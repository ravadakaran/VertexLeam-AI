import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { crc32 } from 'node:zlib'
import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { PDFDocument, PDFName } from 'pdf-lib'
import request from 'supertest'

assert.ok(['development', 'test'].includes(process.env.APP_ENV))
process.env.SYNTHETIC_UPLOADS = 'true'
const { app } = await import('../src/app.ts')
const { db } = await import('../src/db/index.ts')
const { cache } = await import('../src/cache.ts')
const api = request(app)
const base = '/api/v1'
const run = randomUUID()
const email = name => `${name}-${run}@vertexlearn.test`
const password = randomUUID()
const bearer = (req, user) => req.set('Authorization', 'Bearer ' + user.access_token)
const write = (req, key = randomUUID()) => req.set('Idempotency-Key', key)
const sessions = {}
let course, module, lecture, pdf, student2, student3

// A deterministic uncompressed ZIP permits traversal and package fixtures without external tools.
function zip(files) {
  const entries = [], central = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name), contents = Buffer.from(text)
    const file = Buffer.alloc(30), directory = Buffer.alloc(46)
    file.writeUInt32LE(0x04034b50)
    file.writeUInt16LE(20, 4)
    file.writeUInt32LE(crc32(contents), 14)
    file.writeUInt32LE(contents.length, 18)
    file.writeUInt32LE(contents.length, 22)
    file.writeUInt16LE(filename.length, 26)
    directory.writeUInt32LE(0x02014b50)
    directory.writeUInt16LE(20, 4)
    file.copy(directory, 6, 4)
    directory.writeUInt32LE(offset, 42)
    entries.push(file, filename, contents)
    central.push(directory, filename)
    offset += file.length + filename.length + contents.length
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50)
  eocd.writeUInt16LE(central.length / 2, 8)
  eocd.writeUInt16LE(central.length / 2, 10)
  eocd.writeUInt32LE(central.reduce((size, item) => size + item.length, 0), 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...entries, ...central, eocd])
}

const upload = (path, user, content, name, key) =>
  write(bearer(api.post(base + path), user), key).attach('file', content, name)
const post = (path, user, data, key) => write(bearer(api.post(base + path), user), key).send(data)
const get = (path, user) => bearer(api.get(base + path), user)
const put = (path, user, revision, body) => bearer(api.put(base + path), user).set('If-Match', revision).send(body)
const urlPath = value => { const url = new URL(value); return url.pathname + url.search }

before(async () => {
  app.set('trust proxy', 'loopback')
  await cache.connect()
  const hash = await argon2.hash(password)
  const address = run.replaceAll('-', '').match(/.{4}/g).join(':')
  for (const [name, role] of Object.entries({
    author: 'instructor', stranger: 'instructor', admin: 'admin', student: 'student', student2: 'student',
    student3: 'student', outsider: 'student'
  })) {
    await db.query(`
      WITH account AS (INSERT INTO users(full_name,email,password_hash) VALUES($1,$2,$3) RETURNING id)
      INSERT INTO user_roles(user_id,role_id) SELECT account.id, roles.id FROM account CROSS JOIN roles WHERE name=$4
    `, [name, email(name), hash, role])
    sessions[name] = (await api.post(base + '/auth/login').set('X-Forwarded-For', address)
      .send({ email: email(name), password }).expect(200)).body
  }
  student2 = sessions.student2
  student3 = sessions.student3
  const document = await PDFDocument.create()
  document.addPage()
  pdf = Buffer.from(await document.save())
  course = (await post('/courses', sessions.author, {
    title: 'Synthetic learning ' + run, category: 'Testing', difficulty: 'beginner', price: 0, pricing_tier: 'free'
  }).expect(201)).body
  await post('/courses/' + course.id + '/modules', sessions.stranger, { title: 'Denied', order_index: 0 }).expect(404)
  const moduleKey = randomUUID()
  module = (await post('/courses/' + course.id + '/modules', sessions.author, { title: 'Module 1', order_index: 0 }, moduleKey).expect(201)).body
  assert.equal((await post('/courses/' + course.id + '/modules', sessions.author,
    { title: 'Module 1', order_index: 0 }, moduleKey).expect(201)).body.id, module.id)
  await post('/courses/' + course.id + '/modules', sessions.author, { title: 'Changed', order_index: 0 }, moduleKey).expect(409)
})

