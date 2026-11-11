import { useState } from 'react'
import { api, json, type Page } from '../api'
import { useSession } from '../auth'
import { requestKey, useData } from './feature-ui'

type User = {
  id: string
  full_name: string
  email: string
  is_active: boolean
  deleted_at: string | null
  roles: string[]
}

type Pending = {
  id: string
  title: string
  instructor_name: string
  category: string
  revision: string
}

type Report = {
  id: string
  entity_type: string
  entity_id: string
  reason: string
}

type FlaggedPost = {
  id: string
  thread_id: string
  content: string
  visibility: string
  created_at: string
  revision: string
}

type MetricsData = {
  dau: number
  enrollments: number
  completion_rate: number | null
  revenue: {
    currency: string
    amount: number | null
    provenance: string
  }
}

function UsersSection() {
  const actorId = useSession(state => state.tokens?.user.id)
  const users = useData<{ items: User[]; deletion_enabled: boolean }>('/admin/users')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function act(work: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await work()
      users.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">User governance</h1>
        <p className="text-slate-600 dark:text-slate-300 text-sm">Manage user identities, role assignments, suspension, and account privacy.</p>
      </div>

      {error && <p role="alert">{error}</p>}
      {users.error && <p role="alert">{users.error}</p>}

      <div className="space-y-3">
        {users.data?.items.map(user => (
          <article key={user.id} className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xs space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <strong className="text-base text-slate-900 dark:text-slate-100 font-bold">{user.full_name}</strong>
                <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  {user.email} ·{' '}
                  <span className={user.deleted_at ? 'text-rose-700 dark:text-rose-300 font-semibold' : user.is_active ? 'text-emerald-700 dark:text-emerald-300 font-semibold' : 'text-amber-800 dark:text-amber-300 font-semibold'}>
                    {user.deleted_at ? 'Deleted' : user.is_active ? 'Active' : 'Suspended'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              {user.deleted_at ? (
                <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">Deleted and anonymized</span>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Roles:</span>
                    {(['student', 'instructor', 'admin'] as const).map(role => {
                      const checked = user.roles.includes(role)
                      const locked = busy || (checked && (user.roles.length <= 1 || (actorId === user.id && role === 'admin')))
                      return (
                        <label key={role} className="flex items-center gap-1.5 text-xs text-slate-800 dark:text-slate-200 font-semibold capitalize cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={event => {
                              const next = event.target.checked
                                ? [...user.roles, role]
                                : user.roles.filter(item => item !== role)
                              if (!next.length) return
                              void act(() => api('/admin/users/' + user.id + '/roles', json({ roles: next }, {}, 'PUT')))
                            }}
                          />
                          {role}
                        </label>
                      )
                    })}
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      disabled={busy}
                      className="secondary text-xs py-1.5 px-3"
                      onClick={() => void act(() => api('/admin/users/' + user.id + '/suspend', json({ suspended: user.is_active })))}
                    >
                      {user.is_active ? 'Suspend' : 'Reactivate'}
                    </button>

                    {actorId !== user.id && users.data?.deletion_enabled && (
                      <button
                        disabled={busy}
                        className="text-xs py-1.5 px-3 bg-rose-700 hover:bg-rose-800 text-white rounded-md font-semibold"
                        onClick={() => {
                          if (window.confirm(`Delete ${user.full_name}? Profile data will be anonymized immediately; private notes and submissions will be erased.`)) {
                            void act(() => api('/admin/users/' + user.id, { method: 'DELETE' }))
                          }
                        }}
                      >
                        Delete account
                      </button>
                    )}

                    {actorId !== user.id && !users.data?.deletion_enabled && (
                      <span className="text-xs text-slate-600 dark:text-slate-300 italic">Deletion disabled until DEC-14 is confirmed</span>
                    )}
                  </div>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ApprovalsSection() {
  const pending = useData<{ items: Pending[] }>('/admin/courses/pending')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function act(work: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await work()
      pending.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">Course approvals</h1>
        <p className="text-slate-600 dark:text-slate-300 text-sm">Review submitted course drafts before making them available in the public catalog.</p>
      </div>

      {error && <p role="alert">{error}</p>}
      {pending.error && <p role="alert">{pending.error}</p>}

      <div className="space-y-3">
        {pending.data?.items.map(course => (
          <article key={course.id} className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xs flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 m-0">{course.title}</h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 m-0">
                {course.category} · {course.instructor_name}
              </p>
            </div>
            <div className="flex gap-2">
              {(['approved', 'rejected'] as const).map(decision => (
                <button
                  key={decision}
                  disabled={busy}
                  className={`text-xs py-1.5 px-3.5 capitalize font-semibold ${decision === 'approved' ? 'bg-emerald-700 hover:bg-emerald-800 border-emerald-700 text-white' : 'secondary text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950'}`}
                  onClick={() =>
                    void act(
                      () =>
                        api(
                          '/courses/' + course.id + '/approve',
                          json({ decision }, { ...requestKey(), 'If-Match': course.revision })
                        )
                    )
                  }
                >
                  {decision}
                </button>
              ))}
            </div>
          </article>
        ))}

        {pending.data?.items.length === 0 && (
          <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-300 m-0">No courses currently awaiting approval.</p>
          </div>
        )}
      </div>
    </section>
  )
}

function ModerationSection() {
  const reports = useData<{ items: Report[] }>('/admin/moderation/reports')
  const flagged = useData<Page<FlaggedPost>>('/admin/moderation/flagged-posts?limit=50')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function act(work: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await work()
      reports.refresh()
      flagged.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">Moderation queue</h1>
        <p className="text-slate-600 dark:text-slate-300 text-sm">Inspect flagged community reports and take moderation actions.</p>
      </div>

      {error && <p role="alert">{error}</p>}
      {reports.error && <p role="alert">{reports.error}</p>}
      {flagged.error && <p role="alert">{flagged.error}</p>}

      <div className="space-y-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Pending moderation reports</h2>
        {reports.data?.items.map(report => (
          <article key={report.id} className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xs flex items-center justify-between flex-wrap gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700">
                {report.entity_type}
              </span>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 mt-2 m-0">{report.reason}</p>
            </div>
            <div className="flex gap-2">
              {(['actioned', 'dismissed'] as const).map(decision => (
                <button
                  key={decision}
                  disabled={busy}
                  className="secondary text-xs py-1.5 px-3 capitalize font-semibold"
                  onClick={() =>
                    void act(
                      () => api('/admin/moderation/reports/' + report.id + '/review', json({ decision }))
                    )
                  }
                >
                  {decision}
                </button>
              ))}
            </div>
          </article>
        ))}

        {reports.data?.items.length === 0 && (
          <div className="text-center py-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-300 m-0">No moderation reports pending.</p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Flagged discussion posts</h2>
        {flagged.data?.items.map(post => (
          <article key={post.id} className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xs flex items-center justify-between flex-wrap gap-4">
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-700">
                {post.visibility}
              </span>
              <p className="text-sm text-slate-800 dark:text-slate-100 m-0">{post.content}</p>
            </div>
            <div className="flex gap-2">
              {post.visibility === 'visible' ? (
                <button
                  disabled={busy}
                  className="secondary text-xs py-1.5 px-3 font-semibold"
                  onClick={() =>
                    void act(
                      () => api('/posts/' + post.id + '/moderation', json({ decision: 'hide', reason: 'Admin moderation queue action' }, { 'If-Match': post.revision }, 'PUT'))
                    )
                  }
                >
                  Hide
                </button>
              ) : (
                <button
                  disabled={busy}
                  className="secondary text-xs py-1.5 px-3 font-semibold"
                  onClick={() =>
                    void act(
                      () => api('/posts/' + post.id + '/moderation', json({ decision: 'restore', reason: 'Admin moderation queue restore' }, { 'If-Match': post.revision }, 'PUT'))
                    )
                  }
                >
                  Restore
                </button>
              )}
              <button
                disabled={busy}
                className="secondary text-xs py-1.5 px-3 font-semibold"
                onClick={() =>
                  void act(
                    () => api('/posts/' + post.id + '/moderation', json({ decision: 'dismiss', reason: 'Admin moderation queue dismiss' }, { 'If-Match': post.revision }, 'PUT'))
                  )
                }
              >
                Dismiss
              </button>
            </div>
          </article>
        ))}

        {flagged.data?.items.length === 0 && (
          <div className="text-center py-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-300 m-0">No flagged posts in moderation queue.</p>
          </div>
        )}
      </div>
    </section>
  )
}

function MetricsSection() {
  const metrics = useData<MetricsData>('/admin/analytics/overview')

  return (
    <section className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">Platform metrics</h1>
        <p className="text-slate-600 dark:text-slate-300 text-sm">Aggregated telemetry, engagement, completion rates, and platform revenue.</p>
      </div>

      {metrics.error && <p role="alert">{metrics.error}</p>}

      {metrics.data && (
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            ['Daily active learners', metrics.data.dau, 'Learners active today'],
            ['Enrollments', metrics.data.enrollments, 'Total enrolled student seats'],
            [
              'Completion rate',
              metrics.data.completion_rate == null ? '—' : metrics.data.completion_rate + '%',
              'Course curriculum completion'
            ],
            [
              'Revenue',
              metrics.data.revenue.amount === null
                ? `Mixed currencies · ${metrics.data.revenue.provenance}`
                : `${metrics.data.revenue.currency} ${metrics.data.revenue.amount} · ${metrics.data.revenue.provenance}`,
              'Platform earnings ledger'
            ]
          ].map(([label, value, description]) => (
            <article key={String(label)} className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xs">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">{label}</p>
              <strong className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 block mb-1">{value}</strong>
              <span className="text-xs text-slate-600 dark:text-slate-300">{description}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function AdminPanel({ section }: { section: string }) {
  if (section === 'users') return <UsersSection />
  if (section === 'approvals') return <ApprovalsSection />
  if (section === 'moderation') return <ModerationSection />
  return <MetricsSection />
}
