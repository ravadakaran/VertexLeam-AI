import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import request from 'supertest'

assert.ok(['development', 'test'].includes(process.env.APP_ENV), 'Use a local development/test database')
const { app } = await import('../src/app.ts')
const { db } = await import('../src/db/index.ts')
const { cache } = await import('../src/cache.ts')
app.set('trust proxy', 'loopback')
const base = '/api/v1'
const run = randomUUID()
const address = run.replaceAll('-', '').match(/.{4}/g).join(':')
const agent = request(app)
const api = {
  get: path => agent.get(path).set('X-Forwarded-For', path.endsWith('/me') ? address.slice(0, -4) + '10' : address),
  post: path => agent.post(path).set('X-Forwarded-For', path.endsWith('/login') && loginGroup ? loginGroup : address),
  put: path => agent.put(path).set('X-Forwarded-For', address)
}
let loginGroup
const password = randomUUID()
const email = role => `${role}-${run}@vertexlearn.test`
const auth = (req, session) => req.set('Authorization', `Bearer ${session.access_token}`)
const signIn = async role => (await api.post(base + '/auth/login').send({ email: email(role), password }).expect(200)).body

before(async () => {
  await cache.connect()
  const hash = await argon2.hash(password)
  for (const role of ['admin', 'instructor', 'student']) {
    await db.query(`
      WITH account AS (INSERT INTO users(full_name, email, password_hash) VALUES ($1,$2,$3) RETURNING id)
      INSERT INTO user_roles(user_id, role_id)
      SELECT account.id, roles.id FROM account CROSS JOIN roles WHERE name = $1
    `, [role, email(role), hash])
  }
})

