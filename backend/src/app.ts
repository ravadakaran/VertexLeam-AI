import type { Request, Response, NextFunction } from 'express'
import express from 'express'
import helmet from 'helmet'
import { randomUUID } from 'node:crypto'
import { cache } from './cache.ts'
import { db } from './db/index.ts'
import { HttpError } from './http.ts'
import { auth } from './modules/auth/routes.ts'
import { courses, enrollments } from './modules/courses/routes.ts'
import { learning } from './modules/learning/routes.ts'
import { assignments } from './modules/assignments/routes.ts'
import { quizzes } from './modules/quizzes/routes.ts'

export const app = express()
app.disable('x-powered-by')
app.use(helmet())
app.use((req, res, next) => {
  req.requestId = randomUUID()
  res.set('X-Request-Id', req.requestId)
  next()
})
app.use(express.json({ limit: '32kb' }))
app.get('/health/live', (req, res) => res.json({ status: 'ok' }))
app.get('/health/ready', async (req, res) => {
  try {
    await Promise.all([db.query('SELECT 1'), cache.ping()])
  } catch {
    throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'PostgreSQL or Redis unavailable')
  }
  res.json({ status: 'ready' })
})
app.use('/api/v1/auth', auth)
app.use('/api/v1/courses', courses)
app.use('/api/v1/enrollments', enrollments)
app.use('/api/v1', learning)
app.use('/api/v1', assignments)
app.use('/api/v1', quizzes)
app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found')))
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
    console.error('Request failed', req.requestId, error.code ?? error.name)
    const unavailable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '08006'].includes(error.code ?? '')
    problem = unavailable
      ? new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'Database unavailable')
      : new HttpError(500, 'INTERNAL_ERROR', 'Unexpected error')
  }
  res.status(problem.status).json({ error: { code: problem.code, message: problem.message, field: problem.field } })
})

