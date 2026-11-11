import { Router } from 'express'
import { db, transaction } from '../../db/index.ts'
import { forbidden, parse, uuid } from '../../http.ts'
import { authenticate, userRateLimit } from '../../middleware/auth.ts'
import { missing, pagination } from '../learning/scope.ts'

export const notifications = Router()

type NotificationRow = {
  id: string
  title: string
  body: string
  is_read: boolean
  created_at: Date | string
  course_id: string | null
}

function notificationView(row: NotificationRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    is_read: row.is_read,
    created_at: row.created_at
  }
}

notifications.get('/notifications/me', authenticate, userRateLimit, async (req, res) => {
  const { page, limit } = parse(pagination, req.query)
  const { rows: [pageData] } = await db.query<{ total: number; items: NotificationRow[] }>(`
    WITH visible AS MATERIALIZED (
      SELECT id, title, body, is_read, created_at, course_id
      FROM notifications n
      WHERE user_id = $1 AND channel = 'in_app'
        AND (n.course_id IS NULL OR EXISTS (
          SELECT 1 FROM courses c
          WHERE c.id = n.course_id AND c.status = 'approved'
            AND ($4::boolean OR (c.instructor_id = $1 AND $5::boolean)
              OR ($6::boolean AND EXISTS (
                SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = $1
              )))
        ))
    ), items AS (
      SELECT * FROM visible ORDER BY created_at DESC, id LIMIT $2 OFFSET $3
    )
    SELECT (SELECT count(*)::int FROM visible) AS total,
      coalesce(jsonb_agg(items ORDER BY created_at DESC, id), '[]') AS items FROM items
  `, [req.user!.id, limit, (page - 1) * limit,
    req.user!.roles.includes('admin'), req.user!.roles.includes('instructor'), req.user!.roles.includes('student')])
  res.set('Cache-Control', 'private, no-store').json({
    page,
    limit,
    total: pageData.total,
    items: pageData.items.map(notificationView)
  })
})

notifications.put('/notifications/:id/read', authenticate, userRateLimit, async (req, res) => {
  const notificationId = parse(uuid, req.params.id)
  const updated = await transaction(async client => {
    const { rows: [row] } = await client.query<NotificationRow>(`
      SELECT id, title, body, is_read, created_at, course_id
      FROM notifications
      WHERE id = $1 AND user_id = $2 AND channel = 'in_app'
      FOR UPDATE
    `, [notificationId, req.user!.id])
    if (!row) throw missing()

    if (row.course_id) {
      const { rows: [membership] } = await client.query<{ instructor_id: string; status: string; enrolled: boolean }>(`
        SELECT c.instructor_id, c.status,
          EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = $2) AS enrolled
        FROM courses c WHERE c.id = $1
      `, [row.course_id, req.user!.id])
      const allowed = req.user!.roles.includes('admin') ||
        (membership?.status === 'approved' && (
          (req.user!.roles.includes('instructor') && membership.instructor_id === req.user!.id) ||
          (req.user!.roles.includes('student') && membership.enrolled)
        ))
      if (!allowed) throw forbidden()
    }

    const { rows: [saved] } = await client.query<NotificationRow>(`
      UPDATE notifications
      SET is_read = true, read_at = coalesce(read_at, now())
      WHERE id = $1
      RETURNING id, title, body, is_read, created_at, course_id
    `, [notificationId])
    return notificationView(saved)
  })
  res.set('Cache-Control', 'private, no-store').json(updated)
})

