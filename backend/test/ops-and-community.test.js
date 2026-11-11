import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import argon2 from 'argon2'
import request from 'supertest'

assert.ok(['development', 'test'].includes(process.env.APP_ENV), 'Use a local development/test database')

const { app } = await import('../src/app.ts')
const { db } = await import('../src/db/index.ts')
const { cache } = await import('../src/cache.ts')
const { formatLogLine, redactString } = await import('../src/utils/logger.ts')
const {
  connectQueue,
  closeQueue,
  processOutboxEvent,
  reconcilePendingOutbox,
  replayFailedOutbox
} = await import('../src/jobs/outbox.ts')

const api = request(app)
const base = '/api/v1'
const run = randomUUID()
const email = name => `${name.toLowerCase()}-${run}@vertexlearn.test`
const password = randomUUID()
const hexRun = run.replaceAll('-', '')
const ipGroup = slot =>
  `2001:db8:${hexRun.slice(0, 4)}:${hexRun.slice(4, 8)}:${createHash('sha256').update(slot).digest('hex').slice(0, 4)}::1`

const bearer = (req, user) => req.set('Authorization', 'Bearer ' + user.access_token)
const write = (req, key = randomUUID()) => req.set('Idempotency-Key', key)
const get = (path, user, ip = ipGroup('1')) => bearer(api.get(base + path).set('X-Forwarded-For', ip), user)
const post = (path, user, data, key, ip = ipGroup('1')) =>
  write(bearer(api.post(base + path).set('X-Forwarded-For', ip), user), key).send(data)
const put = (path, user, revision, body, ip = ipGroup('1')) =>
  bearer(api.put(base + path).set('X-Forwarded-For', ip), user).set('If-Match', revision).send(body)

const sessions = {}
const courseIds = []
let course

before(async () => {
  app.set('trust proxy', 'loopback')
  await cache.connect()
  await connectQueue()

  const hash = await argon2.hash(password)
  const roles = {
    author: 'instructor',
    stranger: 'instructor',
    admin: 'admin',
    student: 'student',
    student2: 'student',
    outsider: 'student',
    rlUser: 'student',
    rlUpload: 'instructor',
    rlAi0: 'student',
    rlAi1: 'student',
    rlAi2: 'student',
    rlAi3: 'student',
    rlAi4: 'student',
    rlAi5: 'student',
    rlAi6: 'student'
  }

  for (const [name, role] of Object.entries(roles)) {
    await db.query(`
      WITH account AS (INSERT INTO users(full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id)
      INSERT INTO user_roles(user_id, role_id) SELECT account.id, roles.id FROM account CROSS JOIN roles WHERE name = $4
    `, [name, email(name), hash, role])
    sessions[name] = (await api.post(base + '/auth/login')
      .set('X-Forwarded-For', ipGroup(name))
      .send({ email: email(name), password })
      .expect(200)).body
  }

  course = (await post('/courses', sessions.author, {
    title: 'Ops Community Course ' + run,
    description: 'Verification course for community, caching, and operations.',
    category: 'Testing-' + run,
    difficulty: 'intermediate',
    price: 0,
    pricing_tier: 'free'
  }).expect(201)).body
  courseIds.push(course.id)

  await post('/courses/' + course.id + '/approve', sessions.admin, { decision: 'approved' })
    .set('If-Match', course.revision)
    .expect(200)

  await post('/courses/' + course.id + '/enroll', sessions.student, {}).expect(200)
  await post('/courses/' + course.id + '/enroll', sessions.student2, {}).expect(200)
})

