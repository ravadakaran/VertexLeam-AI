import { useState } from 'react'
import { api, json } from '../api'
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

type MetricsData = {
  dau: number
  enrollments: number
  completion_rate: number | null
  revenue: {
    currency: string
    amount: number
    provenance: string
  }
}

export function AdminPanel({ section }: { section: string }) {
  const actorId = useSession(state => state.tokens?.user.id)
  const users = useData<{ items: User[]; deletion_enabled: boolean }>('/admin/users')
  const pending = useData<{ items: Pending[] }>('/admin/courses/pending')
  const reports = useData<{ items: Report[] }>('/admin/moderation/reports')
  const metrics = useData<MetricsData>('/admin/analytics/overview')
  const [error, setError] = useState('')

  async function act(work: () => Promise<unknown>, refresh: () => void) {
    setError('')
    try {
      await work()
      refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  if (section === 'users') {
    return (
      <section className="space-y-6">
        <div className="border-b border-slate-200 pb-4">
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">User governance</h1>
          <p className="text-slate-500 text-sm">Manage user identities, role assignments, suspension, and account privacy.</p>
        </div>

        {error && <p role="alert">{error}</p>}
        {users.error && <p role="alert">{users.error}</p>}

        <div className="space-y-3">
          {users.data?.items.map(user => (
            <article key={user.id} className="p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <strong className="text-base text-slate-900 font-bold">{user.full_name}</strong>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {user.email} ·{' '}
                    <span className={user.deleted_at ? 'text-rose-600 font-semibold' : user.is_active ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                      {user.deleted_at ? 'Deleted' : user.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
                {user.deleted_at ? (
                  <span className="text-xs text-slate-400 font-medium">Deleted and anonymized</span>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-600">Roles:</span>
                      {(['student', 'instructor', 'admin'] as const).map(role => (
                        <label key={role} className="flex items-center gap-1.5 text-xs text-slate-700 font-semibold capitalize cursor-pointer">
                          <input
                            type="checkbox"
                            checked={user.roles.includes(role)}
                            onChange={event => {
                              const next = event.target.checked
                                ? [...user.roles, role]
                                : user.roles.filter(item => item !== role)
                              void act(() => api('/admin/users/' + user.id + '/roles', json({ roles: next }, {}, 'PUT')), users.refresh)
                            }}
                          />
                          {role}
                        </label>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        className="secondary text-xs py-1.5 px-3"
                        onClick={() => void act(() => api('/admin/users/' + user.id + '/suspend', json({ suspended: user.is_active })), users.refresh)}
                      >
                        {user.is_active ? 'Suspend' : 'Reactivate'}
                      </button>

                      {actorId !== user.id && users.data?.deletion_enabled && (
                        <button
                          className="text-xs py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-semibold"
                          onClick={() => {
                            if (window.confirm(`Delete ${user.full_name}? Profile data will be anonymized immediately; private notes and submissions will be erased.`)) {
                              void act(() => api('/admin/users/' + user.id, { method: 'DELETE' }), users.refresh)
                            }
                          }}
                        >
                          Delete account
                        </button>
                      )}

                      {actorId !== user.id && !users.data?.deletion_enabled && (
                        <span className="text-xs text-slate-400 italic">Deletion disabled until DEC-14 is confirmed</span>
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

  if (section === 'approvals') {
    return (
      <section className="space-y-6">
        <div className="border-b border-slate-200 pb-4">
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Course approvals</h1>
          <p className="text-slate-500 text-sm">Review submitted course drafts before making them available in the public catalog.</p>
        </div>

        {error && <p role="alert">{error}</p>}
        {pending.error && <p role="alert">{pending.error}</p>}

        <div className="space-y-3">
          {pending.data?.items.map(course => (
            <article key={course.id} className="p-5 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 m-0">{course.title}</h2>
                <p className="text-xs text-slate-500 mt-1 m-0">
                  {course.category} · {course.instructor_name}
                </p>
              </div>
              <div className="flex gap-2">
                {(['approved', 'rejected'] as const).map(decision => (
                  <button
                    key={decision}
                    className={`text-xs py-1.5 px-3.5 capitalize font-semibold ${decision === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'secondary text-rose-600 border-rose-200 hover:bg-rose-50'}`}
                    onClick={() =>
                      void act(
                        () =>
                          api(
                            '/courses/' + course.id + '/approve',
                            json({ decision }, { ...requestKey(), 'If-Match': course.revision })
                          ),
                        pending.refresh
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
            <div className="text-center py-10 bg-white rounded-xl border border-slate-200">
              <p className="text-sm text-slate-500 m-0">No courses currently awaiting approval.</p>
            </div>
          )}
        </div>
      </section>
    )
  }

  if (section === 'moderation') {
    return (
      <section className="space-y-6">
        <div className="border-b border-slate-200 pb-4">
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Moderation queue</h1>
          <p className="text-slate-500 text-sm">Inspect flagged community reports and take moderation actions.</p>
        </div>

        {error && <p role="alert">{error}</p>}
        {reports.error && <p role="alert">{reports.error}</p>}

        <div className="space-y-3">
          {reports.data?.items.map(report => (
            <article key={report.id} className="p-5 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between flex-wrap gap-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  {report.entity_type}
                </span>
                <p className="text-sm font-medium text-slate-800 mt-2 m-0">{report.reason}</p>
              </div>
              <div className="flex gap-2">
                {(['actioned', 'dismissed'] as const).map(decision => (
                  <button
                    key={decision}
                    className="secondary text-xs py-1.5 px-3 capitalize font-semibold"
                    onClick={() =>
                      void act(
                        () => api('/admin/moderation/reports/' + report.id + '/review', json({ decision })),
                        reports.refresh
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
            <div className="text-center py-10 bg-white rounded-xl border border-slate-200">
              <p className="text-sm text-slate-500 m-0">No moderation reports pending.</p>
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Platform metrics</h1>
        <p className="text-slate-500 text-sm">Aggregated telemetry, engagement, completion rates, and platform revenue.</p>
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
              `${metrics.data.revenue.currency} ${metrics.data.revenue.amount} · ${metrics.data.revenue.provenance}`,
              'Platform earnings ledger'
            ]
          ].map(([label, value, description]) => (
            <article key={String(label)} className="p-5 bg-white border border-slate-200 rounded-xl shadow-xs">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
              <strong className="text-2xl font-extrabold text-slate-900 block mb-1">{value}</strong>
              <span className="text-xs text-slate-400">{description}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
