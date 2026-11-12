import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { crc32 } from 'node:zlib'
import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { PDFDocument, PDFName } from 'pdf-lib'
import request from 'supertest'

assert.ok(['development', 'test'].includes(process.env.APP_ENV))
process.env.SYNTHETIC_UPLOADS = 'true'
process.env.CERTIFICATE_POLICY_CONFIRMED = 'true'
const { app } = await import('../src/app.ts')
const { db } = await import('../src/db/index.ts')
const { cache } = await import('../src/cache.ts')
const { refreshAwards } = await import('../src/modules/gamification/routes.ts')
const api = request(app)
const base = '/api/v1'
const run = randomUUID()
const email = name => `${name}-${run}@vertexlearn.test`
const password = randomUUID()
const bearer = (req, user) => req.set('Authorization', 'Bearer ' + user.access_token)
const write = (req, key = randomUUID()) => req.set('Idempotency-Key', key)
const sessions = {}
const deletedFixtureIds=[]
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
    await db.query('DELETE FROM moderation_reports WHERE reporter_id IN (SELECT id FROM users WHERE email LIKE $1) OR reviewed_by IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM synthetic_payments WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM course_approvals WHERE reviewed_by IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM courses WHERE instructor_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM users WHERE email LIKE $1', [match])
    if(deletedFixtureIds.length){
      await db.query('DELETE FROM audit_logs WHERE actor_id=ANY($1::uuid[])',[deletedFixtureIds])
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[deletedFixtureIds])
    }
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
  assert.equal((await get('/enrollments/me', student).expect(200)).body.items[0].course_title, course.title)
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

test('T-011 awards and T-012 analytics are scoped, stable and owner-only', async () => {
  const prefix = '/users/me'
  const certificates = (await get(prefix + '/certificates', sessions.student).expect(200)).body.items
  assert.equal(certificates.length, 1)
  await get('/certificates/' + certificates[0].id + '/download', student2).expect(404)
  await get('/certificates/' + certificates[0].id + '/download', sessions.student).expect('Content-Type', /application\/pdf/).expect(200)
  const badges = (await get(prefix + '/badges', sessions.student).expect(200)).body.items
  assert.ok(badges.some(item => item.badge_key === 'first_course'))
  for (let daysAgo = 0; daysAgo < 7; daysAgo++) await db.query(`INSERT INTO learner_activity(user_id,activity_date)
    VALUES($1,(now() AT TIME ZONE 'UTC')::date-$2::int) ON CONFLICT DO NOTHING`, [sessions.student.user.id, daysAgo])
  await refreshAwards(sessions.student.user.id, course.id)
  const streakBadges = (await get(prefix + '/badges', sessions.student).expect(200)).body.items
  assert.ok(streakBadges.some(item => item.badge_key === 'seven_day_streak'))
  const perfect = (await post('/quizzes', sessions.author, { module_id: module.id, title: 'Perfect milestone', questions: [
    { question_type: 'mcq', question_text: 'Select the answer', max_points: 1, options: [
      { option_text: 'Correct', is_correct: true }, { option_text: 'Other', is_correct: false }
    ] }
  ] }).expect(201)).body
  const published = (await post('/quizzes/' + perfect.id + '/review', sessions.author, { decision: 'approved' }).set('If-Match', perfect.revision).expect(200)).body
  const attempt = (await post('/quizzes/' + perfect.id + '/attempt', sessions.student, {}).expect(201)).body
  await post('/attempts/' + attempt.id + '/submit', sessions.student, { answers: [
    { question_id: attempt.questions[0].id, selected_option_ids: [attempt.questions[0].options[0].id] }
  ] }).expect(200)
  const milestones = (await get(prefix + '/badges', sessions.student).expect(200)).body.items
  assert.ok(milestones.some(item => item.badge_key === 'perfect_quiz'))
  await get(prefix + '/streak', sessions.student).expect(200)
  const analytics = await get('/instructor/courses/' + course.id + '/analytics', sessions.author).expect(200)
  assert.equal(analytics.body.starts, 1)
  await get('/instructor/courses/' + course.id + '/analytics', sessions.stranger).expect(404)
  await get('/instructor/courses/' + course.id + '/analytics', sessions.student).expect(403)
})

