export function parseTrustProxy(raw = process.env.TRUST_PROXY): boolean | number | string {
  if (!raw) return 'loopback'
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^\d+$/.test(raw)) return Number(raw)
  return raw
}

export function getConfig() {
  const appEnv = process.env.APP_ENV ?? 'development'
  return {
    appEnv,
    port: Number(process.env.PORT ?? 3000),
    releaseId: process.env.RELEASE_ID ?? process.env.GITHUB_SHA ?? 'dev-local',
    trustProxy: parseTrustProxy(),
    redisCacheUrl: process.env.REDIS_CACHE_URL ?? '',
    redisQueueUrl: process.env.REDIS_QUEUE_URL || process.env.REDIS_CACHE_URL || '',
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT ?? 1025),
    emailFrom: process.env.EMAIL_FROM ?? 'no-reply@vertexlearn.local',
    emailWebhookUrl: process.env.EMAIL_WEBHOOK_URL,
    workerMode: process.env.WORKER_MODE ?? (appEnv === 'test' ? 'manual' : 'inline'),
    workerPollMs: Number(process.env.WORKER_POLL_MS ?? 5000),
    logLevel: process.env.LOG_LEVEL ?? (appEnv === 'test' ? 'error' : 'info')
  }
}

