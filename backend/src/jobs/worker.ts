import { createClient } from 'redis'
import { db } from '../db/index.ts'
import { getConfig } from '../config/env.ts'
import { logger } from '../utils/logger.ts'
import { NOTIFICATION_QUEUE_KEY, closeQueue, processOutboxEvent, reconcilePendingOutbox } from './outbox.ts'

const { redisQueueUrl, workerPollMs } = getConfig()
const consumer = redisQueueUrl ? createClient({ url: redisQueueUrl, socket: { connectTimeout: 3000 } }) : null
let running = true

consumer?.on('error', () => {
  logger.warn('worker.redis_error', { reason: 'Consumer connection interrupted' })
})

async function run() {
  if (consumer) {
    await consumer.connect().catch(() => {
      logger.warn('worker.redis_unavailable', { reason: 'Polling PG outbox until Redis queue recovers' })
    })
  }
  logger.info('worker.started', { queue: NOTIFICATION_QUEUE_KEY, poll_ms: workerPollMs })

  let lastReconcile = 0
  while (running) {
    try {
      if (consumer?.isOpen) {
        const item = await consumer.brPop(NOTIFICATION_QUEUE_KEY, Math.max(1, Math.floor(workerPollMs / 1000)))
        if (item?.element) {
          await processOutboxEvent(item.element)
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, workerPollMs))
      }

      if (Date.now() - lastReconcile >= workerPollMs) {
        await reconcilePendingOutbox()
        lastReconcile = Date.now()
      }
    } catch (error) {
      logger.error('worker.loop_error', { err: error })
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

async function shutdown() {
  running = false
  if (consumer?.isOpen) await consumer.quit().catch(() => consumer.destroy())
  await closeQueue()
  await db.end()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

void run()

