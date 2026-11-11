import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { signOut, useSession, type Role } from '../auth'
import { NotificationsPanel } from '../components/NotificationsPanel'
import { useT, type TranslationKey } from '../utils/i18n'
import { useTheme } from '../utils/theme'

export const workspaces = {
  student: { title: 'Student', sections: { catalog: 'Course catalog', learning: 'My learning' } },
  instructor: { title: 'Instructor', sections: { courses: 'My courses' } },
  admin: { title: 'Admin', sections: { approvals: 'Course approvals', users: 'Users', metrics: 'Platform metrics', moderation: 'Moderation queue' } }
} as const

function RoleBadge({ role }: { role: Role }) {
  const styles = {
    student: 'bg-indigo-50 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200 border-indigo-200 dark:border-indigo-700',
    instructor: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-700',
    admin: 'bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700'
  }[role]

  return (
    <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${styles} capitalize`}>
      {role}
    </span>
  )
}

function NavIcon({ name }: { name: string }) {
  if (name.includes('catalog')) {
    return (
      <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    )
  }
  if (name.includes('learning')) {
    return (
      <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    )
  }
  if (name.includes('courses')) {
    return (
      <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    )
  }
  if (name.includes('approvals')) {
    return (
      <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  )
}

export function Workspace({ role }: { role: Role }) {
  const user = useSession(state => state.tokens?.user)
  const theme = useTheme(state => state.theme)
  const toggleTheme = useTheme(state => state.toggleTheme)
  const t = useT()
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

  const userInitial = user?.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'

  return (
    <div className="app-shell min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <a className="skip-link" href="#main-content">{t('app.skipToMain')}</a>
      <header className="workspace-header border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md sticky top-0 z-40 shadow-xs">
        <Link className="brand inline-flex items-center gap-2.5 text-slate-900 dark:text-slate-100 font-extrabold text-lg tracking-tight no-underline hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors" to={`/${role}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-700 to-violet-600 flex items-center justify-center text-white shadow-sm shadow-indigo-500/20">
            <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </div>
          <span className="flex items-center gap-1.5">
            VertexLearn
            <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-indigo-700 text-white uppercase shadow-xs">
              AI
            </span>
          </span>
        </Link>

        <div className="workspace-header__tools">
          <NotificationsPanel />

          <button
            type="button"
            className="secondary workspace-header__theme"
            aria-label={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
            aria-pressed={theme === 'dark'}
            onClick={toggleTheme}
          >
            <svg className="theme-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {theme === 'dark'
                ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>
                : <path d="M20.8 13.2A8.5 8.5 0 0 1 10.8 3.1 8.5 8.5 0 1 0 20.8 13.2Z" />}
            </svg>
            <span className="theme-label">{theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}</span>
          </button>

          <RoleBadge role={role} />

          <div className="workspace-header__profile">
            <div className="workspace-header__avatar" role="img" aria-label={user?.full_name ? `Signed in as ${user.full_name}` : 'Signed in'}>
              {userInitial}
            </div>
            <span className="workspace-header__name">{user?.full_name}</span>
          </div>

          <button className="secondary workspace-header__signout" disabled={busy} onClick={logout}>
            {t('auth.signOut')}
          </button>
        </div>
      </header>

      {error && <p role="alert" className="notice mx-6 mt-4">{error}</p>}

      <div className="workspace flex-1">
        <nav aria-label={`${workspace.title} navigation`} className="flex flex-col gap-1 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider px-3 mb-1">
            {t('nav.menu')}
          </div>
          <NavLink to={`/${role}`} end className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <NavIcon name="overview" />
            {t('nav.overview')}
          </NavLink>
          {Object.entries(workspace.sections).map(([path]) => (
            <NavLink key={path} to={`/${role}/${path}`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <NavIcon name={path} />
              {t(('section.' + path) as TranslationKey)}
            </NavLink>
          ))}

          {user?.roles && user.roles.filter(other => other !== role).length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-1">
              <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider px-3 mb-1">
                {t('nav.otherRoles')}
              </div>
              {user.roles.filter(other => other !== role).map(other => (
                <NavLink key={other} to={`/${other}`} className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50/70 dark:hover:bg-slate-800 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 dark:bg-slate-400"></span>
                  {t(('role.' + other) as TranslationKey)} {t('nav.workspaceSuffix')}
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <main id="main-content" tabIndex={-1} className="p-8 max-w-5xl">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