after(async () => {
  const match = `%-${run}@vertexlearn.test`
  try {
    if (!cache.isOpen) await cache.connect()
    if (courseIds.length) {
      await db.query("DELETE FROM outbox WHERE payload->>'course_id' = ANY($1::text[])", [courseIds])
      await db.query('DELETE FROM notifications WHERE course_id = ANY($1::uuid[])', [courseIds])
      await db.query('DELETE FROM discussion_threads WHERE course_id = ANY($1::uuid[])', [courseIds])
      await db.query('DELETE FROM announcements WHERE course_id = ANY($1::uuid[])', [courseIds])
    }
    await db.query('DELETE FROM ai_chat_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM post_reports WHERE reporter_id IN (SELECT id FROM users WHERE email LIKE $1) OR reviewed_by IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM moderation_reports WHERE reporter_id IN (SELECT id FROM users WHERE email LIKE $1) OR reviewed_by IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM enrollments WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM course_approvals WHERE reviewed_by IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM courses WHERE instructor_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
    await db.query('DELETE FROM users WHERE email LIKE $1', [match])
  } finally {
    await closeQueue()
    if (cache.isOpen) await cache.quit()
    await db.end()
  }
})

test('T-021 forum threads, nested parent_id guard, duplicate report 409, moderation and queue sync', async () => {
  await get('/courses/' + course.id + '/threads', sessions.outsider).expect(403)
  await get('/courses/' + course.id + '/threads', sessions.stranger).expect(403)
  await post('/courses/' + course.id + '/announcements', sessions.stranger, { content: 'Stranger denied' }).expect(404)
  await post('/courses/' + course.id + '/threads', sessions.outsider, { title: 'Nope', content: 'Denied' }).expect(403)

  const threadKey = randomUUID()
  const thread = (await post('/courses/' + course.id + '/threads', sessions.student, {
    title: 'Recursion Question',
    content: 'How does merge sort split work?'
  }, threadKey).expect(201)).body
  assert.equal(thread.course_id, course.id)

  const replayThread = (await post('/courses/' + course.id + '/threads', sessions.student, {
    title: 'Recursion Question',
    content: 'How does merge sort split work?'
  }, threadKey).expect(201)).body
  assert.equal(replayThread.id, thread.id)

  const otherThread = (await post('/courses/' + course.id + '/threads', sessions.author, {
    title: 'Second Thread',
    content: 'Root post in second thread.'
  }).expect(201)).body

  const thread1Posts = (await get('/threads/' + thread.id + '/posts', sessions.student).expect(200)).body
  assert.equal(thread1Posts.items.length, 1)
  const rootPost = thread1Posts.items[0]

  const otherPosts = (await get('/threads/' + otherThread.id + '/posts', sessions.author).expect(200)).body
  const otherRootPost = otherPosts.items[0]

  // Cross-thread parent_id must be rejected with 422
  await post('/threads/' + thread.id + '/posts', sessions.student2, {
    content: 'Cross-thread reply attempt',
    parent_id: otherRootPost.id
  }).expect(422)

  // Valid nested reply
  const reply = (await post('/threads/' + thread.id + '/posts', sessions.student2, {
    content: 'It divides arrays cleanly in half recursively.',
    parent_id: rootPost.id
  }).expect(201)).body
  assert.equal(reply.parent_id, rootPost.id)
  assert.equal(reply.visibility, 'visible')

  // Report flow + duplicate 409 + admin flagged queue sync
  await post('/posts/' + reply.id + '/report', sessions.outsider, { reason: 'Not enrolled' }).expect(403)
  const report = (await post('/posts/' + reply.id + '/report', sessions.student, { reason: 'Needs instructor check' }).expect(201)).body
  assert.equal(report.post_id, reply.id)
  assert.equal(report.status, 'pending')

  await post('/posts/' + reply.id + '/report', sessions.student, { reason: 'Duplicate report' }).expect(409)

  const flaggedBefore = (await get('/admin/moderation/flagged-posts', sessions.admin).expect(200)).body
  assert.ok(flaggedBefore.items.some(p => p.id === reply.id))

  // Student cannot moderate; wrong If-Match returns 409; author hides post
  await bearer(api.put(base + '/posts/' + reply.id + '/moderation').set('X-Forwarded-For', ipGroup('1')), sessions.student)
    .send({ decision: 'hide', reason: 'Not allowed' }).expect(403)
  await put('/posts/' + reply.id + '/moderation', sessions.author, '"999"', {
    decision: 'hide',
    reason: 'Stale test'
  }).expect(409)

  const hidden = (await put('/posts/' + reply.id + '/moderation', sessions.author, reply.revision, {
    decision: 'hide',
    reason: 'Moderation hide check'
  }).expect(200)).body
  assert.equal(hidden.visibility, 'hidden')

  // Student view masks content while author still sees original text
  const studentPosts = (await get('/threads/' + thread.id + '/posts', sessions.student).expect(200)).body.items
  assert.equal(studentPosts.find(p => p.id === reply.id).content, '[Hidden by moderation]')
  const authorPosts = (await get('/threads/' + thread.id + '/posts', sessions.author).expect(200)).body.items
  assert.equal(authorPosts.find(p => p.id === reply.id).content, 'It divides arrays cleanly in half recursively.')

  // Flagged queue is now cleared for this post
  const flaggedAfter = (await get('/admin/moderation/flagged-posts', sessions.admin).expect(200)).body
  assert.ok(!flaggedAfter.items.some(p => p.id === reply.id))

  // Restore post, report again, and verify admin moderation report review syncs discussion_posts
  await put('/posts/' + reply.id + '/moderation', sessions.author, hidden.revision, {
    decision: 'restore',
    reason: 'Restoring for admin sync check'
  }).expect(200)

  await post('/posts/' + reply.id + '/report', sessions.student2, { reason: 'Admin review check' }).expect(201)
  const modReports = (await get('/admin/moderation/reports', sessions.admin).expect(200)).body.items
  const pendingModReport = modReports.find(r => r.entity_type === 'content' && r.entity_id === reply.id)
  assert.ok(pendingModReport)
  await post('/admin/moderation/reports/' + pendingModReport.id + '/review', sessions.admin, { decision: 'actioned' }).expect(200)

  const syncedStudentPosts = (await get('/threads/' + thread.id + '/posts', sessions.student).expect(200)).body.items
  assert.equal(syncedStudentPosts.find(p => p.id === reply.id).visibility, 'hidden')
})

test('T-021 announcements, outbox worker email dedupe, replay after failure, and notification access checks', async () => {
  const deliveries = []
  let failEmailWebhook = false

  const webhook = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    if (failEmailWebhook) {
      res.writeHead(500).end('temporary smtp relay error')
      return
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString())
    deliveries.push({
      key: req.headers['idempotency-key'],
      to: payload.to,
      subject: payload.subject
    })
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'msg-' + deliveries.length }))
  })
  await new Promise(resolve => webhook.listen(0, '127.0.0.1', resolve))
  const prevWebhook = process.env.EMAIL_WEBHOOK_URL
  process.env.EMAIL_WEBHOOK_URL = `http://127.0.0.1:${webhook.address().port}/send`

  try {
    await post('/courses/' + course.id + '/announcements', sessions.student, { content: 'Unauthorized' }).expect(403)
    const announcement = (await post('/courses/' + course.id + '/announcements', sessions.author, {
      content: 'Midterm syllabus and problem set details posted.'
    }).expect(201)).body

    const { rows: [outboxRow] } = await db.query(
      "SELECT id, status FROM outbox WHERE event_type = 'course.announcement' AND payload->>'announcement_id' = $1",
      [announcement.id]
    )
    assert.ok(outboxRow)
    assert.equal(outboxRow.status, 'pending')

    await processOutboxEvent(outboxRow.id)
    // Duplicate forced re-processing must NOT resend already-delivered email notifications
    await db.query("UPDATE outbox SET status = 'pending' WHERE id = $1", [outboxRow.id])
    await processOutboxEvent(outboxRow.id)

    const announcementEmails = deliveries.filter(d => d.subject.includes('Announcement:'))
    assert.equal(announcementEmails.length, 2) // exactly student + student2 once each

    const studentNotes = (await get('/notifications/me', sessions.student).expect(200)).body.items
    assert.ok(studentNotes.some(n => n.body.includes('Midterm syllabus') && !n.is_read))
    const myNote = studentNotes.find(n => n.body.includes('Midterm syllabus'))

    // Outsider cannot read-mark someone else's notification -> 404
    await put('/notifications/' + myNote.id + '/read', sessions.outsider, 'ignored', {}).expect(404)

    // Remove student2 enrollment temporarily and verify course-scoped read denial -> 403
    const student2Notes = (await get('/notifications/me', sessions.student2).expect(200)).body.items
    const note2 = student2Notes.find(n => n.body.includes('Midterm syllabus'))
    await db.query('DELETE FROM enrollments WHERE user_id = $1 AND course_id = $2', [sessions.student2.user.id, course.id])
    const afterAccessLoss = (await get('/notifications/me', sessions.student2).expect(200)).body.items
    assert.ok(!afterAccessLoss.some(n => n.id === note2.id))
    await put('/notifications/' + note2.id + '/read', sessions.student2, 'ignored', {}).expect(403)
    await post('/courses/' + course.id + '/enroll', sessions.student2, {}).expect(200)

    await db.query("UPDATE courses SET status = 'pending' WHERE id = $1", [course.id])
    const whilePending = (await get('/notifications/me', sessions.student2).expect(200)).body.items
    assert.ok(!whilePending.some(n => n.id === note2.id))
    await put('/notifications/' + note2.id + '/read', sessions.student2, 'ignored', {}).expect(403)
    await db.query("UPDATE courses SET status = 'approved' WHERE id = $1", [course.id])

    const marked = (await put('/notifications/' + myNote.id + '/read', sessions.student, 'ignored', {}).expect(200)).body
    assert.equal(marked.is_read, true)

    // Failure & replay drill: simulate failed outbox delivery then recover with replayFailedOutbox()
    failEmailWebhook = true
    const secondAnnouncement = (await post('/courses/' + course.id + '/announcements', sessions.author, {
      content: 'Lab 2 starter repository published.'
    }).expect(201)).body
    const { rows: [failOutbox] } = await db.query(
      "SELECT id FROM outbox WHERE event_type = 'course.announcement' AND payload->>'announcement_id' = $1",
      [secondAnnouncement.id]
    )
    for (let i = 0; i < 5; i++) {
      await db.query("UPDATE outbox SET next_attempt_at = now() - interval '1 second' WHERE id = $1 AND status = 'pending'", [failOutbox.id])
      await processOutboxEvent(failOutbox.id)
    }
    const { rows: [terminal] } = await db.query('SELECT status, attempts FROM outbox WHERE id = $1', [failOutbox.id])
    assert.equal(terminal.status, 'failed')
    assert.equal(terminal.attempts, 5)

    failEmailWebhook = false
    const replayed = await replayFailedOutbox()
    assert.ok(replayed >= 1)
    await reconcilePendingOutbox()

    const { rows: [recovered] } = await db.query('SELECT status FROM outbox WHERE id = $1', [failOutbox.id])
    assert.equal(recovered.status, 'processed')
    const secondEmails = deliveries.filter(d => d.subject.includes('Announcement:'))
    assert.equal(secondEmails.length, 4) // 2 from first announcement + 2 recovered from second announcement
  } finally {
    webhook.close()
    if (prevWebhook === undefined) delete process.env.EMAIL_WEBHOOK_URL
    else process.env.EMAIL_WEBHOOK_URL = prevWebhook
  }
})

