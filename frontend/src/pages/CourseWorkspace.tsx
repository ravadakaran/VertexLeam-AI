import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type Hls from 'hls.js'
import { api, json, type Course, type Page } from '../api'
import { Assignments, Quizzes } from './Assessments'
import { ActionForm, localUrl, requestKey, useData } from './feature-ui'

export type Lecture = {
  id: string; title: string; order_index: number; duration_seconds: number; media_status: string
  resources: Array<{ id: string; title: string }>
}
type Module = { id: string; title: string; order_index: number; lectures: Lecture[] }
type CourseDetail = { course: Course; modules: Module[] }
type Grant = { url: string; playback_id: string; captions_url?: string }
type Progress = { position_seconds: number; watched_seconds: number; completed: boolean; progress_percent: number }
type Annotation = { id: string; timestamp_seconds: number; content?: string }

function Player({ lecture }: { lecture: Lecture }) {
  const prefix = '/lectures/' + lecture.id
  const video = useRef<HTMLVideoElement>(null)
  const session = useRef<{ id: string; sequence: number }>()
  const [progress, setProgress] = useState<Progress>()
  const [error, setError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [reload, setReload] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [captions, setCaptions] = useState<string>()
  const notes = useData<Page<Annotation>>(prefix + '/notes')
  const bookmarks = useData<Page<Annotation>>(prefix + '/bookmarks')

  useEffect(() => {
    const player = video.current
    if (!player) return
    let cancelled = false
    let hls: Hls | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const resume = (position: number) => {
      if (!cancelled && Number.isFinite(player.duration)) player.currentTime = Math.min(position, player.duration)
    }
    let onLoaded: (() => void) | undefined
    async function connect() {
      const signal = controller.signal
      const [stored, grant] = await Promise.all([
        api<Progress>(prefix + '/progress', { signal }), api<Grant>(prefix + '/playback', { signal })
      ])
      if (cancelled || !player) return
      setError('')
      setProgress(stored)
      setCaptions(grant.captions_url ? localUrl(grant.captions_url) : undefined)
      session.current = { id: grant.playback_id, sequence: 0 }
      const url = localUrl(grant.url)
      const position = stored.position_seconds
      onLoaded = () => resume(position)
      player.addEventListener('loadedmetadata', onLoaded, { once: true })
      if (player.canPlayType('application/vnd.apple.mpegurl')) player.src = url
      else {
        const { default: HlsPlayer } = await import('hls.js')
        if (cancelled) return
        if (HlsPlayer.isSupported()) {
          hls = new HlsPlayer()
          hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
            if (data.fatal && !cancelled) setError('Playback interrupted. Reconnect to continue.')
          })
          hls.loadSource(url)
          hls.attachMedia(player)
        } else setError('This browser does not support HLS playback.')
      }
      timer = setTimeout(() => {
        if (!cancelled) setError('Playback link expired. Reconnect to continue.')
      }, 295000)
    }
    void connect().catch(failure => { if (!cancelled) setError(String(failure)) })
    return () => {
      cancelled = true
      controller.abort()
      session.current = undefined
      clearTimeout(timer)
      if (onLoaded) player.removeEventListener('loadedmetadata', onLoaded)
      hls?.destroy()
      player.removeAttribute('src')
      player.load()
    }
  }, [prefix, reload])

  useEffect(() => {
    if (video.current) {
      video.current.defaultPlaybackRate = speed
      video.current.playbackRate = speed
    }
  }, [speed, reload])

  async function heartbeat() {
    const player = video.current, current = session.current
    if (!player || !current || !Number.isFinite(player.duration)) return
    const played_ranges = Array.from({ length: player.played.length }, (_, index) => {
      const start = player.played.start(index), end = player.played.end(index)
      return {
        start_seconds: Math.max(0, Math.ceil(start - .08)),
        end_seconds: Math.min(lecture.duration_seconds,
          player.ended && end >= player.duration - .1 ? lecture.duration_seconds : Math.floor(end))
      }
    }).filter(range => range.end_seconds > range.start_seconds)
    const position_seconds = Math.min(lecture.duration_seconds, Math.floor(player.currentTime))
    try {
      for (let offset = 0; offset < Math.max(1, played_ranges.length); offset += 120) {
        const sequence = ++current.sequence
        const saved = await api<Progress>(prefix + '/progress', { ...json({
          position_seconds, event_id: crypto.randomUUID(), playback_id: current.id, sequence,
          played_ranges: played_ranges.slice(offset, offset + 120)
        }), keepalive: true })
        if (session.current === current) setProgress(previous => !previous || saved.watched_seconds >= previous.watched_seconds ? saved : previous)
      }
    } catch (failure) { if (session.current === current) setError(String(failure)) }
  }

  useEffect(() => {
    const timer = setInterval(() => { if (video.current && !video.current.paused) void heartbeat() }, 15000)
    const flush = () => { void heartbeat() }
    window.addEventListener('pagehide', flush)
    return () => { clearInterval(timer); window.removeEventListener('pagehide', flush) }
  }, [prefix])

  async function download(id: string) {
    setDownloadError('')
    try { window.location.assign(localUrl((await api<Grant>(prefix + '/resources/' + id)).url)) }
    catch (failure) { setDownloadError(String(failure)) }
  }
  async function annotation(path: 'notes' | 'bookmarks', data: object) {
    await api(prefix + '/' + path, json({ ...data, timestamp_seconds: Math.floor(video.current?.currentTime ?? 0) }, requestKey()))
    if (path === 'notes') notes.refresh()
    else bookmarks.refresh()
  }

  return <section><h2>{lecture.title}</h2>
    {lecture.media_status === 'ready' && <>
      <video ref={video} controls playsInline preload="metadata" aria-label={lecture.title}
        onPause={() => void heartbeat()} onSeeked={() => void heartbeat()} onEnded={() => void heartbeat()}>
        {captions && <track kind="captions" srcLang="en" label="English" src={captions} />}
      </video>
      <label>Playback speed<select value={speed} onChange={event => setSpeed(Number(event.target.value))}>
        {[.5, 1, 1.25, 1.5, 2].map(value => <option value={value} key={value}>{value}×</option>)}
      </select></label>
      {error && <p role="alert">{error} <button onClick={() => setReload(value => value + 1)}>Reconnect</button></p>}
      {progress && <p role="status">{progress.completed ? 'Completed' : `${progress.progress_percent}% watched`}</p>}
    </>}
    {!!lecture.resources.length && <><h3>Resources</h3><ul>{lecture.resources.map(asset =>
      <li key={asset.id}><button onClick={() => void download(asset.id)}>Download {asset.title}</button></li>)}</ul></>}
    {downloadError && <p role="alert">{downloadError}</p>}
    <ActionForm label="Save note" onSubmit={data => annotation('notes', { content: data.get('content') })}>
      <label>Note at current time<textarea name="content" required maxLength={12000} /></label>
    </ActionForm>
    <ActionForm label="Bookmark current time" onSubmit={() => annotation('bookmarks', {})}>{null}</ActionForm>
    {notes.error && <p role="alert">{notes.error}</p>}{bookmarks.error && <p role="alert">{bookmarks.error}</p>}
    <ul>{[...notes.data?.items ?? [], ...bookmarks.data?.items ?? []].map(item => <li key={item.id}>
      <button onClick={() => { if (video.current) video.current.currentTime = item.timestamp_seconds }}>{item.timestamp_seconds}s</button> {item.content ?? 'Bookmark'}
    </li>)}</ul>
  </section>
}

