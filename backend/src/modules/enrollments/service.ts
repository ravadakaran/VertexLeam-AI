import type { Pagination } from '../../types.ts'
import { db, transaction } from '../../db/index.ts'
import { HttpError } from '../../http.ts'
import { invalidateLeaderboard } from '../gamification/routes.ts'

const fields = 'e.id, e.course_id, c.title AS course_title, e.progress_percent::float8, e.enrolled_at'

export async function enroll(userId: string, courseId: string) {
  const row = await transaction(async client => {
    const visible = await client.query("SELECT id FROM courses WHERE id = $1 AND status = 'approved' FOR SHARE", [courseId])
    if (!visible.rowCount) throw new HttpError(404, 'NOT_FOUND', 'Course not found')
    await client.query(`
      INSERT INTO enrollments(user_id, course_id) VALUES ($1, $2)
      ON CONFLICT (user_id, course_id) DO NOTHING
    `, [userId, courseId])
    const { rows: [enrolled] } = await client.query(`
      SELECT ${fields} FROM enrollments e JOIN courses c ON c.id = e.course_id
      WHERE e.user_id = $1 AND e.course_id = $2
    `, [userId, courseId])
    return enrolled
  })
  await invalidateLeaderboard(courseId)
  return row
}

export async function listEnrollments(userId: string, { page, limit }: Pagination) {
  const { rows: [result] } = await db.query(`
    WITH matches AS MATERIALIZED (
      SELECT ${fields} FROM enrollments e JOIN courses c ON c.id = e.course_id
      WHERE e.user_id = $1 AND c.status = 'approved'
    ), items AS (
      SELECT * FROM matches ORDER BY enrolled_at DESC, id LIMIT $2 OFFSET $3
    )
    SELECT (SELECT count(*) FROM matches) AS total,
      coalesce(jsonb_agg(items ORDER BY enrolled_at DESC, id), '[]') AS items FROM items
  `, [userId, limit, (page - 1) * limit])
  return { items: result.items, page, limit, total: Number(result.total) }
}