test('T-022 caching, generation invalidation, leaderboard PII omission, Prometheus metrics, and rate limit buckets', async () => {
  const ip = ipGroup('22a')
  // Leaderboard authorization, PII redaction, and invalidation
  await get('/leaderboard/' + course.id, sessions.outsider, ip).expect(403)
  const board1 = (await get('/leaderboard/' + course.id, sessions.student, ip).expect(200)).body
  assert.equal(board1.items.length, 2)
  assert.equal(board1.items[0].rank, 1)
  assert.ok(typeof board1.items[0].display_name === 'string')
  assert.ok(board1.items[0].score >= 0 && board1.items[0].score <= 100)
  assert.doesNotMatch(JSON.stringify(board1), /@vertexlearn\.test|password_hash|user_id/)

  // Enroll rlAi0 and verify leaderboard cache invalidation adds rank 3 immediately
  await post('/courses/' + course.id + '/enroll', sessions.rlAi0, {}, undefined, ip).expect(200)
  const board2 = (await get('/leaderboard/' + course.id, sessions.student, ip).expect(200)).body
  assert.equal(board2.items.length, 3)

  // Course & catalog cache hit and mutation invalidation via cache_generations
  const cacheIp = ipGroup('22b')
  const list1 = (await api.get(base + '/courses').query({ category: 'Testing-' + run }).set('X-Forwarded-For', cacheIp).expect(200)).body
  assert.equal(list1.items.length, 1)

  const edited = (await put('/courses/' + course.id, sessions.author, '"2"', {
    title: 'Updated Ops Course ' + run
  }, cacheIp).expect(200)).body

  // Pending edit immediately invalidates cached catalog/detail views
  const listPending = (await api.get(base + '/courses').query({ category: 'Testing-' + run }).set('X-Forwarded-For', cacheIp).expect(200)).body
  assert.equal(listPending.items.length, 0)
  await api.get(base + '/courses/' + course.id).set('X-Forwarded-For', cacheIp).expect(404)

  // Re-approve so course returns to catalog and stays approved for subsequent tests
  await post('/courses/' + course.id + '/approve', sessions.admin, { decision: 'approved' }, undefined, cacheIp)
    .set('If-Match', edited.revision)
    .expect(200)

  const list2 = (await api.get(base + '/courses').query({ category: 'Testing-' + run }).set('X-Forwarded-For', cacheIp).expect(200)).body
  assert.equal(list2.items[0].title, 'Updated Ops Course ' + run)
  const detail2 = (await api.get(base + '/courses/' + course.id).set('X-Forwarded-For', cacheIp).expect(200)).body
  assert.equal(detail2.course.title, 'Updated Ops Course ' + run)

  // Rate-limit buckets (unique IPs / dedicated test users so other suites stay clean)
  const rlAuthIp = ipGroup('rlauth')
  for (let i = 0; i < 10; i++) {
    await api.post(base + '/auth/login').set('X-Forwarded-For', rlAuthIp)
      .send({ email: `missing-${i}-${run}@vertexlearn.test`, password: 'wrong-password-1234' }).expect(401)
  }
  const authBlocked = await api.post(base + '/auth/login').set('X-Forwarded-For', rlAuthIp)
    .send({ email: `missing-11-${run}@vertexlearn.test`, password: 'wrong-password-1234' }).expect(429)
  assert.ok(Number(authBlocked.headers['retry-after']) >= 1)

  const rlCatalogIp = ipGroup('rlcat')
  for (let i = 0; i < 120; i++) {
    await api.get(base + '/courses').set('X-Forwarded-For', rlCatalogIp).expect(200)
  }
  const catBlocked = await api.get(base + '/courses').set('X-Forwarded-For', rlCatalogIp).expect(429)
  assert.ok(Number(catBlocked.headers['retry-after']) >= 1)

  // user bucket: 100/min/user
  const rlUserIp = ipGroup('rlusr')
  for (let i = 0; i < 100; i++) {
    await get('/notifications/me', sessions.rlUser, rlUserIp).expect(200)
  }
  await get('/notifications/me', sessions.rlUser, rlUserIp).expect(429)

  // upload bucket: 20/min/user (limit runs before validation on /assignments/:id/submit)
  const assignment = (await post('/assignments', sessions.author, {
    course_id: course.id,
    title: 'RL Assignment',
    instructions: 'Check upload limiter.',
    due_date: new Date(Date.now() + 3600000).toISOString(),
    rubric: [{ id: randomUUID(), label: 'Check', max_points: 5 }]
  }).expect(201)).body

  const rlUploadIp = ipGroup('rlup')
  for (let i = 0; i < 20; i++) {
    await bearer(api.post(base + '/assignments/' + assignment.id + '/submit').set('X-Forwarded-For', rlUploadIp), sessions.outsider)
      .set('Idempotency-Key', randomUUID()).expect(403)
  }
  await bearer(api.post(base + '/assignments/' + assignment.id + '/submit').set('X-Forwarded-For', rlUploadIp), sessions.outsider)
    .set('Idempotency-Key', randomUUID()).expect(429)

  // ai-chat bucket: 20/min/user & ai-jobs bucket: 30/min/user
  const rlAiIp = ipGroup('rlai')
  for (let i = 0; i < 20; i++) {
    await post('/ai/chat/sessions', sessions.rlAi0, { course_id: course.id }, undefined, rlAiIp).expect(503)
  }
  await post('/ai/chat/sessions', sessions.rlAi0, { course_id: course.id }, undefined, rlAiIp).expect(429)

  for (let i = 0; i < 30; i++) {
    await post('/ai/lectures/' + randomUUID() + '/summarize', sessions.rlAi1, {}, undefined, rlAiIp).expect(404)
  }
  await post('/ai/lectures/' + randomUUID() + '/summarize', sessions.rlAi1, {}, undefined, rlAiIp).expect(429)

  // ai-chat-ip bucket: 120/min/IP across distinct users
  const sharedAiIp = ipGroup('aishared')
  const chatUsers = [sessions.rlAi1, sessions.rlAi2, sessions.rlAi3, sessions.rlAi4, sessions.rlAi5, sessions.rlAi6]
  for (let u = 0; u < chatUsers.length; u++) {
    for (let i = 0; i < 20; i++) {
      await post('/ai/chat/sessions', chatUsers[u], { course_id: course.id }, undefined, sharedAiIp).expect(403)
    }
  }
  await post('/ai/chat/sessions', sessions.author, { course_id: course.id }, undefined, sharedAiIp).expect(429)

  // Metrics endpoint exposes Prometheus gauges/counters
  const metrics = await api.get('/metrics').expect(200)
  assert.match(metrics.headers['content-type'], /text\/plain/)
  assert.match(metrics.text, /vertexlearn_http_requests_total/)
  assert.match(metrics.text, /vertexlearn_cache_events_total/)
  assert.match(metrics.text, /vertexlearn_rate_limit_blocks_total/)
  assert.match(metrics.text, /vertexlearn_outbox_jobs_total/)
  assert.match(metrics.text, /vertexlearn_db_pool_connections/)
})

