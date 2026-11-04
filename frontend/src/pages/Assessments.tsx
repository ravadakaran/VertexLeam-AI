import { useState } from 'react'
import { api, json, type Page } from '../api'
import { ActionForm, localUrl, requestKey, useData } from './feature-ui'

type Criterion = { id: string; label: string; max_points: number }
type Assignment = { id: string; title: string; instructions: string; due_date: string; rubric: Criterion[] }
type Submission = { id: string; submitted_at: string; user_id: string; grade?: number; feedback?: string; revision: string }

function AssignmentItem({ assignment, author }: { assignment: Assignment; author: boolean }) {
  const path = '/assignments/' + assignment.id
  const submissions = useData<Page<Submission>>(path + '/submissions')
  const [error, setError] = useState('')
  const closed = Date.now() >= Date.parse(assignment.due_date)
  async function download(id: string) {
    setError('')
    try { window.location.assign(localUrl((await api<{ url: string }>('/submissions/' + id + '/file')).url)) }
    catch (failure) { setError(String(failure)) }
  }
  return <article className="feature-section"><h3>{assignment.title}</h3><p>{assignment.instructions}</p>
    <p>Due <time dateTime={assignment.due_date}>{new Date(assignment.due_date).toLocaleString()}</time></p>
    <ul>{assignment.rubric.map(item => <li key={item.id}>{item.label} · {item.max_points} points</li>)}</ul>
    {!author && submissions.data && !submissions.data.items.length && (closed ? <p>Submissions are closed.</p> :
      <ActionForm label="Submit assignment" onSubmit={async data => {
        await api(path + '/submit', { method: 'POST', headers: requestKey(), body: data })
        submissions.refresh()
      }}><label>PDF, ZIP, or code file<input name="file" type="file" required /></label>
        <small>Files are validated before acceptance. Submit before the displayed deadline.</small></ActionForm>)}
    {submissions.error && <p role="alert">{submissions.error}</p>}{error && <p role="alert">{error}</p>}
    {submissions.data?.items.map(submission => <div key={submission.id}>
      <p>Submitted {new Date(submission.submitted_at).toLocaleString()} · {submission.grade === undefined ? 'Awaiting grade' : `${submission.grade}%`}</p>
      {submission.feedback && <p>{submission.feedback}</p>}
      <button onClick={() => void download(submission.id)}>Download submission</button>
      {author && <ActionForm label="Save rubric grade" onSubmit={async data => {
        await api('/submissions/' + submission.id + '/grade', json({
          scores: assignment.rubric.map(item => ({ criterion_id: item.id, points: Number(data.get(item.id)) })),
          ...(data.get('feedback') ? { feedback: data.get('feedback') } : {})
        }, { 'If-Match': submission.revision }, 'PUT'))
        submissions.refresh()
      }}>
        {assignment.rubric.map(item => <label key={item.id}>{item.label} points
          <input name={item.id} type="number" min="0" max={item.max_points} step=".01" required /></label>)}
        <label>Feedback<textarea name="feedback" maxLength={12000} /></label>
      </ActionForm>}
    </div>)}
  </article>
}

export function Assignments({ courseId, author }: { courseId: string; author: boolean }) {
  const assignments = useData<Page<Assignment>>('/courses/' + courseId + '/assignments')
  const [criteria, setCriteria] = useState(1)
  return <section className="feature-section"><h2>Assignments</h2>
    {author && <ActionForm label="Create assignment" onSubmit={async data => {
      await api('/assignments', json({
        course_id: courseId, title: data.get('title'), instructions: data.get('instructions'),
        due_date: new Date(String(data.get('deadline'))).toISOString(),
        rubric: Array.from({ length: criteria }, (_, index) => ({
          id: crypto.randomUUID(), label: data.get('criterion' + index), max_points: Number(data.get('points' + index))
        }))
      }, requestKey()))
      setCriteria(1); assignments.refresh()
    }}>
      <label>Assignment title<input name="title" required maxLength={200} /></label>
      <label>Instructions<textarea name="instructions" required maxLength={12000} /></label>
      <label>Deadline (local time)<input name="deadline" type="datetime-local" required /></label>
      {Array.from({ length: criteria }, (_, index) => <fieldset key={index}><legend>Criterion {index + 1}</legend>
        <label>Label<input name={'criterion' + index} required /></label>
        <label>Maximum points<input name={'points' + index} type="number" min=".01" max="10000" step=".01" required /></label>
      </fieldset>)}
      <button type="button" className="secondary" disabled={criteria >= 50} onClick={() => setCriteria(value => value + 1)}>Add criterion</button>
    </ActionForm>}
    {assignments.error && <p role="alert">{assignments.error}</p>}
    {assignments.data?.items.map(item => <AssignmentItem key={item.id} assignment={item} author={author} />)}
  </section>
}

