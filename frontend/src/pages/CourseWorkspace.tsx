import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type Hls from 'hls.js/light'
import { api, json, type Course, type Page } from '../api'
import { CourseCommunity } from '../components/CourseCommunity'
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
type TutorSource = { lecture_id: string; lecture_title: string; timestamp_seconds?: number; page_number?: number; source_name?: string }
type TutorSession = { id: string; course_id: string; mode: string; created_at?: string; last_question?: string }
type TutorMessage = { role: 'user'|'assistant'; content: string; sources?: TutorSource[] }
type TutorReply = { reply: string; mode: string; sources: TutorSource[] }
type CourseAnalytics = { starts: number; completes: number; average_quiz_score: number | null; time_on_task_seconds: number; dropoff_percent: number | null }
type StudyCards = { summary?: string; sources?: Array<TutorSource>; items?: Array<{id:string;question:string;answer:string;next_review_at?:string}> }
type SavedFlashcard = {id:string;module_title:string;course_title:string;question:string;answer:string;next_review_at:string}

function PersonalizationPanel({courseId}:{courseId:string}){
  const mastery=useData<{items:Array<{topic_id:string;name:string;score:number;band:string}>}>('/users/me/mastery')
  const plan=useData<{days:Array<{day:number;scheduled_for:string;steps:Array<{order?:number;course_title?:string;topic:string;action:string;reason?:string;mastery?:number;estimated_minutes:number}>}>}>('/users/me/study-plan?course_id='+encodeURIComponent(courseId))
  const recommendations=useData<{items:Array<{course_id:string;title:string;score:number;reason:string}>}>('/users/me/recommendations')
  const [generating,setGenerating]=useState(false),[generationError,setGenerationError]=useState('')
  async function generate(){setGenerating(true);setGenerationError('');try{await api('/ai/study-plan',json({course_id:courseId}));plan.refresh()}catch(failure){setGenerationError(String(failure))}finally{setGenerating(false)}}
  return <section className="feature-section space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Your study plan</h2><button type="button" disabled={generating} className="secondary text-xs py-1.5 px-3" onClick={()=>void generate()}>{generating?'Building plan…':'Generate personalized plan'}</button></div><p className="text-xs text-slate-600 dark:text-slate-300">A seven-day schedule ordered around your finalized quiz results. Cold-start topics use the course syllabus.</p>{generationError&&<p role="alert" className="text-xs">{generationError}</p>}{plan.data?.days.map(day=><section key={day.day} className="border-t border-slate-200 dark:border-slate-700 pt-2"><h3 className="text-sm font-bold">Day {day.day} · {day.scheduled_for}</h3>{day.steps.length?day.steps.map((step,index)=><p key={step.order??index} className="text-sm text-slate-800 dark:text-slate-100"><strong>{step.topic}</strong>{step.course_title&&` · ${step.course_title}`} · {step.estimated_minutes} min<br/>{step.action} {step.reason&&<span className="text-slate-600 dark:text-slate-300">({step.reason})</span>}</p>):<p className="text-xs text-slate-600 dark:text-slate-300">Rest day or catch up on a previous topic.</p>}</section>)}
    {!!mastery.data?.items.length&&<div><h3 className="text-sm font-bold">Topic mastery</h3>{mastery.data.items.map(topic=><p key={topic.topic_id} className="text-xs text-slate-700 dark:text-slate-200">{topic.name}: {Math.round(topic.score*100)}% · {topic.band}</p>)}</div>}
    {!!recommendations.data?.items.length&&<div><h3 className="text-sm font-bold">Recommended courses</h3>{recommendations.data.items.map(item=><p key={item.course_id} className="text-xs text-slate-700 dark:text-slate-200">{item.title} · {item.reason}</p>)}</div>}
    {(plan.error||mastery.error||recommendations.error)&&<p role="alert" className="text-xs">{plan.error||mastery.error||recommendations.error}</p>}
  </section>
}

