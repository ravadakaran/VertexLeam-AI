import type { Pool, PoolClient } from 'pg'
import type { Profile } from '../../types.ts'

type TokenType = 'access' | 'refresh'
type Claims = { sub: string; sid: string; jti: string; type: TokenType }
type Credentials = { email: string; password: string }
type Registration = Credentials & { full_name: string }
type UserRow = Omit<Profile, 'role' | 'revision'> & { revision: number; password_hash: string }
import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { createHash, randomUUID } from 'node:crypto'
import { db, transaction } from '../../db/index.ts'
import { HttpError, unauthorized, uuid } from '../../http.ts'

const issuer = 'vertexlearn'
const keys = { access: process.env.ACCESS_JWT_KEY ?? '', refresh: process.env.REFRESH_JWT_KEY ?? '' }
if (Object.values(keys).some(key => !key || Buffer.byteLength(key) < 32) || keys.access === keys.refresh) {
  throw new Error('Set distinct ACCESS_JWT_KEY and REFRESH_JWT_KEY values of at least 32 bytes')
}
const refreshLifetime = 14 * 24 * 60 * 60
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const dummyPassword = await argon2.hash(randomUUID())

function sign(type: TokenType, userId: string, sessionId: string, expiresIn: number) {
  return jwt.sign({ sid: sessionId, type }, keys[type], {
    algorithm: 'HS256', issuer, audience: `vertexlearn-${type}`,
    subject: userId, jwtid: randomUUID(), expiresIn
  })
}

export function verify(type: TokenType, token: string): Claims {
  try {
    const claims = jwt.verify(token, keys[type], {
      algorithms: ['HS256'], issuer, audience: `vertexlearn-${type}`
    })
    if (typeof claims !== 'string' && claims.type === type && Number.isFinite(claims.exp) &&
        [claims.sub, claims.sid, claims.jti].every(value => uuid.safeParse(value).success)) return claims as Claims
  } catch {
    // A malformed, expired or incorrectly signed token is an invalid session.
  }
  throw unauthorized()
}

function profile(user: UserRow): Profile {
  const { id, full_name, email, roles, is_active, revision } = user
  return { id, full_name, email, roles, is_active, revision: `"${revision}"`, role: roles[0] }
}

async function readUser(client: Pool | PoolClient, key: 'id' | 'email', value: string, lock = false) {
  const { rows: [user] } = await client.query<UserRow>(`
    SELECT u.*, ARRAY(
      SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id
      ORDER BY CASE r.name WHEN 'admin' THEN 1 WHEN 'instructor' THEN 2 ELSE 3 END
    ) AS roles FROM users u WHERE u.${key} = $1 ${lock ? 'FOR UPDATE' : ''}
  `, [value])
  return user
}

export async function register({ full_name, email, password }: Registration) {
  const passwordHash = await argon2.hash(password)
  return transaction(async client => {
    const { rows: [user] } = await client.query<Omit<UserRow, 'roles'>>(`
      INSERT INTO users(full_name, email, password_hash) VALUES ($1, $2, $3)
      ON CONFLICT (email) DO NOTHING RETURNING *
    `, [full_name, email, passwordHash])
    if (!user) throw new HttpError(409, 'CONFLICT', 'Account already exists')
    await client.query(`
      INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = 'student'
    `, [user.id])
    return profile({ ...user, roles: ['student'] })
  })
}

function tokens(user: UserRow, sid: string, refreshToken: string) {
  return { access_token: sign('access', user.id, sid, 600), refresh_token: refreshToken, user: profile(user) }
}

export async function login({ email, password }: Credentials) {
  const candidate = await readUser(db, 'email', email)
  if (!await argon2.verify(candidate?.password_hash ?? dummyPassword, password) ||
      !candidate?.is_active) throw unauthorized()
  return transaction(async client => {
    const user = await readUser(client, 'id', candidate.id, true)
    if (!user?.is_active || !user.roles.length || user.password_hash !== candidate.password_hash) throw unauthorized()
    const sid = randomUUID()
    const refreshToken = sign('refresh', user.id, sid, refreshLifetime)
    await client.query(`
      INSERT INTO sessions(id, user_id, user_revision, refresh_hash, expires_at)
      VALUES ($1, $2, $3, $4, now() + interval '14 days')
    `, [sid, user.id, user.revision, hash(refreshToken)])
    return tokens(user, sid, refreshToken)
  })
}

export async function sessionUser(claims: Pick<Claims, 'sub' | 'sid'>) {
  const user = await readUser(db, 'id', claims.sub)
  if (!user?.is_active || !user.roles.length) throw unauthorized()
  const { rowCount } = await db.query(`
    SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = $1 AND s.user_id = $2 AND s.user_revision = u.revision
      AND u.revision = $3 AND u.is_active AND s.expires_at > now() AND s.revoked_at IS NULL
  `, [claims.sid, user.id, user.revision])
  if (!rowCount) throw unauthorized()
  return profile(user)
}

export async function refresh(token: string, claims: Claims) {
  const result = await transaction(async client => {
    const user = await readUser(client, 'id', claims.sub, true)
    const { rows: [session] } = await client.query(`
      SELECT * FROM sessions WHERE id = $1 AND user_id = $2
      AND expires_at > now() AND revoked_at IS NULL FOR UPDATE
    `, [claims.sid, claims.sub])
    if (!session || !user?.is_active || !user.roles.length || session.user_revision !== user.revision) return null
    if (session.refresh_hash !== hash(token)) {
      await client.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [claims.sid])
      return null
    }
    const remaining = Math.floor(session.expires_at.getTime() / 1000 - Date.now() / 1000)
    if (remaining <= 0) return null
    const successor = sign('refresh', user.id, claims.sid, remaining)
    await client.query('UPDATE sessions SET refresh_hash = $1 WHERE id = $2', [hash(successor), claims.sid])
    return tokens(user, claims.sid, successor)
  })
  if (!result) throw unauthorized()
  return result
}

export async function logout(claims: Claims) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [claims.sid, claims.sub])
}