test('T-024 AI outage isolation, Redis outage fallback, and structured logger PII/secret redaction', async () => {
  // Structured logger redaction
  const redacted = redactString('Bearer eyJhbGciOiJIUzI1NiJ9.payload123.sig?grant=secret1&token=secret2 student@vertexlearn.test')
  assert.doesNotMatch(redacted, /payload123|secret1|secret2|student@vertexlearn\.test/)
  const line = formatLogLine('info', 'ops.redaction_check', {
    authorization: 'Bearer rawtoken999',
    email: 'private@vertexlearn.test',
    note: 'eyJhbGciOiJIUzI1NiJ9.abcdefgh.ijklmnop'
  })
  const parsed = JSON.parse(line)
  assert.equal(parsed.authorization, '[REDACTED]')
  assert.equal(parsed.email, '[REDACTED]')
  assert.equal(parsed.note, '[REDACTED_JWT]')
  assert.ok(parsed.release_id)
  assert.ok(parsed.timestamp)

  // AI provider unreachable returns 503 while core LMS APIs stay 200
  const closedAiServer = createServer((_req, res) => res.end())
  await new Promise(resolve => closedAiServer.listen(0, '127.0.0.1', resolve))
  const unreachablePort = closedAiServer.address().port
  await new Promise(resolve => closedAiServer.close(resolve))

  const prevAi = {
    url: process.env.AI_SERVICE_URL,
    token: process.env.AI_SERVICE_TOKEN,
    approved: process.env.AI_OUTBOUND_DATA_APPROVED
  }
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${unreachablePort}`
  process.env.AI_SERVICE_TOKEN = 'synthetic-token'
  process.env.AI_OUTBOUND_DATA_APPROVED = 'true'

  try {
    const sess = (await post('/ai/chat/sessions', sessions.student, { course_id: course.id }, undefined, ipGroup('24ai')).expect(201)).body
    await post('/ai/chat/sessions/' + sess.id + '/messages', sessions.student, {
      message: 'Explain balanced binary trees.',
      request_id: randomUUID()
    }, undefined, ipGroup('24ai')).expect(503)

    // Non-AI endpoints continue unaffected
    await api.get(base + '/courses').set('X-Forwarded-For', ipGroup('24ok')).expect(200)
    await get('/courses/' + course.id + '/threads', sessions.student, ipGroup('24ok')).expect(200)
    await get('/notifications/me', sessions.student, ipGroup('24ok')).expect(200)
  } finally {
    if (prevAi.url === undefined) delete process.env.AI_SERVICE_URL
    else process.env.AI_SERVICE_URL = prevAi.url
    if (prevAi.token === undefined) delete process.env.AI_SERVICE_TOKEN
    else process.env.AI_SERVICE_TOKEN = prevAi.token
    if (prevAi.approved === undefined) delete process.env.AI_OUTBOUND_DATA_APPROVED
    else process.env.AI_OUTBOUND_DATA_APPROVED = prevAi.approved
  }

  // Redis outage simulation: public catalog fails open (200 via PostgreSQL), login fails closed (503)
  await cache.quit()
  try {
    await api.get(base + '/courses').set('X-Forwarded-For', ipGroup('redisoff')).expect(200)
    await api.get(base + '/courses/' + course.id).set('X-Forwarded-For', ipGroup('redisoff')).expect(200)
    await api.post(base + '/auth/login').set('X-Forwarded-For', ipGroup('redisoff'))
      .send({ email: email('student'), password }).expect(503)
  } finally {
    await cache.connect()
  }
})