after(async () => {
  const match = `%-${run}@vertexlearn.test`
  try {
    await db.query('DELETE FROM enrollments WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM course_approvals WHERE reviewed_by IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM courses WHERE instructor_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM users WHERE email LIKE $1', [match])
  } finally {
    if (cache.isOpen) await cache.quit()
    await db.end()
  }
})

test('T-007 authorized multipart upload, private HLS segments, PDF/PPTX resources and expiry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vertexlearn-fixtures-'))
  let video
  try {
    const path = join(directory, 'fixture.mp4')
    await promisify(execFile)(process.env.FFMPEG_PATH ?? ffmpeg.path, [
      '-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=25:d=12',
      '-c:v','libx264','-pix_fmt','yuv420p', path
    ], { timeout: 15000 })
    video = await readFile(path)
  } finally { await rm(directory, { recursive: true, force: true }) }
  const slides = zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'
  })
  const endpoint = base + '/modules/' + module.id + '/lectures'
  const key = randomUUID()
  const create = user => write(bearer(api.post(endpoint), user), key)
    .field('title', 'Private lecture').field('order_index', '0')
    .attach('video', video, 'fixture.mp4')
    .attach('captions', Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nSynthetic cue\n'), 'captions.vtt')
    .attach('resources', pdf, 'handout.pdf').attach('resources', slides, 'slides.pptx')
  await create(sessions.stranger).expect(404)
  lecture = (await create(sessions.author).expect(201)).body
  assert.equal(lecture.media_status, 'ready')
  assert.equal(lecture.resources.length, 2)
  assert.equal((await create(sessions.author).expect(201)).body.id, lecture.id)
  await api.get(base + '/courses/' + course.id).expect(404)
  await post('/courses/' + course.id + '/approve', sessions.admin, { decision: 'approved' })
    .set('If-Match', course.revision).expect(200)
  for (const user of [sessions.student, student2, student3]) await post('/courses/' + course.id + '/enroll', user, {}).expect(200)
  const prefix = '/lectures/' + lecture.id
  await get(prefix + '/playback', sessions.outsider).expect(403)
  const grant = (await get(prefix + '/playback', sessions.student).expect(200)).body
  const path = urlPath(grant.url)
  await api.get(urlPath(grant.captions_url)).expect('Content-Type', /text\/vtt/).expect(200)
  await api.get(urlPath(grant.captions_url).split('?')[0]).expect(401)
  const list = await api.get(path).buffer(true).parse((res, done) => {
    res.setEncoding('utf8')
    let content = ''
    res.on('data', chunk => { content += chunk })
    res.on('end', () => done(null, content))
  }).expect(200)
  assert.match(list.body, /^#EXTM3U/)
  const segment = list.body.split(/\r?\n/).find(line => line.startsWith('segment'))
  assert.ok(segment?.includes('?grant='))
  const segmentPath = path.split('/index.m3u8')[0] + '/' + segment
  await api.get(segmentPath).expect('Content-Type', /video\/mp2t/).expect(200)
  await api.get(segmentPath.split('?')[0]).expect(401)
  const expired = new URL(grant.url)
  const { iat, exp, ...claims } = jwt.decode(expired.searchParams.get('grant'))
  expired.searchParams.set('grant', jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.ACCESS_JWT_KEY))
  await api.get(expired.pathname + expired.search).expect(401)
  for (const asset of lecture.resources) {
    await get(prefix + '/resources/' + asset.id, sessions.outsider).expect(403)
    const link = (await get(prefix + '/resources/' + asset.id, sessions.student).expect(200)).body
    await api.get(urlPath(link.url)).expect('Content-Disposition', /attachment/).expect(200)
  }
})

