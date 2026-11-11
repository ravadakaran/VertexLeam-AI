import { Router } from 'express'
import { z } from 'zod'
import argon2 from 'argon2'
import { randomUUID } from 'node:crypto'
import { db, transaction } from '../../db/index.ts'
import { HttpError, parse, uuid } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import { pagination } from '../learning/scope.ts'
import { postView } from '../discussions/routes.ts'

export const admin = Router()
const onlyAdmin = [authenticate, requireRole('admin')]
const roles = z.array(z.enum(['student', 'instructor', 'admin'])).min(1).max(3).refine(v => new Set(v).size === v.length)

admin.get('/admin/courses/pending', ...onlyAdmin, async (_req,res)=>{
  const {rows}=await db.query(`SELECT c.id,c.title,c.category,c.difficulty,c.status,c.revision,c.submitted_at,
    u.id instructor_id,u.full_name instructor_name FROM courses c JOIN users u ON u.id=c.instructor_id
    WHERE c.status='pending' ORDER BY c.submitted_at,c.id LIMIT 100`)
  res.set('Cache-Control','private, no-store').json({items:rows.map(row=>({...row,revision:`"${row.revision}"`}))})
})

admin.get('/admin/users', ...onlyAdmin, async (req, res) => {
  const { page, limit } = parse(pagination, req.query)
  const result = await db.query(`SELECT u.id,u.full_name,u.email,u.is_active,u.deleted_at,u.revision,u.created_at,
    coalesce(array_agg(r.name ORDER BY r.name) FILTER(WHERE r.name IS NOT NULL),'{}') roles
    FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
    GROUP BY u.id ORDER BY u.created_at DESC,u.id LIMIT $1 OFFSET $2`, [limit, (page - 1) * limit])
  const count = await db.query('SELECT count(*)::int total FROM users')
  res.set('Cache-Control', 'private, no-store').json({ page, limit, total: count.rows[0].total,
    deletion_enabled:process.env.ACCOUNT_DELETION_POLICY_CONFIRMED==='true',items: result.rows })
})

admin.put('/admin/users/:id/roles', ...onlyAdmin, async (req, res) => {
  const id = parse(uuid, req.params.id), requested = parse(roles, req.body?.roles)
  const result = await transaction(async client => {
    const { rows: [user] } = await client.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE', [id])
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'User not found')
    if(user.deleted_at)throw new HttpError(409,'CONFLICT','Deleted accounts cannot be changed')
    if (id === req.user!.id && !requested.includes('admin')) throw new HttpError(409, 'CONFLICT', 'You cannot remove your own admin role')
    if (!requested.includes('admin')) {
      const admins = await client.query("SELECT count(*)::int n FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.name='admin' AND ur.user_id<>$1", [id])
      const current = await client.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.name='admin'", [id])
      if (current.rowCount && admins.rows[0].n === 0) throw new HttpError(409, 'CONFLICT', 'The final admin role cannot be removed')
    }
    await client.query('DELETE FROM user_roles WHERE user_id=$1', [id])
    await client.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=ANY($2::varchar[])', [id, requested])
    await client.query('UPDATE users SET revision=revision+1,updated_at=now() WHERE id=$1', [id])
    await client.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1', [id])
    await client.query("INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES($1,'admin.roles','user',$2,$3)", [req.user!.id, id, { roles: requested, correlation_id: req.requestId }])
    return { id, roles: requested }
  })
  res.set('Cache-Control', 'no-store').json(result)
})

admin.post('/admin/users/:id/suspend', ...onlyAdmin, async (req, res) => {
  const id = parse(uuid, req.params.id), body = z.strictObject({ suspended: z.boolean() }).parse(req.body)
  if (id === req.user!.id && body.suspended) throw new HttpError(409, 'CONFLICT', 'You cannot suspend your own account')
  const result = await transaction(async client => {
    const { rows: [current] } = await client.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE',[id])
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'User not found')
    if(current.deleted_at)throw new HttpError(409,'CONFLICT','Deleted accounts cannot be reactivated')
    const { rows: [user] } = await client.query('UPDATE users SET is_active=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,is_active,revision', [id, !body.suspended])
    if (body.suspended) await client.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1', [id])
    await client.query("INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES($1,$2,'user',$3,$4)", [req.user!.id, body.suspended ? 'admin.suspend' : 'admin.reactivate', id, { correlation_id: req.requestId }])
    return user
  })
  res.set('Cache-Control', 'no-store').json(result)
})