function ModuleLearningTools({moduleId,lectures}:{moduleId:string;lectures:Lecture[]}){
  const [result,setResult]=useState<StudyCards>(),[error,setError]=useState(''),[busy,setBusy]=useState('')
  async function load(kind:string,path:string){setBusy(kind);setError('');setResult(undefined);try{setResult(await api<StudyCards>(path,json({})))}catch(failure){setError(String(failure))}finally{setBusy('')}}
  return <div className="mt-3 p-3 rounded-lg bg-indigo-50/70 dark:bg-slate-800/80 border border-indigo-200 dark:border-slate-700 space-y-2">
    <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-800 dark:text-slate-100">AI study tools</span>
      {lectures.map((item,index)=><div key={item.id} className="inline-flex items-center gap-1.5 rounded-md bg-white dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 pl-2 pr-1 py-0.5">
        <span id={`summary-target-${item.id}`} className="text-xs text-slate-700 dark:text-slate-200 font-medium">{index+1}. {item.title}</span>
        <button type="button" disabled={!!busy} aria-describedby={`summary-target-${item.id}`} className="secondary text-xs py-1 px-2" onClick={()=>void load('summary:'+item.id,'/ai/lectures/'+item.id+'/summarize')}>{busy==='summary:'+item.id?'Summarizing…':`Summarize #${index+1}`}</button>
      </div>)}
      <button type="button" disabled={!!busy} className="secondary text-xs py-1 px-2" onClick={()=>void load('cards','/ai/modules/'+moduleId+'/flashcards')}>{busy==='cards'?'Working…':'Generate module flashcards'}</button>
    </div>
    {error&&<p role="alert" className="text-xs">{error}</p>}
    {result?.summary&&<><p className="text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-100">{result.summary}</p><button type="button" className="secondary text-xs py-1 px-2" onClick={()=>{
      const url=URL.createObjectURL(new Blob([result.summary??''],{type:'text/plain;charset=utf-8'})),anchor=document.createElement('a')
      anchor.href=url;anchor.download='lecture-summary.txt';anchor.click();URL.revokeObjectURL(url)
    }}>Download summary</button></>}
    {!!result?.sources?.length&&<p className="text-xs text-slate-600 dark:text-slate-300">Sources: {result.sources.map(source=>(source.source_name??source.lecture_title)+(source.page_number!==undefined?` p. ${source.page_number}`:source.timestamp_seconds!==undefined?` at ${source.timestamp_seconds}s`:'' )).join(' · ')}</p>}
    {result?.items?.map((item,index)=><details key={index} className="p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700"><summary className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.question}</summary><p className="text-sm text-slate-700 dark:text-slate-200 mb-0">{item.answer}</p></details>)}
  </div>
}