export function CourseWorkspace({ author = false }: { author?: boolean }) {
  const { courseId } = useParams()
  const path = (author ? '/instructor/courses/' : '/courses/') + courseId
  const course = useData<CourseDetail>(path)
  const [selected, select] = useState<string>()
  if (course.error) return <p role="alert">{course.error}</p>
  if (!course.data) return <p role="status">Loading course…</p>
  const { course: current, modules } = course.data
  const lecture = modules.flatMap(module => module.lectures).find(item => item.id === selected)
  return <><h1>{current.title}</h1><p>{current.description}</p>
    {author && <ActionForm label="Add module" onSubmit={async data => {
      await api('/courses/' + current.id + '/modules', json({ title: data.get('title'), order_index: Math.max(-1, ...modules.map(item => item.order_index)) + 1 }, requestKey()))
      course.refresh()
    }}><label>Module title<input name="title" required maxLength={200} /></label></ActionForm>}
    {modules.map(module => <section className="feature-section" key={module.id}><h2>{module.title}</h2>
      <ul>{module.lectures.map(item => <li key={item.id}>{author ? item.title :
        <button aria-pressed={selected === item.id} onClick={() => select(item.id)}>{item.title}</button>}</li>)}</ul>
      {author && <ActionForm label="Upload lecture" onSubmit={async data => {
        for (const field of ['video','resources','captions']) {
          const files = data.getAll(field).filter(item => item instanceof File && item.size > 0)
          data.delete(field); for (const file of files) data.append(field, file)
        }
        data.set('order_index', String(Math.max(-1, ...module.lectures.map(item => item.order_index)) + 1))
        await api('/modules/' + module.id + '/lectures', { method: 'POST', headers: requestKey(), body: data })
        course.refresh()
      }}>
        <label>Lecture title<input name="title" required maxLength={200} /></label>
        <label>Video<input name="video" type="file" accept=".mp4,.mov,.webm" /></label>
        <label>English captions<input name="captions" type="file" accept=".vtt" /></label>
        <label>Resources<input name="resources" type="file" accept=".pdf,.pptx" multiple /></label>
      </ActionForm>}
      <Quizzes moduleId={module.id} author={author} />
    </section>)}
    {lecture && <Player key={lecture.id} lecture={lecture} />}
    <Assignments courseId={current.id} author={author} />
  </>
}
