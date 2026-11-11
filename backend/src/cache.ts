import { createClient } from 'redis'
import type { Pool, PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { db } from './db/index.ts'
import { limit } from './middleware/rateLimit.ts'

if (!process.env.REDIS_CACHE_URL) throw new Error('Set REDIS_CACHE_URL')
export const cache = createClient({
  url: process.env.REDIS_CACHE_URL,
  disableOfflineQueue: true,
  socket: { connectTimeout: 3000 }
})
cache.on('error', () => console.error('Redis connection unavailable'))

export { limit }

const inFlight = new Map<string, Promise<unknown>>()

export const cacheKeyDigest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function getCatalogGeneration(sql: Pool | PoolClient = db): Promise<string> {
  const { rows: [row] } = await sql.query<{ generation: string }>(
    "SELECT generation::text AS generation FROM cache_generations WHERE scope = 'catalog'"
  )
  return row?.generation ?? '1'
}

export async function bumpCatalogGeneration(client: PoolClient): Promise<string> {
  const { rows: [row] } = await client.query<{ generation: string }>(`
    INSERT INTO cache_generations(scope, generation) VALUES ('catalog', 2)
    ON CONFLICT (scope) DO UPDATE SET generation = cache_generations.generation + 1, updated_at = now()
    RETURNING generation::text AS generation
  `)
  return row.generation
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!cache.isOpen) return null
  try {
    const raw = await cache.get(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!cache.isOpen) return
  try {
    await cache.set(key, JSON.stringify(value), { EX: ttlSeconds })
  } catch {
    // Cache writes are best-effort; PostgreSQL remains authoritative.
  }
}

export async function cacheDel(key: string): Promise<void> {
  if (!cache.isOpen) return
  try {
    await cache.del(key)
  } catch {
    // Ignore transient cache delete errors.
  }
}

export function singleFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const active = inFlight.get(key) as Promise<T> | undefined
  if (active) return active
  const promise = load().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}
