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
    try {
      window.location.assign(localUrl((await api<{ url: string }>('/submissions/' + id + '/file')).url))
    } catch (failure) {
      setError(String(failure))
    }
  }

  return (
    <article className="feature-section space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
        <h3 className="text-lg font-bold text-slate-900 m-0">{assignment.title}</h3>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
          Due <time dateTime={assignment.due_date}>{new Date(assignment.due_date).toLocaleString()}</time>
        </span>
      </div>

      <p className="text-sm text-slate-600 m-0 leading-relaxed">{assignment.instructions}</p>

      {/* Rubric Breakdown */}
      <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-2">Grading Rubric</span>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 list-none p-0 m-0">
          {assignment.rubric.map(item => (
            <li key={item.id} className="text-xs px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-slate-700 font-medium flex justify-between">
              <span>{item.label}</span>
              <span className="font-bold text-indigo-600">{item.max_points} pts</span>
            </li>
          ))}
        </ul>
      </div>

      {!author && submissions.data && !submissions.data.items.length && (
        closed ? (
          <p className="text-xs font-semibold text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200">Submissions are closed.</p>
        ) : (
          <div className="pt-2 border-t border-slate-100">
            <ActionForm label="Submit assignment" onSubmit={async data => {
              await api(path + '/submit', { method: 'POST', headers: requestKey(), body: data })
              submissions.refresh()
            }}>
              <label className="text-xs font-semibold text-slate-700">
                PDF, ZIP, or code file
                <input name="file" type="file" required className="mt-1" />
              </label>
              <small className="text-xs text-slate-500 block">Files are validated before acceptance. Submit before the displayed deadline.</small>
            </ActionForm>
          </div>
        )
      )}

      {submissions.error && <p role="alert">{submissions.error}</p>}
      {error && <p role="alert">{error}</p>}

      {/* Submissions List */}
      {submissions.data?.items.map(submission => (
        <div key={submission.id} className="mt-3 p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs text-slate-500">
              Submitted {new Date(submission.submitted_at).toLocaleString()} · {submission.grade === undefined ? (
                <span className="font-bold text-amber-600">Awaiting grade</span>
              ) : (
                <span className="font-bold text-emerald-600">{submission.grade}%</span>
              )}
            </span>
            <button onClick={() => void download(submission.id)} className="secondary text-xs py-1 px-3">
              Download submission
            </button>
          </div>

          {submission.feedback && (
            <p className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200 m-0">
              <span className="font-bold text-slate-900 block mb-1">Feedback:</span>
              {submission.feedback}
            </p>
          )}

          {author && (
            <div className="pt-3 border-t border-slate-200">
              <ActionForm label="Save rubric grade" onSubmit={async data => {
                await api('/submissions/' + submission.id + '/grade', json({
                  scores: assignment.rubric.map(item => ({ criterion_id: item.id, points: Number(data.get(item.id)) })),
                  ...(data.get('feedback') ? { feedback: data.get('feedback') } : {})
                }, { 'If-Match': submission.revision }, 'PUT'))
                submissions.refresh()
              }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2 text-xs">
                  {assignment.rubric.map(item => (
                    <label key={item.id} className="font-semibold text-slate-700">
                      {item.label} points
                      <input name={item.id} type="number" min="0" max={item.max_points} step=".01" required className="mt-1" />
                    </label>
                  ))}
                </div>
                <label className="text-xs font-semibold text-slate-700">
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
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h2 className="text-xl font-bold text-slate-900 m-0">Assignments</h2>
        <span className="text-xs text-slate-400 font-medium">Course deliverables</span>
      </div>

      {author && (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Create New Assignment</h3>
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
              <label className="text-xs font-semibold text-slate-700">
                Assignment title
                <input name="title" required maxLength={200} placeholder="e.g. Graph Algorithms Project" className="mt-1" />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Instructions
                <textarea name="instructions" required maxLength={12000} rows={3} placeholder="Submission guidelines and deliverables…" className="mt-1" />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Deadline (local time)
                <input name="deadline" type="datetime-local" required className="mt-1" />
              </label>

              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-600 block">Rubric Criteria:</span>
                {Array.from({ length: criteria }, (_, index) => (
                  <fieldset key={index} className="m-0 bg-white border border-slate-200 rounded-lg p-3">
                    <legend className="text-xs font-bold text-slate-700 px-2 bg-slate-100 rounded">Criterion {index + 1}</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <label className="font-semibold text-slate-700">
                        Label
                        <input name={'criterion' + index} required placeholder="Criterion name" className="mt-1" />
                      </label>
                      <label className="font-semibold text-slate-700">
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
  options?: Array<{ option_text: string; is_correct: boolean }>
}
type Question = Omit<DraftQuestion, 'options' | 'rubric'> & { id: string; options?: Array<{ id: string; option_text: string }> }
type Quiz = { id: string; title: string; status: string; revision: string }
type ManualReview = { question_id: string; question_text: string; text_answer?: string; rubric: string; max_points: number }
type Attempt = {
  id: string; status: string; revision: string; questions?: Question[];
  objective_score?: number; score?: number; review?: ManualReview[]
}

function QuizEditor({ moduleId, onSaved }: { moduleId: string; onSaved: () => void }) {
  const [type, setType] = useState<QuestionType>('mcq')
  const [questions, setQuestions] = useState<DraftQuestion[]>([])
  const [optionCount, setOptionCount] = useState(2)

  return (
    <details className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
      <summary className="font-bold text-sm text-indigo-700 cursor-pointer select-none">
        Author a quiz
      </summary>

      <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
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
            ...(options && { options }),
            ...(type === 'short_answer' && { rubric: String(data.get('rubric')) })
          }])
        }}>
          <div className="space-y-3 text-xs">
            <label className="font-semibold text-slate-700">
              Question type
              <select value={type} onChange={event => setType(event.target.value as QuestionType)} className="mt-1">
                <option value="mcq">Multiple choice</option>
                <option value="multi_select">Multi-select</option>
                <option value="short_answer">Short answer</option>
              </select>
            </label>
            <label className="font-semibold text-slate-700">
              Question
              <textarea name="question" required rows={2} placeholder="Enter problem statement…" className="mt-1" />
            </label>
            <label className="font-semibold text-slate-700">
              Maximum points
              <input name="points" type="number" min=".01" max="10000" step=".01" required placeholder="10" className="mt-1" />
            </label>

            {type === 'short_answer' ? (
              <label className="font-semibold text-slate-700">
                Grading rubric
                <textarea name="rubric" required rows={2} placeholder="Rubric guidance for manual evaluation…" className="mt-1" />
              </label>
            ) : (
              <div className="space-y-2">
                <span className="font-bold text-slate-700 block">Options:</span>
                {Array.from({ length: optionCount }, (_, index) => (
                  <fieldset key={index} className="m-0 bg-white border border-slate-200 rounded-lg p-2.5">
                    <legend className="text-xs font-bold text-slate-600 px-2 bg-slate-50 rounded">Option {index + 1}</legend>
                    <div className="flex items-center gap-3">
                      <label className="flex-1 font-medium text-slate-700 m-0">
                        Option text
                        <input name={'option' + index} required className="mt-1" />
                      </label>
                      <label className="flex items-center gap-1.5 font-bold text-slate-700 m-0 pt-5">
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
          <div className="pt-3 border-t border-slate-200">
            <span className="text-xs font-bold text-slate-600 block mb-2">Drafted Questions ({questions.length}):</span>
            <ol className="space-y-2 list-decimal pl-4 m-0 text-xs text-slate-800">
              {questions.map((item, index) => (
                <li key={index} className="p-2 rounded bg-white border border-slate-200">
                  <div className="flex items-center justify-between">
                    <span>{item.question_text} ({item.max_points} pts)</span>
                    <button
                      type="button"
                      className="secondary text-[11px] py-0.5 px-2 text-rose-600 border-rose-200 hover:bg-rose-50"
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
          <div className="pt-3 border-t border-slate-200">
            <ActionForm label="Save quiz draft" onSubmit={async data => {
              await api('/quizzes', json({ module_id: moduleId, title: data.get('title'), questions }, requestKey()))
              setQuestions([]); onSaved()
            }}>
              <label className="text-xs font-semibold text-slate-700">
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
    <article className="mt-3 p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-bold text-slate-900 m-0">{quiz.title}</h3>
        {author ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 capitalize">
              {quiz.status}
            </span>
            {quiz.status === 'draft' && (
              <ActionForm label="Publish quiz" onSubmit={async () => {
                await api(path + '/review', json({ decision: 'approved' }, { ...requestKey(), 'If-Match': quiz.revision }))
                refresh()
              }}>
                {null}
              </ActionForm>
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

      {attempt?.status === 'in_progress' && (
        <div className="mt-4 p-4 rounded-xl bg-white border border-indigo-200 shadow-xs space-y-4">
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
                <fieldset key={q.id} className="m-0 bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <legend className="text-xs font-bold text-slate-800 px-2 py-0.5 bg-white border border-slate-200 rounded">
                    {q.question_text} ({q.max_points} points)
                  </legend>
                  {q.question_type === 'short_answer' ? (
                    <label className="text-xs font-semibold text-slate-700 mt-2">
                      Answer
                      <textarea name={q.id} maxLength={12000} rows={3} placeholder="Write your response…" className="mt-1" />
                    </label>
                  ) : (
                    <div className="space-y-2 mt-2">
                      {q.options?.map(option => (
                        <label key={option.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer">
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
        <div key={row.id} className="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-700 capitalize">
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
            <div className="pt-2 border-t border-slate-100">
              <ActionForm label="Grade short answers" onSubmit={async data => {
                await api('/attempts/' + row.id + '/grade', json({
                  scores: row.review!.map(item => ({ question_id: item.question_id, points: Number(data.get(item.question_id)) }))
                }, { 'If-Match': row.revision }, 'PUT'))
                attempts.refresh()
              }}>
                {row.review.map(item => (
                  <fieldset key={item.question_id} className="m-0 bg-slate-50 border border-slate-200 rounded p-2.5 mb-2">
                    <legend className="text-xs font-bold text-slate-700">{item.question_text}</legend>
                    <p className="text-slate-500 m-0 mb-1">Rubric: {item.rubric}</p>
                    <p className="text-slate-800 m-0 mb-2 font-medium">Answer: {item.text_answer ?? 'Unanswered'}</p>
                    <label className="text-xs font-semibold text-slate-700">
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

  return (
    <section className="mt-4 pt-3 border-t border-slate-100">
      <h3 className="text-sm font-bold text-slate-800 mb-2">Quizzes</h3>
      {author && <QuizEditor moduleId={moduleId} onSaved={quizzes.refresh} />}
      {quizzes.error && <p role="alert">{quizzes.error}</p>}
      {quizzes.data?.items.map(quiz => (
        <QuizItem key={quiz.id} quiz={quiz} author={author} refresh={quizzes.refresh} />
      ))}
    </section>
  )
}
