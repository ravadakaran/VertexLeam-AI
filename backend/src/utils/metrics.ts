const DURATION_BUCKETS_MS = [10, 25, 50, 100, 250, 300, 500, 1000, 2500, 5000]

const httpRequests = new Map<string, number>()
const cacheEvents = new Map<string, number>()
const rateLimitBlocks = new Map<string, number>()
const outboxJobs = new Map<string, number>()
const aiOutcomes = new Map<string, number>()
const durationBuckets = new Array<number>(DURATION_BUCKETS_MS.length).fill(0)
let durationCount = 0
let durationSum = 0

function esc(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}

function key(labels: Record<string, string | number>) {
  return Object.entries(labels).map(([k, v]) => `${k}="${esc(String(v))}"`).join(',')
}

function inc(store: Map<string, number>, labels: Record<string, string | number>, amount = 1) {
  const labelKey = key(labels)
  store.set(labelKey, (store.get(labelKey) ?? 0) + amount)
}

export function observeHttpRequest(method: string, route: string, status: number, durationMs: number) {
  inc(httpRequests, { method, route, status })
  durationCount++
  durationSum += durationMs
  for (let i = 0; i < DURATION_BUCKETS_MS.length; i++) {
    if (durationMs <= DURATION_BUCKETS_MS[i]) durationBuckets[i]++
  }
}

export function observeCacheEvent(cacheName: 'catalog' | 'course' | 'leaderboard', outcome: 'hit' | 'miss' | 'error' | 'invalidated') {
  inc(cacheEvents, { cache: cacheName, outcome })
}

export function observeRateLimitBlock(scope: string) {
  inc(rateLimitBlocks, { scope })
}

export function observeOutboxJob(eventType: string, status: string) {
  inc(outboxJobs, { event_type: eventType, status })
}

export function observeAiOutcome(outcome: 'ok' | 'unavailable' | 'denied') {
  inc(aiOutcomes, { outcome })
}

export function formatPrometheusMetrics(pool?: { totalCount?: number; idleCount?: number; waitingCount?: number }) {
  const lines: string[] = [
    '# HELP vertexlearn_http_requests_total Total HTTP requests handled.',
    '# TYPE vertexlearn_http_requests_total counter'
  ]
  for (const [labelKey, count] of httpRequests) lines.push(`vertexlearn_http_requests_total{${labelKey}} ${count}`)

  lines.push('# HELP vertexlearn_http_request_duration_ms Request latency distribution in milliseconds.')
  lines.push('# TYPE vertexlearn_http_request_duration_ms histogram')
  for (let i = 0; i < DURATION_BUCKETS_MS.length; i++) {
    lines.push(`vertexlearn_http_request_duration_ms_bucket{le="${DURATION_BUCKETS_MS[i]}"} ${durationBuckets[i]}`)
  }
  lines.push(`vertexlearn_http_request_duration_ms_bucket{le="+Inf"} ${durationCount}`)
  lines.push(`vertexlearn_http_request_duration_ms_sum ${durationSum.toFixed(3)}`)
  lines.push(`vertexlearn_http_request_duration_ms_count ${durationCount}`)

  lines.push('# HELP vertexlearn_cache_events_total Redis cache events.')
  lines.push('# TYPE vertexlearn_cache_events_total counter')
  for (const [labelKey, count] of cacheEvents) lines.push(`vertexlearn_cache_events_total{${labelKey}} ${count}`)

  lines.push('# HELP vertexlearn_rate_limit_blocks_total Rate limit rejections (429).')
  lines.push('# TYPE vertexlearn_rate_limit_blocks_total counter')
  for (const [labelKey, count] of rateLimitBlocks) lines.push(`vertexlearn_rate_limit_blocks_total{${labelKey}} ${count}`)

  lines.push('# HELP vertexlearn_outbox_jobs_total Durable outbox job outcomes.')
  lines.push('# TYPE vertexlearn_outbox_jobs_total counter')
  for (const [labelKey, count] of outboxJobs) lines.push(`vertexlearn_outbox_jobs_total{${labelKey}} ${count}`)

  lines.push('# HELP vertexlearn_ai_requests_total AI proxy request outcomes.')
  lines.push('# TYPE vertexlearn_ai_requests_total counter')
  for (const [labelKey, count] of aiOutcomes) lines.push(`vertexlearn_ai_requests_total{${labelKey}} ${count}`)

  if (pool) {
    lines.push('# HELP vertexlearn_db_pool_connections PostgreSQL pool connection gauges.')
    lines.push('# TYPE vertexlearn_db_pool_connections gauge')
    lines.push(`vertexlearn_db_pool_connections{state="total"} ${pool.totalCount ?? 0}`)
    lines.push(`vertexlearn_db_pool_connections{state="idle"} ${pool.idleCount ?? 0}`)
    lines.push(`vertexlearn_db_pool_connections{state="waiting"} ${pool.waitingCount ?? 0}`)
  }

  return lines.join('\n') + '\n'
}

