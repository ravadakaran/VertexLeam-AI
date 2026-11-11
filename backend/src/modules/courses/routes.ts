import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { parse, uuid, sendResource } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import { limit } from '../../cache.ts'
import { catalog, detail, createCourse, updateCourse, approve } from './service.ts'
import { enroll, listEnrollments } from '../enrollments/service.ts'

const mode = z.enum(['beginner', 'intermediate', 'advanced'])
const string = (max: number) => z.string().trim().min(1).max(max)
const numericQuery = (schema: z.ZodType<number, number>) => z.string().trim().min(1).pipe(z.coerce.number()).pipe(schema)
const pagination = z.strictObject({
  page: numericQuery(z.int().min(1).max(2147483647)).default(1),
  limit: numericQuery(z.int().min(1).max(100)).default(20)
})
const filters = pagination.extend({
  category: string(12000).optional(),
  difficulty: mode.optional(),
  rating_min: numericQuery(z.number().min(0).max(5)).optional(),
  q: string(12000).optional()
})
const courseBody = z.strictObject({
  title: string(200),
  description: string(12000).optional(),
  category: string(80),
  difficulty: mode,
  thumbnail_url: z.url({ protocol: /^https?$/ }).optional(),
  price: z.number().min(0).max(99999999.99).multipleOf(0.01),
  pricing_tier: string(12000)
})
const update = courseBody.partial().refine(body => Object.keys(body).length > 0)
const review = z.strictObject({ decision: z.enum(['approved', 'rejected']), comment: string(12000).optional() })
const revision = z.string().regex(/^"\d+"$/)
const author = requireRole('instructor', 'admin')
const student = requireRole('student')
const admin = requireRole('admin')
const publicCatalog = async (req: Request, res: Response, next: NextFunction) => {
  await limit(res, 'catalog-ip', req.ip ?? req.socket.remoteAddress ?? 'unknown', 120, { failOpen: true })
  next()
}

export const courses = Router()
courses.get('/', publicCatalog, async (req, res) => res.json(await catalog(parse(filters, req.query))))
courses.get('/:id', publicCatalog, async (req, res) => {
  const result = await detail(parse(uuid, req.params.id))
  res.set('ETag', result.course.revision).json(result)
})
courses.post('/', authenticate, author, async (req, res) => {
  sendResource(res, await createCourse(req.user!, parse(courseBody, req.body)), 201)
})
courses.put('/:id', authenticate, author, async (req, res) => {
  sendResource(res, await updateCourse(req.user!, parse(uuid, req.params.id),
    parse(revision, req.get('If-Match')), parse(update, req.body)))
})
courses.post('/:id/approve', authenticate, admin, async (req, res) => {
  sendResource(res, await approve(req.user!, parse(uuid, req.params.id), parse(revision, req.get('If-Match')),
    parse(z.string().min(8).max(128), req.get('Idempotency-Key')), parse(review, req.body), req.requestId))
})
courses.post('/:id/enroll', authenticate, student, async (req, res) => {
  res.json(await enroll(req.user!.id, parse(uuid, req.params.id)))
})

export const enrollments = Router()
enrollments.get('/me', authenticate, student, async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await listEnrollments(req.user!.id, parse(pagination, req.query)))
})

