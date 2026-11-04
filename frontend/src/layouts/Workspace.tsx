import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { signOut, useSession, type Role } from '../auth'

export const workspaces = {
  student: { title: 'Student', sections: { catalog: 'Course catalog', learning: 'My learning' } },
  instructor: { title: 'Instructor', sections: { courses: 'My courses' } },
  admin: { title: 'Admin', sections: { approvals: 'Course approvals', users: 'Users' } }
} as const

export function Workspace({ role }: { role: Role }) {
  const user = useSession(state => state.tokens?.user)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const workspace = workspaces[role]

  async function logout() {
    setBusy(true)
    setError('')
    try {
      await signOut()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Try signing out again.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <header>
      <Link className="brand" to={`/${role}`}>VertexLearn AI</Link>
      <span>{user?.full_name}</span>
      <button className="secondary" disabled={busy} onClick={logout}>Sign out</button>
    </header>
    {error && <p role="alert" className="notice">{error}</p>}
    <div className="workspace">
      <nav aria-label={`${workspace.title} navigation`}>
        <NavLink to={`/${role}`} end>Overview</NavLink>
        {Object.entries(workspace.sections).map(([path, label]) =>
          <NavLink key={path} to={`/${role}/${path}`}>{label}</NavLink>)}
        {user?.roles.filter(other => other !== role).map(other =>
          <NavLink key={other} to={`/${other}`}>{workspaces[other].title} workspace</NavLink>)}
      </nav>
      <main><Outlet /></main>
    </div>
  </>
}

