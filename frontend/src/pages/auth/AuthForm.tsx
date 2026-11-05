import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { post, signIn, useSession } from '../../auth'

export function AuthForm({ registering = false }: { registering?: boolean }) {
  const tokens = useSession(state => state.tokens)
  const setTokens = useSession(state => state.setTokens)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [emailValue, setEmailValue] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
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

  function fillDemo(roleEmail: string) {
    setEmailValue(roleEmail)
    // Keep password input ready for demo credentials
  }

  return (
    <div className="auth-wrapper flex min-h-screen items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-md">
        {/* Top Logo & Brand Presentation */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-md shadow-indigo-500/25 mb-3">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="font-extrabold text-2xl tracking-tight text-slate-900">VertexLearn</span>
            <span className="text-xs font-bold tracking-wider px-2 py-0.5 rounded-md bg-indigo-600 text-white uppercase shadow-xs">
              AI
            </span>
          </div>
          <p className="text-xs font-medium text-slate-500 mt-1">Autonomous Learning Management & Tutor System</p>
        </div>

        {/* Main Card */}
        <main className="auth-card bg-white border border-slate-200/80 rounded-2xl shadow-xl shadow-slate-200/50 p-8">
          <p className="eyebrow">VertexLearn AI</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1 mb-2">
            {registering ? 'Create your student account' : 'Sign in'}
          </h1>
          <p className="text-sm text-slate-500 mb-6">
            {registering ? 'Start learning in the student workspace.' : 'Open your learning or teaching workspace.'}
          </p>

          {/* Quick Demo Accounts Helper */}
          {!registering && (
            <div className="mb-5 p-3 rounded-lg bg-indigo-50/60 border border-indigo-100/80 text-xs">
              <div className="font-semibold text-indigo-900 mb-1.5 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                Demo Fill Shortcuts:
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="secondary text-[11px] py-1 px-2 font-medium bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => fillDemo('student@vertexlearn.test')}
                >
                  Student
                </button>
                <button
                  type="button"
                  className="secondary text-[11px] py-1 px-2 font-medium bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => fillDemo('instructor@vertexlearn.test')}
                >
                  Instructor
                </button>
                <button
                  type="button"
                  className="secondary text-[11px] py-1 px-2 font-medium bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => fillDemo('admin@vertexlearn.test')}
                >
                  Admin
                </button>
              </div>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {registering && (
              <label className="text-sm font-medium text-slate-700">
                Full name
                <input
                  name="full_name"
                  autoComplete="name"
                  maxLength={150}
                  required
                  placeholder="e.g. Marie Curie"
                  className="mt-1"
                />
              </label>
            )}

            <label className="text-sm font-medium text-slate-700">
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={180}
                required
                value={emailValue}
                onChange={e => setEmailValue(e.target.value)}
                placeholder="name@vertexlearn.test"
                className="mt-1"
              />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Password
              <input
                name="password"
                type="password"
                autoComplete={registering ? 'new-password' : 'current-password'}
                minLength={registering ? 12 : undefined}
                maxLength={128}
                required
                value={passwordValue}
                onChange={e => setPasswordValue(e.target.value)}
                placeholder="••••••••••••"
                className="mt-1"
              />
            </label>

            {registering && (
              <small className="text-xs text-slate-500 block">Use at least 12 characters.</small>
            )}

            {error && (
              <p role="alert" className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                {error}
              </p>
            )}

            <button
              disabled={busy}
              className="w-full py-2.5 px-4 font-semibold text-sm rounded-lg shadow-sm bg-indigo-600 hover:bg-indigo-700 text-white mt-2"
            >
              {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
            <Link to={registering ? '/login' : '/register'} className="font-semibold text-indigo-600 hover:text-indigo-800">
              {registering ? 'Back to sign in' : 'Create a student account'}
            </Link>
          </div>
        </main>
      </div>
    </div>
  )
}
