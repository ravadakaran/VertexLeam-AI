import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './routes/App'
import { initTheme } from './utils/theme'
import './styles.css'

initTheme()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