type QuestionType = 'mcq' | 'multi_select' | 'short_answer'
type DraftQuestion = { question_text: string; question_type: QuestionType; max_points: number; rubric?: string;
  options?: Array<{ option_text: string; is_correct: boolean }> }
type Question = Omit<DraftQuestion, 'options' | 'rubric'> & { id: string; options?: Array<{ id: string; option_text: string }> }
type Quiz = { id: string; title: string; status: string; revision: string }
type ManualReview = { question_id: string; question_text: string; text_answer?: string; rubric: string; max_points: number }
type Attempt = { id: string; status: string; revision: string; questions?: Question[];
  objective_score?: number; score?: number; review?: ManualReview[] }

function QuizEditor({ moduleId, onSaved }: { moduleId: string; onSaved: () => void }) {
  const [type, setType] = useState<QuestionType>('mcq')
  const [questions, setQuestions] = useState<DraftQuestion[]>([])
  const [optionCount, setOptionCount] = useState(2)
  return <details><summary>Author a quiz</summary>
    <ActionForm label="Add question" onSubmit={async data => {
      const options = type === 'short_answer' ? undefined : Array.from({ length: optionCount }, (_, index) => ({
        option_text: String(data.get('option' + index)), is_correct: data.has('correct' + index)
      }))
      const count = options?.filter(option => option.is_correct).length
      if (options && (type === 'mcq' ? count !== 1 : !count)) throw new Error('Mark the correct options.')
      setQuestions(current => [...current, { question_text: String(data.get('question')), question_type: type,
        max_points: Number(data.get('points')), ...(options && { options }),
        ...(type === 'short_answer' && { rubric: String(data.get('rubric')) }) }])
    }}>
      <label>Question type<select value={type} onChange={event => setType(event.target.value as QuestionType)}>
        <option value="mcq">Multiple choice</option><option value="multi_select">Multi-select</option><option value="short_answer">Short answer</option>
      </select></label>
      <label>Question<textarea name="question" required /></label>
      <label>Maximum points<input name="points" type="number" min=".01" max="10000" step=".01" required /></label>
      {type === 'short_answer' ? <label>Grading rubric<textarea name="rubric" required /></label> :
        <>{Array.from({ length: optionCount }, (_, index) => <fieldset key={index}><legend>Option {index + 1}</legend>
          <label>Option text<input name={'option' + index} required /></label>
          <label>Correct<input name={'correct' + index} type="checkbox" /></label>
        </fieldset>)}<button type="button" className="secondary" disabled={optionCount >= 20} onClick={() => setOptionCount(value => value + 1)}>Add option</button></>}
    </ActionForm>
    <ol>{questions.map((item, index) => <li key={index}>{item.question_text} <button type="button" className="secondary"
      onClick={() => setQuestions(current => current.filter((_, position) => position !== index))}>Remove</button></li>)}</ol>
    {!!questions.length && <ActionForm label="Save quiz draft" onSubmit={async data => {
      await api('/quizzes', json({ module_id: moduleId, title: data.get('title'), questions }, requestKey()))
      setQuestions([]); onSaved()
    }}><label>Quiz title<input name="title" required maxLength={200} /></label></ActionForm>}
  </details>
}

