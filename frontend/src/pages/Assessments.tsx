import { useEffect, useState } from 'react'
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
    try {
      window.location.assign(localUrl((await api<{ url: string }>('/submissions/' + id + '/file')).url))
    } catch (failure) {
      setError(String(failure))
    }
  }

  return (
    <article className="feature-section space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 flex-wrap gap-2">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 m-0">{assignment.title}</h3>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
          Due <time dateTime={assignment.due_date}>{new Date(assignment.due_date).toLocaleString()}</time>
        </span>
      </div>

      <p className="text-sm text-slate-700 dark:text-slate-200 m-0 leading-relaxed">{assignment.instructions}</p>

      {/* Rubric Breakdown */}
      <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider block mb-2">Grading Rubric</span>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 list-none p-0 m-0">
          {assignment.rubric.map(item => (
            <li key={item.id} className="text-xs px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-medium flex justify-between">
              <span>{item.label}</span>
              <span className="font-bold text-indigo-700 dark:text-indigo-300">{item.max_points} pts</span>
            </li>
          ))}
        </ul>
      </div>

      {!author && submissions.data && !submissions.data.items.length && (
        closed ? (
          <p className="text-xs font-semibold text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950 p-2.5 rounded-lg border border-rose-200 dark:border-rose-700">Submissions are closed.</p>
        ) : (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
            <ActionForm label="Submit assignment" onSubmit={async data => {
              await api(path + '/submit', { method: 'POST', headers: requestKey(), body: data })
              submissions.refresh()
            }}>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                PDF, ZIP, or code file
                <input name="file" type="file" required className="mt-1" />
              </label>
              <small className="text-xs text-slate-600 dark:text-slate-300 block">Files are validated before acceptance. Submit before the displayed deadline.</small>
            </ActionForm>
          </div>
        )
      )}

      {submissions.error && <p role="alert">{submissions.error}</p>}
      {error && <p role="alert">{error}</p>}

      {/* Submissions List */}
      {submissions.data?.items.map(submission => (
        <div key={submission.id} className="mt-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs text-slate-700 dark:text-slate-200">
              Submitted {new Date(submission.submitted_at).toLocaleString()} · {submission.grade === undefined ? (
                <span className="font-bold text-amber-800 dark:text-amber-300">Awaiting grade</span>
              ) : (
                <span className="font-bold text-emerald-700 dark:text-emerald-300">{submission.grade}%</span>
              )}
            </span>
            <button onClick={() => void download(submission.id)} className="secondary text-xs py-1 px-3">
              Download submission
            </button>
          </div>

          {submission.feedback && (
            <p className="text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 m-0">
              <span className="font-bold text-slate-900 dark:text-slate-100 block mb-1">Feedback:</span>
              {submission.feedback}
            </p>
          )}

          {author && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
              <ActionForm label="Save rubric grade" onSubmit={async data => {
                await api('/submissions/' + submission.id + '/grade', json({
                  scores: assignment.rubric.map(item => ({ criterion_id: item.id, points: Number(data.get(item.id)) })),
                  ...(data.get('feedback') ? { feedback: data.get('feedback') } : {})
                }, { 'If-Match': submission.revision }, 'PUT'))
                submissions.refresh()
              }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2 text-xs">
                  {assignment.rubric.map(item => (
                    <label key={item.id} className="font-semibold text-slate-700 dark:text-slate-200">
                      {item.label} points
                      <input name={item.id} type="number" min="0" max={item.max_points} step=".01" required className="mt-1" />
                    </label>
                  ))}
                </div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Feedback
                  <textarea name="feedback" maxLength={12000} rows={2} className="mt-1" />
                </label>
              </ActionForm>
            </div>
          )}
        </div>
      ))}
    </article>
  )
}

