import { Router } from 'express'
import { db } from '../../db/index.ts'
import { HttpError, parse, uuid } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'

export const analytics = Router()
const owner = [authenticate,requireRole('instructor','admin')]
const page = (req:any)=>({from: typeof req.query.from==='string'?new Date(req.query.from):new Date(Date.now()-30*86400000),to:typeof req.query.to==='string'?new Date(req.query.to):new Date(Date.now() + 60000)})
function validRange(from:Date,to:Date){if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||from>=to)throw new HttpError(422,'VALIDATION_ERROR','Analytics window is invalid')}
analytics.get('/instructor/courses/:id/analytics',...owner,async(req,res)=>{
  const id=parse(uuid,req.params.id),{from,to}=page(req);validRange(from,to)
  const {rows:[scope]}=await db.query('SELECT instructor_id FROM courses WHERE id=$1',[id])
  if(!scope||(!req.user!.roles.includes('admin')&&scope.instructor_id!==req.user!.id)){res.status(404).json({error:{code:'NOT_FOUND',message:'Resource not found'}});return}
  const result=await db.query(`
    WITH starters AS (
      SELECT DISTINCT e.user_id,l.id lecture_id FROM enrollments e JOIN modules m ON m.course_id=e.course_id JOIN lectures l ON l.module_id=m.id
      JOIN playback_events p ON p.enrollment_id=e.id AND p.lecture_id=l.id
      WHERE e.course_id=$1 AND p.created_at >= $2 AND p.created_at < $3 AND e.user_id IS NOT NULL
    ), completions AS (SELECT DISTINCT e.user_id,p.lecture_id FROM enrollments e JOIN lecture_progress p ON p.enrollment_id=e.id
      JOIN lectures l ON l.id=p.lecture_id JOIN modules m ON m.id=l.module_id WHERE e.course_id=$1 AND
      (SELECT coalesce(sum(upper(watched.range)-lower(watched.range)),0) FROM unnest(p.coverage) AS watched(range))>=l.duration_seconds),
    scores AS (SELECT avg(a.score)::numeric(5,2) average,count(*)::int count FROM quiz_attempts a JOIN quizzes q ON q.id=a.quiz_id
      JOIN modules m ON m.id=q.module_id WHERE m.course_id=$1 AND a.status='graded' AND a.graded_at >= $2 AND a.graded_at < $3),
    times AS (SELECT coalesce(sum(least(60,upper(watched.range)-lower(watched.range))),0)::int seconds FROM enrollments e JOIN lecture_progress p ON p.enrollment_id=e.id
      CROSS JOIN LATERAL unnest(p.coverage) AS watched(range)
      JOIN lectures l ON l.id=p.lecture_id JOIN modules m ON m.id=l.module_id WHERE e.course_id=$1),
    rewatches AS (SELECT coalesce(sum(p.rewatch_count),0)::int total FROM enrollments e JOIN lecture_progress p ON p.enrollment_id=e.id WHERE e.course_id=$1)
    SELECT (SELECT count(*)::int FROM starters) starts,(SELECT count(*)::int FROM completions c JOIN starters s USING(user_id,lecture_id)) completes,
      (SELECT average FROM scores) average_quiz_score,(SELECT count FROM scores) finalized_attempts,(SELECT seconds FROM times) time_on_task_seconds,
      (SELECT total FROM rewatches) rewatch_count
  `,[id,from,to])
  const row=result.rows[0]
  const lectureMetrics = await db.query(`
    SELECT l.id lecture_id, l.title, l.duration_seconds,
      count(DISTINCT pe.event_id)::int starts,
      count(DISTINCT CASE WHEN coalesce((SELECT sum(upper(r)-lower(r))::int FROM unnest(p.coverage) AS r), 0) >= l.duration_seconds THEN p.enrollment_id END)::int completes,
      coalesce((SELECT round(avg(lp.position_seconds))::int FROM lecture_progress lp JOIN enrollments le ON le.id=lp.enrollment_id WHERE le.course_id=$1 AND lp.lecture_id=l.id), 0) dropoff_seconds,
      coalesce((SELECT sum(lp.rewatch_count)::int FROM lecture_progress lp JOIN enrollments le ON le.id=lp.enrollment_id WHERE le.course_id=$1 AND lp.lecture_id=l.id), 0) rewatch_count,
      coalesce((SELECT round(avg(CASE WHEN l.duration_seconds > 0 THEN (SELECT sum(upper(r)-lower(r))::numeric * 100 / l.duration_seconds FROM unnest(lp.coverage) AS r) ELSE 0 END), 1)::float FROM lecture_progress lp JOIN enrollments le ON le.id=lp.enrollment_id WHERE le.course_id=$1 AND lp.lecture_id=l.id), 0)::float avg_watch_percent
    FROM modules m
    JOIN lectures l ON l.module_id=m.id
    LEFT JOIN enrollments e ON e.course_id=m.course_id
    LEFT JOIN lecture_progress p ON p.enrollment_id=e.id AND p.lecture_id=l.id
    LEFT JOIN playback_events pe ON pe.enrollment_id=e.id AND pe.lecture_id=l.id AND pe.created_at >= $2 AND pe.created_at < $3
    WHERE m.course_id=$1
    GROUP BY l.id, l.title, l.duration_seconds, l.order_index, m.order_index
    ORDER BY m.order_index, l.order_index
  `, [id, from, to])

  // Phase 4: Assessment Analytics - Question difficulty breakdown & most incorrect questions
  const { rows: questionStats } = await db.query(`
    WITH course_quizzes AS (
      SELECT q.id quiz_id, qr.title quiz_title, qr.questions
      FROM quizzes q
      JOIN modules m ON m.id = q.module_id
      JOIN quiz_revisions qr ON qr.quiz_id = q.id AND qr.revision = q.published
      WHERE m.course_id = $1 AND q.published IS NOT NULL
    ),
    unfolded_questions AS (
      SELECT 
        cq.quiz_id,
        cq.quiz_title,
        elem->>'id' question_id,
        elem->>'question_text' question_text,
        elem->>'question_type' question_type,
        coalesce((elem->>'max_points')::numeric, 1) max_points,
        elem->>'topic_id' topic_id
      FROM course_quizzes cq
      CROSS JOIN LATERAL jsonb_array_elements(cq.questions) elem
    ),
    attempt_answers AS (
      SELECT 
        a.id attempt_id,
        a.quiz_id,
        a.points
      FROM quiz_attempts a
      JOIN quizzes q ON q.id = a.quiz_id
      JOIN modules m ON m.id = q.module_id
      WHERE m.course_id = $1 AND a.status = 'graded' AND a.points IS NOT NULL
        AND a.graded_at >= $2 AND a.graded_at < $3
    )
    SELECT 
      uq.quiz_id,
      uq.quiz_title,
      uq.question_id,
      uq.question_text,
      uq.question_type,
      uq.max_points::float max_points,
      count(aa.attempt_id)::int total_attempts,
      count(aa.attempt_id) FILTER (WHERE (aa.points->>(uq.question_id))::numeric >= uq.max_points * 100)::int correct_attempts,
      (count(aa.attempt_id) - count(aa.attempt_id) FILTER (WHERE (aa.points->>(uq.question_id))::numeric >= uq.max_points * 100))::int incorrect_attempts
    FROM unfolded_questions uq
    LEFT JOIN attempt_answers aa ON aa.quiz_id = uq.quiz_id AND aa.points ? uq.question_id
    GROUP BY uq.quiz_id, uq.quiz_title, uq.question_id, uq.question_text, uq.question_type, uq.max_points
    ORDER BY uq.quiz_title, uq.question_id
  `, [id, from, to])

  const formattedQuestions = questionStats.map((q: any) => {
    const successRate = q.total_attempts > 0 ? Math.round((q.correct_attempts * 1000) / q.total_attempts) / 10 : null
    let difficulty = 'unassessed'
    if (successRate !== null) {
      if (successRate < 50) difficulty = 'hard'
      else if (successRate < 80) difficulty = 'moderate'
      else difficulty = 'easy'
    }
    return {
      ...q,
      success_rate: successRate,
      difficulty
    }
  })

  const mostIncorrect = [...formattedQuestions]
    .filter(q => q.total_attempts > 0)
    .sort((a, b) => (a.success_rate ?? 100) - (b.success_rate ?? 100) || b.incorrect_attempts - a.incorrect_attempts)
    .slice(0, 5)

  // Phase 4: AI Analytics - Frequently asked tutor topics and questions
  const { rows: tutorSessions } = await db.query(`
    SELECT s.id session_id, s.user_id, count(m.id)::int message_count
    FROM ai_chat_sessions s
    LEFT JOIN ai_chat_messages m ON m.session_id = s.id
    WHERE s.course_id = $1 AND s.created_at >= $2 AND s.created_at < $3
    GROUP BY s.id, s.user_id
  `, [id, from, to])

  const { rows: tutorQueries } = await db.query(`
    SELECT m.content, m.created_at
    FROM ai_chat_messages m
    JOIN ai_chat_sessions s ON s.id = m.session_id
    WHERE s.course_id = $1 AND m.role = 'user' AND m.created_at >= $2 AND m.created_at < $3
    ORDER BY m.created_at DESC LIMIT 50
  `, [id, from, to])

  const { rows: courseTopics } = await db.query(`
    SELECT id, name FROM learning_topics WHERE course_id = $1 ORDER BY name
  `, [id])

  const topicFrequencyMap = new Map<string, number>()
  for (const t of courseTopics) topicFrequencyMap.set(t.name, 0)

  const stopWords = new Set(['what', 'when', 'where', 'which', 'who', 'whom', 'this', 'that', 'with', 'from', 'have', 'more', 'some', 'explain', 'could', 'would', 'should', 'about', 'please', 'help'])
  const keywordFreq = new Map<string, number>()

  for (const query of tutorQueries) {
    const text = query.content.toLowerCase()
    for (const t of courseTopics) {
      if (text.includes(t.name.toLowerCase())) {
        topicFrequencyMap.set(t.name, (topicFrequencyMap.get(t.name) ?? 0) + 1)
      }
    }
    const words = text.match(/[a-z]{4,}/g) ?? []
    for (const w of words) {
      if (!stopWords.has(w)) {
        keywordFreq.set(w, (keywordFreq.get(w) ?? 0) + 1)
      }
    }
  }

  const frequentTopics: Array<{ topic: string; count: number }> = []
  for (const [topic, count] of topicFrequencyMap.entries()) {
    if (count > 0) frequentTopics.push({ topic, count })
  }
  for (const [kw, count] of keywordFreq.entries()) {
    if (count >= 2 && !frequentTopics.some(ft => ft.topic.toLowerCase() === kw)) {
      frequentTopics.push({ topic: kw.charAt(0).toUpperCase() + kw.slice(1), count })
    }
  }
  frequentTopics.sort((a, b) => b.count - a.count)

  res.set('Cache-Control','private, no-store').json({
    course_id:id,
    window:{from:from.toISOString(),to:to.toISOString()},
    ...row,
    dropoff_percent:row.starts?Math.round(10000*(row.starts-row.completes)/row.starts)/100:null,
    lectures: lectureMetrics.rows.map((item: any) => ({
      ...item,
      dropoff_percent: item.starts ? Math.round(10000*(item.starts-item.completes)/item.starts)/100 : null
    })),
    assessment_analytics: {
      average_score: row.average_quiz_score ? Number(row.average_quiz_score) : null,
      finalized_attempts: row.finalized_attempts ?? 0,
      questions: formattedQuestions,
      most_incorrect: mostIncorrect
    },
    ai_analytics: {
      total_queries: tutorQueries.length,
      unique_students: new Set(tutorSessions.map(s => s.user_id)).size,
      total_sessions: tutorSessions.length,
      frequent_topics: frequentTopics.slice(0, 8),
      recent_questions: tutorQueries.slice(0, 5).map(q => ({ content: q.content, created_at: q.created_at }))
    }
  })
})