test('T-013–015 AI service requires enrollment and remains unavailable without approved provider configuration', async () => {
  const { AI_SERVICE_TOKEN, AI_SERVICE_URL, AI_OUTBOUND_DATA_APPROVED } = process.env
  delete process.env.AI_SERVICE_TOKEN; delete process.env.AI_SERVICE_URL; delete process.env.AI_OUTBOUND_DATA_APPROVED
  try {
    await post('/ai/chat/sessions', sessions.outsider, { course_id: course.id }).expect(403)
    await post('/ai/chat/sessions', sessions.admin, { course_id: course.id }).expect(403)
    await post('/ai/chat/sessions', sessions.stranger, { course_id: course.id }).expect(403)
    await post('/ai/chat/sessions', sessions.author, { course_id: course.id }).expect(503)
    await post('/ai/chat/sessions', sessions.student, { course_id: course.id }).expect(503)
    await post('/ai/lectures/' + lecture.id + '/ingest', sessions.stranger, { content: 'Synthetic transcript', segments: [] }).expect(404)
  } finally {
    if (AI_SERVICE_TOKEN !== undefined) process.env.AI_SERVICE_TOKEN = AI_SERVICE_TOKEN
    if (AI_SERVICE_URL !== undefined) process.env.AI_SERVICE_URL = AI_SERVICE_URL
    if (AI_OUTBOUND_DATA_APPROVED !== undefined) process.env.AI_OUTBOUND_DATA_APPROVED = AI_OUTBOUND_DATA_APPROVED
  }
})

test('T-016–020 grounded tools, mastery planning and governance APIs enforce scope', async () => {
  await get('/admin/users', sessions.student).expect(403)
  const aiConfig={token:process.env.AI_SERVICE_TOKEN,url:process.env.AI_SERVICE_URL,approved:process.env.AI_OUTBOUND_DATA_APPROVED}
  delete process.env.AI_SERVICE_TOKEN;delete process.env.AI_SERVICE_URL;delete process.env.AI_OUTBOUND_DATA_APPROVED
  try {
    await post('/ai/lectures/'+lecture.id+'/summarize',sessions.student,{}).expect(503)
    await post('/ai/modules/'+module.id+'/flashcards',sessions.student,{}).expect(503)
    await post('/ai/modules/'+module.id+'/quiz-draft',sessions.author,{}).expect(503)
  } finally {
    if(aiConfig.token!==undefined)process.env.AI_SERVICE_TOKEN=aiConfig.token
    if(aiConfig.url!==undefined)process.env.AI_SERVICE_URL=aiConfig.url
    if(aiConfig.approved!==undefined)process.env.AI_OUTBOUND_DATA_APPROVED=aiConfig.approved
  }
  const topic=(await post('/courses/'+course.id+'/topics',sessions.author,{name:'Sorting fundamentals',description:'Ordering and complexity'}).expect(201)).body
  let mastery=(await get('/users/me/mastery',sessions.student3).expect(200)).body.items
  assert.equal(mastery.find(item=>item.topic_id===topic.id).band,'intermediate')
  const draft=(await post('/quizzes',sessions.author,{module_id:module.id,title:'Topic mastery quiz',questions:[
    {question_type:'mcq',question_text:'Which operation orders values?',max_points:2,topic_id:topic.id,options:[
      {option_text:'Sorting',is_correct:true},{option_text:'Hashing',is_correct:false}
    ]}
  ]}).expect(201)).body
  await post('/quizzes/'+draft.id+'/review',sessions.author,{decision:'approved'}).set('If-Match',draft.revision).expect(200)
  const attempt=(await post('/quizzes/'+draft.id+'/attempt',sessions.student3,{}).expect(201)).body
  await post('/attempts/'+attempt.id+'/submit',sessions.student3,{answers:[{question_id:attempt.questions[0].id,selected_option_ids:[attempt.questions[0].options[0].id]}]}).expect(200)
  mastery=(await get('/users/me/mastery',sessions.student3).expect(200)).body.items
  assert.equal(mastery.find(item=>item.topic_id===topic.id).score,0.6)
  const plan=(await get('/users/me/study-plan',sessions.student3).expect(200)).body
  assert.equal(plan.steps[0].reason,'Prior finalized quiz performance indicates this priority')
  assert.equal(plan.days.length,7)
  assert.ok(plan.steps.every(step=>step.scheduled_for&&step.estimated_minutes>0))
  const candidate=(await post('/courses',sessions.author,{title:'Sorting project challenge '+run,description:'Practice sorting fundamentals',category:'Testing',difficulty:'intermediate',price:0,pricing_tier:'free'}).expect(201)).body
  await post('/courses/'+candidate.id+'/approve',sessions.admin,{decision:'approved'}).set('If-Match',candidate.revision).expect(200)
  const suggestions=(await get('/users/me/recommendations',sessions.student3).expect(200)).body.items
  assert.equal(suggestions[0].course_id,candidate.id)

  const pending=(await post('/courses',sessions.author,{title:'Pending admin review '+run,category:'Testing',difficulty:'beginner',price:0,pricing_tier:'free'}).expect(201)).body
  const queue=(await get('/admin/courses/pending',sessions.admin).expect(200)).body.items
  assert.ok(queue.some(item=>item.id===pending.id))
  await get('/admin/analytics/overview',sessions.student).expect(403)
  await db.query('INSERT INTO synthetic_payments(user_id,course_id,amount,status) VALUES($1,$2,499,\'succeeded\')',[sessions.student.user.id,course.id])
  const metrics=(await get('/admin/analytics/overview',sessions.admin).expect(200)).body
  assert.equal(metrics.revenue.amount,499)
  assert.equal(metrics.revenue.provenance,'synthetic payments')
  await db.query('DELETE FROM synthetic_payments WHERE user_id=$1',[sessions.student.user.id])

  const {rows:[report]}=await db.query('INSERT INTO moderation_reports(reporter_id,entity_type,entity_id,reason) VALUES($1,\'course\',$2,\'Synthetic report\') RETURNING id',[sessions.student.user.id,course.id])
  await get('/admin/moderation/reports',sessions.student).expect(403)
  assert.ok((await get('/admin/moderation/reports',sessions.admin).expect(200)).body.items.some(item=>item.id===report.id))
  await post('/admin/moderation/reports/'+report.id+'/review',sessions.admin,{decision:'dismissed'}).expect(200)
  await post('/admin/moderation/reports/'+report.id+'/review',sessions.admin,{decision:'dismissed'}).expect(409)

  const {roles:current}=sessions.student3.user
  await bearer(api.put(base+'/admin/users/'+sessions.student3.user.id+'/roles'),sessions.admin).send({roles:['student','instructor']}).expect(200)
  await get('/users/me/mastery',sessions.student3).expect(401)
  const upgraded=(await api.post(base+'/auth/login').send({email:email('student3'),password}).expect(200)).body
  await bearer(api.put(base+'/admin/users/'+sessions.student3.user.id+'/roles'),sessions.admin).send({roles:current}).expect(200)
  await post('/admin/users/'+sessions.student3.user.id+'/suspend',sessions.admin,{suspended:true}).expect(200)
  await get('/users/me/mastery',{access_token:upgraded.access_token}).expect(401)
  await post('/admin/users/'+sessions.student3.user.id+'/suspend',sessions.admin,{suspended:false}).expect(200)
})

