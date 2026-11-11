import type { RequestHandler } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { limit } from '../../cache.ts'
import { parse, sendResource } from '../../http.ts'
import { authenticate, userRateLimit } from '../../middleware/auth.ts'
import { register, login, refresh, logout, verify } from './service.ts'

const email = z.string().trim().toLowerCase().max(180).pipe(z.email())
const credentials = z.strictObject({ email, password: z.string().min(1).max(128) })
const registration = credentials.extend({
  full_name: z.string().trim().min(1).max(150),
  password: z.string().min(12).max(128)
})
const refreshBody = z.strictObject({ refresh_token: z.string().min(1).max(12000) })

const authIp: RequestHandler = async (req, res, next) => {
  await limit(res, 'auth-ip', req.ip ?? req.socket.remoteAddress ?? 'unknown', 10)
  next()
}

export const auth = Router()
auth.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})
auth.post('/register', authIp, async (req, res) => {
  const body = parse(registration, req.body)
  await limit(res, 'auth-account', body.email, 10)
  sendResource(res, await register(body), 201)
})
auth.post('/login', authIp, async (req, res) => {
  const body = parse(credentials, req.body)
  await limit(res, 'auth-account', body.email, 10)
  res.json(await login(body))
})
auth.post('/refresh', authIp, async (req, res) => {
  const { refresh_token } = parse(refreshBody, req.body)
  const claims = verify('refresh', refresh_token)
  await limit(res, 'auth-session', claims.sid, 10)
  res.json(await refresh(refresh_token, claims))
})
auth.post('/logout', authIp, async (req, res) => {
  const { refresh_token } = parse(refreshBody, req.body)
  const claims = verify('refresh', refresh_token)
  await limit(res, 'auth-session', claims.sid, 10)
  await logout(claims)
  res.sendStatus(204)
})
auth.get('/me', authenticate, userRateLimit, (req, res) => sendResource(res, req.user!))

