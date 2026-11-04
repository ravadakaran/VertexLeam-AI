import jwt from 'jsonwebtoken'
import { z } from 'zod'
import type { Request } from 'express'
import { sessionUser } from '../auth/service.ts'
import { unauthorized, uuid } from '../../http.ts'

const key = process.env.ACCESS_JWT_KEY ?? ''
const audience = 'vertexlearn-download'
const claims = z.object({ sub: uuid, sid: uuid, scope: z.string() })

export function grant(req: Request, scope: string, path: string, absolute = true) {
  const token = jwt.sign({ scope, sid: req.sessionId }, key, {
    algorithm: 'HS256', audience, subject: req.user!.id, expiresIn: 300
  })
  const origin = process.env.PUBLIC_APP_ORIGIN ?? 'http://127.0.0.1:5173'
  return { url: (absolute ? origin : '') + path + '?grant=' + token, expires_at: new Date(Date.now() + 300000).toISOString() }
}

export async function grantUser(token: unknown, scope: string) {
  let payload
  try {
    if (typeof token !== 'string') throw unauthorized()
    payload = claims.parse(jwt.verify(token, key, { algorithms: ['HS256'], audience }))
    if (payload.scope !== scope) throw unauthorized()
  } catch { throw unauthorized() }
  return sessionUser(payload)
}