test('T-016–017 approved internal adapter returns lecture tools and keeps generated quiz private until review', async () => {
  const {rows:[generation]}=await db.query(`INSERT INTO ai_source_generations(lecture_id,generation,status,source_hash)
    VALUES($1,100,'active',$2) RETURNING id`,[lecture.id,'synthetic-'+run])
  const {rows:[chunk]}=await db.query(`INSERT INTO ai_chunks(generation_id,course_id,lecture_id,ordinal,content,start_seconds)
    VALUES($1,$2,$3,0,'Quicksort chooses a pivot and partitions values around it.',42) RETURNING id`,[generation.id,course.id,lecture.id])
  const questions=Array.from({length:5},(_,index)=>({question_text:`Question ${index+1} about partitioning`,question_type:'mcq',max_points:1,evidence:chunk.id,options:[
    {option_text:'Partitions values around a pivot',is_correct:true},{option_text:'Sorts by hashing',is_correct:false}
  ]}))
  let providerCalls=0
  const server=createServer(async(req,res)=>{
    providerCalls++
    const pieces=[];for await(const piece of req)pieces.push(piece)
    const body=JSON.parse(Buffer.concat(pieces).toString())
    const path=req.url
    const result=path==='/v1/summarize'?{summary:`Sorting uses a pivot [${chunk.id}]`,sources:[{chunk_id:chunk.id}]}:
      path==='/v1/flashcards'?{items:[{question:'What does a pivot do?',answer:'Partitions values around itself.'}]}:
      path==='/v1/study-plan'?{days:Array.from({length:7},(_,index)=>({day:index+1,steps:index===0?[{topic:body.payload.topics[0].name,action:'Review the core lesson and practice.',estimated_minutes:30}]:[]}))}:
      {title:'Generated transcript quiz',questions}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const previous={token:process.env.AI_SERVICE_TOKEN,url:process.env.AI_SERVICE_URL,approved:process.env.AI_OUTBOUND_DATA_APPROVED}
  process.env.AI_SERVICE_TOKEN='synthetic-adapter-token'
  process.env.AI_SERVICE_URL=`http://127.0.0.1:${server.address().port}`
  process.env.AI_OUTBOUND_DATA_APPROVED='true'
  try{
    const summary=(await post('/ai/lectures/'+lecture.id+'/summarize',sessions.student,{}).expect(200)).body
    assert.match(summary.summary,/Private lecture at 42s/)
    assert.equal(summary.sources[0].lecture_id,lecture.id)
    const cards=(await post('/ai/modules/'+module.id+'/flashcards',sessions.student,{}).expect(200)).body
    assert.equal(cards.items[0].question,'What does a pivot do?')
    assert.ok(cards.items[0].id)
    const savedCards=(await get('/users/me/flashcards?course_id='+course.id,sessions.student).expect(200)).body.items
    assert.ok(savedCards.some(item=>item.id===cards.items[0].id))
    await post('/users/me/flashcards/'+cards.items[0].id+'/review',sessions.student,{}).expect(200)
    await post('/users/me/flashcards/'+cards.items[0].id+'/review',sessions.outsider,{}).expect(404)
    const personalized=(await post('/ai/study-plan',sessions.student,{course_id:course.id}).expect(200)).body
    assert.equal(personalized.days.length,7)
    assert.equal(personalized.days[0].steps[0].topic,'Sorting fundamentals')
    assert.equal((await get('/users/me/study-plan?course_id='+course.id,sessions.student).expect(200)).body.days.length,7)
    const draftKey=randomUUID()
    const draft=(await post('/ai/modules/'+module.id+'/quiz-draft',sessions.author,{},draftKey).expect(201)).body
    assert.equal(draft.questions.length,5);assert.equal(draft.status,'draft')
    const retry=(await post('/ai/modules/'+module.id+'/quiz-draft',sessions.author,{},draftKey).expect(201)).body
    assert.equal(retry.quiz_id,draft.quiz_id);assert.equal(providerCalls,4)
    await post('/quizzes/'+draft.quiz_id+'/attempt',sessions.student,{}).expect(404)
    await get('/quizzes/'+draft.quiz_id+'/review',sessions.student).expect(403)
    const review=(await get('/quizzes/'+draft.quiz_id+'/review',sessions.author).expect(200)).body
    assert.equal(review.questions[0].source_chunks[0],chunk.id)
    await post('/quizzes/'+draft.quiz_id+'/review',sessions.author,{decision:'approved'}).set('If-Match',draft.revision).expect(200)
    await post('/quizzes/'+draft.quiz_id+'/attempt',sessions.student,{}).expect(201)
  }finally{
    server.close()
    for(const [key,value] of Object.entries({AI_SERVICE_TOKEN:previous.token,AI_SERVICE_URL:previous.url,AI_OUTBOUND_DATA_APPROVED:previous.approved})){
      if(value===undefined)delete process.env[key];else process.env[key]=value
    }
  }
})

test('T-014–015 ingest/publish, owning instructor reviewer chat, isolation and chat replay conflict', async () => {
  let chatCalls = 0
  let publishedChunkId
  let lastChatPayload
  const vectorLiteral = '[' + Array.from({ length: 1536 }, (_, idx) => (idx === 0 ? '1' : '0')).join(',') + ']'
  const server = createServer(async (req, res) => {
    const pieces = []
    for await (const piece of req) pieces.push(piece)
    const body = JSON.parse(Buffer.concat(pieces).toString())
    if (req.url === '/v1/extract') {
      const { rows: assets } = await db.query('SELECT id,name FROM lecture_assets WHERE id=ANY($1::uuid[])', [body.payload.resource_ids])
      const documents = assets.flatMap(asset => asset.name === 'handout.pdf'
        ? [{ source_asset_id: asset.id, source_name: asset.name, page_number: 2, text: 'PDF extracted topic details.' }]
        : asset.name === 'slides.pptx'
          ? [{ source_asset_id: asset.id, source_name: asset.name, page_number: 1, text: 'Slide extracted topic details.' }]
          : [{ source_asset_id: asset.id, source_name: asset.name, start_seconds: 42, end_seconds: 47, text: 'Captioned topic details.' }])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ documents }))
      return
    }
    if (req.url === '/v1/embed') {
      const generationId = body.payload.generation_id
      const { rows } = await db.query('SELECT id FROM ai_chunks WHERE generation_id=$1 ORDER BY ordinal', [generationId])
      publishedChunkId = rows[0].id
      await db.query('UPDATE ai_chunks SET embedding=$2::vector WHERE generation_id=$1', [generationId, vectorLiteral])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ generation_id: generationId, chunks: rows.length }))
      return
    }
    if (req.url === '/v1/chat') {
      chatCalls++
      lastChatPayload = body.payload
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        reply: `Quicksort explanation grounded in [${publishedChunkId}].`,
        sources: [{ chunk_id: publishedChunkId }]
      }))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const previous = {
    token: process.env.AI_SERVICE_TOKEN,
    url: process.env.AI_SERVICE_URL,
    approved: process.env.AI_OUTBOUND_DATA_APPROVED
  }
  process.env.AI_SERVICE_TOKEN = 'synthetic-adapter-token'
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${server.address().port}`
  process.env.AI_OUTBOUND_DATA_APPROVED = 'true'
  try {
    const ingest = (await post('/ai/lectures/' + lecture.id + '/ingest', sessions.author, {
      content: 'Quicksort selects a pivot and partitions elements in place.',
      segments: [{ start_seconds: 1, end_seconds: 5, text: 'Quicksort selects a pivot and partitions elements in place.' }]
    }).expect(202)).body
    assert.equal(ingest.status, 'processing')
    const indexed = await db.query('SELECT source_name,page_number,start_seconds FROM ai_chunks WHERE generation_id=$1', [ingest.id])
    assert.ok(indexed.rows.some(row=>row.source_name==='handout.pdf'&&row.page_number===2))
    assert.ok(indexed.rows.some(row=>row.source_name==='slides.pptx'&&row.page_number===1))
    assert.ok(indexed.rows.some(row=>row.source_name==='captions.vtt'&&row.start_seconds===42))
    const activated = (await post('/ai/jobs/' + ingest.id + '/publish', sessions.author, {}).expect(200)).body
    assert.equal(activated.status, 'active')

    await post('/ai/chat/sessions', sessions.admin, { course_id: course.id }).expect(403)
    const reviewerSession = (await post('/ai/chat/sessions', sessions.author, { course_id: course.id }).expect(201)).body
    await bearer(api.put(base + '/ai/chat/sessions/' + reviewerSession.id + '/mode'), sessions.author).send({ mode: 'advanced' }).expect(200)
    const reviewerReply = (await post('/ai/chat/sessions/' + reviewerSession.id + '/messages', sessions.author, {
      message: 'Summarize reviewer scope',
      request_id: randomUUID()
    }).expect(200)).body
    assert.equal(reviewerReply.mode, 'advanced')
    assert.equal(reviewerReply.sources[0].lecture_id, lecture.id)
    assert.equal((await db.query('SELECT count(*)::int n FROM learner_activity WHERE user_id=$1', [sessions.author.user.id])).rows[0].n, 0)

    const studentSession = (await post('/ai/chat/sessions', sessions.student, { course_id: course.id }).expect(201)).body
    const secondSession = (await post('/ai/chat/sessions', sessions.student, { course_id: course.id }).expect(201)).body
    assert.ok((await get('/ai/chat/sessions?course_id='+course.id,sessions.student).expect(200)).body.items.length>=2)
    assert.equal((await get('/ai/chat/sessions?course_id='+course.id,sessions.student2).expect(200)).body.items.length,0)
    await get('/ai/chat/sessions/' + studentSession.id + '/messages', sessions.author).expect(404)

    const msgRequestId = randomUUID()
    const callsBefore = chatCalls
    const first = (await post('/ai/chat/sessions/' + studentSession.id + '/messages', sessions.student, {
      message: 'How does partitioning work?',
      request_id: msgRequestId
    }).expect(200)).body
    const replaySame = (await post('/ai/chat/sessions/' + studentSession.id + '/messages', sessions.student, {
      message: 'How does partitioning work?',
      request_id: msgRequestId
    }).expect(200)).body
    assert.deepEqual(replaySame, first)
    assert.equal(chatCalls, callsBefore + 1)
    await post('/ai/chat/sessions/' + studentSession.id + '/messages', sessions.student, {
      message: 'What happens next?', request_id: randomUUID()
    }).expect(200)
    assert.equal(lastChatPayload.history.length,2)
    assert.equal(lastChatPayload.history[0].content,'How does partitioning work?')
    assert.equal(lastChatPayload.history[1].role,'assistant')
    await post('/ai/chat/sessions/' + secondSession.id + '/messages', sessions.student, {
      message: 'A separate question', request_id: randomUUID()
    }).expect(200)
    assert.deepEqual(lastChatPayload.history,[])
    await post('/ai/chat/sessions/' + studentSession.id + '/messages', sessions.student, {
      message: 'Different question reusing request_id',
      request_id: msgRequestId
    }).expect(409)
  } finally {
    server.close()
    for (const [key, value] of Object.entries({
      AI_SERVICE_TOKEN: previous.token,
      AI_SERVICE_URL: previous.url,
      AI_OUTBOUND_DATA_APPROVED: previous.approved
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})

test('T-019 account deletion is policy-gated, anonymizes PII and revokes access', async()=>{
  const target=sessions.outsider, prior=process.env.ACCOUNT_DELETION_POLICY_CONFIRMED
  deletedFixtureIds.push(target.user.id)
  await db.query('INSERT INTO lecture_annotations(lecture_id,user_id,kind,timestamp_seconds,content) VALUES($1,$2,\'note\',0,\'private note\')',[lecture.id,target.user.id])
  await db.query('INSERT INTO ai_chat_sessions(user_id,course_id) VALUES($1,$2)',[target.user.id,course.id])
  await db.query('INSERT INTO learner_activity(user_id,activity_date) VALUES($1,(now() AT TIME ZONE \'UTC\')::date)',[target.user.id])
  await db.query("INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES($1,'test.personal','user',$1,$2)",[target.user.id,{email:email('outsider'),detail:'private metadata'}])
  delete process.env.ACCOUNT_DELETION_POLICY_CONFIRMED
  try{await bearer(api.delete(base+'/admin/users/'+target.user.id),sessions.admin).expect(503)}
  finally{if(prior!==undefined)process.env.ACCOUNT_DELETION_POLICY_CONFIRMED=prior}
  process.env.ACCOUNT_DELETION_POLICY_CONFIRMED='true'
  try{
    await bearer(api.delete(base+'/admin/users/'+sessions.admin.user.id),sessions.admin).expect(409)
    const deletion=(await bearer(api.delete(base+'/admin/users/'+target.user.id),sessions.admin).expect(200)).body
    assert.equal(deletion.deleted,true)
    const {rows:[tombstone]}=await db.query('SELECT full_name,email,is_active,deleted_at,revision FROM users WHERE id=$1',[target.user.id])
    assert.equal(tombstone.full_name,'Deleted account');assert.equal(tombstone.email,`deleted+${target.user.id}@deleted.invalid`);assert.equal(tombstone.is_active,false)
    await get('/auth/me',target).expect(401)
    await api.post(base+'/auth/login').send({email:email('outsider'),password}).expect(401)
    await bearer(api.put(base+'/admin/users/'+target.user.id+'/roles'),sessions.admin).send({roles:['student']}).expect(409)
    await post('/admin/users/'+target.user.id+'/suspend',sessions.admin,{suspended:false}).expect(409)
    const {rows:[privateRows]}=await db.query(`SELECT
      (SELECT count(*)::int FROM lecture_annotations WHERE user_id=$1) annotations,
      (SELECT count(*)::int FROM ai_chat_sessions WHERE user_id=$1) chats,
      (SELECT count(*)::int FROM learner_activity WHERE user_id=$1) activity,
      (SELECT count(*)::int FROM user_roles WHERE user_id=$1) roles,
      (SELECT count(*)::int FROM sessions WHERE user_id=$1 AND revoked_at IS NOT NULL) revoked`,[target.user.id])
    assert.deepEqual(privateRows,{annotations:0,chats:0,activity:1,roles:0,revoked:1})
    const {rows:[audit]}=await db.query("SELECT metadata FROM audit_logs WHERE actor_id=$1 AND action='test.personal'",[target.user.id])
    assert.deepEqual(audit.metadata,{redacted:true,action:'test.personal'})
    const retried=(await bearer(api.delete(base+'/admin/users/'+target.user.id),sessions.admin).expect(200)).body
    assert.equal(retried.deleted_at.toString(),deletion.deleted_at)
  }finally{if(prior===undefined)delete process.env.ACCOUNT_DELETION_POLICY_CONFIRMED;else process.env.ACCOUNT_DELETION_POLICY_CONFIRMED=prior}
})
