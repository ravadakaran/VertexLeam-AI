import { getConfig } from '../config/env.ts'

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'authorization',
  'access_token',
  'refresh_token',
  'token',
  'secret',
  'api_key',
  'cookie',
  'set-cookie',
  'email',
  'full_name',
  'provider_ref',
  'grant',
  'x-forwarded-for'
])

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

export function redactString(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]')
    .replace(/([?&](?:grant|token|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (depth > 6) return '[TRUNCATED]'
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    const code = (value as unknown as { code?: unknown }).code
    return {
      name: value.name,
      message: redactString(value.message),
      ...(typeof code === 'string' && { code })
    }
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : sanitizeValue(v, depth + 1)
    }
    return out
  }
  return String(value)
}

export function formatLogLine(level: 'info' | 'warn' | 'error', event: string, context: Record<string, unknown> = {}): string {
  const { releaseId, appEnv } = getConfig()
  const sanitized = sanitizeValue(context) as Record<string, unknown>
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    env: appEnv,
    release_id: releaseId,
    event,
    ...sanitized
  })
}

export type LogSink = (line: string) => void

export function createLogger(sink?: LogSink) {
  const emit = (level: 'info' | 'warn' | 'error', event: string, context?: Record<string, unknown>) => {
    const line = formatLogLine(level, event, context)
    if (sink) {
      sink(line)
      return line
    }
    const configured = LEVELS[getConfig().logLevel] ?? LEVELS.info
    if (LEVELS[level] < configured) return line
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
    return line
  }
  return {
    info: (event: string, context?: Record<string, unknown>) => emit('info', event, context),
    warn: (event: string, context?: Record<string, unknown>) => emit('warn', event, context),
    error: (event: string, context?: Record<string, unknown>) => emit('error', event, context)
  }
}

export const logger = createLogger()
