import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { transaction } from '../../db/index.ts'
import { parse, sendResource, uuid } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import { conflict, invalid, keySchema, missing, moduleScope, pagination, replay, revisionSchema, text } from '../learning/scope.ts'
import type { Profile } from '../../types.ts'
import { recordActivity } from '../gamification/routes.ts'
import { recordQuizMastery } from '../personalization/routes.ts'

export const quizzes = Router()
const author = [authenticate, requireRole('instructor', 'admin')]
const student = [authenticate, requireRole('student')]
const member = [authenticate, requireRole('student', 'instructor', 'admin')]
const id = (req: Request) => parse(uuid, req.params.id)
const key = (req: Request) => parse(keySchema, req.get('Idempotency-Key'))
const revision = (req: Request) => parse(revisionSchema, req.get('If-Match'))
const points = z.number().min(0).max(10000).multipleOf(.01)
const question = z.strictObject({
  question_text: text(12000), question_type: z.enum(['mcq', 'multi_select', 'short_answer']),
  max_points: points, rubric: text(12000).optional(), topic_id: uuid.optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  options: z.array(z.strictObject({ option_text: text(12000), is_correct: z.boolean() })).max(20).optional()
}).refine(q => {
  const options = q.options ?? []
  if (q.question_type === 'short_answer') return !options.length && Boolean(q.rubric)
  const correct = options.filter(option => option.is_correct).length
  return options.length >= 2 && (q.question_type === 'mcq' ? correct === 1 : correct > 0)
})
const versionInput = z.strictObject({
  title: text(200), questions: z.array(question).min(1).max(50).refine(items => items.some(item => item.max_points > 0))
})
const createInput = versionInput.extend({ module_id: uuid, lecture_id: uuid.optional() })
const answer = z.strictObject({
  question_id: uuid, selected_option_ids: z.array(uuid).max(20).optional(), text_answer: text(12000).optional()
})
const answersInput = z.strictObject({ answers: z.array(answer).max(50) })
const grading = z.strictObject({ scores: z.array(z.strictObject({ question_id: uuid, points })).min(1).max(50) })
const reviewInput = z.strictObject({ decision: z.enum(['approved', 'rejected']), comment: text(12000).optional() })
type Question = Omit<z.infer<typeof question>, 'options'> & {
  id: string; options?: Array<{ id: string; option_text: string; is_correct: boolean }>
}
type Quiz = { id: string; module_id: string; is_ai_generated: boolean; latest: number; published: number | null }
type Version = { revision: number; title: string; status: string; questions: Question[] }
type Attempt = {
  id: string; quiz_id: string; quiz_revision: number; user_id: string; status: string; revision: number
  objective_score: string | null; score: string | null; submitted_at: Date | null; points: Record<string, number> | null
  answers: Array<z.infer<typeof answer>> | null
}
const etag = (value: number) => `"${value}"`
const hundredths = (value: number) => Math.round(value * 100)
const percent = (earned: number, maximum: number) => Math.round(10000 * earned / maximum) / 100
const quizView = (quiz: Quiz, version: Version) => ({
  id: quiz.id, module_id: quiz.module_id, is_ai_generated: quiz.is_ai_generated,
  title: version.title, status: version.status, revision: etag(version.revision)
})

function attemptView(attempt: Attempt, questions?: Question[]) {
  return { id: attempt.id, quiz_id: attempt.quiz_id, status: attempt.status, revision: etag(attempt.revision),
    ...(attempt.objective_score !== null && { objective_score: Number(attempt.objective_score) }),
    ...(attempt.score !== null && { score: Number(attempt.score) }),
    ...(attempt.submitted_at && { submitted_at: attempt.submitted_at }),
    ...(questions && { questions: questions.map(q => ({
      id: q.id, question_text: q.question_text, question_type: q.question_type, max_points: q.max_points,
      ...(q.options && { options: q.options.map(({ id, option_text }) => ({ id, option_text })) })
    })) })
  }
}

