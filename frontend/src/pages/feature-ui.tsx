import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'

export const requestKey = () => ({ 'Idempotency-Key': crypto.randomUUID() })
export const localUrl = (value: string) => {
  const url = new URL(value, window.location.origin)
  if (!url.pathname.startsWith('/api/v1/private/')) throw new Error('Invalid file link')
  return url.pathname + url.search
}

export function useData<T>(path: string) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>()
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api<T>(path, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setState({ path, data }) },
      error => { if (!controller.signal.aborted) setState({ path, error: String(error) }) }
    )
    return () => controller.abort()
  }, [path, version])
  return { ...(state?.path === path ? state : {}), refresh: () => setVersion(value => value + 1) }
}

export function ActionForm({ children, label, onSubmit }: {
  children: React.ReactNode; label: string; onSubmit: (data: FormData) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    setBusy(true); setMessage('')
    try { await onSubmit(new FormData(form)); form.reset(); setMessage('Saved.') }
    catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  return <form className="feature-form" onSubmit={handle}>{children}
    <button disabled={busy}>{busy ? 'Working…' : label}</button>
    {message && <p role="status">{message}</p>}
  </form>
}

