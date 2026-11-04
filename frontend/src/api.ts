import { checkSession, useSession } from './auth'

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tokens = useSession.getState().tokens
  const send = (access?: string) => {
    const headers = new Headers(init.headers)
    if (access) headers.set('Authorization', `Bearer ${access}`)
    return fetch('/api/v1' + path, { ...init, headers })
  }
  let response = await send(tokens?.access_token)
  if (response.status === 401 && tokens) {
    await checkSession(tokens)
    const refreshed = useSession.getState().tokens
    if (refreshed && refreshed !== tokens) response = await send(refreshed.access_token)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message ?? 'Request failed')
  }
  return response.status === 204 ? undefined as T : response.json()
}

export const json = (body: object, headers: Record<string, string> = {}, method = 'POST') => ({
  method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
})

export type Course = { id: string; title: string; description?: string; category: string; difficulty: string; status: string; revision: string }
export type Page<T> = { items: T[]; total: number }