async function scopedQuiz(client: PoolClient, user: Profile, quizId: string, access: 'author' | 'learner', lock = false) {
  const { rows: [quiz] } = await client.query<Quiz>('SELECT * FROM quizzes WHERE id=$1', [quizId])
  if (!quiz) throw missing()
  await moduleScope(client, user, quiz.module_id, access)
  if (!lock) return quiz
  const { rows: [current] } = await client.query<Quiz>('SELECT * FROM quizzes WHERE id=$1 FOR UPDATE', [quizId])
  if (!current) throw missing()
  return current
}

async function version(client: PoolClient, quizId: string, number: number) {
  const { rows: [row] } = await client.query<Version>('SELECT * FROM quiz_revisions WHERE quiz_id=$1 AND revision=$2', [quizId, number])
  if (!row) throw missing()
  return row
}

async function addVersion(client: PoolClient, quizId: string, number: number, body: z.infer<typeof versionInput>) {
  const questions = body.questions.map(q => ({
    ...q, id: randomUUID(), options: q.options?.map(option => ({ ...option, id: randomUUID() }))
  }))
  const { rows: [row] } = await client.query<Version>(`
    INSERT INTO quiz_revisions(quiz_id,revision,title,status,questions) VALUES($1,$2,$3,'draft',$4) RETURNING *
  `, [quizId, number, body.title, JSON.stringify(questions)])
  return row
}

async function scopedAttempt(client: PoolClient, user: Profile, attemptId: string, access: 'author' | 'learner', lock = false) {
  const { rows: [attempt] } = await client.query<Attempt>('SELECT * FROM quiz_attempts WHERE id=$1', [attemptId])
  if (!attempt || (access === 'learner' && attempt.user_id !== user.id)) throw missing()
  await scopedQuiz(client, user, attempt.quiz_id, access)
  if (!lock) return attempt
  const { rows: [current] } = await client.query<Attempt>('SELECT * FROM quiz_attempts WHERE id=$1 FOR UPDATE', [attemptId])
  if (!current) throw missing()
  return current
}

