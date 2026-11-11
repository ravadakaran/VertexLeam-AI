import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { db, transaction } from '../../db/index.ts'
import { HttpError, parse, sendResource, uuid } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import type { Profile } from '../../types.ts'
import { enqueueOutboxEvent } from '../../jobs/outbox.ts'
import { conflict, courseScope, invalid, keySchema, missing, pagination, replay, revisionSchema, text, type Sql } from '../learning/scope.ts'

export const discussions = Router()

const author = [authenticate, requireRole('instructor', 'admin')]
const member = [authenticate, requireRole('student', 'instructor', 'admin')]
const id = (req: Request) => parse(uuid, req.params.id)
const key = (req: Request) => parse(keySchema, req.get('Idempotency-Key'))

const threadBody = z.strictObject({ title: text(200), content: text(12000) })
const postBody = z.strictObject({ content: text(12000), parent_id: uuid.optional() })
const reportBody = z.strictObject({ reason: text(12000) })
const moderationBody = z.strictObject({
  decision: z.enum(['hide', 'restore', 'dismiss']),
  reason: text(12000)
})
const announcementBody = z.strictObject({ content: text(12000) })

type ThreadRow = { id: string; course_id: string; title: string; created_at: Date | string }
type PostRow = {
  id: string
  thread_id: string
  parent_id: string | null
  content: string
  visibility: string
  created_at: Date | string
  revision: number
}
type AnnouncementRow = { id: string; course_id: string; content: string; created_at: Date | string }

export function postView(row: PostRow, authored = true) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    ...(row.parent_id !== null && { parent_id: row.parent_id }),
    content: row.visibility === 'hidden' && !authored ? '[Hidden by moderation]' : row.content,
    visibility: row.visibility,
    created_at: row.created_at,
    revision: `"${row.revision}"`
  }
}

async function memberScope(sql: Sql, user: Profile, courseId: string) {
  const { rows: [row] } = await sql.query<{ instructor_id: string }>('SELECT instructor_id FROM courses WHERE id = $1', [courseId])
  if (!row) throw missing()
  const authored = user.roles.includes('admin') || (user.roles.includes('instructor') && row.instructor_id === user.id)
  await courseScope(sql, user, courseId, authored ? 'author' : 'learner')
  return authored
}

discussions.get('/courses/:id/threads', ...member, async (req, res) => {
  const courseId = id(req), { page, limit } = parse(pagination, req.query)
  const result = await transaction(async client => {
    await memberScope(client, req.user!, courseId)
    const { rows: [pageData] } = await client.query<{ total: number; items: ThreadRow[] }>(`
      WITH visible AS MATERIALIZED (
        SELECT id, course_id, title, created_at
        FROM discussion_threads WHERE course_id = $1
      ), items AS (
        SELECT * FROM visible ORDER BY created_at DESC, id LIMIT $2 OFFSET $3
      )
      SELECT (SELECT count(*)::int FROM visible) AS total,
        coalesce(jsonb_agg(items ORDER BY created_at DESC, id), '[]') AS items FROM items
    `, [courseId, limit, (page - 1) * limit])
    return pageData
  })
  res.set('Cache-Control', 'private, no-store').json({ ...result, page, limit })
})

discussions.post('/courses/:id/threads', ...member, async (req, res) => {
  const courseId = id(req), requestKey = key(req), body = parse(threadBody, req.body)
  const thread = await transaction(async client => {
    await memberScope(client, req.user!, courseId)
    return replay(client, req.user!.id, 'thread:' + courseId, requestKey, body, async () => {
      const { rows: [created] } = await client.query<ThreadRow>(`
        INSERT INTO discussion_threads(course_id, created_by, title)
        VALUES ($1, $2, $3) RETURNING id, course_id, title, created_at
      `, [courseId, req.user!.id, body.title])
      await client.query(`
        INSERT INTO discussion_posts(thread_id, user_id, content)
        VALUES ($1, $2, $3)
      `, [created.id, req.user!.id, body.content])
      return created
    })
  })
  res.status(201).set('Cache-Control', 'private, no-store').json(thread)
})

