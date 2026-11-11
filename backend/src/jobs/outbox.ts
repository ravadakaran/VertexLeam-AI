import { createClient, type RedisClientType } from 'redis'
import { db, transaction } from '../db/index.ts'
import { getConfig } from '../config/env.ts'
import { logger } from '../utils/logger.ts'
import { observeOutboxJob } from '../utils/metrics.ts'
import { sendEmail } from './email.ts'

export const NOTIFICATION_QUEUE_KEY = 'vertexlearn:queue:notifications'

type OutboxRow = {
  id: string
  event_type: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
  status: string
}

type DeliveryPlan = {
  userId: string
  email: string | null
  title: string
  body: string
}

let queueClient: RedisClientType | null = null
let inlineHook: ((outboxId: string) => void) | null = null

export function setOutboxEnqueueHook(hook: ((outboxId: string) => void) | null): void {
  inlineHook = hook
}

export async function connectQueue(): Promise<RedisClientType | null> {
  const { redisQueueUrl } = getConfig()
  if (!redisQueueUrl) return null
  if (!queueClient) {
    queueClient = createClient({
      url: redisQueueUrl,
      disableOfflineQueue: true,
      socket: { connectTimeout: 3000 }
    })
    queueClient.on('error', () => {
      logger.warn('outbox.queue_error', { reason: 'Redis queue connection unavailable' })
    })
  }
  if (!queueClient.isOpen) {
    await queueClient.connect().catch(() => {
      logger.warn('outbox.queue_connect_failed', { reason: 'Redis queue connect failed' })
    })
  }
  return queueClient.isOpen ? queueClient : null
}

export async function closeQueue(): Promise<void> {
  if (queueClient?.isOpen) {
    await queueClient.quit().catch(() => queueClient?.destroy())
  }
  queueClient = null
}

export async function enqueueOutboxEvent(outboxId: string): Promise<void> {
  if (inlineHook) {
    inlineHook(outboxId)
    return
  }
  try {
    const client = queueClient?.isOpen ? queueClient : await connectQueue()
    if (client?.isOpen) {
      await client.lPush(NOTIFICATION_QUEUE_KEY, outboxId)
    }
  } catch {
    // PG outbox row remains authoritative; reconcilePendingOutbox handles durable replay.
  }
}

async function resolveDeliveries(eventType: string, payload: Record<string, unknown>): Promise<{
  courseId: string | null
  recipients: DeliveryPlan[]
}> {
  if (eventType === 'course.announcement') {
    const courseId = String(payload.course_id ?? '')
    const announcementId = String(payload.announcement_id ?? '')
    const { rows: [announcement] } = await db.query<{ content: string; course_title: string }>(`
      SELECT a.content, c.title AS course_title
      FROM announcements a JOIN courses c ON c.id = a.course_id
      WHERE a.id = $1 AND a.course_id = $2
    `, [announcementId, courseId])
    if (!announcement) return { courseId: courseId || null, recipients: [] }

    const { rows: enrolled } = await db.query<{ id: string; email: string }>(`
      SELECT DISTINCT u.id, u.email
      FROM enrollments e
      JOIN users u ON u.id = e.user_id
      WHERE e.course_id = $1 AND u.is_active AND u.deleted_at IS NULL
    `, [courseId])

    const excerpt = announcement.content.slice(0, 500)
    return {
      courseId,
      recipients: enrolled.map(user => ({
        userId: user.id,
        email: user.email,
        title: `Announcement: ${announcement.course_title}`.slice(0, 150),
        body: excerpt
      }))
    }
  }

  if (eventType === 'discussion.reply') {
    const courseId = String(payload.course_id ?? '')
    const threadId = String(payload.thread_id ?? '')
    const postId = String(payload.post_id ?? '')
    const authorId = String(payload.user_id ?? payload.author_id ?? '')
    const parentId = typeof payload.parent_id === 'string' ? payload.parent_id : null

    const { rows: [context] } = await db.query<{
      thread_title: string
      course_title: string
      instructor_id: string
      post_content: string
    }>(`
      SELECT t.title AS thread_title, c.title AS course_title, c.instructor_id, p.content AS post_content
      FROM discussion_threads t
      JOIN courses c ON c.id = t.course_id
      JOIN discussion_posts p ON p.id = $2 AND p.thread_id = t.id
      WHERE t.id = $1 AND t.course_id = $3
    `, [threadId, postId, courseId])
    if (!context) return { courseId: courseId || null, recipients: [] }

    const { rows: candidates } = await db.query<{ id: string; email: string }>(`
      SELECT DISTINCT u.id, u.email
      FROM users u
      WHERE u.is_active AND u.deleted_at IS NULL AND u.id <> $1 AND (
        u.id = $2
        OR u.id = (SELECT user_id FROM discussion_posts WHERE thread_id = $3 ORDER BY created_at, id LIMIT 1)
        OR ($4::uuid IS NOT NULL AND u.id = (SELECT user_id FROM discussion_posts WHERE id = $4))
      )
      AND (
        u.id = $2
        OR EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id AND e.course_id = $5)
      )
    `, [authorId, context.instructor_id, threadId, parentId, courseId])

    const excerpt = context.post_content.slice(0, 500)
    return {
      courseId,
      recipients: candidates.map(user => ({
        userId: user.id,
        email: user.email,
        title: `New reply in ${context.thread_title}`.slice(0, 150),
        body: excerpt
      }))
    }
  }

  return { courseId: null, recipients: [] }
}

