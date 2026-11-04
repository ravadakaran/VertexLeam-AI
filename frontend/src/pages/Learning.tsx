import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, json, type Course, type Page } from '../api'

type Enrollment = { id: string; course_id: string; progress_percent: number }

export function Catalog() {
  const [items, setItems] = useState<Course[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function load(query = '') {
    try { setItems((await api<Page<Course>>('/courses' + query)).items) }
    catch (error) { setMessage(String(error)) }
  }
  useEffect(() => { void load() }, [])
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    const query = new URLSearchParams()
    for (const [key, value] of new FormData(event.currentTarget)) if (value) query.set(key, String(value))
    void load('?' + query)
  }
  async function enroll(id: string) {
    setBusy(true)
    try {
      await api('/courses/' + id + '/enroll', { method: 'POST' })
      setMessage('Enrolled. Open My learning to continue.')
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  return <><h1>Course catalog</h1><form onSubmit={filter} className="feature-form">
    <label>Search<input name="q" /></label><label>Category<input name="category" /></label>
    <label>Difficulty<select name="difficulty"><option value="">Any</option>{['beginner','intermediate','advanced'].map(mode => <option key={mode}>{mode}</option>)}</select></label>
    <label>Minimum rating<input name="rating_min" type="number" min="0" max="5" step=".1" /></label>
    <button>Apply filters</button>
  </form><p role="status">{message}</p>
  <ul>{items.map(course => <li key={course.id}><h2>{course.title}</h2><p>{course.description}</p>
    <p>{course.category} · {course.difficulty}</p><button disabled={busy} onClick={() => void enroll(course.id)}>Enroll in {course.title}</button></li>)}</ul>
  {!items.length && <p>No courses to display.</p>}</>
}

export function Learning({ overview = false }: { overview?: boolean }) {
  const [items, setItems] = useState<Array<Enrollment & { title: string }>>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    api<Page<Enrollment>>('/enrollments/me').then(result =>
      Promise.all(result.items.map(async row => ({
        ...row, title: (await api<{ course: Course }>('/courses/' + row.course_id)).course.title
      })))
    ).then(rows => { if (!cancelled) setItems(rows) }, failure => { if (!cancelled) setError(String(failure)) })
    return () => { cancelled = true }
  }, [])
  return <><h1>{overview ? 'Student workspace' : 'My learning'}</h1>
    {error && <p role="alert">{error}</p>}
    <ul>{items.map(row => <li key={row.id}><Link to={'/student/learning/' + row.course_id}>{row.title}</Link> · {row.progress_percent}% complete</li>)}</ul>
    {!items.length && !error && <p>No courses yet. <Link to="/student/catalog">Browse the catalog</Link>.</p>}</>
}

export function InstructorCourses() {
  const [items, setItems] = useState<Course[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Page<Course>>('/instructor/courses').then(result => setItems(result.items), failure => setError(String(failure))) }, [])
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const { thumbnail_url, price, ...data } = Object.fromEntries(new FormData(form))
    setBusy(true); setError('')
    try {
      const course = await api<Course>('/courses', json({ ...data, ...(thumbnail_url ? { thumbnail_url } : {}), price: Number(price) }))
      setItems(current => [course, ...current])
      form.reset()
    } catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  return <><h1>My courses</h1><form className="feature-form" onSubmit={create}>
    <label>Title<input name="title" required maxLength={200} /></label>
    <label>Description<textarea name="description" required /></label>
    <label>Category<input name="category" required maxLength={80} /></label>
    <label>Difficulty<select name="difficulty">{['beginner','intermediate','advanced'].map(mode => <option key={mode}>{mode}</option>)}</select></label>
    <label>Thumbnail URL<input name="thumbnail_url" type="url" /></label>
    <label>Price<input name="price" type="number" min="0" max="99999999.99" step=".01" defaultValue={0} required /></label>
    <label>Pricing tier<input name="pricing_tier" defaultValue="free" required /></label>
    <button disabled={busy}>Create course</button>
  </form>{error && <p role="alert">{error}</p>}
  <ul>{items.map(row => <li key={row.id}><Link to={'/instructor/courses/' + row.id}>{row.title}</Link> · {row.status}</li>)}</ul></>
}