discussions.get('/threads/:id/posts', ...member, async (req, res) => {
  const threadId = id(req), { page, limit } = parse(pagination, req.query)
  const { authored, pageData } = await transaction(async client => {
    const { rows: [thread] } = await client.query<{ id: string; course_id: string }>(
      'SELECT id, course_id FROM discussion_threads WHERE id = $1', [threadId]
    )
    if (!thread) throw missing()
    const isAuthor = await memberScope(client, req.user!, thread.course_id)
    const { rows: [result] } = await client.query<{ total: number; items: PostRow[] }>(`
      WITH visible AS MATERIALIZED (
        SELECT id, thread_id, parent_id, content, visibility, created_at, revision
        FROM discussion_posts WHERE thread_id = $1
      ), items AS (
        SELECT * FROM visible ORDER BY created_at ASC, id ASC LIMIT $2 OFFSET $3
      )
      SELECT (SELECT count(*)::int FROM visible) AS total,
        coalesce(jsonb_agg(items ORDER BY created_at ASC, id ASC), '[]') AS items FROM items
    `, [threadId, limit, (page - 1) * limit])
    return { authored: isAuthor, pageData: result }
  })
  res.set('Cache-Control', 'private, no-store').json({
    page,
    limit,
    total: pageData.total,
    items: pageData.items.map(row => postView(row, authored))
  })
})

discussions.post('/threads/:id/posts', ...member, async (req, res) => {
  const threadId = id(req), requestKey = key(req), body = parse(postBody, req.body)
  let newOutboxId: string | undefined
  const post = await transaction(async client => {
    const { rows: [thread] } = await client.query<{ id: string; course_id: string }>(
      'SELECT id, course_id FROM discussion_threads WHERE id = $1', [threadId]
    )
    if (!thread) throw missing()
    await memberScope(client, req.user!, thread.course_id)
    return replay(client, req.user!.id, 'post:' + threadId, requestKey, body, async () => {
      if (body.parent_id) {
        const { rows: [parent] } = await client.query<{ id: string; thread_id: string }>(
          'SELECT id, thread_id FROM discussion_posts WHERE id = $1', [body.parent_id]
        )
        if (!parent || parent.thread_id !== threadId) {
          throw invalid('Parent post must belong to the same thread')
        }
      }
      const { rows: [created] } = await client.query<PostRow>(`
        INSERT INTO discussion_posts(thread_id, parent_id, user_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id, thread_id, parent_id, content, visibility, created_at, revision
      `, [threadId, body.parent_id ?? null, req.user!.id, body.content])

      const { rows: [outbox] } = await client.query<{ id: string }>(`
        INSERT INTO outbox(event_type, aggregate_type, aggregate_id, payload)
        VALUES ('discussion.reply', 'discussion_post', $1, $2)
        RETURNING id
      `, [created.id, JSON.stringify({
        course_id: thread.course_id,
        thread_id: threadId,
        post_id: created.id,
        user_id: req.user!.id,
        ...(body.parent_id && { parent_id: body.parent_id })
      })])
      newOutboxId = outbox.id
      return postView(created, true)
    })
  })
  if (newOutboxId) await enqueueOutboxEvent(newOutboxId)
  sendResource(res.set('Cache-Control', 'private, no-store'), post, 201)
})

discussions.post('/posts/:id/report', ...member, async (req, res) => {
  const postId = id(req), requestKey = key(req), body = parse(reportBody, req.body)
  const report = await transaction(async client => {
    const { rows: [post] } = await client.query<{ id: string; course_id: string }>(`
      SELECT p.id, t.course_id
      FROM discussion_posts p JOIN discussion_threads t ON t.id = p.thread_id
      WHERE p.id = $1
    `, [postId])
    if (!post) throw missing()
    await memberScope(client, req.user!, post.course_id)
    return replay(client, req.user!.id, 'post-report:' + postId, requestKey, body, async () => {
      const { rowCount: existing } = await client.query(
        "SELECT 1 FROM post_reports WHERE post_id = $1 AND reporter_id = $2 AND status = 'pending'",
        [postId, req.user!.id]
      )
      if (existing) throw conflict('You have already reported this post')

      const { rows: [modReport] } = await client.query<{ id: string }>(`
        INSERT INTO moderation_reports(reporter_id, entity_type, entity_id, reason, status)
        VALUES ($1, 'content', $2, $3, 'pending')
        RETURNING id
      `, [req.user!.id, postId, body.reason])

      const { rows: [postReport] } = await client.query<{ id: string; post_id: string; status: string }>(`
        INSERT INTO post_reports(post_id, reporter_id, reason, status, moderation_report_id)
        VALUES ($1, $2, $3, 'pending', $4)
        RETURNING id, post_id, status
      `, [postId, req.user!.id, body.reason, modReport.id])

      await client.query('UPDATE discussion_posts SET is_flagged = true WHERE id = $1', [postId])
      return postReport
    })
  })
  res.status(201).set('Cache-Control', 'private, no-store').json(report)
})

