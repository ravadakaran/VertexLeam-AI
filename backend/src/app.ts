import type { Request, Response, NextFunction } from 'express'
import express from 'express'
import helmet from 'helmet'
import { randomUUID } from 'node:crypto'
import { cache } from './cache.ts'
import { getConfig } from './config/env.ts'
import { db } from './db/index.ts'
import { HttpError } from './http.ts'
import { logger } from './utils/logger.ts'
import { formatPrometheusMetrics, observeHttpRequest } from './utils/metrics.ts'
import { auth } from './modules/auth/routes.ts'
import { courses, enrollments } from './modules/courses/routes.ts'
import { learning } from './modules/learning/routes.ts'
import { assignments } from './modules/assignments/routes.ts'
import { quizzes } from './modules/quizzes/routes.ts'
import { gamification } from './modules/gamification/routes.ts'
import { analytics } from './modules/analytics/routes.ts'
import { ai } from './modules/ai/routes.ts'
import { admin } from './modules/admin/routes.ts'
import { personalization } from './modules/personalization/routes.ts'
import { discussions } from './modules/discussions/routes.ts'
import { notifications } from './modules/notifications/routes.ts'

export const app = express()
app.disable('x-powered-by')
app.set('trust proxy', getConfig().trustProxy)
app.use(helmet())
app.use((req, res, next) => {
  const start = process.hrtime.bigint()
  req.requestId = randomUUID()
  res.set('X-Request-Id', req.requestId)
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6
    const route = req.route?.path
      ? `${req.baseUrl}${typeof req.route.path === 'string' ? req.route.path : ''}`
      : req.path === '/health/live' || req.path === '/health/ready' || req.path === '/metrics'
        ? req.path
        : 'unmatched'
    observeHttpRequest(req.method, route, res.statusCode, durationMs)
    logger.info('http.request', {
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100
    })
  })
  next()
})
app.use(express.json({ limit: '2mb' }))
app.get('/health/live', (_req, res) => res.json({ status: 'ok' }))
app.get('/health/ready', async (_req, res) => {
  try {
    await Promise.all([db.query('SELECT 1'), cache.ping()])
  } catch {
    throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'PostgreSQL or Redis unavailable')
  }
  res.json({ status: 'ready' })
})
app.get('/metrics', (_req, res) => {
  res
    .set('Cache-Control', 'no-store')
    .type('text/plain; version=0.0.4; charset=utf-8')
    .send(formatPrometheusMetrics(db))
})
app.use('/api/v1/auth', auth)
app.use('/api/v1/courses', courses)
app.use('/api/v1/enrollments', enrollments)
app.use('/api/v1', learning)
app.use('/api/v1', assignments)
app.use('/api/v1', quizzes)
app.use('/api/v1', gamification)
app.use('/api/v1', analytics)
app.use('/api/v1', ai)
app.use('/api/v1', admin)
app.use('/api/v1', personalization)
app.use('/api/v1', discussions)
app.use('/api/v1', notifications)
app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found')))
app.use((error: Error & { type?: string; code?: string }, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error)
  let problem: HttpError
  if (error instanceof HttpError) problem = error
  else if (error.type === 'entity.parse.failed') problem = new HttpError(400, 'VALIDATION_ERROR', 'Malformed JSON')
  else if (error.type === 'entity.too.large') problem = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large')
  else if (error.name === 'MulterError') problem = new HttpError(error.code === 'LIMIT_UNEXPECTED_FILE' ? 400 : 413,
    'UPLOAD_LIMIT', 'Upload has unexpected fields or exceeds limits')
  else if (error.code === '23505') problem = new HttpError(409, 'CONFLICT', 'Resource already exists')
  else {
    logger.error('request.failed', {
      request_id: req.requestId,
      code: error.code ?? error.name,
      err: error
    })
    const unavailable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '08006'].includes(error.code ?? '')
    problem = unavailable
      ? new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'Database unavailable')
      : new HttpError(500, 'INTERNAL_ERROR', 'Unexpected error')
  }
  res.status(problem.status).json({ error: { code: problem.code, message: problem.message, field: problem.field } })
})

