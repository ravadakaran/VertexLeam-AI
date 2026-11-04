import type { Response } from 'express'
import { createClient } from 'redis'
import { createHash } from 'node:crypto'
import { HttpError } from './http.ts'

if (!process.env.REDIS_CACHE_URL) throw new Error('Set REDIS_CACHE_URL')
export const cache = createClient({
  url: process.env.REDIS_CACHE_URL,
  disableOfflineQueue: true,
  socket: { connectTimeout: 3000 }
})
cache.on('error', () => console.error('Redis connection unavailable'))

export async function limit(res: Response, scope: string, identity: string, maximum: number) {
  const digest = createHash('sha256').update(identity).digest('hex')
  let result: [number, number]
  try {
    result = await cache.eval(`
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
      return { count, redis.call('TTL', KEYS[1]) }
    `, { keys: [`vertexlearn:${scope}:${digest}`] }) as [number, number]
  } catch {
    throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'Rate limiter unavailable')
  }
  if (result[0] > maximum) {
    res.set('Retry-After', String(Math.max(1, result[1])))
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests')
  }
}

