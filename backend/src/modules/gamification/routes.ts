import { Router } from 'express'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { db } from '../../db/index.ts'
import type { PoolClient } from 'pg'
import { HttpError, parse, uuid } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'

export const gamification = Router()
const student = [authenticate, requireRole('student')]
const printable = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?').slice(0, 100)

gamification.get('/users/me/streak', ...student, async (req, res) => {
  const { rows: [row] } = await db.query(`
    WITH days AS (SELECT activity_date, row_number() OVER(ORDER BY activity_date DESC) n FROM learner_activity WHERE user_id=$1),
    anchor AS (SELECT activity_date d FROM learner_activity WHERE user_id=$1 AND activity_date >= (now() AT TIME ZONE 'UTC')::date - 1 ORDER BY activity_date DESC LIMIT 1)
    SELECT coalesce((SELECT count(*)::int FROM days,anchor WHERE days.activity_date=anchor.d-(days.n-1)::int),0) streak,
      (SELECT max(activity_date) FROM learner_activity WHERE user_id=$1) last_active
  `, [req.user!.id])
  res.set('Cache-Control','private, no-store').json(row)
})
gamification.get('/users/me/badges', ...student, async (req,res)=>{
  const { rows }=await db.query('SELECT badge_key,awarded_at FROM learner_badges WHERE user_id=$1 ORDER BY awarded_at',[req.user!.id])
  res.set('Cache-Control','private, no-store').json({items:rows})
})
gamification.get('/users/me/certificates', ...student, async(req,res)=>{
  const {rows}=await db.query('SELECT id,course_id,issued_at FROM learner_certificates WHERE user_id=$1 ORDER BY issued_at DESC',[req.user!.id])
  res.set('Cache-Control','private, no-store').json({items:rows})
})
gamification.get('/certificates/:id/download', ...student, async(req,res)=>{
  const id=parse(uuid,req.params.id)
  const {rows:[row]}=await db.query('SELECT pdf FROM learner_certificates WHERE id=$1 AND user_id=$2',[id,req.user!.id])
  if(!row) throw new HttpError(404,'NOT_FOUND','Certificate not found')
  res.set('Cache-Control','private, no-store').type('application/pdf').attachment('certificate.pdf').send(row.pdf)
})

export async function refreshAwards(userId:string, courseId:string, client?:PoolClient){
  const sql=client??db
  await recordActivity(userId,sql)
  const {rows:[row]}=await sql.query('SELECT progress_percent FROM enrollments WHERE user_id=$1 AND course_id=$2',[userId,courseId])
  if(row?.progress_percent<100)return
  await sql.query("INSERT INTO learner_badges(user_id,badge_key) VALUES($1,'first_course') ON CONFLICT DO NOTHING",[userId])
  if(process.env.CERTIFICATE_POLICY_CONFIRMED!=='true')return
  const {rows:[prior]}=await sql.query('SELECT id FROM learner_certificates WHERE user_id=$1 AND course_id=$2 FOR UPDATE',[userId,courseId])
  if(prior)return
  const {rows:[course]}=await sql.query('SELECT c.title,u.full_name FROM courses c JOIN users u ON u.id=$2 WHERE c.id=$1',[courseId,userId])
  const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]),font=await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Certificate of Completion',{x:100,y:570,size:30,font,color:rgb(.1,.25,.4)})
  page.drawText(printable(String(course.title)),{x:80,y:500,size:20,font})
  page.drawText('Awarded to '+printable(String(course.full_name)),{x:80,y:450,size:16,font})
  await sql.query('INSERT INTO learner_certificates(user_id,course_id,pdf) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[userId,courseId,Buffer.from(await pdf.save())])
}

export async function recordActivity(userId:string, sql:PoolClient|typeof db = db){
  await sql.query(`INSERT INTO learner_activity(user_id,activity_date) VALUES($1,(now() AT TIME ZONE 'UTC')::date)
    ON CONFLICT(user_id,activity_date) DO UPDATE SET last_activity_at=now()`,[userId])
  const {rows:[streak]}=await sql.query(`WITH d AS (SELECT activity_date,row_number() OVER(ORDER BY activity_date DESC) n FROM learner_activity WHERE user_id=$1)
    SELECT count(*)::int n FROM d WHERE activity_date=(now() AT TIME ZONE 'UTC')::date-(n-1)::int`,[userId])
  if(streak.n>=7) await sql.query("INSERT INTO learner_badges(user_id,badge_key) VALUES($1,'seven_day_streak') ON CONFLICT DO NOTHING",[userId])
}