quizzes.post('/quizzes', ...author, async (req, res) => {
  const body = parse(createInput, req.body), requestKey = key(req)
  const result = await transaction(async client => {
    await moduleScope(client, req.user!, body.module_id, 'author')
    if (body.lecture_id) {
      const { rowCount } = await client.query('SELECT 1 FROM lectures WHERE id=$1 AND module_id=$2', [body.lecture_id, body.module_id])
      if (!rowCount) throw missing()
    }
    return replay(client, req.user!.id, 'quiz:' + body.module_id, requestKey, body, async () => {
      const { rows: [quiz] } = await client.query<Quiz>('INSERT INTO quizzes(module_id,lecture_id) VALUES($1,$2) RETURNING *',
        [body.module_id, body.lecture_id ?? null])
      return quizView(quiz, await addVersion(client, quiz.id, 1, body))
    })
  })
  sendResource(res, result, 201)
})
quizzes.get('/modules/:id/quizzes', ...member, async (req, res) => {
  const moduleId = id(req), { page, limit } = parse(pagination, req.query)
  const result = await transaction(async client => {
    const { rows: [owner] } = await client.query(`
      SELECT c.instructor_id FROM modules m JOIN courses c ON c.id=m.course_id WHERE m.id=$1
    `, [moduleId])
    const authored = req.user!.roles.includes('admin') || (req.user!.roles.includes('instructor') && owner?.instructor_id === req.user!.id)
    await moduleScope(client, req.user!, moduleId, authored ? 'author' : 'learner')
    const { rows: [row] } = await client.query(`
      WITH visible AS MATERIALIZED (
        SELECT q.id,q.module_id,q.is_ai_generated,v.title,v.status,v.revision FROM quizzes q
        JOIN quiz_revisions v ON v.quiz_id=q.id AND v.revision=CASE WHEN $2 THEN q.latest ELSE q.published END
        WHERE q.module_id=$1
      ), items AS (SELECT * FROM visible ORDER BY id LIMIT $3 OFFSET $4)
      SELECT (SELECT count(*)::int FROM visible) AS total, coalesce(jsonb_agg(items ORDER BY id),'[]') AS items FROM items
    `, [moduleId, authored, limit, (page - 1) * limit])
    return row
  })
  res.set('Cache-Control', 'private, no-store').json({ ...result, page, limit,
    items: result.items.map((row: Quiz & Version) => quizView(row, row)) })
})
quizzes.get('/quizzes/:id/review', ...author, async (req, res) => {
  const quizId = id(req)
  const result = await transaction(async client => {
    const quiz = await scopedQuiz(client, req.user!, quizId, 'author')
    const latest = await version(client, quizId, quiz.latest)
    return { quiz: quizView(quiz, latest), questions: latest.questions.map(q => ({
      question_text: q.question_text, question_type: q.question_type, max_points: q.max_points,
      ...(q.rubric && { rubric: q.rubric }), ...(q.topic_id && { topic_id: q.topic_id }),
      ...(Array.isArray((q as any).source_chunks) && { source_chunks: (q as any).source_chunks }),
      ...(q.difficulty && { difficulty: q.difficulty }),
      ...(q.options && { options: q.options.map(({ option_text, is_correct }) => ({ option_text, is_correct })) })
    })) }
  })
  res.set('Cache-Control', 'private, no-store').set('ETag', result.quiz.revision).json(result)
})
quizzes.put('/quizzes/:id', ...author, async (req, res) => {
  const quizId = id(req), expected = revision(req), body = parse(versionInput, req.body)
  const result = await transaction(async client => {
    const quiz = await scopedQuiz(client, req.user!, quizId, 'author', true)
    if (etag(quiz.latest) !== expected) throw conflict('Quiz revision is stale')
    const draft = await addVersion(client, quizId, quiz.latest + 1, body)
    await client.query('UPDATE quizzes SET latest=$2 WHERE id=$1', [quizId, draft.revision])
    return quizView(quiz, draft)
  })
  sendResource(res, result)
})
quizzes.post('/quizzes/:id/review', ...author, async (req, res) => {
  const quizId = id(req), expected = revision(req), requestKey = key(req), body = parse(reviewInput, req.body)
  const result = await transaction(async client => {
    const quiz = await scopedQuiz(client, req.user!, quizId, 'author', true)
    return replay(client, req.user!.id, 'quiz-review:' + quizId, requestKey, [expected, body], async () => {
      const draft = await version(client, quizId, quiz.latest)
      if (etag(quiz.latest) !== expected || draft.status !== 'draft') throw conflict('Quiz revision is stale or has already been reviewed')
      // Record the decision as its own revision so both draft and published ETags are immutable.
      const reviewed = quiz.latest + 1
      await client.query(`
        INSERT INTO quiz_revisions(quiz_id,revision,title,status,questions) VALUES($1,$2,$3,$4,$5)
      `, [quizId, reviewed, draft.title, body.decision, JSON.stringify(draft.questions)])
      await client.query('UPDATE quizzes SET latest=$2,published=CASE WHEN $3 THEN $2 ELSE published END WHERE id=$1',
        [quizId, reviewed, body.decision === 'approved'])
      await client.query(`
        INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES($1,'quiz.review','quiz',$2,$3)
      `, [req.user!.id, quizId, { decision: body.decision, comment: body.comment, revision: reviewed, correlation_id: req.requestId }])
      return quizView(quiz, { ...draft, revision: reviewed, status: body.decision })
    })
  })
  sendResource(res, result)
})
quizzes.post('/quizzes/:id/attempt', ...student, async (req, res) => {
  const quizId = id(req), requestKey = key(req)
  const result = await transaction(async client => {
    const quiz = await scopedQuiz(client, req.user!, quizId, 'learner', true)
    if (!quiz.published) throw missing()
    return replay(client, req.user!.id, 'quiz-start:' + quizId, requestKey, {}, async () => {
      const { rows: [prior] } = await client.query<Attempt>(`
        SELECT * FROM quiz_attempts WHERE quiz_id=$1 AND user_id=$2 AND status='in_progress'
      `, [quizId, req.user!.id])
      const attempt = prior ?? (await client.query<Attempt>(`
        INSERT INTO quiz_attempts(quiz_id,quiz_revision,user_id) VALUES($1,$2,$3) RETURNING *
      `, [quizId, quiz.published, req.user!.id])).rows[0]
      const published = await version(client, quizId, attempt.quiz_revision)
      return attemptView(attempt, published.questions)
    })
  })
  sendResource(res.set('Cache-Control', 'private, no-store'), result, 201)
})
quizzes.get('/quizzes/:id/attempts', ...member, async (req, res) => {
  const quizId = id(req), { page, limit } = parse(pagination, req.query)
  const result = await transaction(async client => {
    const { rows: [owner] } = await client.query(`
      SELECT c.instructor_id FROM quizzes q JOIN modules m ON m.id=q.module_id JOIN courses c ON c.id=m.course_id WHERE q.id=$1
    `, [quizId])
    const authored = req.user!.roles.includes('admin') ||
      (req.user!.roles.includes('instructor') && owner?.instructor_id === req.user!.id)
    await scopedQuiz(client, req.user!, quizId, authored ? 'author' : 'learner')
    const { rows: [pageData] } = await client.query(`
      WITH visible AS MATERIALIZED (
        SELECT a.id,a.quiz_id,a.status,a.revision,a.objective_score,a.score,a.submitted_at,a.started_at,
          CASE WHEN $2 THEN a.answers END AS answers,
          CASE WHEN $2 THEN v.questions END AS questions
        FROM quiz_attempts a JOIN quiz_revisions v ON v.quiz_id=a.quiz_id AND v.revision=a.quiz_revision
        WHERE a.quiz_id=$1 AND (CASE WHEN $2 THEN a.status='pending_review' ELSE a.user_id=$3 END)
      ), items AS (SELECT * FROM visible ORDER BY started_at DESC,id LIMIT $4 OFFSET $5)
      SELECT (SELECT count(*)::int FROM visible) AS total, coalesce(jsonb_agg(items ORDER BY started_at DESC,id),'[]') AS items FROM items
    `, [quizId, authored, req.user!.id, limit, (page - 1) * limit])
    return { page, limit, total: pageData.total, items: pageData.items.map((row: Attempt & { questions: Question[] | null }) => ({
      ...attemptView(row),
      ...(authored && { review: row.questions!.filter(q => q.question_type === 'short_answer').map(q => ({
        question_id: q.id, question_text: q.question_text, rubric: q.rubric, max_points: q.max_points,
        text_answer: row.answers?.find(answer => answer.question_id === q.id)?.text_answer
      })) })
    })) }
  })
  res.set('Cache-Control', 'private, no-store').json(result)
})
quizzes.get('/attempts/:id', ...student, async (req, res) => {
  const attemptId = id(req)
  const result = await transaction(async client => {
    const attempt = await scopedAttempt(client, req.user!, attemptId, 'learner')
    const pinned = await version(client, attempt.quiz_id, attempt.quiz_revision)
    return attemptView(attempt, attempt.status === 'in_progress' ? pinned.questions : undefined)
  })
  sendResource(res.set('Cache-Control', 'private, no-store'), result)
})
quizzes.post('/attempts/:id/submit', ...student, async (req, res) => {
  const attemptId = id(req), requestKey = key(req), body = parse(answersInput, req.body)
  const result = await transaction(async client => {
    const attempt = await scopedAttempt(client, req.user!, attemptId, 'learner', true)
    return replay(client, req.user!.id, 'quiz-submit:' + attemptId, requestKey, body, async () => {
      if (attempt.status !== 'in_progress') throw conflict('Attempt was already submitted')
      const { questions } = await version(client, attempt.quiz_id, attempt.quiz_revision)
      const byId = new Map(questions.map(q => [q.id, q]))
      const answers = new Map(body.answers.map(item => [item.question_id, item]))
      if (answers.size !== body.answers.length) throw invalid('Answers must have unique question IDs')
      for (const [questionId, item] of answers) {
        const q = byId.get(questionId)
        if (!q) throw invalid('Answer does not belong to this attempt')
        const selected = item.selected_option_ids ?? []
        if (q.question_type === 'short_answer') {
          if (item.selected_option_ids !== undefined) throw invalid('Short answers require text')
        } else if (item.text_answer !== undefined || new Set(selected).size !== selected.length ||
            (q.question_type === 'mcq' && selected.length > 1) ||
            selected.some(option => !q.options?.some(candidate => candidate.id === option))) {
          throw invalid('Selected options do not match this question')
        }
      }
      const scored: Record<string, number> = {}
      let earned = 0, maximum = 0
      const manual = questions.some(q => q.question_type === 'short_answer')
      for (const q of questions) {
        if (q.question_type === 'short_answer') continue
        const selected = answers.get(q.id)?.selected_option_ids ?? []
        const correct = q.options!.filter(option => option.is_correct).map(option => option.id)
        const available = hundredths(q.max_points)
        scored[q.id] = selected.length === correct.length && selected.every(option => correct.includes(option)) ? available : 0
        earned += scored[q.id]
        maximum += available
      }
      const objective = maximum ? percent(earned, maximum) : null
      const { rows: [updated] } = await client.query<Attempt>(`
        UPDATE quiz_attempts SET status=$2,submitted_at=clock_timestamp(),answers=$3,points=$4,
          objective_score=$5,score=$6,graded_at=CASE WHEN $2='graded' THEN clock_timestamp() END,revision=revision+1 WHERE id=$1 RETURNING *
      `, [attemptId, manual ? 'pending_review' : 'graded', JSON.stringify(body.answers), scored, objective, manual ? null : objective])
      if (!manual) await recordQuizMastery(client, req.user!.id, attemptId, questions, scored)
      if (!manual && objective === 100) {
        await client.query("INSERT INTO learner_badges(user_id,badge_key) VALUES($1,'perfect_quiz') ON CONFLICT DO NOTHING", [req.user!.id])
      }
      await recordActivity(req.user!.id, client)
      return attemptView(updated)
    })
  })
  sendResource(res.set('Cache-Control', 'private, no-store'), result)
})
quizzes.put('/attempts/:id/grade', ...author, async (req, res) => {
  const attemptId = id(req), expected = revision(req), body = parse(grading, req.body)
  const result = await transaction(async client => {
    const attempt = await scopedAttempt(client, req.user!, attemptId, 'author', true)
    if (attempt.status !== 'pending_review' || etag(attempt.revision) !== expected) throw conflict('Attempt revision is stale or closed')
    const { questions } = await version(client, attempt.quiz_id, attempt.quiz_revision)
    const manual = questions.filter(q => q.question_type === 'short_answer')
    const scores = new Map(body.scores.map(item => [item.question_id, hundredths(item.points)]))
    if (scores.size !== body.scores.length || scores.size !== manual.length ||
        manual.some(q => !scores.has(q.id) || scores.get(q.id)! > hundredths(q.max_points))) throw invalid('Score each short answer within its maximum')
    const scored = { ...attempt.points, ...Object.fromEntries(scores) }
    const earned = Object.values(scored).reduce((sum, value) => sum + value, 0)
    const maximum = questions.reduce((sum, q) => sum + hundredths(q.max_points), 0)
    const { rows: [updated] } = await client.query<Attempt>(`
      UPDATE quiz_attempts SET status='graded',score=$2,points=$3,revision=revision+1 WHERE id=$1 RETURNING *
    `, [attemptId, percent(earned, maximum), scored])
    await recordQuizMastery(client, attempt.user_id, attemptId, questions, scored)
    await client.query('UPDATE quiz_attempts SET graded_at=now() WHERE id=$1', [attemptId])
    if (percent(earned, maximum) === 100) {
      await client.query("INSERT INTO learner_badges(user_id,badge_key) VALUES($1,'perfect_quiz') ON CONFLICT DO NOTHING", [attempt.user_id])
    }
    await client.query(`
      INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES($1,'quiz.grade','attempt',$2,$3)
    `, [req.user!.id, attemptId, { revision: updated.revision, correlation_id: req.requestId }])
    return attemptView(updated)
  })
  sendResource(res.set('Cache-Control', 'private, no-store'), result)
})
