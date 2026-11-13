import { app } from './app.ts'
import { cache } from './cache.ts'
import { getConfig } from './config/env.ts'
import { db } from './db/index.ts'
import {
  closeQueue,
  connectQueue,
  processOutboxEvent,
  reconcilePendingOutbox,
  setOutboxEnqueueHook
} from './jobs/outbox.ts'
import { logger } from './utils/logger.ts'

const { port, workerMode, workerPollMs } = getConfig()
const host = process.env.HOST ?? '0.0.0.0'

cache.connect().catch(() => logger.warn('redis.startup_failed', { target: 'cache' }))
connectQueue().catch(() => logger.warn('redis.startup_failed', { target: 'queue' }))

let reconcileTimer: ReturnType<typeof setInterval> | undefined
if (workerMode !== 'external') {
  setOutboxEnqueueHook(outboxId => {
    void processOutboxEvent(outboxId).catch(err => logger.warn('outbox.event_error', { err: String(err) }))
  })
  reconcileTimer = setInterval(() => {
    void reconcilePendingOutbox().catch(err => logger.warn('outbox.reconcile_error', { err: String(err) }))
  }, workerPollMs)
  reconcileTimer.unref()
}

const server = app.listen(port, host, () => {
  logger.info('api.started', { host, port, worker_mode: workerMode })
})

async function shutdown() {
  if (reconcileTimer) clearInterval(reconcileTimer)
  setOutboxEnqueueHook(null)
  server.close(async () => {
    await closeQueue()
    if (cache.isOpen) cache.destroy()
    await db.end()
  })
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

