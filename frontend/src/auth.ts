import { create } from 'zustand'

export type Role = 'student' | 'instructor' | 'admin'
export type Profile = { id: string; full_name: string; role: Role; roles: Role[] }
export type Tokens = { access_token: string; refresh_token: string; user: Profile }

type Session = {
  tokens: Tokens | null
  setTokens: (tokens: Tokens | null) => void
}

export const useSession = create<Session>(set => ({
  tokens: null,
  setTokens: tokens => set({ tokens })
}))

class AuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function post<T>(path: string, data: object): Promise<T> {
  const response = await fetch(`/api/v1/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new AuthError(body?.error?.message ?? 'The service is unavailable. Try again.', response.status)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export function signIn(email: string, password: string) {
  return post<Tokens>('login', { email, password })
}

const pending = new WeakMap<Tokens, Promise<Profile>>()

export function checkSession(tokens: Tokens) {
  const existing = pending.get(tokens)
  if (existing) return existing
  const check = (async () => {
    const response = await fetch('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    if (response.ok) return response.json() as Promise<Profile>
    if (response.status !== 401) throw new Error('Could not check your session. Try again.')

    try {
      const renewed = await post<Tokens>('refresh', { refresh_token: tokens.refresh_token })
      if (useSession.getState().tokens === tokens) useSession.getState().setTokens(renewed)
      return renewed.user
    } catch (error) {
      if (error instanceof AuthError && error.status === 401 && useSession.getState().tokens === tokens) {
        useSession.getState().setTokens(null)
      }
      throw error
    }
  })().finally(() => pending.delete(tokens))
  pending.set(tokens, check)
  return check
}

export async function signOut() {
  const { tokens, setTokens } = useSession.getState()
  if (!tokens) return
  try {
    await post('logout', { refresh_token: tokens.refresh_token })
  } catch (error) {
    if (!(error instanceof AuthError && error.status === 401)) throw error
  }
  if (useSession.getState().tokens === tokens) setTokens(null)
}

