import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { db, transaction } from '../../db/index.ts'
import { HttpError, parse, sendResource, uuid } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import { courseScope, conflict, digest, invalid, keySchema, missing, pagination, replay, revisionSchema, text, type Sql } from '../learning/scope.ts'
import { grant, grantUser } from '../learning/grants.ts'
import { limitUploads, upload, validateFile } from '../learning/uploads.ts'
import type { Profile } from '../../types.ts'

export const assignments = Router()
const author = [authenticate, requireRole('instructor', 'admin')]
const student = [authenticate, requireRole('student')]
const member = [authenticate, requireRole('student', 'instructor', 'admin')]
const id = (req: Request) => parse(uuid, req.params.id)
const key = (req: Request) => parse(keySchema, req.get('Idempotency-Key'))
const points = z.number().min(0).max(10000).multipleOf(.01)
const rubric = z.array(z.strictObject({ id: uuid, label: text(12000), max_points: points }))
  .min(1).max(50).refine(items => items.some(item => item.max_points > 0) &&
    new Set(items.map(item => item.id)).size === items.length)
type Criterion = z.infer<typeof rubric>[number]
const assignmentBody = z.strictObject({
  course_id: uuid, title: text(200), instructions: text(12000), due_date: z.iso.datetime({ offset: true }), rubric
})
const grades = z.strictObject({
  scores: z.array(z.strictObject({ criterion_id: uuid, points })).min(1).max(50),
  feedback: text(12000).optional()
})
type Assignment = { id: string; course_id: string; title: string; instructions: string; due_date: Date; rubric: Criterion[] }
type Submission = { id: string; assignment_id: string; user_id: string; submitted_at: Date; grade: string | null;
  feedback: string | null; revision: number; name: string; mime: string; data: Buffer }

function submissionView(row: Submission) {
  return { id: row.id, assignment_id: row.assignment_id, user_id: row.user_id, submitted_at: row.submitted_at,
    ...(row.grade !== null && { grade: Number(row.grade) }), ...(row.feedback !== null && { feedback: row.feedback }),
    revision: `"${row.revision}"` }
}

async function findAssignment(sql: Sql, assignmentId: string) {
  const { rows: [row] } = await sql.query<Assignment>('SELECT * FROM assignments WHERE id=$1', [assignmentId])
  if (!row) throw missing()
  return row
}

async function memberScope(sql: Sql, user: Profile, course: string) {
  const { rows: [row] } = await sql.query('SELECT instructor_id FROM courses WHERE id=$1', [course])
  const authored = user.roles.includes('admin') || (user.roles.includes('instructor') && row?.instructor_id === user.id)
  await courseScope(sql, user, course, authored ? 'author' : 'learner')
  return authored
}

async function submissionScope(sql: Sql, user: Profile, submissionId: string, authorOnly = false) {
  const { rows: [row] } = await sql.query<Submission & { course_id: string }>(`
    SELECT s.id,s.assignment_id,s.user_id,s.submitted_at,s.grade,s.feedback,s.revision,a.course_id
    FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=$1
  `, [submissionId])
  if (!row) throw missing()
  if (authorOnly) await courseScope(sql, user, row.course_id, 'author')
  else if (!await memberScope(sql, user, row.course_id) && row.user_id !== user.id) throw missing()
  return row
}