analytics.get('/admin/analytics/overview',authenticate,requireRole('admin'),async(req,res)=>{
  const {from,to}=page(req);validRange(from,to)
  const {rows:[row]}=await db.query(`
    SELECT (SELECT count(DISTINCT user_id)::int FROM learner_activity WHERE activity_date >= $1::date AND activity_date < $2::date) dau,
      (SELECT count(*)::int FROM enrollments WHERE enrolled_at >= $1 AND enrolled_at < $2) enrollments,
      (SELECT count(*)::int FROM enrollments WHERE progress_percent>=100 AND enrolled_at >= $1 AND enrolled_at < $2) completed,
      (SELECT count(*)::int FROM enrollments WHERE enrolled_at >= $1 AND enrolled_at < $2) cohort
  `,[from,to])
  const { rows: [revenue] } = await db.query(`SELECT coalesce(sum(amount),0)::numeric(12,2) amount,
    coalesce(min(currency),'INR') currency,count(DISTINCT currency)::int currencies
    FROM synthetic_payments WHERE status='succeeded' AND created_at >= $1 AND created_at < $2`, [from,to])
  const { rows: [aiUsage] } = await db.query(`SELECT count(*)::int requests,
    coalesce(sum(input_tokens),0)::bigint input_tokens,
    coalesce(sum(output_tokens),0)::bigint output_tokens,
    coalesce(sum(input_tokens + output_tokens),0)::bigint total_tokens
    FROM ai_provider_usage WHERE recorded_at >= $1 AND recorded_at < $2`, [from,to])
  const { rows: [platform] } = await db.query(`SELECT
    (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) total_users,
    (SELECT count(*)::int FROM users WHERE is_active=true AND deleted_at IS NULL) active_users,
    (SELECT count(*)::int FROM users WHERE is_active=false AND deleted_at IS NULL) suspended_users,
    (SELECT count(*)::int FROM courses WHERE status='approved') approved_courses,
    (SELECT count(*)::int FROM courses WHERE status='pending') pending_courses,
    (SELECT count(*)::int FROM moderation_reports WHERE status='pending') pending_reports,
    (SELECT count(*)::int FROM discussion_posts WHERE is_flagged=true OR visibility='hidden') flagged_posts`)
  res.set('Cache-Control','private, no-store').json({
    ...row,
    completion_rate:row.cohort?Math.round(10000*row.completed/row.cohort)/100:null,
    revenue:{amount:revenue.currencies <= 1 ? Number(revenue.amount) : null,currency:revenue.currencies <= 1 ? revenue.currency : 'mixed',provenance:'synthetic payments'},
    ai_usage:{
      requests: Number(aiUsage?.requests ?? 0),
      input_tokens: Number(aiUsage?.input_tokens ?? 0),
      output_tokens: Number(aiUsage?.output_tokens ?? 0),
      total_tokens: Number(aiUsage?.total_tokens ?? 0)
    },
    platform_overview:{
      total_users: Number(platform.total_users),
      active_users: Number(platform.active_users),
      suspended_users: Number(platform.suspended_users),
      approved_courses: Number(platform.approved_courses),
      pending_courses: Number(platform.pending_courses),
      pending_reports: Number(platform.pending_reports),
      flagged_posts: Number(platform.flagged_posts)
    }
  })
})
