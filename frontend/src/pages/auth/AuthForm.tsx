import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { post, signIn, useSession } from '../../auth'

export function AuthForm({ registering = false }: { registering?: boolean }) {
  const tokens = useSession(state => state.tokens)
  const setTokens = useSession(state => state.setTokens)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  if (tokens) return <Navigate to={`/${tokens.user.role}`} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    setBusy(true)
    setError('')
    try {
      if (registering) {
        await post('register', { full_name: form.get('full_name'), email, password })
        navigate('/login', { replace: true, state: { registered: true } })
      } else {
        const result = await signIn(email, password)
        setTokens(result)
        navigate(`/${result.user.role}`, { replace: true })
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-card">
    <p className="eyebrow">VertexLearn AI</p>
    <h1>{registering ? 'Create your student account' : 'Sign in'}</h1>
    <p>{registering ? 'Start learning in the student workspace.' : 'Open your learning or teaching workspace.'}</p>
    <form onSubmit={submit}>
      {registering && <label>Full name<input name="full_name" autoComplete="name" maxLength={150} required /></label>}
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={180} required /></label>
      <label>Password<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'}
        minLength={registering ? 12 : undefined} maxLength={128} required /></label>
      {registering && <small>Use at least 12 characters.</small>}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}</button>
    </form>
    <Link to={registering ? '/login' : '/register'}>{registering ? 'Back to sign in' : 'Create a student account'}</Link>
  </main>
}

