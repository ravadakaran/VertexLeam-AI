import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, json, type Course, type Page } from '../api'
import { useSession } from '../auth'

type Enrollment = { id: string; course_id: string; progress_percent: number }
type Streak = { streak: number; last_active: string | null }
type Award = { items: Array<{ id?: string; badge_key?: string; course_id?: string; issued_at?: string; awarded_at?: string }> }

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const styles = {
    beginner: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    intermediate: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    advanced: 'bg-violet-50 text-violet-700 border-violet-200'
  }[difficulty.toLowerCase()] ?? 'bg-slate-50 text-slate-700 border-slate-200'

  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${styles} capitalize`}>
      {difficulty}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    published: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    draft: 'bg-slate-100 text-slate-700 border-slate-200',
    rejected: 'bg-rose-50 text-rose-700 border-rose-200'
  }[status.toLowerCase()] ?? 'bg-slate-100 text-slate-700 border-slate-200'

  return (
    <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${styles} capitalize`}>
      {status}
    </span>
  )
}

export function Catalog() {
  const [items, setItems] = useState<Course[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function load(query = '') {
    try {
      setItems((await api<Page<Course>>('/courses' + query)).items)
    } catch (error) {
      setMessage(String(error))
    }
  }

  useEffect(() => { void load() }, [])

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    const query = new URLSearchParams()
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (value) query.set(key, String(value))
    }
    void load('?' + query)
  }

  async function enroll(id: string) {
    setBusy(true)
    try {
      await api('/courses/' + id + '/enroll', { method: 'POST' })
      setMessage('Enrolled. Open My learning to continue.')
    } catch (error) {
      setMessage(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Course catalog</h1>
        <p className="text-slate-500 text-sm">Discover verified academic curricula with AI tutoring and interactive assessments.</p>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <form onSubmit={filter} className="feature-form grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-none m-0">
          <label className="text-xs font-semibold text-slate-700">
            Search
            <input name="q" placeholder="Keywords, topics…" className="mt-1" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Category
            <input name="category" placeholder="Computer Science, Math…" className="mt-1" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Difficulty
            <select name="difficulty" className="mt-1">
              <option value="">Any</option>
              {['beginner', 'intermediate', 'advanced'].map(mode => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Minimum rating
            <input name="rating_min" type="number" min="0" max="5" step=".1" placeholder="4.0" className="mt-1" />
          </label>
          <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-between pt-2">
            <button className="text-sm py-2 px-5">Apply filters</button>
            {message && <p role="status" className="m-0 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">{message}</p>}
          </div>
        </form>
      </div>

      {/* Courses Grid */}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-6 list-none p-0 m-0">
        {items.map(course => (
          <li key={course.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between">
            <div className="p-6">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50/80 px-2.5 py-1 rounded-md border border-indigo-100">
                  {course.category}
                </span>
                <DifficultyBadge difficulty={course.difficulty} />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2 leading-snug">{course.title}</h2>
              <p className="text-slate-600 text-sm line-clamp-3 mb-4 leading-relaxed">{course.description}</p>
              <p className="text-xs text-slate-400 font-medium">{course.category} · {course.difficulty}</p>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <button
                disabled={busy}
                onClick={() => void enroll(course.id)}
                className="w-full text-xs font-semibold py-2 px-4 shadow-sm"
              >
                Enroll in {course.title}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {!items.length && (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-500 font-medium">No courses to display.</p>
        </div>
      )}
    </div>
  )
}

export function Learning({ overview = false }: { overview?: boolean }) {
  const [items, setItems] = useState<Array<Enrollment & { title: string }>>([])
  const [error, setError] = useState('')
  const [streak, setStreak] = useState<Streak>()
  const [badges, setBadges] = useState<Award['items']>([])
  const [certificates, setCertificates] = useState<Award['items']>([])
  const tokens = useSession(state => state.tokens)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api<Page<Enrollment>>('/enrollments/me'),
      api<Streak>('/users/me/streak'),
      api<Award>('/users/me/badges'),
      api<Award>('/users/me/certificates')
    ]).then(async ([result, current, earned, issued]) => {
      const rows = await Promise.all(result.items.map(async row => ({
        ...row,
        title: (await api<{ course: Course }>('/courses/' + row.course_id)).course.title
      })))
      if (!cancelled) {
        setItems(rows)
        setStreak(current)
        setBadges(earned.items)
        setCertificates(issued.items)
      }
    }).catch(failure => {
      if (!cancelled) setError(String(failure))
    })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          {overview ? 'Student workspace' : 'My learning'}
        </h1>
        <p className="text-slate-500 text-sm">
          {overview ? 'Track learning milestones, daily streaks, and certified completions.' : 'Continue your enrolled courses and view progress.'}
        </p>
      </div>

      {error && <p role="alert">{error}</p>}

      {overview && (
        <section className="feature-section space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Your progress</h2>
              <p className="text-xs text-slate-500 m-0">Continuous learning streak and recognized badges.</p>
            </div>
            {/* Streak Counter Jewel */}
            <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 shadow-xs">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-orange-600" aria-hidden="true">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21c4.2 0 7-2.8 7-6.5 0-2.8-1.7-4.7-4.4-7.5.2 2.1-.8 3.3-1.7 3.8C12.7 7.8 10.9 5.6 8 3c.5 4-3 6.8-3 11.3C5 18.3 7.8 21 12 21Z"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 21c-1.7-1.1-2.3-2.2-2.3-3.6 0-1.3.8-2.4 2.2-3.9 0 1.2.7 1.9 1.4 2.3.9 1.9.4 3.9-1.3 5.2Z"/></svg>
              </span>
              <div>
                <p className="text-sm font-extrabold text-amber-900 m-0 leading-tight">
                  Current streak: {streak?.streak ?? 0} days
                </p>
                <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Keep it burning</span>
              </div>
            </div>
          </div>

          {/* Badges Section */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">Badges</h3>
            {badges.length ? (
              <ul className="flex flex-wrap gap-2.5 list-none p-0 m-0">
                {badges.map(item => (
                  <li key={item.badge_key} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-800 text-xs font-semibold shadow-2xs">
                    <svg aria-hidden="true" className="h-4 w-4 text-blue-700" viewBox="0 0 20 20" fill="currentColor"><path d="m10 1.8 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L10 1.8Z"/></svg>
                    {item.badge_key?.replaceAll('_', ' ')}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 italic">Milestone badges appear here as you learn.</p>
            )}
          </div>

          {/* Certificates Section */}
          <div className="pt-2 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">Certificates</h3>
            {certificates.length ? (
              <ul className="list-none p-0 m-0 space-y-2">
                {certificates.map(item => (
                  <li key={item.id} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                        PDF
                      </div>
                      <span className="text-sm font-semibold text-slate-800">Verified Course Certificate</span>
                    </div>
                    <button
                      className="secondary text-xs font-semibold py-1.5 px-3"
                      onClick={async () => {
                        const response = await fetch('/api/v1/certificates/' + item.id + '/download', {
                          headers: { Authorization: `Bearer ${tokens?.access_token}` }
                        })
                        if (!response.ok) { setError('Certificate download failed.'); return }
                        const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a')
                        anchor.href = url; anchor.download = 'certificate.pdf'; anchor.click(); URL.revokeObjectURL(url)
                      }}
                    >
                      Download course certificate
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 italic">Certificate issuance appears after the course completion policy is confirmed.</p>
            )}
          </div>
        </section>
      )}

      {/* Enrolled Courses */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Enrolled Courses</h2>
        <ul className="space-y-3.5 list-none p-0 m-0">
          {items.map(row => (
            <li key={row.id} className="p-5 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-indigo-300 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <Link to={'/student/learning/' + row.course_id} className="text-base font-bold text-slate-900 hover:text-indigo-600">
                  {row.title}
                </Link>
                <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full w-fit">
                  {row.progress_percent}% complete
                </span>
              </div>
              {/* Progress Bar */}
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-violet-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(4, row.progress_percent)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>

        {!items.length && !error && (
          <div className="text-center py-10 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-500 text-sm mb-2">No courses yet.</p>
            <Link to="/student/catalog" className="text-sm font-semibold text-indigo-600 hover:underline">
              Browse the catalog
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export function InstructorCourses() {
  const [items, setItems] = useState<Course[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Page<Course>>('/instructor/courses').then(
      result => setItems(result.items),
      failure => setError(String(failure))
    )
  }, [])

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const { thumbnail_url, price, ...data } = Object.fromEntries(new FormData(form))
    setBusy(true); setError('')
    try {
      const course = await api<Course>('/courses', json({
        ...data,
        ...(thumbnail_url ? { thumbnail_url } : {}),
        price: Number(price)
      }))
      setItems(current => [course, ...current])
      form.reset()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">My courses</h1>
        <p className="text-slate-500 text-sm">Create curricula, upload lecture media, configure rubrics, and publish quizzes.</p>
      </div>

      {/* Course Authoring Card */}
      <div className="feature-section">
        <h2 className="text-lg font-bold text-slate-900 mb-1">Create a new course</h2>
        <p className="text-xs text-slate-500 mb-4">Provide title, subject category, and syllabus details to initialize the course workspace.</p>

        <form className="feature-form grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-none m-0" onSubmit={create}>
          <label className="sm:col-span-2 text-xs font-semibold text-slate-700">
            Title
            <input name="title" required maxLength={200} placeholder="e.g. Data Structures and Algorithms" className="mt-1" />
          </label>
          <label className="sm:col-span-2 text-xs font-semibold text-slate-700">
            Description
            <textarea name="description" required rows={3} placeholder="Comprehensive description of learning outcomes…" className="mt-1" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Category
            <input name="category" required maxLength={80} placeholder="Computer Science" className="mt-1" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Difficulty
            <select name="difficulty" className="mt-1">
              {['beginner', 'intermediate', 'advanced'].map(mode => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Thumbnail URL
            <input name="thumbnail_url" type="url" placeholder="https://…" className="mt-1" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Price
            <input name="price" type="number" min="0" max="99999999.99" step=".01" defaultValue={0} required className="mt-1" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Pricing tier
            <input name="pricing_tier" defaultValue="free" required className="mt-1" />
          </label>
          <div className="sm:col-span-2 pt-2">
            <button disabled={busy} className="text-sm font-semibold py-2 px-6">
              {busy ? 'Creating…' : 'Create course'}
            </button>
          </div>
        </form>
      </div>

      {error && <p role="alert">{error}</p>}

      {/* Managed Courses List */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Your Authored Courses</h2>
        <ul className="space-y-3 list-none p-0 m-0">
          {items.map(row => (
            <li key={row.id} className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs flex items-center justify-between hover:border-indigo-300 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center font-bold text-indigo-600">
                  📚
                </div>
                <div>
                  <Link to={'/instructor/courses/' + row.id} className="text-base font-bold text-slate-900 hover:text-indigo-600 block">
                    {row.title}
                  </Link>
                  <span className="text-xs text-slate-500 font-medium">Status: {row.status}</span>
                </div>
              </div>
              <StatusBadge status={row.status} />
            </li>
          ))}
        </ul>

        {!items.length && !error && (
          <div className="text-center py-10 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-500 text-sm">No authored courses yet. Create one above to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}
