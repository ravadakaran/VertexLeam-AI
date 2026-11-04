import type { Request, Response, NextFunction } from 'express'
import type { Role } from '../types.ts'
import { verify, sessionUser } from '../modules/auth/service.ts'
import { forbidden, unauthorized } from '../http.ts'
import { limit } from '../cache.ts'

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const match = /^Bearer (\S+)$/i.exec(req.get('Authorization') ?? '')
  if (!match) throw unauthorized()
  const claims = verify('access', match[1])
  req.user = await sessionUser(claims)
  req.sessionId = claims.sid
  next()
}

export const requireRole = (...roles: Role[]) => async (req: Request, res: Response, next: NextFunction) => {
  await limit(res, 'user', req.user!.id, 100)
  if (!roles.some(role => req.user!.roles.includes(role))) throw forbidden()
  next()
}

