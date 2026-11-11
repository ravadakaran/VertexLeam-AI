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
  const [error, setError] = useState('')
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    setBusy(true); setMessage(''); setError('')
    try { await onSubmit(new FormData(form)); form.reset(); setMessage('Saved.') }
    catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  return <form className="feature-form space-y-3" onSubmit={handle}>{children}
    <div>
      <button disabled={busy} className="text-xs font-semibold py-2 px-4 shadow-sm">{busy ? 'Working…' : label}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status" className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-700 inline-block">{message}</p>}
  </form>
}
