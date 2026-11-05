import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './frontend/test',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: [
    { command: 'node --env-file-if-exists=.env backend/test/browser-server.js', url: 'http://127.0.0.1:3000/health/ready', reuseExistingServer: true },
    { command: 'npm run dev:web', url: 'http://127.0.0.1:5173', reuseExistingServer: true }
  ]
})