assignments.post('/assignments', ...author, async (req, res) => {
  const body = parse(assignmentBody, req.body), requestKey = key(req)
  const row = await transaction(async client => {
    await courseScope(client, req.user!, body.course_id, 'author')
    return replay(client, req.user!.id, 'assignment:' + body.course_id, requestKey, body, async () => {
      const { rows: [created] } = await client.query<Assignment>(`
        INSERT INTO assignments(course_id,title,instructions,due_date,rubric)
        SELECT $1,$2,$3,$4,$5 WHERE $4::timestamptz > clock_timestamp() RETURNING *
      `, [body.course_id, body.title, body.instructions, body.due_date, JSON.stringify(body.rubric)])
      if (!created) throw invalid('Deadline must be in the future')
      return created
    })
  })
  res.status(201).json(row)
})
assignments.get('/courses/:id/assignments', ...member, async (req, res) => {
  const course = id(req), { page, limit } = parse(pagination, req.query)
  const result = await transaction(async client => {
    await memberScope(client, req.user!, course)
    const { rows: [row] } = await client.query(`
      WITH visible AS MATERIALIZED (SELECT * FROM assignments WHERE course_id=$1),
      items AS (SELECT * FROM visible ORDER BY due_date,id LIMIT $2 OFFSET $3)
      SELECT (SELECT count(*)::int FROM visible) AS total,
        coalesce(jsonb_agg(items ORDER BY due_date,id),'[]') AS items FROM items
    `, [course, limit, (page - 1) * limit])
    return row
  })
  res.set('Cache-Control', 'private, no-store').json({ ...result, page, limit })
})
assignments.post('/assignments/:id/submit', ...student, async (req: Request, res: Response, next: NextFunction) => {
  const assignment = await findAssignment(db, id(req))
  await courseScope(db, req.user!, assignment.course_id, 'learner')
  key(req)
  if (!req.is('multipart/form-data')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use multipart/form-data')
  next()
}, limitUploads, upload.single('file'), async (req, res) => {
  const assignmentId = id(req), requestKey = key(req), file = req.file
  if (!file || Object.keys(req.body ?? {}).length) throw invalid('Attach one file')
  const result = await transaction(async client => {
    const assignment = await findAssignment(client, assignmentId)
    await courseScope(client, req.user!, assignment.course_id, 'learner')
    return replay(client, req.user!.id, 'submission:' + assignmentId, requestKey, [file.originalname, digest(file.buffer)], async () => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        'submission-slot:' + assignmentId + ':' + req.user!.id
      ])
      const asset = await validateFile(file, 'submission')
      const { rows: [row] } = await client.query<Submission>(`
        WITH checked AS MATERIALIZED (SELECT clock_timestamp() AS accepted_at)
        INSERT INTO assignment_submissions(assignment_id,user_id,submitted_at,name,mime,data)
        SELECT a.id,$2,c.accepted_at,$3,$4,$5 FROM assignments a CROSS JOIN checked c
        WHERE a.id=$1 AND c.accepted_at<a.due_date
        ON CONFLICT(assignment_id,user_id) DO NOTHING
        RETURNING id,assignment_id,user_id,submitted_at,grade,feedback,revision
      `, [assignment.id, req.user!.id, asset.name, asset.mime, asset.data])
      if (!row) throw conflict('The deadline passed or you already submitted this assignment')
      return submissionView(row)
    })
  })
  sendResource(res.set('Cache-Control', 'private, no-store'), result, 201)
})
assignments.get('/assignments/:id/submissions', ...member, async (req, res) => {
  const assignmentId = id(req), { page, limit } = parse(pagination, req.query)
  const result = await transaction(async client => {
    const assignment = await findAssignment(client, assignmentId)
    const authored = await memberScope(client, req.user!, assignment.course_id)
    const { rows: [row] } = await client.query(`
      WITH visible AS MATERIALIZED (SELECT id,assignment_id,user_id,submitted_at,grade,feedback,revision
        FROM assignment_submissions WHERE assignment_id=$1 AND ($2::boolean OR user_id=$3)),
      items AS (SELECT * FROM visible ORDER BY submitted_at,id LIMIT $4 OFFSET $5)
      SELECT (SELECT count(*)::int FROM visible) AS total,
        coalesce(jsonb_agg(items ORDER BY submitted_at,id),'[]') AS items FROM items
    `, [assignmentId, authored, req.user!.id, limit, (page - 1) * limit])
    return row
  })
  res.set('Cache-Control', 'private, no-store').json({ ...result, page, limit, items: result.items.map(submissionView) })
})
assignments.put('/submissions/:id/grade', ...author, async (req, res) => {
  const submissionId = id(req), revision = parse(revisionSchema, req.get('If-Match')), body = parse(grades, req.body)
  const result = await transaction(async client => {
    const submission = await submissionScope(client, req.user!, submissionId, true)
    const assignment = await findAssignment(client, submission.assignment_id)
    const scores = new Map(body.scores.map(score => [score.criterion_id, score.points]))
    if (scores.size !== body.scores.length || scores.size !== assignment.rubric.length ||
        assignment.rubric.some(criterion => !scores.has(criterion.id) || scores.get(criterion.id)! > criterion.max_points)) {
      throw invalid('Provide one score within the maximum for every rubric criterion')
    }
    const cents = (value: number) => Math.round(value * 100)
    const maximum = assignment.rubric.reduce((total, criterion) => total + cents(criterion.max_points), 0)
    const earned = body.scores.reduce((total, score) => total + cents(score.points), 0)
    const { rows: [row] } = await client.query<Submission>(`
      UPDATE assignment_submissions SET grade=$3,feedback=$4,rubric_scores=$5,revision=revision+1
      WHERE id=$1 AND revision::text=$2 RETURNING id,assignment_id,user_id,submitted_at,grade,feedback,revision
    `, [submissionId, revision.slice(1, -1), earned / maximum * 100, body.feedback ?? null, JSON.stringify(body.scores)])
    if (!row) throw conflict('Submission revision is stale')
    await client.query(`
      INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata)
      VALUES($1,'assignment.grade','submission',$2,$3)
    `, [req.user!.id, row.id, { revision: row.revision, correlation_id: req.requestId }])
    return submissionView(row)
  })
  sendResource(res.set('Cache-Control', 'private, no-store'), result)
})
assignments.get('/submissions/:id/file', ...member, async (req, res) => {
  const submission = id(req)
  await submissionScope(db, req.user!, submission)
  res.set('Cache-Control', 'private, no-store').json(grant(req, 'submission:' + submission, '/api/v1/private/submissions/' + submission))
})
assignments.get('/private/submissions/:id', async (req, res) => {
  const submission = id(req), user = await grantUser(req.query.grant, 'submission:' + submission)
  const asset = await transaction(async client => {
    await submissionScope(client, user, submission)
    const { rows: [row] } = await client.query('SELECT name,mime,data FROM assignment_submissions WHERE id=$1', [submission])
    if (!row) throw missing()
    return row
  })
  res.set('Cache-Control', 'private, no-store').attachment(asset.name).type(asset.mime).send(asset.data)
})