async function dispatchRecipient(eventId: string, courseId: string | null, plan: DeliveryPlan) {
  await db.query(`
    INSERT INTO notifications(user_id, course_id, event_id, channel, title, body, delivery_status)
    VALUES ($1, $2, $3, 'in_app', $4, $5, 'delivered')
    ON CONFLICT (event_id, user_id, channel) DO NOTHING
  `, [plan.userId, courseId, eventId, plan.title, plan.body])

  if (!plan.email) return

  await db.query(`
    INSERT INTO notifications(user_id, course_id, event_id, channel, title, body, delivery_status)
    VALUES ($1, $2, $3, 'email', $4, $5, 'pending')
    ON CONFLICT (event_id, user_id, channel) DO NOTHING
  `, [plan.userId, courseId, eventId, plan.title, plan.body])

  const { rows: [pendingEmail] } = await db.query<{ id: string }>(`
    SELECT id FROM notifications
    WHERE event_id = $1 AND user_id = $2 AND channel = 'email'
      AND delivery_status IN ('pending', 'failed') AND provider_ref IS NULL
  `, [eventId, plan.userId])

  if (!pendingEmail) return

  const dedupeKey = `${eventId}:${plan.userId}:email`
  try {
    const { providerRef } = await sendEmail({
      to: plan.email,
      subject: plan.title,
      text: plan.body,
      dedupeKey
    })
    await db.query(`
      UPDATE notifications
      SET delivery_status = 'sent', provider_ref = $2
      WHERE id = $1
    `, [pendingEmail.id, providerRef])
  } catch (error) {
    await db.query(`
      UPDATE notifications SET delivery_status = 'failed' WHERE id = $1
    `, [pendingEmail.id])
    throw error
  }
}

export async function processOutboxEvent(outboxId: string): Promise<'processed' | 'retried' | 'failed' | 'skipped'> {
  const claimed = await transaction(async client => {
    const { rows: [row] } = await client.query<OutboxRow>(`
      SELECT id, event_type, payload, attempts, max_attempts, status
      FROM outbox
      WHERE id = $1
        AND (
          (status = 'pending' AND next_attempt_at <= now())
          OR (status = 'dispatched' AND dispatched_at < now() - interval '60 seconds')
        )
      FOR UPDATE SKIP LOCKED
    `, [outboxId])
    if (!row) return null
    await client.query(`
      UPDATE outbox
      SET status = 'dispatched', dispatched_at = now(), attempts = attempts + 1
      WHERE id = $1
    `, [row.id])
    return { ...row, attempts: row.attempts + 1 }
  })

  if (!claimed) return 'skipped'

  try {
    const { courseId, recipients } = await resolveDeliveries(claimed.event_type, claimed.payload)
    for (const recipient of recipients) {
      await dispatchRecipient(claimed.id, courseId, recipient)
    }
    await db.query(`UPDATE outbox SET status = 'processed', processed_at = now(), last_error = NULL WHERE id = $1`, [claimed.id])
    observeOutboxJob(claimed.event_type, 'processed')
    return 'processed'
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Outbox delivery failure'
    if (claimed.attempts >= claimed.max_attempts) {
      await db.query(`UPDATE outbox SET status = 'failed', last_error = $2 WHERE id = $1`, [claimed.id, message])
      observeOutboxJob(claimed.event_type, 'failed')
      logger.error('outbox.failed', { outbox_id: claimed.id, event_type: claimed.event_type, attempts: claimed.attempts })
      return 'failed'
    }
    const baseDelayMs = Math.min(60_000, Math.pow(2, claimed.attempts) * 500)
    const jitterMs = Math.floor(Math.random() * 250)
    await db.query(`
      UPDATE outbox
      SET status = 'pending',
          last_error = $2,
          next_attempt_at = now() + ($3::int * interval '1 millisecond')
      WHERE id = $1
    `, [claimed.id, message, baseDelayMs + jitterMs])
    observeOutboxJob(claimed.event_type, 'retried')
    logger.warn('outbox.retried', { outbox_id: claimed.id, event_type: claimed.event_type, attempts: claimed.attempts })
    return 'retried'
  }
}

export async function reconcilePendingOutbox(limit = 50): Promise<number> {
  const { rows } = await db.query<{ id: string }>(`
    SELECT id FROM outbox
    WHERE (status = 'pending' AND next_attempt_at <= now())
       OR (status = 'dispatched' AND dispatched_at < now() - interval '60 seconds')
    ORDER BY created_at, id LIMIT $1
  `, [limit])
  let processed = 0
  for (const row of rows) {
    const outcome = await processOutboxEvent(row.id)
    if (outcome !== 'skipped') processed++
  }
  return processed
}

export async function replayFailedOutbox(outboxId?: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(`
    UPDATE outbox
    SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
    WHERE status = 'failed' AND ($1::uuid IS NULL OR id = $1)
    RETURNING id
  `, [outboxId ?? null])
  for (const row of rows) {
    await enqueueOutboxEvent(row.id)
  }
  return rows.length
}
