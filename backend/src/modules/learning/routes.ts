import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { db, transaction } from '../../db/index.ts'
import { limit } from '../../cache.ts'
import { HttpError, parse, uuid } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import { courseView } from '../courses/service.ts'
import { courseScope, curriculum, moduleScope, lectureScope, ordinal, text, keySchema, replay, digest, missing, invalid, pagination } from './scope.ts'
import { limitUploads, packageVideo, upload, validateCaptions, validateFile } from './uploads.ts'
import { grant, grantUser } from './grants.ts'
import { readProgress, writeProgress } from './progress.ts'

export const learning = Router()
const author = [authenticate, requireRole('instructor', 'admin')]
const student = [authenticate, requireRole('student')]
const section = z.strictObject({ title: text(200), order_index: ordinal })
const lectureBody = section.extend({ order_index: z.string().regex(/^\d+$/).transform(Number).pipe(ordinal) })
const id = (req: Request) => parse(uuid, req.params.id)
const key = (req: Request) => parse(keySchema, req.get('Idempotency-Key'))
const hidden = (res: Response) => res.set('Cache-Control', 'private, no-store')

learning.get('/instructor/courses', ...author, async (req, res) => {
  const { page, limit } = parse(pagination, req.query)
  const { rows: [result] } = await db.query(`
    WITH owned AS MATERIALIZED (SELECT * FROM courses WHERE ($1::bool OR instructor_id=$2) AND status <> 'archived'),
    items AS (SELECT * FROM owned ORDER BY created_at DESC, id LIMIT $3 OFFSET $4)
    SELECT (SELECT count(*)::int FROM owned) AS total, coalesce(jsonb_agg(items ORDER BY created_at DESC,id), '[]') AS items FROM items
  `, [req.user!.roles.includes('admin'), req.user!.id, limit, (page - 1) * limit])
  hidden(res).json({ ...result, page, limit, items: result.items.map(courseView) })
})
learning.get('/instructor/courses/:id', ...author, async (req, res) => {
  const courseId = id(req)
  const result = await transaction(async client => {
    await courseScope(client, req.user!, courseId, 'author')
    const { rows: [course] } = await client.query('SELECT * FROM courses WHERE id=$1', [courseId])
    return { course: courseView(course), modules: await curriculum(courseId, client) }
  })
  hidden(res).set('ETag', result.course.revision).json(result)
})
learning.post('/courses/:id/modules', ...author, async (req, res) => {
  const courseId = id(req), body = parse(section, req.body), requestKey = key(req)
  const result = await transaction(async client => {
    await courseScope(client, req.user!, courseId, 'author')
    return replay(client, req.user!.id, 'module:' + courseId, requestKey, body, async () => {
      const { rows: [row] } = await client.query(
        'INSERT INTO modules(course_id,title,order_index) VALUES($1,$2,$3) RETURNING *', [courseId, body.title, body.order_index])
      return row
    })
  })
  res.status(201).json(result)
})

learning.post('/modules/:id/lectures', ...author, async (req: Request, res: Response, next: NextFunction) => {
  await limit(res, 'upload', req.user!.id, 20)
  await moduleScope(db, req.user!, id(req), 'author')
  key(req)
  if (!req.is('multipart/form-data')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use multipart/form-data')
  next()
}, limitUploads, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'resources', maxCount: 4 },
  { name: 'captions', maxCount: 1 }]), async (req, res) => {
  const moduleId = id(req), body = parse(lectureBody, req.body), requestKey = key(req)
  const files = req.files as Record<string, Express.Multer.File[]> | undefined
  const video = files?.video?.[0], resources = files?.resources ?? [], captions = files?.captions?.[0]
  if (!video && !resources.length) throw invalid('Attach a video or a resource')
  if (captions && !video) throw invalid('Captions require a video')
  const fingerprint = [body, ...[video, captions, ...resources].map(file => file && [file.originalname, digest(file.buffer)])]
  const result = await transaction(async client => {
    await moduleScope(client, req.user!, moduleId, 'author')
    return replay(client, req.user!.id, 'lecture:' + moduleId, requestKey, fingerprint, async () => {
      const validated = await Promise.all(resources.map(file => validateFile(file, 'resource')))
      const captionAsset = captions ? await validateCaptions(captions) : null
      const encoded = video ? await packageVideo(video) : null
      const { rows: [row] } = await client.query(`
        INSERT INTO lectures(module_id,title,order_index,duration_seconds,media_status)
        VALUES($1,$2,$3,$4,$5) RETURNING *
      `, [moduleId, body.title, body.order_index, encoded?.duration ?? 0, encoded ? 'ready' : 'none'])
      const attachments = []
      const mediaAssets = [...encoded?.assets ?? [], ...(captionAsset ? [captionAsset] : [])]
      for (const [isResource, assets] of [[true, validated], [false, mediaAssets]] as const) {
        for (const asset of assets) {
          const { rows: [saved] } = await client.query(`
            INSERT INTO lecture_assets(lecture_id,name,mime,resource,data) VALUES($1,$2,$3,$4,$5) RETURNING id
          `, [row.id, asset.name, asset.mime, isResource, asset.data])
          if (isResource) attachments.push({ id: saved.id, title: asset.name })
        }
      }
      return { ...row, resources: attachments }
    })
  })
  hidden(res).status(201).json(result)
})

