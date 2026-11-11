import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useT } from '../utils/i18n'

type NotificationItem = {
  id: string
  title: string
  body: string
  is_read: boolean
  created_at: string
}

export function NotificationsPanel() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await api<{ items: NotificationItem[] }>('/notifications/me?limit=20')
      setItems(data.items)
    } catch (failure) {
      setError(String(failure))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next) await load()
  }

  async function markRead(id: string) {
    setBusyId(id)
    setError('')
    try {
      const updated = await api<NotificationItem>('/notifications/' + id + '/read', { method: 'PUT' })
      setItems(current => current.map(item => (item.id === id ? updated : item)))
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusyId('')
    }
  }

  const unreadCount = items.filter(item => !item.is_read).length

  return (
    <div className="relative">
      <button
        type="button"
        className="secondary text-xs py-1.5 px-3 rounded-md"
        aria-expanded={open}
        aria-controls="notifications-popover"
        aria-label={`${t('nav.notifications')}${unreadCount ? ` (${unreadCount})` : ''}`}
        onClick={() => void toggle()}
      >
        <svg className="notification-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4" />
        </svg>
        <span className="notification-label">{t('nav.notifications')}</span>
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-indigo-700 text-white text-[11px] font-bold">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          id="notifications-popover"
          aria-label={t('nav.notifications')}
          className="absolute right-0 mt-2 w-80 sm:w-96 max-h-96 overflow-y-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-4 z-50 space-y-3"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 m-0">
              {t('nav.notifications')}
            </h2>
            <button
              type="button"
              className="secondary text-xs py-1 px-2.5"
              onClick={() => setOpen(false)}
            >
              {t('nav.closeNotifications')}
            </button>
          </div>

          {error && <p role="alert" className="text-xs m-0">{error}</p>}

          {!items.length && !error && (
            <p className="text-xs text-slate-600 dark:text-slate-300 m-0">{t('nav.noNotifications')}</p>
          )}

          <ul className="space-y-2 list-none p-0 m-0">
            {items.map(item => (
              <li
                key={item.id}
                className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                  item.is_read
                    ? 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                    : 'bg-indigo-50 dark:bg-slate-800 border-indigo-200 dark:border-indigo-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-slate-900 dark:text-slate-100 font-bold">{item.title}</strong>
                  <span className="text-[11px] text-slate-600 dark:text-slate-300 shrink-0">
                    {item.is_read ? 'Read' : 'Unread'}
                  </span>
                </div>
                <p className="text-slate-700 dark:text-slate-200 m-0 leading-relaxed">{item.body}</p>
                {!item.is_read && (
                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      className="secondary text-[11px] py-1 px-2.5"
                      onClick={() => void markRead(item.id)}
                    >
                      {t('nav.markRead')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

