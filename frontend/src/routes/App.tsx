import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { checkSession, useSession, type Role, type Tokens } from '../auth'
import { Workspace, workspaces } from '../layouts/Workspace'
import { AuthForm } from '../pages/auth/AuthForm'
import { Catalog, InstructorCourses, Learning } from '../pages/Learning'
import { CourseWorkspace } from '../pages/CourseWorkspace'

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
  if (result?.tokens !== tokens || result.role !== role) return <main className="auth-card" role="status">Checking your session…</main>
  if (result.failed) return <main className="auth-card">
    <p role="alert">Could not check your session.</p>
    <button onClick={() => { setResult(undefined); setAttempt(value => value + 1) }}>Retry</button>
  </main>
  if (!result.allowed) return <Navigate to="/forbidden" replace />
  return <Workspace role={role} />
}

function Home() {
  const role = useSession(state => state.tokens?.user.role)
  return <Navigate to={role ? `/${role}` : '/login'} replace />
}

export function App() {
  const roles = Object.keys(workspaces) as Role[]
  return <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<AuthForm key="login" />} />
      <Route path="/register" element={<AuthForm key="register" registering />} />
      <Route path="/forbidden" element={<main className="auth-card">
        <h1>Access denied</h1><p>Your account cannot open this workspace.</p><Link to="/">Return home</Link>
      </main>} />
      {roles.map(role => <Route key={role} path={role} element={<Guard role={role} />}>
        <Route index element={role === 'student' ? <Learning overview /> : <><p className="eyebrow">Overview</p><h1>{workspaces[role].title} workspace</h1>
          <p>Use the navigation to explore your workspace.</p></>} />
        {Object.entries(workspaces[role].sections).map(([path, label]) =>
          <Route key={path} path={path} element={path === 'catalog' ? <Catalog /> : path === 'learning' ? <Learning /> :
            role === 'instructor' && path === 'courses' ? <InstructorCourses /> :
            <><h1>{label}</h1><p>This section is planned for a later task.</p></>} />)}
        {role === 'student' && <Route path="learning/:courseId" element={<CourseWorkspace />} />}
        {role === 'instructor' && <Route path="courses/:courseId" element={<CourseWorkspace author />} />}
      </Route>)}
      <Route path="*" element={<main className="auth-card"><h1>Page not found</h1><Link to="/">Return home</Link></main>} />
    </Routes>
  </BrowserRouter>
}

