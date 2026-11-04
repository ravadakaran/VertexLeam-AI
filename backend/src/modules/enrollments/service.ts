import type { Pagination } from '../../types.ts'
import { db, transaction } from '../../db/index.ts'
import { HttpError } from '../../http.ts'

const fields = 'e.id, e.course_id, e.progress_percent::float8, e.enrolled_at'

export function enroll(userId: string, courseId: string) {
  return transaction(async client => {
    const visible = await client.query("SELECT id FROM courses WHERE id = $1 AND status = 'approved' FOR SHARE", [courseId])
    if (!visible.rowCount) throw new HttpError(404, 'NOT_FOUND', 'Course not found')
    await client.query(`
      INSERT INTO enrollments(user_id, course_id) VALUES ($1, $2)
      ON CONFLICT (user_id, course_id) DO NOTHING
    `, [userId, courseId])
    const { rows: [row] } = await client.query(`
      SELECT ${fields} FROM enrollments e WHERE e.user_id = $1 AND e.course_id = $2
    `, [userId, courseId])
    return row
  })
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