test('T-008 reordered playback updates union coverage, preserve resume and keep annotations private', async () => {
  const prefix = '/lectures/' + lecture.id
  const student = sessions.student
  const duration = lecture.duration_seconds
  assert.equal(duration, 12)
  const { playback_id } = (await get(prefix + '/playback', student).expect(200)).body
  const event = (sequence, start_seconds, end_seconds, position_seconds = end_seconds) => ({
    sequence, playback_id, position_seconds, event_id: randomUUID(), played_ranges: [{ start_seconds, end_seconds }]
  })
  const newest = event(4, 1, duration, 3)
  const first = await post(prefix + '/progress', student, newest).expect(200)
  assert.ok(first.body.progress_percent > 90)
  assert.equal(first.body.completed, false)
  const older = event(2, 0, 1)
  const completed = await post(prefix + '/progress', student, older).expect(200)
  assert.equal(completed.body.position_seconds, 3)
  assert.equal(completed.body.watched_seconds, duration)
  assert.equal(completed.body.completed, true)
  assert.deepEqual((await post(prefix + '/progress', student, newest).expect(200)).body, completed.body)
  await post(prefix + '/progress', student, { ...newest, position_seconds: 1 }).expect(409)
  await post(prefix + '/progress', student2, event(5, 0, duration)).expect(422)
  assert.equal((await get('/enrollments/me', student).expect(200)).body.items[0].progress_percent, 100)
  const note = await post(prefix + '/notes', student, { timestamp_seconds: 2, content: 'Synthetic note' }).expect(201)
  assert.equal(note.body.timestamp_seconds, 2)
  await post(prefix + '/bookmarks', student, { timestamp_seconds: 3 }).expect(201)
  assert.equal((await get(prefix + '/bookmarks', student).expect(200)).body.items[0].timestamp_seconds, 3)
  assert.deepEqual((await get(prefix + '/notes', student2).expect(200)).body.items, [])
  await get(prefix + '/notes', sessions.outsider).expect(403)
})