function FlashcardReview({courseId}:{courseId:string}){
  const cards=useData<{items:SavedFlashcard[]}>('/users/me/flashcards?course_id='+encodeURIComponent(courseId))
  const [revealed,setRevealed]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const now=Date.now(),due=cards.data?.items.filter(card=>new Date(card.next_review_at).getTime()<=now)??[]
  const current=due[0]
  async function markReviewed(){
    if(!current)return
    setBusy(true);setError('')
    try{await api('/users/me/flashcards/'+current.id+'/review',json({}));setRevealed('');cards.refresh()}
    catch(failure){setError(String(failure))}finally{setBusy(false)}
  }
  return <section className="feature-section space-y-3"><h2 className="text-lg font-bold">Flashcard review</h2>
    {cards.error&&<p role="alert">{cards.error}</p>}{error&&<p role="alert">{error}</p>}
    {current?<div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3" aria-live="polite">
      <p className="text-xs text-slate-600 dark:text-slate-300">{due.length} due · {current.course_title} / {current.module_title}</p>
      <p className="text-base font-semibold">{current.question}</p>
      {revealed===current.id?<><p className="text-sm whitespace-pre-wrap">{current.answer}</p><button type="button" disabled={busy} onClick={()=>void markReviewed()}>Mark reviewed · due tomorrow</button></>:<button type="button" className="secondary" onClick={()=>setRevealed(current.id)}>Show answer</button>}
    </div>:cards.data?.items.length?<p role="status" className="text-sm">No cards are due. Next review: {new Date(Math.min(...cards.data.items.map(card=>new Date(card.next_review_at).getTime()))).toLocaleDateString()}.</p>:<p role="status" className="text-sm">No saved flashcards yet. Generate a module deck to start reviewing.</p>}
  </section>
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function CourseTutor({ courseId, reviewer = false }: { courseId: string; reviewer?: boolean }) {
  const [session, setSession] = useState<TutorSession>()
  const [sessions, setSessions] = useState<TutorSession[]>([])
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [usage, setUsage] = useState<{requests:number;input_tokens:number;output_tokens:number}>()
  const [mode, setMode] = useState('intermediate')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled=false
    setSession(undefined);setSessions([]);setMessages([]);setMode('intermediate')
    void Promise.all([
      api<{items:TutorSession[]}>('/ai/chat/sessions?course_id='+encodeURIComponent(courseId)).then(async result=>{
        if(cancelled)return
        setSessions(result.items)
        if(result.items[0]){
          setSession(result.items[0]);setMode(result.items[0].mode)
          const history=await api<{items:TutorMessage[]}>('/ai/chat/sessions/'+result.items[0].id+'/messages')
          if(!cancelled)setMessages(history.items)
        }
      }).catch(failure=>{if(!cancelled)setError(String(failure))}),
      api<typeof usage>('/users/me/ai-usage').then(value=>{if(!cancelled&&value)setUsage(value)}).catch(()=>{})
    ])
    return ()=>{cancelled=true}
  },[courseId])

  async function selectSession(next:TutorSession){
    setError('');setSession(next);setMode(next.mode);setMessages([])
    try{setMessages((await api<{items:TutorMessage[]}>('/ai/chat/sessions/'+next.id+'/messages')).items)}
    catch(failure){setError(String(failure))}
  }

  async function newSession(){
    setError('');setSession(undefined);setMessages([]);setMode('intermediate')
  }

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const form = new FormData(event.currentTarget)
      const current = session ?? await api<TutorSession>('/ai/chat/sessions', json({ course_id: courseId }, requestKey()))
      setSession(current)
      const selectedMode = String(form.get('mode'))
      let active=current
      if (selectedMode !== current.mode) {
        const updated = await api<TutorSession>('/ai/chat/sessions/' + current.id + '/mode', json({ mode:selectedMode }, {}, 'PUT'))
        setSession(updated)
        active=updated
      }
      const answer=await api<TutorReply>('/ai/chat/sessions/' + current.id + '/messages', json({
        message: form.get('message'), request_id: crypto.randomUUID()
      }))
      setMessages(previous=>[...previous,{role:'user',content:String(form.get('message'))},{role:'assistant',content:answer.reply,sources:answer.sources}])
      if(!sessions.some(item=>item.id===current.id))setSessions(previous=>[current,...previous])
      setMode(active.mode)
      const currentUsage=await api<typeof usage>('/users/me/ai-usage').catch(()=>undefined)
      if(currentUsage)setUsage(currentUsage)
      event.currentTarget.reset()
    } catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }

  return (
    <section className="feature-section border-indigo-200 dark:border-slate-700 bg-gradient-to-b from-indigo-50/40 to-white dark:from-slate-900 dark:to-slate-900 shadow-xs">
      <div className="flex items-center gap-2 mb-3">
        <span className="p-1.5 rounded-lg bg-indigo-700 text-white text-xs font-bold shadow-xs">
          AI
        </span>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 m-0">
          {reviewer ? 'Tutor reviewer preview' : 'Ask the course tutor'}
        </h2>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300 mb-4">
        {reviewer
          ? 'Test grounded tutor responses against your published lecture transcripts in an isolated instructor reviewer session.'
          : 'Grounded in lecture transcripts and course syllabus. Ask for explanations, step-by-step guidance, or code walkthroughs.'}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className="secondary text-xs py-1.5 px-3" onClick={()=>void newSession()}>New conversation</button>
        {sessions.map((item,index)=><button type="button" key={item.id} aria-pressed={session?.id===item.id} className={session?.id===item.id?'text-xs py-1.5 px-3':'secondary text-xs py-1.5 px-3'} onClick={()=>void selectSession(item)}>{item.last_question?.slice(0,42)||`Conversation ${sessions.length-index}`}</button>)}
        {usage&&<span className="ml-auto text-xs text-slate-600 dark:text-slate-300">This month: {usage.input_tokens.toLocaleString()} input · {usage.output_tokens.toLocaleString()} output tokens</span>}
      </div>

      <form className="feature-form max-w-none space-y-3" onSubmit={ask}>
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          {reviewer ? 'Reviewer prompt' : 'Question'}
          <textarea
            name="message"
            required
            maxLength={4000}
            rows={3}
            placeholder="e.g. Can you explain how quicksort handles duplicate elements?"
            className="mt-1"
          />
        </label>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex-1 max-w-xs">
            Explanation depth
            <select name="mode" value={mode} onChange={event=>setMode(event.target.value)} className="mt-1">
              {['beginner', 'intermediate', 'advanced'].map(mode => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <button disabled={busy} className="text-sm py-2 px-5">
            {busy ? 'Thinking…' : reviewer ? 'Ask tutor reviewer' : 'Ask tutor'}
          </button>
        </div>
      </form>

      {error && <p role="alert">{error}</p>}

      {!!messages.length && <ol aria-label="Conversation" className="mt-5 space-y-3 list-none p-0">
        {messages.map((message,index)=><li key={`${index}-${message.role}`} className={`p-3 rounded-lg border ${message.role==='assistant'?'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700':'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">{message.role==='assistant'?`Tutor · ${session?.mode??mode}`:'You'}</span>
          <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed mb-0 mt-1">{message.content}</p>
          {!!message.sources?.length && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1.5">Grounded Sources & Citations:</span>
              <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                {message.sources.map((source, sourceIndex) => (
                  <li key={source.lecture_id + sourceIndex} className="text-xs px-2.5 py-1 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium">
                    <svg aria-hidden="true" className="inline h-3.5 w-3.5 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Zm0 0V21"/></svg>{source.source_name??source.lecture_title}{source.page_number!==undefined?` · page ${source.page_number}`:source.timestamp_seconds !== undefined ? ` at ${source.timestamp_seconds}s` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>)}
      </ol>}
    </section>
  )
}

function AnalyticsPanel({ courseId }: { courseId: string }) {
  const report = useData<CourseAnalytics>('/instructor/courses/' + courseId + '/analytics')

  return (
    <section className="feature-section">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 m-0">Course analytics</h2>
        <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">Aggregated metrics</span>
      </div>

      {report.error && <p role="alert">{report.error}</p>}

      {report.data ? (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">Lecture starts</span>
              <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{report.data.starts}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">Drop-off rate</span>
              <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{report.data.dropoff_percent ?? '—'}%</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">Quiz average</span>
              <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{report.data.average_quiz_score ?? '—'}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider block">Time watched</span>
              <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{report.data.time_on_task_seconds}s</span>
            </div>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 m-0">
            {report.data.starts} lecture starts · {report.data.dropoff_percent ?? '—'}% drop-off · {report.data.average_quiz_score ?? '—'} average quiz score · {report.data.time_on_task_seconds}s watched
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-300">Loading metrics…</p>
      )}
    </section>
  )
}

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
        const { default: HlsPlayer } = await import('hls.js/light')
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

  return (
    <section className="feature-section space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 m-0">{lecture.title}</h2>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
          Duration: {formatSeconds(lecture.duration_seconds)}
        </span>
      </div>

      {lecture.media_status === 'ready' && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl bg-black shadow-lg">
            <video
              ref={video}
              controls
              playsInline
              preload="metadata"
              aria-label={lecture.title}
              onPause={() => void heartbeat()}
              onSeeked={() => void heartbeat()}
              onEnded={() => void heartbeat()}
              className="w-full aspect-video m-0"
            >
              {captions && <track kind="captions" srcLang="en" label="English" src={captions} />}
            </video>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-4 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 m-0">
              Playback speed
              <select
                value={speed}
                onChange={event => setSpeed(Number(event.target.value))}
                className="w-24 text-xs font-semibold py-1 px-2 border-slate-200 dark:border-slate-600 rounded-lg"
              >
                {[.5, 1, 1.25, 1.5, 2].map(value => <option value={value} key={value}>{value}×</option>)}
              </select>
            </label>

            {progress && (
              <p role="status" className="m-0 text-xs font-bold text-indigo-800 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-700 px-3 py-1 rounded-md">
                {progress.completed ? 'Completed' : `${progress.progress_percent}% watched`}
              </p>
            )}
          </div>

          {error && (
            <p role="alert">
              {error} <button onClick={() => setReload(value => value + 1)} className="secondary text-xs ml-2 py-1 px-2">Reconnect</button>
            </p>
          )}
        </div>
      )}

      {/* Resources Section */}
      {!!lecture.resources.length && (
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">Resources</h3>
          <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
            {lecture.resources.map(asset => (
              <li key={asset.id}>
                <button
                  onClick={() => void download(asset.id)}
                  className="secondary text-xs font-semibold py-1.5 px-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-700 border-slate-300 dark:border-slate-600"
                >
                  Download {asset.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {downloadError && <p role="alert">{downloadError}</p>}

      {/* Notes & Bookmarks */}
      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ActionForm label="Save note" onSubmit={data => annotation('notes', { content: data.get('content') })}>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Note at current time
              <textarea name="content" required maxLength={12000} rows={2} placeholder="Take note tied to current video timestamp…" className="mt-1" />
            </label>
          </ActionForm>

          <div className="flex flex-col justify-end">
            <ActionForm label="Bookmark current time" onSubmit={() => annotation('bookmarks', {})}>
              {null}
            </ActionForm>
          </div>
        </div>

        {notes.error && <p role="alert">{notes.error}</p>}
        {bookmarks.error && <p role="alert">{bookmarks.error}</p>}

        {/* Saved Annotations List */}
        <div>
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-2">Saved Moments & Notes</span>
          <ul className="space-y-2 list-none p-0 m-0">
            {[...notes.data?.items ?? [], ...bookmarks.data?.items ?? []]
              .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
              .map(item => (
                <li key={item.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                  <button
                    type="button"
                    onClick={() => { if (video.current) video.current.currentTime = item.timestamp_seconds }}
                    className="secondary text-[11px] font-mono py-0.5 px-2 bg-indigo-50 dark:bg-indigo-950 border-indigo-200 dark:border-indigo-700 text-indigo-800 dark:text-indigo-200 font-bold"
                  >
                    {item.timestamp_seconds}s
                  </button>
                  <span className="text-slate-800 dark:text-slate-100 font-medium">{item.content ?? 'Bookmark'}</span>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </section>
  )
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

  return (
    <div className="space-y-6">
      {/* Course Banner */}
      <div className="border-b border-slate-200 dark:border-slate-700 pb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-700 uppercase">
            {current.category}
          </span>
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 capitalize">
            {current.difficulty}
          </span>
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">{current.title}</h1>
        <p className="text-slate-700 dark:text-slate-300 text-sm max-w-3xl leading-relaxed mt-2">{current.description}</p>
      </div>

      {/* Author Module Action */}
      {author && (
        <div className="p-4 rounded-xl bg-indigo-50/70 dark:bg-slate-800/80 border border-indigo-200 dark:border-slate-700">
          <ActionForm label="Add module" onSubmit={async data => {
            await api('/courses/' + current.id + '/modules', json({
              title: data.get('title'),
              order_index: Math.max(-1, ...modules.map(item => item.order_index)) + 1
            }, requestKey()))
            course.refresh()
          }}>
            <label className="text-xs font-semibold text-indigo-950 dark:text-indigo-200">
              Module title
              <input name="title" required maxLength={200} placeholder="e.g. Module 1: Foundations and Analysis" className="mt-1" />
            </label>
          </ActionForm>
        </div>
      )}

      {/* Curriculum Modules */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Curriculum</h2>
        {modules.map(module => (
          <section className="feature-section" key={module.id}>
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 mb-3">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 m-0">{module.title}</h2>
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">{module.lectures.length} lecture{module.lectures.length !== 1 ? 's' : ''}</span>
            </div>

            <ul className="space-y-2 list-none p-0 m-0 mb-4">
              {module.lectures.map(item => (
                <li key={item.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  {author ? (
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.title}</span>
                  ) : (
                    <button
                      aria-pressed={selected === item.id}
                      onClick={() => select(item.id)}
                      className={`text-sm font-semibold py-1 px-3 ${selected === item.id ? 'bg-indigo-700 text-white' : 'secondary'}`}
                    >
                      {item.title}
                    </button>
                  )}
                  <span className="text-xs text-slate-600 dark:text-slate-300 font-mono">{formatSeconds(item.duration_seconds)}</span>
                </li>
              ))}
            </ul>

            {author&&module.lectures.map(item=><details key={`index-${item.id}`} className="mb-3 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
              <summary className="text-xs font-semibold cursor-pointer">Index transcript and attached course materials · {item.title}</summary>
              <p className="text-xs text-slate-600 dark:text-slate-300">Includes this lecture’s uploaded PDFs, slides and captions. Learner notes remain private and are not indexed.</p>
              <ActionForm label="Build and publish search index" onSubmit={async data=>{
                const generation=await api<{id:string}>('/ai/lectures/'+item.id+'/ingest',json({content:data.get('content')??'',segments:[]}))
                await api('/ai/jobs/'+generation.id+'/publish',json({}))
              }}>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">Instructor transcript or notes
                  <textarea name="content" maxLength={1000000} rows={4} placeholder="Paste lecture transcript or instructor course notes…" className="mt-1" />
                </label>
              </ActionForm>
            </details>)}

            {!author&&<ModuleLearningTools moduleId={module.id} lectures={module.lectures} />}

            {author && (
              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                <ActionForm label="Upload lecture" onSubmit={async data => {
                  for (const field of ['video', 'resources', 'captions']) {
                    const files = data.getAll(field).filter(item => item instanceof File && item.size > 0)
                    data.delete(field); for (const file of files) data.append(field, file)
                  }
                  data.set('order_index', String(Math.max(-1, ...module.lectures.map(item => item.order_index)) + 1))
                  await api('/modules/' + module.id + '/lectures', { method: 'POST', headers: requestKey(), body: data })
                  course.refresh()
                }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <label className="sm:col-span-2 font-semibold text-slate-700 dark:text-slate-200">
                      Lecture title
                      <input name="title" required maxLength={200} placeholder="e.g. Asymptotic Notation" className="mt-1" />
                    </label>
                    <label className="font-semibold text-slate-700 dark:text-slate-200">
                      Video
                      <input name="video" type="file" accept=".mp4,.mov,.webm" className="mt-1" />
                    </label>
                    <label className="font-semibold text-slate-700 dark:text-slate-200">
                      English captions
                      <input name="captions" type="file" accept=".vtt" className="mt-1" />
                    </label>
                    <label className="sm:col-span-2 font-semibold text-slate-700 dark:text-slate-200">
                      Resources
                      <input name="resources" type="file" accept=".pdf,.pptx" multiple className="mt-1" />
                    </label>
                  </div>
                </ActionForm>
              </div>
            )}

            <Quizzes moduleId={module.id} author={author} />
          </section>
        ))}
      </div>

      {lecture && <Player key={lecture.id} lecture={lecture} />}

      {author ? <><AnalyticsPanel courseId={current.id} /><CourseTutor courseId={current.id} reviewer /></> : <><CourseTutor courseId={current.id} /><FlashcardReview courseId={current.id} /><PersonalizationPanel courseId={current.id} /></>}

      <Assignments courseId={current.id} author={author} />

      <CourseCommunity courseId={current.id} author={author} />
    </div>
  )
}