export function Assignments({ courseId, author }: { courseId: string; author: boolean }) {
  const assignments = useData<Page<Assignment>>('/courses/' + courseId + '/assignments')
  const [criteria, setCriteria] = useState(1)

  return (
    <section className="feature-section space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 m-0">Assignments</h2>
        <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">Course deliverables</span>
      </div>

      {author && (
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-3">Create New Assignment</h3>
          <ActionForm label="Create assignment" onSubmit={async data => {
            await api('/assignments', json({
              course_id: courseId,
              title: data.get('title'),
              instructions: data.get('instructions'),
              due_date: new Date(String(data.get('deadline'))).toISOString(),
              rubric: Array.from({ length: criteria }, (_, index) => ({
                id: crypto.randomUUID(),
                label: data.get('criterion' + index),
                max_points: Number(data.get('points' + index))
              }))
            }, requestKey()))
            setCriteria(1); assignments.refresh()
          }}>
            <div className="space-y-3">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Assignment title
                <input name="title" required maxLength={200} placeholder="e.g. Graph Algorithms Project" className="mt-1" />
              </label>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Instructions
                <textarea name="instructions" required maxLength={12000} rows={3} placeholder="Submission guidelines and deliverables…" className="mt-1" />
              </label>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Deadline (local time)
                <input name="deadline" type="datetime-local" required className="mt-1" />
              </label>

              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Rubric Criteria:</span>
                {Array.from({ length: criteria }, (_, index) => (
                  <fieldset key={index} className="m-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                    <legend className="text-xs font-bold text-slate-700 dark:text-slate-200 px-2 bg-slate-100 dark:bg-slate-800 rounded">Criterion {index + 1}</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <label className="font-semibold text-slate-700 dark:text-slate-200">
                        Label
                        <input name={'criterion' + index} required placeholder="Criterion name" className="mt-1" />
                      </label>
                      <label className="font-semibold text-slate-700 dark:text-slate-200">
                        Maximum points
                        <input name={'points' + index} type="number" min=".01" max="10000" step=".01" required placeholder="10" className="mt-1" />
                      </label>
                    </div>
                  </fieldset>
                ))}
              </div>

              <button
                type="button"
                className="secondary text-xs py-1.5 px-3"
                disabled={criteria >= 50}
                onClick={() => setCriteria(value => value + 1)}
              >
                + Add criterion
              </button>
            </div>
          </ActionForm>
        </div>
      )}

      {assignments.error && <p role="alert">{assignments.error}</p>}
      {assignments.data?.items.map(item => <AssignmentItem key={item.id} assignment={item} author={author} />)}
    </section>
  )
}

type QuestionType = 'mcq' | 'multi_select' | 'short_answer'
type DraftQuestion = {
  question_text: string; question_type: QuestionType; max_points: number; rubric?: string;
  topic_id?: string;
  options?: Array<{ option_text: string; is_correct: boolean }>
}
type Question = Omit<DraftQuestion, 'options' | 'rubric'> & { id: string; options?: Array<{ id: string; option_text: string }> }
type Quiz = { id: string; title: string; status: string; revision: string; is_ai_generated?: boolean }
type ManualReview = { question_id: string; question_text: string; text_answer?: string; rubric: string; max_points: number }
type Attempt = {
  id: string; status: string; revision: string; questions?: Question[];
  objective_score?: number; score?: number; review?: ManualReview[]
}