test('T-009 PDF, ZIP, code, deadline, unsafe inputs and rubric grades with scoped reads', async () => {
  const student = sessions.student
  const criterion = randomUUID()
  const body = { course_id: course.id, title: 'Synthetic assignment', instructions: 'Upload your example.',
    rubric: [{ id: criterion, label: 'Correctness', max_points: 10 }], due_date: new Date(Date.now() + 3600000).toISOString() }
  await post('/assignments', sessions.stranger, body).expect(404)
  const assignment = (await post('/assignments', sessions.author, body).expect(201)).body
  const prefix = '/assignments/' + assignment.id
  await upload(prefix + '/submit', sessions.outsider, pdf, 'work.pdf').expect(403)
  await upload(prefix + '/submit', student, zip({ '../payload.py': 'pass' }), 'bad.zip').expect(415)
  const active = await PDFDocument.create()
  active.addPage()
  active.catalog.set(PDFName.of('OpenAction'), active.context.obj({ S: 'JavaScript', JS: 'active' }))
  await upload(prefix + '/submit', student, Buffer.from(await active.save()), 'active.pdf').expect(415)
  await upload(prefix + '/submit', student, Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'), 'bad.py').expect(415)
  const key = randomUUID()
  const submission = (await upload(prefix + '/submit', student, pdf, 'work.pdf', key).expect(201)).body
  assert.equal((await upload(prefix + '/submit', student, pdf, 'work.pdf', key).expect(201)).body.id, submission.id)
  await upload(prefix + '/submit', student, Buffer.from('print(1)'), 'work.py', key).expect(409)
  await upload(prefix + '/submit', student2, zip({ 'src/example.py': 'print(2)' }), 'work.zip').expect(201)
  await upload(prefix + '/submit', student3, Buffer.from('print(3)'), 'work.py').expect(201)
  await db.query("UPDATE assignments SET due_date=clock_timestamp()-interval '1 second' WHERE id=$1", [assignment.id])
  await db.query('DELETE FROM assignment_submissions WHERE assignment_id=$1 AND user_id=$2', [assignment.id, student3.user.id])
  await upload(prefix + '/submit', student3, Buffer.from('print(4)'), 'late.py').expect(409)
  const path = '/submissions/' + submission.id
  const grade = { scores: [{ criterion_id: criterion, points: 8 }], feedback: 'Good work' }
  await put(path + '/grade', sessions.stranger, submission.revision, grade).expect(404)
  await put(path + '/grade', sessions.author, submission.revision, { scores: [{ criterion_id: criterion, points: 11 }] }).expect(422)
  assert.equal((await put(path + '/grade', sessions.author, submission.revision, grade).expect(200)).body.grade, 80)
  await put(path + '/grade', sessions.author, submission.revision, grade).expect(409)
  await get(path + '/file', student2).expect(404)
  const download = (await get(path + '/file', student).expect(200)).body
  await api.get(urlPath(download.url)).expect('Content-Disposition', /attachment/).expect(200)
  const list = (await get(prefix + '/submissions', student).expect(200)).body.items
  assert.deepEqual(list.map(row => [row.id, row.grade, row.feedback]), [[submission.id, 80, 'Good work']])
})

test('T-010 drafts are private, attempts pin revision, objective scoring and manual grade replay', async () => {
  const { author, student, stranger } = sessions
  const option = (option_text, is_correct) => ({ option_text, is_correct })
  const questions = [
    { question_type: 'mcq', question_text: 'Pick one', max_points: 2, options: [option('A', true), option('B', false)] },
    { question_type: 'multi_select', question_text: 'Pick both', max_points: 2,
      options: [option('A', true), option('B', false), option('C', true)] },
    { question_type: 'short_answer', question_text: 'Explain', max_points: 4, rubric: 'Award for evidence.' }
  ]
  const draft = (await post('/quizzes', author, { module_id: module.id, title: 'Synthetic quiz', questions }).expect(201)).body
  const path = '/quizzes/' + draft.id
  await get(path + '/review', student).expect(403)
  await get(path + '/review', stranger).expect(404)
  await post(path + '/attempt', student, {}).expect(404)
  const publish = row => post(path + '/review', author, { decision: 'approved' }).set('If-Match', row.revision).expect(200)
  const published = (await publish(draft)).body
  const initial = (await post(path + '/attempt', student, {}).expect(201)).body
  assert.equal((await post(path + '/attempt', student, {}).expect(201)).body.id, initial.id)
  assert.doesNotMatch(JSON.stringify(initial), /is_correct|rubric/)
  const fork = (await put(path, author, published.revision, { title: 'Second version', questions: questions.slice(0, 1) }).expect(200)).body
  await publish(fork)
  const [mcq, multi, short] = initial.questions
  const prefix = '/attempts/' + initial.id
  await get(prefix, student2).expect(404)
  await post(prefix + '/submit', student, { answers: [{ question_id: mcq.id, selected_option_ids: [multi.options[0].id] }] }).expect(422)
  const body = { answers: [
    { question_id: mcq.id, selected_option_ids: [mcq.options[0].id] },
    { question_id: multi.id, selected_option_ids: [multi.options[2].id, multi.options[0].id] },
    { question_id: short.id, text_answer: 'Synthetic response' }
  ] }
  const key = randomUUID()
  const submitted = (await post(prefix + '/submit', student, body, key).expect(200)).body
  assert.equal(submitted.objective_score, 100)
  assert.equal(submitted.status, 'pending_review')
  assert.equal(submitted.score, undefined)
  await post(prefix + '/submit', student, body).expect(409)
  await post(prefix + '/submit', student, { answers: [] }, key).expect(409)
  const studentAttempts = (await get(path + '/attempts', student).expect(200)).body
  assert.doesNotMatch(JSON.stringify(studentAttempts), /is_correct|rubric|Synthetic response/)
  const review = (await get(path + '/attempts', author).expect(200)).body.items[0]
  assert.equal(review.review[0].text_answer, 'Synthetic response')
  const grade = { scores: [{ question_id: short.id, points: 2 }] }
  await put(prefix + '/grade', stranger, submitted.revision, grade).expect(404)
  assert.equal((await put(prefix + '/grade', author, submitted.revision, grade).expect(200)).body.score, 75)
  assert.equal((await get(prefix, student).expect(200)).body.score, 75)
  assert.deepEqual((await post(prefix + '/submit', student, body, key).expect(200)).body, submitted)
})