function QuizItem({ quiz, author, refresh }: { quiz: Quiz; author: boolean; refresh: () => void }) {
  const path = '/quizzes/' + quiz.id
  const attempts = useData<Page<Attempt>>(path + '/attempts')
  const [attempt, setAttempt] = useState<Attempt>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function start(existing?: string) {
    setBusy(true); setError('')
    try {
      setAttempt(existing ? await api<Attempt>('/attempts/' + existing) :
        await api<Attempt>(path + '/attempt', { method: 'POST', headers: requestKey() }))
      attempts.refresh()
    } catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  return <article className="feature-section"><h3>{quiz.title}</h3>
    {author ? <><p>{quiz.status}</p>{quiz.status === 'draft' &&
      <ActionForm label="Publish quiz" onSubmit={async () => {
        await api(path + '/review', json({ decision: 'approved' }, { ...requestKey(), 'If-Match': quiz.revision }))
        refresh()
      }}>{null}</ActionForm>}</> :
      <button disabled={busy || attempt?.status === 'in_progress'} onClick={() => void start()}>Start quiz</button>}
    {attempt?.status === 'in_progress' && <ActionForm label="Submit answers" onSubmit={async data => {
      const answers = attempt.questions!.flatMap<{ question_id: string; text_answer?: string; selected_option_ids?: string[] }>(q => {
        if (q.question_type === 'short_answer') {
          const value = String(data.get(q.id) ?? '').trim()
          return value ? [{ question_id: q.id, text_answer: value }] : []
        }
        const selected = data.getAll(q.id).map(String)
        return selected.length ? [{ question_id: q.id, selected_option_ids: selected }] : []
      })
      const result = await api<Attempt>('/attempts/' + attempt.id + '/submit', json({ answers }, requestKey()))
      setAttempt(result); attempts.refresh()
    }}>{attempt.questions?.map(q => <fieldset key={q.id}><legend>{q.question_text} ({q.max_points} points)</legend>
      {q.question_type === 'short_answer' ? <label>Answer<textarea name={q.id} maxLength={12000} /></label> :
        q.options?.map(option => <label key={option.id}>{option.option_text}
          <input type={q.question_type === 'mcq' ? 'radio' : 'checkbox'} name={q.id} value={option.id} /></label>)}
    </fieldset>)}</ActionForm>}
    {error && <p role="alert">{error}</p>}{attempts.error && <p role="alert">{attempts.error}</p>}
    {attempts.data?.items.map(row => <div key={row.id}>
      <p>{row.status.replaceAll('_', ' ')}{row.objective_score !== undefined && ` · Objective ${row.objective_score}%`}
        {row.score !== undefined && ` · Final ${row.score}%`}</p>
      {!author && row.status === 'in_progress' && attempt?.status !== 'in_progress' &&
        <button disabled={busy} onClick={() => void start(row.id)}>Resume attempt</button>}
      {author && row.review && <ActionForm label="Grade short answers" onSubmit={async data => {
        await api('/attempts/' + row.id + '/grade', json({
          scores: row.review!.map(item => ({ question_id: item.question_id, points: Number(data.get(item.question_id)) }))
        }, { 'If-Match': row.revision }, 'PUT'))
        attempts.refresh()
      }}>{row.review.map(item => <fieldset key={item.question_id}><legend>{item.question_text}</legend>
        <p>Rubric: {item.rubric}</p><p>Answer: {item.text_answer ?? 'Unanswered'}</p>
        <label>Points<input name={item.question_id} type="number" min="0" max={item.max_points} step=".01" required /></label>
      </fieldset>)}</ActionForm>}
    </div>)}
  </article>
}

export function Quizzes({ moduleId, author }: { moduleId: string; author: boolean }) {
  const quizzes = useData<Page<Quiz>>('/modules/' + moduleId + '/quizzes')
  return <section><h3>Quizzes</h3>
    {author && <QuizEditor moduleId={moduleId} onSaved={quizzes.refresh} />}
    {quizzes.error && <p role="alert">{quizzes.error}</p>}
    {quizzes.data?.items.map(quiz => <QuizItem key={quiz.id} quiz={quiz} author={author} refresh={quizzes.refresh} />)}
  </section>
}
