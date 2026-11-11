import type { PoolClient } from 'pg'
import type { Pagination, Profile } from '../../types.ts'

type Difficulty = 'beginner' | 'intermediate' | 'advanced'
type CatalogFilters = Pagination & { category?: string; difficulty?: Difficulty; q?: string; rating_min?: number }
type CourseInput = {
  title: string; description?: string; category: string; difficulty: Difficulty
  thumbnail_url?: string; price: number; pricing_tier: string
}
type Review = { decision: 'approved' | 'rejected'; comment?: string }
type CourseRow = Omit<CourseInput, 'price' | 'description' | 'thumbnail_url'> & {
  id: string; instructor_id: string; status: string; revision: number
  description: string | null; thumbnail_url: string | null; price: string | number; rating: string | number | null
}
import { db, transaction } from '../../db/index.ts'
import { forbidden, HttpError } from '../../http.ts'
import {
  bumpCatalogGeneration,
  cacheDel,
  cacheGet,
  cacheKeyDigest,
  cacheSet,
  getCatalogGeneration,
  singleFlight
} from '../../cache.ts'
import { observeCacheEvent } from '../../utils/metrics.ts'
import { curriculum } from '../learning/scope.ts'

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Course not found')
const conflict = () => new HttpError(409, 'CONFLICT', 'Course state or request revision conflicts')

export function courseView(row: CourseRow) {
  const { id, instructor_id, title, category, difficulty, pricing_tier, status } = row
  return {
    id, instructor_id, title, category, difficulty, pricing_tier, status,
    price: Number(row.price), revision: `"${row.revision}"`,
    ...(row.description !== null && { description: row.description }),
    ...(row.thumbnail_url !== null && { thumbnail_url: row.thumbnail_url }),
    ...(row.rating !== null && { rating: Number(row.rating) })
  }
}

export async function catalog({ category, difficulty, q, rating_min, page, limit }: CatalogFilters) {
  const normalized = {
    category: category ?? null,
    difficulty: difficulty ?? null,
    q: q ?? null,
    rating_min: rating_min ?? null,
    page,
    limit
  }
  const gen = await getCatalogGeneration()
  const key = `vertexlearn:catalog:g${gen}:${cacheKeyDigest(normalized)}`
  const cached = await cacheGet<{ items: ReturnType<typeof courseView>[]; page: number; limit: number; total: number }>(key)
  if (cached) {
    observeCacheEvent('catalog', 'hit')
    return cached
  }
  observeCacheEvent('catalog', 'miss')
  return singleFlight(key, async () => {
    const { rows: [result] } = await db.query(`
      WITH matches AS MATERIALIZED (
        SELECT * FROM courses WHERE status = 'approved'
        AND ($1::text IS NULL OR lower(category) = lower($1))
        AND ($2::text IS NULL OR difficulty = $2)
        AND ($3::text IS NULL OR strpos(lower(title || ' ' || coalesce(description, '')), lower($3)) > 0)
        AND ($4::numeric IS NULL OR rating >= $4)
      ), items AS (
        SELECT * FROM matches ORDER BY created_at DESC, id LIMIT $5 OFFSET $6
      )
      SELECT (SELECT count(*) FROM matches) AS total,
        coalesce(jsonb_agg(items ORDER BY created_at DESC, id), '[]') AS items FROM items
    `, [category, difficulty, q, rating_min, limit, (page - 1) * limit])
    const payload = { items: result.items.map(courseView), page, limit, total: Number(result.total) }
    await cacheSet(key, payload, 300)
    return payload
  })
}

export async function detail(id: string) {
  const gen = await getCatalogGeneration()
  const key = `vertexlearn:course:g${gen}:${id}`
  const cached = await cacheGet<{ course: ReturnType<typeof courseView>; modules: Awaited<ReturnType<typeof curriculum>> }>(key)
  if (cached) {
    observeCacheEvent('course', 'hit')
    return cached
  }
  observeCacheEvent('course', 'miss')
  return singleFlight(key, async () => {
    const { rows: [course] } = await db.query("SELECT * FROM courses WHERE id = $1 AND status = 'approved'", [id])
    if (!course) throw notFound()
    const payload = { course: courseView(course), modules: await curriculum(id) }
    await cacheSet(key, payload, 300)
    return payload
  })
}

const editable = ['title', 'description', 'category', 'difficulty', 'thumbnail_url', 'price', 'pricing_tier'] as const

export async function createCourse(user: Profile, body: CourseInput) {
  const { rows: [course] } = await db.query(`
    INSERT INTO courses(instructor_id, ${editable.join(', ')})
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
  `, [user.id, ...editable.map(field => body[field])])
  return courseView(course)
}

async function lockCourse(client: PoolClient, id: string) {
  const { rows: [course] } = await client.query('SELECT * FROM courses WHERE id = $1 FOR UPDATE', [id])
  if (!course) throw notFound()
  return course
}

export async function updateCourse(user: Profile, id: string, revision: string, body: Partial<CourseInput>) {
  let previousGen: string | undefined
  const view = await transaction(async client => {
    const course = await lockCourse(client, id)
    if (course.instructor_id !== user.id && !user.roles.includes('admin')) throw notFound()
    if (courseView(course).revision !== revision || course.status === 'archived') throw conflict()
    const columns = editable.filter(field => Object.hasOwn(body, field))
    const { rows: [updated] } = await client.query(`
      UPDATE courses SET ${columns.map((field, index) => `${field} = $${index + 2}`).join(', ')},
        status = 'pending', submitted_at = now(), revision = revision + 1 WHERE id = $1 RETURNING *
    `, [id, ...columns.map(field => body[field])])
    previousGen = await getCatalogGeneration(client)
    await bumpCatalogGeneration(client)
    return courseView(updated)
  })
  if (previousGen) {
    await cacheDel(`vertexlearn:course:g${previousGen}:${id}`)
    observeCacheEvent('catalog', 'invalidated')
  }
  return view
}

export async function approve(user: Profile, id: string, revision: string, key: string,
  { decision, comment }: Review, correlationId: string) {
  const reason = comment ?? null
  if (!user.roles.includes('admin')) throw forbidden()
  let previousGen: string | undefined
  const response = await transaction(async client => {
    const course = await lockCourse(client, id)
    const { rows: [prior] } = await client.query(`
      SELECT * FROM course_approvals WHERE reviewed_by = $1 AND course_id = $2 AND idempotency_key = $3
    `, [user.id, id, key])
    if (prior) {
      if (prior.request_revision !== revision || prior.decision !== decision || prior.comment !== reason) throw conflict()
      return prior.response
    }
    if (courseView(course).revision !== revision || course.status !== 'pending' || !course.submitted_at) throw conflict()
    const { rows: [updated] } = await client.query(`
      UPDATE courses SET status = $2, revision = revision + 1 WHERE id = $1 RETURNING *
    `, [id, decision])
    const view = courseView(updated)
    await client.query(`
      INSERT INTO course_approvals(course_id, reviewed_by, decision, comment, correlation_id, idempotency_key, request_revision, response)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, user.id, decision, reason, correlationId, key, revision, view])
    await client.query(`
      INSERT INTO audit_logs(actor_id, action, entity, entity_id, metadata)
      VALUES ($1, 'course.review', 'course', $2, $3)
    `, [user.id, id, { decision, revision, correlation_id: correlationId }])
    previousGen = await getCatalogGeneration(client)
    await bumpCatalogGeneration(client)
    return view
  })
  if (previousGen) {
    await cacheDel(`vertexlearn:course:g${previousGen}:${id}`)
    observeCacheEvent('catalog', 'invalidated')
  }
  return response
}


