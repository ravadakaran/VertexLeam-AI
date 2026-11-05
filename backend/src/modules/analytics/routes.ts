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
      JOIN lectures l ON l.id=p.lecture_id JOIN modules m ON m.id=l.module_id WHERE e.course_id=$1)
    SELECT (SELECT count(*)::int FROM starters) starts,(SELECT count(*)::int FROM completions c JOIN starters s USING(user_id,lecture_id)) completes,
      (SELECT average FROM scores) average_quiz_score,(SELECT count FROM scores) finalized_attempts,(SELECT seconds FROM times) time_on_task_seconds
  `,[id,from,to])
  const row=result.rows[0]
  res.set('Cache-Control','private, no-store').json({course_id:id,window:{from:from.toISOString(),to:to.toISOString()},...row,
    dropoff_percent:row.starts?Math.round(10000*(row.starts-row.completes)/row.starts)/100:null})
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
    FROM synthetic_payments WHERE status='succeeded' AND created_at >= $1 AND created_at <= $2`, [from,to])
  res.set('Cache-Control','private, no-store').json({...row,completion_rate:row.cohort?Math.round(10000*row.completed/row.cohort)/100:null,
    revenue:{amount:revenue.currencies <= 1 ? Number(revenue.amount) : null,currency:revenue.currencies <= 1 ? revenue.currency : 'mixed',provenance:'synthetic payments'}})
})