after(async () => {
  const match = `%-${run}@vertexlearn.test`
  await db.query('DELETE FROM enrollments WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
  await db.query('DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
  await db.query('DELETE FROM course_approvals WHERE reviewed_by IN (SELECT id FROM users WHERE email LIKE $1)', [match])
  await db.query('DELETE FROM courses WHERE instructor_id IN (SELECT id FROM users WHERE email LIKE $1)', [match])
  await db.query('DELETE FROM users WHERE email LIKE $1', [match])
  if (cache.isOpen) await cache.quit()
  await db.end()
})

test('T-001 dependencies ready and T-002 role seeds, vector extension and foreign key integrity', async () => {
  await api.get('/health/live').expect(200)
  await api.get('/health/ready').expect(200)
  const { rows } = await db.query('SELECT name FROM roles ORDER BY name')
  assert.deepEqual(rows.map(row => row.name), ['admin', 'instructor', 'student'])
  assert.equal((await db.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'")).rowCount, 1)
  await assert.rejects(db.query('INSERT INTO enrollments(user_id, course_id) VALUES ($1,$2)', [randomUUID(), randomUUID()]),
    { code: '23503' })
})

test('T-003 registration, replay, expiry, logout, forged roles and suspended users', async () => {
  const account = { email: email('new'), full_name: 'Synthetic learner', password }
  await api.post(base + '/auth/register').send({ ...account, role: 'admin' }).expect(400)
  await api.post(base + '/auth/register').send({ ...account, email: 'invalid' }).expect(400)
  const { body } = await api.post(base + '/auth/register').send(account).expect(201)
  assert.deepEqual(body.roles, ['student'])
  const initial = await signIn('new')
  const { body: rotated } = await api.post(base + '/auth/refresh').send({ refresh_token: initial.refresh_token }).expect(200)
  const parts = rotated.access_token.split('.')
  parts[1] = Buffer.from(JSON.stringify({ ...jwt.decode(rotated.access_token), roles: ['admin'] })).toString('base64url')
  await auth(api.get(base + '/auth/me'), { access_token: parts.join('.') }).expect(401)
  const { iat, exp, ...claims } = jwt.decode(rotated.access_token)
  const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 1 }, process.env.ACCESS_JWT_KEY)
  await auth(api.get(base + '/auth/me'), { access_token: expired }).expect(401)
  await auth(api.get(base + '/auth/me'), rotated).expect(200)
  await api.post(base + '/auth/refresh').send({ refresh_token: initial.refresh_token }).expect(401)
  await auth(api.get(base + '/auth/me'), rotated).expect(401)

  const next = await signIn('new')
  await api.post(base + '/auth/logout').send({ refresh_token: next.refresh_token }).expect(204)
  await auth(api.get(base + '/auth/me'), next).expect(401)
  await db.query('UPDATE users SET is_active = false WHERE email = $1', [account.email])
  await api.post(base + '/auth/login').send({ email: account.email, password }).expect(401)
  await api.post(base + '/auth/login').send({ email: account.email, password }).expect(401)
  const capped = await api.post(base + '/auth/login').send({ email: account.email, password }).expect(429)
  assert.ok(Number(capped.headers['retry-after']) > 0)
})

test('T-004 approval is authorized and idempotent, catalog composes filters, concurrent enrollment converges', async () => {
  loginGroup = '::' + address.split(':').at(-1)
  const [instructor, admin, student] = await Promise.all(['instructor', 'admin', 'student'].map(signIn))
  const course = { title: `Arrays ${run}`, category: run, difficulty: 'beginner', price: 0, pricing_tier: 'free' }
  const create = async overrides => (await auth(api.post(base + '/courses'), instructor)
    .send({ ...course, ...overrides }).expect(201)).body
  const selected = await create({})
  const low = await create({})
  const advanced = await create({ difficulty: 'advanced' })
  const differentCategory = await create({ category: 'Other' })
  const differentTitle = await create({ title: 'Linked lists' })
  const pending = await create({})
  const rejected = await create({})
  const coursePath = id => base + '/courses/' + id
  const enroll = (id, session = student) => auth(api.post(coursePath(id) + '/enroll'), session)
  const approve = (row, session = admin, decision = 'approved') => auth(api.post(coursePath(row.id) + '/approve'), session)
    .set('If-Match', row.revision).set('Idempotency-Key', row.id).send({ decision })

  await api.get(coursePath(selected.id)).expect(404)
  await enroll(selected.id).expect(404)
  await approve(selected, instructor).expect(403)
  await auth(api.put(coursePath(selected.id)), student).send({ title: 'Other' }).expect(403)
  for (const row of [selected, low, advanced, differentCategory, differentTitle, pending, rejected]) {
    await db.query('UPDATE courses SET rating = $1 WHERE id = $2', [row === low ? 2 : 4.7, row.id])
  }
  for (const row of [selected, low, advanced, differentCategory, differentTitle]) await approve(row).expect(200)
  await approve(rejected, admin, 'rejected').expect(200)
  const replay = await approve(selected).expect(200)
  assert.equal(replay.body.status, 'approved')
  assert.equal((await db.query('SELECT 1 FROM course_approvals WHERE course_id = $1', [selected.id])).rowCount, 1)
  assert.equal((await db.query('SELECT 1 FROM audit_logs WHERE entity_id = $1', [selected.id])).rowCount, 1)
  await approve(selected, admin, 'rejected').expect(409)
  await api.get(coursePath(pending.id)).expect(404)
  await api.get(coursePath(rejected.id)).expect(404)
  await api.get(coursePath(selected.id)).expect(200)
  const filtered = await api.get(base + '/courses').query({
    category: run, difficulty: 'beginner', rating_min: 4, q: 'arrays'
  }).expect(200)
  assert.deepEqual(filtered.body.items.map(item => item.id), [selected.id])

  await enroll(selected.id, instructor).expect(403)
  const attempts = await Promise.all(Array.from({ length: 6 }, () => enroll(selected.id).expect(200)))
  assert.equal(new Set(attempts.map(response => response.body.id)).size, 1)
  const listed = await auth(api.get(base + '/enrollments/me'), student).expect(200)
  assert.deepEqual(listed.body.items.map(row => row.id), [attempts[0].body.id])
})

