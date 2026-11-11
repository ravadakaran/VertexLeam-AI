import type { Response } from 'express'
import { createHash } from 'node:crypto'
import { cache } from '../cache.ts'
import { HttpError } from '../http.ts'
import { observeRateLimitBlock } from '../utils/metrics.ts'

type LimitOptions = {
  failOpen?: boolean
  windowSeconds?: number
}

const LOCAL_FALLBACK_MAX_KEYS = 5000
const fallbackBuckets = new Map<string, { count: number; resetAt: number }>()

function checkLocalFallback(res: Response, cacheKey: string, maximum: number, windowSeconds: number) {
  const now = Date.now()
  if (fallbackBuckets.size >= LOCAL_FALLBACK_MAX_KEYS) {
    for (const [k, entry] of fallbackBuckets) {
      if (entry.resetAt <= now || fallbackBuckets.size >= LOCAL_FALLBACK_MAX_KEYS) {
        fallbackBuckets.delete(k)
      }
      if (fallbackBuckets.size < LOCAL_FALLBACK_MAX_KEYS * 0.8) break
    }
  }
  const current = fallbackBuckets.get(cacheKey)
  if (!current || current.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000
    fallbackBuckets.set(cacheKey, { count: 1, resetAt })
    return
  }
  current.count++
  if (current.count > maximum) {
    res.set('Retry-After', String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))))
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests')
  }
}

export async function limit(
  res: Response,
  scope: string,
  identity: string,
  maximum: number,
  options: LimitOptions = {}
) {
  const windowSeconds = options.windowSeconds ?? 60
  const digest = createHash('sha256').update(identity).digest('hex')
  const key = `vertexlearn:${scope}:${digest}`
  let result: [number, number]
  try {
    if (!cache.isOpen) throw new Error('Redis unavailable')
    result = await cache.eval(`
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
      return { count, redis.call('TTL', KEYS[1]) }
    `, { keys: [key], arguments: [String(windowSeconds)] }) as [number, number]
  } catch {
    if (options.failOpen) {
      checkLocalFallback(res, key, maximum, windowSeconds)
      return
    }
    res.set('Retry-After', String(windowSeconds))
    throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'Rate limiter unavailable')
  }
  if (result[0] > maximum) {
    observeRateLimitBlock(scope)
    res.set('Retry-After', String(Math.max(1, result[1])))
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests')
  }
}

