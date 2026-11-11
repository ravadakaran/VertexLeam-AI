import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'vertexlearn-theme'

function readStoredTheme(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    // Ignore storage access errors in restricted contexts
  }
  return 'light'
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Ignore storage quota/access errors
  }
}

export const useTheme = create<{
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}>(set => ({
  theme: 'light',
  setTheme: theme => {
    applyTheme(theme)
    set({ theme })
  },
  toggleTheme: () =>
    set(state => {
      const next: ThemeMode = state.theme === 'light' ? 'dark' : 'light'
      applyTheme(next)
      return { theme: next }
    })
}))

export function initTheme() {
  const initial = readStoredTheme()
  useTheme.getState().setTheme(initial)
}