function QuizEditor({ moduleId, onSaved }: { moduleId: string; onSaved: () => void }) {
  const topics=useData<{items:Array<{id:string;name:string}>}>('/modules/'+moduleId+'/topics')
  useEffect(()=>{const refresh=()=>topics.refresh();window.addEventListener('topics-updated',refresh);return()=>window.removeEventListener('topics-updated',refresh)},[moduleId])
  const [type, setType] = useState<QuestionType>('mcq')
  const [questions, setQuestions] = useState<DraftQuestion[]>([])
  const [optionCount, setOptionCount] = useState(2)

  return (
    <details className="mt-3 p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
      <summary className="font-bold text-sm text-indigo-800 dark:text-indigo-200 cursor-pointer select-none">
        Author a quiz
      </summary>

      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-4">
        <ActionForm label="Add question" onSubmit={async data => {
          const options = type === 'short_answer' ? undefined : Array.from({ length: optionCount }, (_, index) => ({
            option_text: String(data.get('option' + index)), is_correct: data.has('correct' + index)
          }))
          const count = options?.filter(option => option.is_correct).length
          if (options && (type === 'mcq' ? count !== 1 : !count)) throw new Error('Mark the correct options.')
          setQuestions(current => [...current, {
            question_text: String(data.get('question')),
            question_type: type,
            max_points: Number(data.get('points')),
            ...(data.get('topic_id')&&{topic_id:String(data.get('topic_id'))}),
            ...(options && { options }),
            ...(type === 'short_answer' && { rubric: String(data.get('rubric')) })
          }])
        }}>
          <div className="space-y-3 text-xs">
            <label className="font-semibold text-slate-700 dark:text-slate-200">
              Question type
              <select value={type} onChange={event => setType(event.target.value as QuestionType)} className="mt-1">
                <option value="mcq">Multiple choice</option>
                <option value="multi_select">Multi-select</option>
                <option value="short_answer">Short answer</option>
              </select>
            </label>
            <label className="font-semibold text-slate-700 dark:text-slate-200">
              Question
              <textarea name="question" required rows={2} placeholder="Enter problem statement…" className="mt-1" />
            </label>
            <label className="font-semibold text-slate-700 dark:text-slate-200">Learning topic<select name="topic_id" defaultValue="" className="mt-1"><option value="">No topic mapping</option>{topics.data?.items.map(topic=><option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
            <label className="font-semibold text-slate-700 dark:text-slate-200">
              Maximum points
              <input name="points" type="number" min=".01" max="10000" step=".01" required placeholder="10" className="mt-1" />
            </label>

            {type === 'short_answer' ? (
              <label className="font-semibold text-slate-700 dark:text-slate-200">
                Grading rubric
                <textarea name="rubric" required rows={2} placeholder="Rubric guidance for manual evaluation…" className="mt-1" />
              </label>
            ) : (
              <div className="space-y-2">
                <span className="font-bold text-slate-700 dark:text-slate-200 block">Options:</span>
                {Array.from({ length: optionCount }, (_, index) => (
                  <fieldset key={index} className="m-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5">
                    <legend className="text-xs font-bold text-slate-700 dark:text-slate-200 px-2 bg-slate-50 dark:bg-slate-800 rounded">Option {index + 1}</legend>
                    <div className="flex items-center gap-3">
                      <label className="flex-1 font-medium text-slate-700 dark:text-slate-200 m-0">
                        Option text
                        <input name={'option' + index} required className="mt-1" />
                      </label>
                      <label className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200 m-0 pt-5">
                        <input name={'correct' + index} type="checkbox" />
                        Correct
                      </label>
                    </div>
                  </fieldset>
                ))}
                <button
                  type="button"
                  className="secondary text-xs py-1 px-2.5"
                  disabled={optionCount >= 20}
                  onClick={() => setOptionCount(value => value + 1)}
                >
                  + Add option
                </button>
              </div>
            )}
          </div>
        </ActionForm>

        {questions.length > 0 && (
          <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block mb-2">Drafted Questions ({questions.length}):</span>
            <ol className="space-y-2 list-decimal pl-4 m-0 text-xs text-slate-800 dark:text-slate-100">
              {questions.map((item, index) => (
                <li key={index} className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <span>{item.question_text} ({item.max_points} pts){item.topic_id&&<small className="block text-slate-600 dark:text-slate-300">Mapped to {topics.data?.items.find(topic=>topic.id===item.topic_id)?.name??'topic'}</small>}</span>
                    <button
                      type="button"
                      className="secondary text-[11px] py-0.5 px-2 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950"
                      onClick={() => setQuestions(current => current.filter((_, position) => position !== index))}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {!!questions.length && (
          <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
            <ActionForm label="Save quiz draft" onSubmit={async data => {
              await api('/quizzes', json({ module_id: moduleId, title: data.get('title'), questions }, requestKey()))
              setQuestions([]); onSaved()
            }}>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Quiz title
                <input name="title" required maxLength={200} placeholder="e.g. Module 1 Knowledge Check" className="mt-1" />
              </label>
            </ActionForm>
          </div>
        )}
      </div>
    </details>
  )
}

function QuizItem({ quiz, author, refresh }: { quiz: Quiz; author: boolean; refresh: () => void }) {
  const path = '/quizzes/' + quiz.id
  const attempts = useData<Page<Attempt>>(path + '/attempts')
  const [attempt, setAttempt] = useState<Attempt>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [review,setReview]=useState<{questions:Array<{question_text:string;question_type:string;rubric?:string;source_chunks?:string[];options?:Array<{option_text:string;is_correct:boolean}>}>}>()

  async function start(existing?: string) {
    setBusy(true); setError('')
    try {
      setAttempt(existing ? await api<Attempt>('/attempts/' + existing) :
        await api<Attempt>(path + '/attempt', { method: 'POST', headers: requestKey() }))
      attempts.refresh()
    } catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }

  return (
    <article className="mt-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 m-0">{quiz.title}</h3>
        {author ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 capitalize">
              {quiz.status}
            </span>
            {quiz.status === 'draft' && (
              <div className="flex items-center gap-2">
                <ActionForm label="Publish quiz" onSubmit={async () => {
                  await api(path + '/review', json({ decision: 'approved' }, { ...requestKey(), 'If-Match': quiz.revision }))
                  refresh()
                }}>
                  {null}
                </ActionForm>
                <button type="button" className="secondary text-xs py-1.5 px-3" onClick={async()=>{setError('');try{setReview(await api(path+'/review'))}catch(e){setError(String(e))}}}>Review draft</button>
              </div>
            )}
          </div>
        ) : (
          <button
            disabled={busy || attempt?.status === 'in_progress'}
            onClick={() => void start()}
            className="text-xs font-semibold py-1.5 px-3"
          >
            Start quiz
          </button>
        )}
      </div>

      {author&&quiz.status==='draft'&&review&&<div className="p-3 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 rounded-lg space-y-2">
        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{quiz.is_ai_generated?'AI generated questions':'Draft questions'}</h4>
        {review.questions.map((q,index)=><div key={index} className="p-2 bg-slate-50 dark:bg-slate-800 rounded text-xs"><strong>{index+1}. {q.question_text}</strong><span className="ml-2 text-slate-600 dark:text-slate-300">{q.question_type}</span>
          {q.options?.map((option,i)=><div key={i} className={option.is_correct?'text-emerald-700 dark:text-emerald-300 font-semibold':'text-slate-700 dark:text-slate-200'}>{option.is_correct?'✓ ':'· '}{option.option_text}</div>)}
          {q.rubric&&<p className="m-0 text-slate-700 dark:text-slate-200">Rubric: {q.rubric}</p>}
          {!!q.source_chunks?.length&&<p className="m-0 text-slate-600 dark:text-slate-300">Transcript evidence: {q.source_chunks.length} source chunk(s)</p>}
        </div>)}
        <div className="flex gap-2">{(['approved','rejected'] as const).map(decision=><button key={decision} type="button" className="secondary text-xs py-1.5 px-3" onClick={async()=>{setBusy(true);setError('');try{await api(path+'/review',json({decision},{...requestKey(),'If-Match':quiz.revision}));setReview(undefined);refresh()}catch(e){setError(String(e))}finally{setBusy(false)}}} disabled={busy}>{decision==='approved'?'Approve and publish':'Reject draft'}</button>)}</div>
      </div>}

      {attempt?.status === 'in_progress' && (
        <div className="mt-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 shadow-xs space-y-4">
          <ActionForm label="Submit answers" onSubmit={async data => {
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
          }}>
            <div className="space-y-4">
              {attempt.questions?.map(q => (
                <fieldset key={q.id} className="m-0 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                  <legend className="text-xs font-bold text-slate-800 dark:text-slate-100 px-2 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded">
                    {q.question_text} ({q.max_points} points)
                  </legend>
                  {q.question_type === 'short_answer' ? (
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-2">
                      Answer
                      <textarea name={q.id} maxLength={12000} rows={3} placeholder="Write your response…" className="mt-1" />
                    </label>
                  ) : (
                    <div className="space-y-2 mt-2">
                      {q.options?.map(option => (
                        <label key={option.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                          <input
                            type={q.question_type === 'mcq' ? 'radio' : 'checkbox'}
                            name={q.id}
                            value={option.id}
                          />
                          {option.option_text}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              ))}
            </div>
          </ActionForm>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
      {attempts.error && <p role="alert">{attempts.error}</p>}

      {/* Attempts History */}
      {attempts.data?.items.map(row => (
        <div key={row.id} className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-700 dark:text-slate-200 capitalize">
              {row.status.replaceAll('_', ' ')}
              {row.objective_score !== undefined && ` · Objective ${row.objective_score}%`}
              {row.score !== undefined && ` · Final ${row.score}%`}
            </span>
            {!author && row.status === 'in_progress' && attempt?.status !== 'in_progress' && (
              <button disabled={busy} onClick={() => void start(row.id)} className="secondary text-xs py-1 px-2.5">
                Resume attempt
              </button>
            )}
          </div>

          {author && row.review && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
              <ActionForm label="Grade short answers" onSubmit={async data => {
                await api('/attempts/' + row.id + '/grade', json({
                  scores: row.review!.map(item => ({ question_id: item.question_id, points: Number(data.get(item.question_id)) }))
                }, { 'If-Match': row.revision }, 'PUT'))
                attempts.refresh()
              }}>
                {row.review.map(item => (
                  <fieldset key={item.question_id} className="m-0 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2.5 mb-2">
                    <legend className="text-xs font-bold text-slate-700 dark:text-slate-200">{item.question_text}</legend>
                    <p className="text-slate-600 dark:text-slate-300 m-0 mb-1">Rubric: {item.rubric}</p>
                    <p className="text-slate-800 dark:text-slate-100 m-0 mb-2 font-medium">Answer: {item.text_answer ?? 'Unanswered'}</p>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      Points
                      <input name={item.question_id} type="number" min="0" max={item.max_points} step=".01" required className="mt-1" />
                    </label>
                  </fieldset>
                ))}
              </ActionForm>
            </div>
          )}
        </div>
      ))}
    </article>
  )
}

export function Quizzes({ moduleId, author }: { moduleId: string; author: boolean }) {
  const quizzes = useData<Page<Quiz>>('/modules/' + moduleId + '/quizzes')
  const [draftError,setDraftError]=useState('')
  const [generating,setGenerating]=useState(false)
  async function generateDraft(){
    setGenerating(true);setDraftError('')
    try{await api('/ai/modules/'+moduleId+'/quiz-draft',json({},requestKey()));quizzes.refresh()}
    catch(error){setDraftError(String(error))}finally{setGenerating(false)}
  }

  return (
    <section className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">Quizzes</h3>
        {author&&<button type="button" disabled={generating} onClick={()=>void generateDraft()} className="secondary text-xs py-1.5 px-3">{generating?'Generating…':'Generate AI draft'}</button>}
      </div>
      {draftError&&<p role="alert">{draftError}</p>}
      {author && <QuizEditor moduleId={moduleId} onSaved={quizzes.refresh} />}
      {quizzes.error && <p role="alert">{quizzes.error}</p>}
      {quizzes.data?.items.map(quiz => (
        <QuizItem key={quiz.id} quiz={quiz} author={author} refresh={quizzes.refresh} />
      ))}
    </section>
  )
}
