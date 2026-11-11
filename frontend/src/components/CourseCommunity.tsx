import { useState } from 'react'
import { api, json, type Page } from '../api'
import { ActionForm, requestKey, useData } from '../pages/feature-ui'
import { useT } from '../utils/i18n'

type LeaderEntry = {
  display_name: string
  rank: number
  score: number
}

type AnnouncementItem = {
  id: string
  course_id: string
  content: string
  created_at: string
}

type ThreadItem = {
  id: string
  course_id: string
  title: string
  created_at: string
}

type PostItem = {
  id: string
  thread_id: string
  parent_id?: string
  content: string
  visibility: string
  created_at: string
  revision: string
}

function ThreadPosts({ threadId, author }: { threadId: string; author: boolean }) {
  const t = useT()
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const posts = useData<Page<PostItem>>('/threads/' + threadId + '/posts?limit=50')

  async function moderate(post: PostItem, decision: 'hide' | 'restore' | 'dismiss') {
    setBusyId(post.id)
    setError('')
    try {
      await api(
        '/posts/' + post.id + '/moderation',
        json(
          { decision, reason: `Moderator decision: ${decision}` },
          { 'If-Match': post.revision },
          'PUT'
        )
      )
      posts.refresh()
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusyId('')
    }
  }

  const items = posts.data?.items ?? []
  const byId = new Map(items.map(item => [item.id, item]))

  return (
    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-3">
      {posts.error && <p role="alert">{posts.error}</p>}
      {error && <p role="alert">{error}</p>}

      <ul className="space-y-2.5 list-none p-0 m-0">
        {items.map(post => {
          const parent = post.parent_id ? byId.get(post.parent_id) : undefined
          const isHidden = post.visibility === 'hidden'
          return (
            <li
              key={post.id}
              className={`p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2 ${
                post.parent_id ? 'ml-4 sm:ml-6 border-l-4 border-l-indigo-500 dark:border-l-indigo-400' : ''
              }`}
            >
              {parent && (
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Replying to: {parent.content.slice(0, 80)}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] text-slate-600 dark:text-slate-300">
                  {new Date(post.created_at).toLocaleString()}
                </span>
                {isHidden && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                    {t('community.hiddenNotice')}
                  </span>
                )}
              </div>

              <p className="text-sm text-slate-800 dark:text-slate-100 m-0 whitespace-pre-wrap">
                {post.content}
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  className="secondary text-xs py-1 px-2.5"
                  onClick={() => setReplyingTo(current => (current === post.id ? null : post.id))}
                >
                  {t('community.reply')}
                </button>

                <button
                  type="button"
                  className="secondary text-xs py-1 px-2.5"
                  onClick={() => setReportingId(current => (current === post.id ? null : post.id))}
                >
                  {t('community.report')}
                </button>

                {author && (
                  <>
                    {post.visibility === 'visible' ? (
                      <button
                        type="button"
                        disabled={busyId === post.id}
                        className="secondary text-xs py-1 px-2.5"
                        onClick={() => void moderate(post, 'hide')}
                      >
                        {t('community.hide')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === post.id}
                        className="secondary text-xs py-1 px-2.5"
                        onClick={() => void moderate(post, 'restore')}
                      >
                        {t('community.restore')}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === post.id}
                      className="secondary text-xs py-1 px-2.5"
                      onClick={() => void moderate(post, 'dismiss')}
                    >
                      {t('community.dismiss')}
                    </button>
                  </>
                )}
              </div>

              {replyingTo === post.id && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                  <ActionForm
                    label="Post reply"
                    onSubmit={async data => {
                      await api(
                        '/threads/' + threadId + '/posts',
                        json({ content: data.get('content'), parent_id: post.id }, requestKey())
                      )
                      setReplyingTo(null)
                      posts.refresh()
                    }}
                  >
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      Reply message
                      <textarea name="content" required maxLength={12000} rows={2} className="mt-1" />
                    </label>
                  </ActionForm>
                </div>
              )}

              {reportingId === post.id && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                  <ActionForm
                    label="Submit report"
                    onSubmit={async data => {
                      await api(
                        '/posts/' + post.id + '/report',
                        json({ reason: data.get('reason') }, requestKey())
                      )
                      setReportingId(null)
                      posts.refresh()
                    }}
                  >
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      Report reason
                      <input
                        name="reason"
                        required
                        maxLength={12000}
                        placeholder="Describe policy concern…"
                        className="mt-1"
                      />
                    </label>
                  </ActionForm>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
        <ActionForm
          label="Reply to thread"
          onSubmit={async data => {
            await api(
              '/threads/' + threadId + '/posts',
              json({ content: data.get('content') }, requestKey())
            )
            posts.refresh()
          }}
        >
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            New reply
            <textarea name="content" required maxLength={12000} rows={2} className="mt-1" />
          </label>
        </ActionForm>
      </div>
    </div>
  )
}

function ThreadView({ thread, author }: { thread: ThreadItem; author: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <article className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 m-0">{thread.title}</h3>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            Started {new Date(thread.created_at).toLocaleString()}
          </span>
        </div>
        <button
          type="button"
          className="secondary text-xs py-1.5 px-3"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          {open ? 'Collapse thread' : 'Open thread'}
        </button>
      </div>

      {open && <ThreadPosts threadId={thread.id} author={author} />}
    </article>
  )
}

export function CourseCommunity({ courseId, author }: { courseId: string; author: boolean }) {
  const t = useT()
  const leaderboard = useData<Page<LeaderEntry>>('/leaderboard/' + courseId + '?limit=10')
  const announcements = useData<Page<AnnouncementItem>>('/courses/' + courseId + '/announcements?limit=20')
  const threads = useData<Page<ThreadItem>>('/courses/' + courseId + '/threads?limit=20')

  return (
    <div className="space-y-6">
      {/* Leaderboard */}
      <section className="feature-section space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 m-0">
            {t('community.leaderboardTitle')}
          </h2>
          <button
            type="button"
            className="secondary text-xs py-1 px-2.5"
            onClick={() => leaderboard.refresh()}
          >
            Refresh rankings
          </button>
        </div>

        {leaderboard.error && <p role="alert">{leaderboard.error}</p>}

        {leaderboard.data && leaderboard.data.items.length > 0 ? (
          <ol className="space-y-2 list-none p-0 m-0">
            {leaderboard.data.items.map(entry => (
              <li
                key={`${entry.rank}-${entry.display_name}`}
                className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-700 text-white text-xs font-bold">
                    #{entry.rank}
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {entry.display_name}
                  </span>
                </div>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {entry.score} pts
                </span>
              </li>
            ))}
          </ol>
        ) : (
          !leaderboard.error && (
            <p className="text-sm text-slate-600 dark:text-slate-300 m-0">
              {t('community.noLeaders')}
            </p>
          )
        )}
      </section>

      {/* Course Announcements */}
      <section className="feature-section space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 m-0">
            {t('community.announcementsTitle')}
          </h2>
        </div>

        {author && (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <ActionForm
              label={t('community.postAnnouncement')}
              onSubmit={async data => {
                await api(
                  '/courses/' + courseId + '/announcements',
                  json({ content: data.get('content') }, requestKey())
                )
                announcements.refresh()
              }}
            >
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Announcement message
                <textarea
                  name="content"
                  required
                  maxLength={12000}
                  rows={2}
                  placeholder="Share course schedules, updates, or deadline reminders…"
                  className="mt-1"
                />
              </label>
            </ActionForm>
          </div>
        )}

        {announcements.error && <p role="alert">{announcements.error}</p>}

        {announcements.data && announcements.data.items.length > 0 ? (
          <ul className="space-y-2.5 list-none p-0 m-0">
            {announcements.data.items.map(item => (
              <li
                key={item.id}
                className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-1"
              >
                <span className="text-xs text-slate-600 dark:text-slate-300 block">
                  {new Date(item.created_at).toLocaleString()}
                </span>
                <p className="text-sm text-slate-800 dark:text-slate-100 m-0 whitespace-pre-wrap">
                  {item.content}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          !announcements.error && (
            <p className="text-sm text-slate-600 dark:text-slate-300 m-0">
              {t('community.noAnnouncements')}
            </p>
          )
        )}
      </section>

      {/* Course Discussion Forum */}
      <section className="feature-section space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 m-0">
            {t('community.forumTitle')}
          </h2>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
          <ActionForm
            label={t('community.startThread')}
            onSubmit={async data => {
              await api(
                '/courses/' + courseId + '/threads',
                json({ title: data.get('title'), content: data.get('content') }, requestKey())
              )
              threads.refresh()
            }}
          >
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Thread title
              <input
                name="title"
                required
                maxLength={200}
                placeholder="Ask a conceptual question or share study notes…"
                className="mt-1"
              />
            </label>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Message
              <textarea name="content" required maxLength={12000} rows={2} className="mt-1" />
            </label>
          </ActionForm>
        </div>

        {threads.error && <p role="alert">{threads.error}</p>}

        <div className="space-y-3">
          {threads.data?.items.map(thread => (
            <ThreadView key={thread.id} thread={thread} author={author} />
          ))}

          {threads.data && threads.data.items.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-300 m-0">
              {t('community.noThreads')}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
