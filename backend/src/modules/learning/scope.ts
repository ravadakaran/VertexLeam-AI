import type { Pool, PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { HttpError, forbidden } from '../../http.ts'
import type { Profile } from '../../types.ts'
import { db } from '../../db/index.ts'

export type Sql = Pool | PoolClient
export const missing = () => new HttpError(404, 'NOT_FOUND', 'Resource not found')
export const conflict = (message = 'The request conflicts with current state') => new HttpError(409, 'CONFLICT', message)
export const invalid = (message: string) => new HttpError(422, 'DOMAIN_ERROR', message)
export const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !value.includes('\0'))
export const ordinal = z.int().min(0).max(2147483647)
export const keySchema = z.string().min(8).max(128)
export const revisionSchema = z.string().regex(/^"\d+"$/)
export const studentRoles = ['student'] as const
export const pagination = z.strictObject({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(2147483647)).default(1),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(100)).default(20)
})
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

export async function courseScope(sql: Sql, user: Pick<Profile, 'id' | 'roles'>, id: string, access: 'author' | 'learner') {
  const { rows: [course] } = await sql.query<{ id: string; instructor_id: string; status: string; enrollment_id: string | null }>(`
    SELECT c.id, c.instructor_id, c.status, e.id AS enrollment_id FROM courses c
    LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $2
    WHERE c.id = $1 FOR SHARE OF c
  `, [id, user.id])
  if (!course) throw missing()
  if (access === 'author') {
    if (course.status === 'archived' || (!user.roles.includes('admin') &&
        (!user.roles.includes('instructor') || course.instructor_id !== user.id))) throw missing()
    return course
  }
  if (course.status !== 'approved') throw missing()
  if (!user.roles.includes('student') || !course.enrollment_id) throw forbidden()
  return { ...course, enrollment_id: course.enrollment_id }
}

export async function moduleScope(sql: Sql, user: Profile, id: string, access: 'author' | 'learner') {
  const { rows: [row] } = await sql.query<{ course_id: string }>('SELECT course_id FROM modules WHERE id = $1', [id])
  if (!row) throw missing()
  return courseScope(sql, user, row.course_id, access)
}

export async function lectureScope(sql: Sql, user: Pick<Profile, 'id' | 'roles'>, id: string, access: 'author' | 'learner') {
  const { rows: [row] } = await sql.query<{ course_id: string; duration_seconds: number; media_status: string }>(`
    SELECT m.course_id, l.duration_seconds, l.media_status FROM lectures l JOIN modules m ON m.id = l.module_id
    WHERE l.id = $1
  `, [id])
  if (!row) throw missing()
  return { ...row, ...await courseScope(sql, user, row.course_id, access) }
}

export async function replay<T>(client: PoolClient, user: string, scope: string, key: string, input: unknown, work: () => Promise<T>): Promise<T> {
  const hash = digest(JSON.stringify(input))
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([user, scope, key])])
  const { rows: [prior] } = await client.query<{ digest: string; response: T }>(
    'SELECT digest, response FROM request_replays WHERE user_id = $1 AND scope = $2 AND key = $3', [user, scope, key])
  if (prior) {
    if (prior.digest !== hash) throw conflict('Idempotency key was used for a different request')
    return prior.response
  }
  const result = await work()
  await client.query('INSERT INTO request_replays(user_id, scope, key, digest, response) VALUES ($1,$2,$3,$4,$5)',
    [user, scope, key, hash, JSON.stringify(result)])
  return result
}

export async function curriculum(courseId: string, sql: Sql = db) {
  const { rows } = await sql.query(`
    SELECT m.*, coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'module_id', l.module_id, 'title', l.title, 'order_index', l.order_index,
        'media_status', l.media_status, 'duration_seconds', l.duration_seconds,
        'resources', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'title', a.name, 'content_type', a.mime)
          ORDER BY a.name) FROM lecture_assets a WHERE a.lecture_id = l.id AND a.resource), '[]')
      ) ORDER BY l.order_index) FROM lectures l WHERE l.module_id = m.id
    ), '[]') AS lectures FROM modules m WHERE m.course_id = $1 ORDER BY m.order_index
  `, [courseId])
  return rows
}