learning.get('/lectures/:id/playback', ...student, async (req, res) => {
  const lectureId = id(req)
  const playback = await transaction(async client => {
    const lecture = await lectureScope(client, req.user!, lectureId, 'learner')
    if (lecture.media_status !== 'ready') throw missing()
    const { rows: [session] } = await client.query(`
      INSERT INTO playback_sessions(enrollment_id,lecture_id,expires_at)
      VALUES($1,$2,now()+interval '8 hours') RETURNING id
    `, [lecture.enrollment_id, lectureId])
    const { rowCount } = await client.query(
      "SELECT 1 FROM lecture_assets WHERE lecture_id=$1 AND name='captions.vtt' AND NOT resource", [lectureId])
    return { id: session.id as string, captions: Boolean(rowCount) }
  })
  const link = grant(req, 'hls:' + lectureId, '/api/v1/private/hls/' + lectureId + '/index.m3u8')
  hidden(res).json({ ...link, playback_id: playback.id,
    ...(playback.captions && { captions_url: link.url.replace('/index.m3u8?', '/captions.vtt?') }) })
})
learning.get('/private/hls/:id/:name', async (req, res) => {
  const lectureId = id(req), name = req.params.name
  if (!/^(?:index\.m3u8|captions\.vtt|segment\d{4}\.ts)$/.test(name)) throw missing()
  const user = await grantUser(req.query.grant, 'hls:' + lectureId)
  const asset = await transaction(async client => {
    await lectureScope(client, user, lectureId, 'learner')
    const { rows: [row] } = await client.query(
      'SELECT data,mime FROM lecture_assets WHERE lecture_id=$1 AND name=$2 AND NOT resource', [lectureId, name])
    if (!row) throw missing()
    return row
  })
  const data = name.endsWith('.m3u8') ? asset.data.toString('utf8').replace(
    /^(segment\d{4}\.ts)\r?$/gm, '$1?grant=' + encodeURIComponent(String(req.query.grant))) : asset.data
  hidden(res).type(asset.mime).send(data)
})
learning.get('/lectures/:id/resources/:resourceId', ...student, async (req, res) => {
  const lectureId = id(req), resourceId = parse(uuid, req.params.resourceId)
  await lectureScope(db, req.user!, lectureId, 'learner')
  const { rowCount } = await db.query('SELECT 1 FROM lecture_assets WHERE id=$1 AND lecture_id=$2 AND resource', [resourceId, lectureId])
  if (!rowCount) throw missing()
  hidden(res).json(grant(req, 'resource:' + resourceId, '/api/v1/private/resources/' + resourceId))
})
learning.get('/private/resources/:id', async (req, res) => {
  const resourceId = id(req)
  const user = await grantUser(req.query.grant, 'resource:' + resourceId)
  const row = await transaction(async client => {
    const { rows: [asset] } = await client.query('SELECT lecture_id,name,mime,data FROM lecture_assets WHERE id=$1 AND resource', [resourceId])
    if (!asset) throw missing()
    await lectureScope(client, user, asset.lecture_id, 'learner')
    return asset
  })
  hidden(res).attachment(row.name).type(row.mime).send(row.data)
})

const heartbeat = z.strictObject({
  position_seconds: ordinal, event_id: uuid, playback_id: uuid, sequence: ordinal,
  played_ranges: z.array(z.strictObject({ start_seconds: ordinal, end_seconds: ordinal })).max(120)
})
learning.get('/lectures/:id/progress', ...student, async (req, res) => hidden(res).json(await readProgress(req.user!, id(req))))
learning.post('/lectures/:id/progress', ...student, async (req, res) =>
  hidden(res).json(await writeProgress(req.user!, id(req), parse(heartbeat, req.body))))

for (const [path, kind] of [['notes', 'note'], ['bookmarks', 'bookmark']] as const) {
  const annotation = kind === 'note'
    ? z.strictObject({ timestamp_seconds: ordinal, content: text(12000) })
    : z.strictObject({ timestamp_seconds: ordinal })
  learning.get('/lectures/:id/' + path, ...student, async (req, res) => {
    const lectureId = id(req)
    await lectureScope(db, req.user!, lectureId, 'learner')
    const { page, limit } = parse(pagination, req.query)
    const { rows: [result] } = await db.query(`
      WITH visible AS MATERIALIZED (SELECT id,lecture_id,timestamp_seconds,content,created_at
        FROM lecture_annotations WHERE user_id=$1 AND lecture_id=$2 AND kind=$3),
      items AS (SELECT * FROM visible ORDER BY created_at,id LIMIT $4 OFFSET $5)
      SELECT (SELECT count(*)::int FROM visible) AS total,
        coalesce(jsonb_agg(jsonb_strip_nulls(to_jsonb(items)) ORDER BY created_at,id), '[]') AS items FROM items
    `, [req.user!.id, lectureId, kind, limit, (page - 1) * limit])
    hidden(res).json({ ...result, page, limit })
  })
  learning.post('/lectures/:id/' + path, ...student, async (req, res) => {
    const lectureId = id(req), requestKey = key(req)
    const body = parse(annotation, req.body)
    const result = await transaction(async client => {
      const lecture = await lectureScope(client, req.user!, lectureId, 'learner')
      if (body.timestamp_seconds > lecture.duration_seconds) throw invalid('Timestamp exceeds lecture duration')
      return replay(client, req.user!.id, path + ':' + lectureId, requestKey, body, async () => {
        const { rows: [row] } = await client.query(`
          INSERT INTO lecture_annotations(lecture_id,user_id,kind,timestamp_seconds,content)
          VALUES($1,$2,$3,$4,$5) RETURNING id,lecture_id,timestamp_seconds,content,created_at
        `, [lectureId, req.user!.id, kind, body.timestamp_seconds, 'content' in body ? body.content : null])
        if (row.content === null) delete row.content
        return row
      })
    })
    hidden(res).status(201).json(result)
  })
}