admin.delete('/admin/users/:id', ...onlyAdmin, async (req, res) => {
  if(process.env.ACCOUNT_DELETION_POLICY_CONFIRMED!=='true')throw new HttpError(503,'POLICY_UNCONFIRMED','Account deletion is disabled until DEC-14 is confirmed')
  const id=parse(uuid,req.params.id)
  if(id===req.user!.id)throw new HttpError(409,'CONFLICT','You cannot delete your own account')
  const replacementHash=await argon2.hash(randomUUID())
  const result=await transaction(async client=>{
    const {rows:[target]}=await client.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE',[id])
    if(!target)throw new HttpError(404,'NOT_FOUND','User not found')
    if(target.deleted_at)return {id,deleted:true,deleted_at:target.deleted_at}
    const currentAdmin=await client.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.name='admin'",[id])
    if(currentAdmin.rowCount){
      const others=await client.query("SELECT count(*)::int n FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.name='admin' AND ur.user_id<>$1",[id])
      if(others.rows[0].n===0)throw new HttpError(409,'CONFLICT','The final admin account cannot be deleted')
    }
    await client.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1',[id])
    await client.query('DELETE FROM request_replays WHERE user_id=$1',[id])
    await client.query('DELETE FROM lecture_annotations WHERE user_id=$1',[id])
    await client.query('DELETE FROM ai_chat_sessions WHERE user_id=$1',[id])
    await client.query('DELETE FROM learner_certificates WHERE user_id=$1',[id])
    await client.query('DELETE FROM assignment_submissions WHERE user_id=$1',[id])
    await client.query("DELETE FROM quiz_attempts WHERE user_id=$1 AND status<>'graded'",[id])
    await client.query('UPDATE quiz_attempts SET answers=NULL WHERE user_id=$1 AND status=\'graded\'',[id])
    await client.query('DELETE FROM learner_badges WHERE user_id=$1',[id])
    await client.query('DELETE FROM mastery_events WHERE user_id=$1',[id])
    await client.query('DELETE FROM learner_mastery WHERE user_id=$1',[id])
    await client.query('DELETE FROM learner_recommendations WHERE user_id=$1',[id])
    await client.query('DELETE FROM notifications WHERE user_id=$1',[id])
    await client.query('UPDATE synthetic_payments SET user_id=NULL WHERE user_id=$1',[id])
    await client.query(`UPDATE post_reports SET reporter_id=NULL,reviewed_by=NULL,
      reason=CASE WHEN reporter_id=$1 THEN '[redacted on account deletion]' ELSE reason END WHERE reporter_id=$1 OR reviewed_by=$1`,[id])
    await client.query(`UPDATE moderation_reports SET reporter_id=NULL,reviewed_by=NULL,
      reason=CASE WHEN reporter_id=$1 THEN '[redacted on account deletion]' ELSE reason END WHERE reporter_id=$1 OR reviewed_by=$1`,[id])
    await client.query('UPDATE course_approvals SET comment=NULL WHERE reviewed_by=$1',[id])
    await client.query("UPDATE audit_logs SET metadata=jsonb_build_object('redacted',true,'action',action) WHERE actor_id=$1",[id])
    const {rows:[deleted]}=await client.query(`UPDATE users SET full_name='Deleted account',email='deleted+'||id::text||'@deleted.invalid',
      avatar_url=NULL,password_hash=$2,is_active=false,deleted_at=now(),revision=revision+1,updated_at=now()
      WHERE id=$1 RETURNING id,deleted_at`,[id,replacementHash])
    await client.query('DELETE FROM user_roles WHERE user_id=$1',[id])
    await client.query("INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES($1,'admin.delete','user',$2,$3)",
      [req.user!.id,id,{redacted:true,correlation_id:req.requestId}])
    return {id:deleted.id,deleted:true,deleted_at:deleted.deleted_at}
  })
  res.set('Cache-Control','no-store').json(result)
})

admin.get('/admin/moderation/flagged-posts', ...onlyAdmin, async (req, res) => {
  const { page, limit } = parse(pagination, req.query)
  const { rows: [result] } = await db.query(`
    WITH flagged AS MATERIALIZED (
      SELECT p.id, p.thread_id, p.parent_id, p.content, p.visibility, p.created_at, p.revision
      FROM discussion_posts p
      WHERE p.is_flagged = true OR EXISTS (
        SELECT 1 FROM post_reports pr WHERE pr.post_id = p.id AND pr.status = 'pending'
      )
    ), items AS (
      SELECT * FROM flagged ORDER BY created_at DESC, id LIMIT $1 OFFSET $2
    )
    SELECT (SELECT count(*)::int FROM flagged) AS total,
      coalesce(jsonb_agg(items ORDER BY created_at DESC, id), '[]') AS items FROM items
  `, [limit, (page - 1) * limit])
  res.set('Cache-Control', 'private, no-store').json({
    page,
    limit,
    total: result.total,
    items: result.items.map((row: Parameters<typeof postView>[0]) => postView(row, true))
  })
})

admin.get('/admin/moderation/reports', ...onlyAdmin, async (_req, res) => {
  const { rows } = await db.query(`SELECT id,reporter_id,entity_type,entity_id,reason,status,created_at
    FROM moderation_reports WHERE status='pending' ORDER BY created_at,id LIMIT 100`)
  res.set('Cache-Control', 'private, no-store').json({ items: rows })
})

admin.post('/admin/moderation/reports/:id/review', ...onlyAdmin, async (req, res) => {
  const id = parse(uuid, req.params.id), { decision } = z.strictObject({ decision: z.enum(['actioned','dismissed']) }).parse(req.body)
  const report=await transaction(async client=>{
    const { rows: [updated] } = await client.query(`UPDATE moderation_reports SET status=$2,reviewed_by=$3,reviewed_at=now()
      WHERE id=$1 AND status='pending' RETURNING id,entity_type,entity_id,status,reviewed_by,reviewed_at`, [id, decision, req.user!.id])
    if (!updated) throw new HttpError(409, 'CONFLICT', 'Report is missing or already reviewed')
    if (updated.entity_type === 'content') {
      await client.query(`
        UPDATE post_reports SET status=$2,reviewed_by=$3,reviewed_at=now()
        WHERE status='pending' AND (moderation_report_id=$1 OR post_id=$4)
      `, [id, decision, req.user!.id, updated.entity_id])
      await client.query(`
        UPDATE discussion_posts
        SET visibility = CASE WHEN $2 = 'actioned' THEN 'hidden' ELSE visibility END,
            is_flagged = EXISTS (SELECT 1 FROM post_reports pr WHERE pr.post_id = $1 AND pr.status = 'pending'),
            revision = revision + 1
        WHERE id = $1
      `, [updated.entity_id, decision])
    }
    await client.query("INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES($1,'moderation.review','report',$2,$3)", [req.user!.id, id, { decision, correlation_id: req.requestId }])
    return { id: updated.id, status: updated.status, reviewed_by: updated.reviewed_by, reviewed_at: updated.reviewed_at }
  })
  res.json(report)
})
