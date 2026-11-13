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
  const loading = !state || state.path !== path || (!state.data && !state.error)
  return { ...(state?.path === path ? state : {}), loading, refresh: () => setVersion(value => value + 1) }
}

export function SkeletonLoader({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-slate-200 dark:bg-slate-700/60 rounded ${className}`}
    />
  )
}

export function CardSkeleton() {
  return (
    <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xs space-y-3">
      <SkeletonLoader className="h-4 w-1/3" />
      <SkeletonLoader className="h-6 w-2/3" />
      <SkeletonLoader className="h-3 w-1/2" />
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading content" className="space-y-6 p-2">
      <h1 className="sr-only">Loading</h1>
      <div className="space-y-2 pb-4 border-b border-slate-200 dark:border-slate-700">
        <SkeletonLoader className="h-8 w-64 rounded-lg" />
        <SkeletonLoader className="h-4 w-96 rounded" />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4">
        <SkeletonLoader className="h-5 w-48" />
        <SkeletonLoader className="h-20 w-full rounded-lg" />
        <SkeletonLoader className="h-10 w-32 rounded-lg" />
      </div>
    </div>
  )
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
