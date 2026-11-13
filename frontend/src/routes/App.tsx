import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { checkSession, useSession, type Role, type Tokens } from '../auth'
import { Workspace, workspaces } from '../layouts/Workspace'
import { AuthForm } from '../pages/auth/AuthForm'
import { Catalog, InstructorCourses, Learning } from '../pages/Learning'
import { PageSkeleton } from '../pages/feature-ui'

const CourseWorkspace = lazy(() => import('../pages/CourseWorkspace').then(m => ({ default: m.CourseWorkspace })))
const AdminPanel = lazy(() => import('../pages/AdminPanel').then(m => ({ default: m.AdminPanel })))
const VerifyCertificate = lazy(() => import('../pages/VerifyCertificate').then(m => ({ default: m.VerifyCertificate })))

function Guard({ role }: { role: Role }) {
  const tokens = useSession(state => state.tokens)
  const [result, setResult] = useState<{ tokens: Tokens; role: Role; allowed?: boolean; failed?: boolean }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!tokens?.user.roles.includes(role)) return
    let cancelled = false
    checkSession(tokens).then(
      profile => { if (!cancelled) setResult({ tokens, role, allowed: profile.roles.includes(role) }) },
      () => { if (!cancelled) setResult({ tokens, role, failed: true }) }
    )
    return () => { cancelled = true }
  }, [tokens, role, attempt])

  if (!tokens) return <Navigate to="/login" replace />
  if (!tokens.user.roles.includes(role)) return <Navigate to="/forbidden" replace />
  if (result?.tokens !== tokens || result.role !== role) {
    return (
      <div className="auth-wrapper">
        <main className="auth-card text-center" role="status">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Checking your session…</p>
        </main>
      </div>
    )
  }
  if (result.failed) {
    return (
      <div className="auth-wrapper">
        <main className="auth-card">
          <p role="alert">Could not check your session.</p>
          <button onClick={() => { setResult(undefined); setAttempt(value => value + 1) }}>Retry</button>
        </main>
      </div>
    )
  }
  if (!result.allowed) return <Navigate to="/forbidden" replace />
  return <Workspace role={role} />
}

function Home() {
  const role = useSession(state => state.tokens?.user.role)
  return <Navigate to={role ? `/${role}` : '/login'} replace />
}

export function App() {
  const roles = Object.keys(workspaces) as Role[]
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<AuthForm key="login" />} />
        <Route path="/register" element={<AuthForm key="register" registering />} />
        <Route
          path="/verify/:certificateId"
          element={
            <Suspense fallback={<div className="p-6 max-w-2xl mx-auto"><PageSkeleton /></div>}>
              <VerifyCertificate />
            </Suspense>
          }
        />
          <Route
            path="/forbidden"
            element={
              <div className="auth-wrapper">
                <main className="auth-card text-center">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-200 flex items-center justify-center font-bold text-xl mb-3">
                    ✕
                  </div>
                  <h1>Access denied</h1>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">Your account cannot open this workspace.</p>
                  <Link to="/" className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg no-underline hover:text-white">
                    Return home
                  </Link>
                </main>
              </div>
            }
          />
          {roles.map(role => (
            <Route key={role} path={role} element={<Guard role={role} />}>
              <Route
                index
                element={
                  role === 'student' ? (
                    <Learning overview />
                  ) : (
                    <div className="space-y-4">
                      <div className="page-heading">
                        <p className="eyebrow">{role === 'instructor' ? 'Teach with confidence' : 'Platform governance'}</p>
                        <h1>{workspaces[role].title} workspace</h1>
                        <p>{role === 'instructor' ? 'Build and manage courses, then help learners make progress.' : 'Review activity and keep the learning experience running smoothly.'}</p>
                      </div>
                      <div className="dashboard-grid mt-6">
                        {Object.entries(workspaces[role].sections).map(([path, label]) => (
                          <div key={path} className="dashboard-card">
                            <p className="eyebrow">{role === 'admin' ? 'Platform tools' : 'Teaching'}</p>
                            <h2>{label}</h2>
                            <p className="text-sm">{role === 'admin' ? `Review and manage ${label.toLowerCase()} in one place.` : 'Create courses, organize lessons, and follow learner activity.'}</p>
                            <Link to={`/${role}/${path}`} className="text-sm">
                              Manage section <span aria-hidden="true">→</span>
                            </Link>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }
              />
              {Object.entries(workspaces[role].sections).map(([path, label]) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    path === 'catalog' ? (
                      <Catalog />
                    ) : path === 'learning' ? (
                      <Learning />
                    ) : role === 'admin' ? (
                      <AdminPanel section={path} />
                    ) : role === 'instructor' && path === 'courses' ? (
                      <InstructorCourses />
                    ) : (
                      <div className="space-y-4">
                        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">{label}</h1>
                        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xs">
                          <p className="text-sm text-slate-700 dark:text-slate-200 m-0">This section is planned for a later task.</p>
                        </div>
                      </div>
                    )
                  }
                />
              ))}
              {role === 'student' && <Route path="learning/:courseId" element={<CourseWorkspace />} />}
              {role === 'instructor' && <Route path="courses/:courseId" element={<CourseWorkspace author />} />}
            </Route>
          ))}
          <Route
            path="*"
            element={
              <div className="auth-wrapper">
                <main className="auth-card text-center">
                  <h1>Page not found</h1>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">The page you are looking for does not exist.</p>
                  <Link to="/" className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg no-underline hover:text-white">
                    Return home
                  </Link>
                </main>
              </div>
            }
          />
        </Routes>
    </BrowserRouter>
  )
}