discussions.put('/posts/:id/moderation', ...author, async (req, res) => {
  const postId = id(req)
  const rawIfMatch = req.get('If-Match')
  const expectedRevision = rawIfMatch !== undefined ? parse(revisionSchema, rawIfMatch) : undefined
  const body = parse(moderationBody, req.body)

  const moderated = await transaction(async client => {
    const { rows: [post] } = await client.query<PostRow & { course_id: string }>(`
      SELECT p.id, p.thread_id, p.parent_id, p.content, p.visibility, p.created_at, p.revision, t.course_id
      FROM discussion_posts p JOIN discussion_threads t ON t.id = p.thread_id
      WHERE p.id = $1 FOR UPDATE OF p
    `, [postId])
    if (!post) throw missing()
    await courseScope(client, req.user!, post.course_id, 'author')
    if (expectedRevision !== undefined && `"${post.revision}"` !== expectedRevision) {
      throw conflict('Post revision is stale')
    }

    const nextVisibility =
      body.decision === 'hide' ? 'hidden' : body.decision === 'restore' ? 'visible' : post.visibility
    const reportStatus = body.decision === 'hide' ? 'actioned' : 'dismissed'

    const { rows: [updated] } = await client.query<PostRow>(`
      UPDATE discussion_posts
      SET visibility = $2, is_flagged = false, revision = revision + 1
      WHERE id = $1
      RETURNING id, thread_id, parent_id, content, visibility, created_at, revision
    `, [postId, nextVisibility])

    await client.query(`
      UPDATE post_reports
      SET status = $2, reviewed_by = $3, reviewed_at = now()
      WHERE post_id = $1 AND status = 'pending'
    `, [postId, reportStatus, req.user!.id])

    await client.query(`
      UPDATE moderation_reports
      SET status = $2, reviewed_by = $3, reviewed_at = now()
      WHERE entity_type = 'content' AND entity_id = $1 AND status = 'pending'
    `, [postId, reportStatus, req.user!.id])

    await client.query(`
      INSERT INTO audit_logs(actor_id, action, entity, entity_id, metadata)
      VALUES ($1, 'post.moderation', 'post', $2, $3)
    `, [req.user!.id, postId, { decision: body.decision, reason: body.reason, revision: updated.revision, correlation_id: req.requestId }])

    return postView(updated, true)
  })
  if (!moderated) throw new HttpError(404, 'NOT_FOUND', 'Post not found')
  sendResource(res.set('Cache-Control', 'private, no-store'), moderated)
})

discussions.get('/courses/:id/announcements', ...member, async (req, res) => {
  const courseId = id(req), { page, limit } = parse(pagination, req.query)
  const result = await transaction(async client => {
    await memberScope(client, req.user!, courseId)
    const { rows: [pageData] } = await client.query<{ total: number; items: AnnouncementRow[] }>(`
      WITH visible AS MATERIALIZED (
        SELECT id, course_id, content, created_at
        FROM announcements WHERE course_id = $1
      ), items AS (
        SELECT * FROM visible ORDER BY created_at DESC, id LIMIT $2 OFFSET $3
      )
      SELECT (SELECT count(*)::int FROM visible) AS total,
        coalesce(jsonb_agg(items ORDER BY created_at DESC, id), '[]') AS items FROM items
    `, [courseId, limit, (page - 1) * limit])
    return pageData
  })
  res.set('Cache-Control', 'private, no-store').json({ ...result, page, limit })
})

discussions.post('/courses/:id/announcements', ...author, async (req, res) => {
  const courseId = id(req), requestKey = key(req), body = parse(announcementBody, req.body)
  let newOutboxId: string | undefined
  const announcement = await transaction(async client => {
    await courseScope(client, req.user!, courseId, 'author')
    return replay(client, req.user!.id, 'announcement:' + courseId, requestKey, body, async () => {
      const { rows: [created] } = await client.query<AnnouncementRow>(`
        INSERT INTO announcements(course_id, posted_by, content)
        VALUES ($1, $2, $3)
        RETURNING id, course_id, content, created_at
      `, [courseId, req.user!.id, body.content])

      const { rows: [outbox] } = await client.query<{ id: string }>(`
        INSERT INTO outbox(event_type, aggregate_type, aggregate_id, payload)
        VALUES ('course.announcement', 'announcement', $1, $2)
        RETURNING id
      `, [created.id, JSON.stringify({ course_id: courseId, announcement_id: created.id })])
      newOutboxId = outbox.id
      return created
    })
  })
  if (newOutboxId) await enqueueOutboxEvent(newOutboxId)
  res.status(201).set('Cache-Control', 'private, no-store').json(announcement)
})
