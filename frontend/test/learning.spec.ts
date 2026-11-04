import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import pg from 'pg'

let fixture: { id: string; title: string } | undefined
test.afterEach(async () => {
  if (!fixture) return
  const database = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await database.query(`
      DELETE FROM enrollments e USING courses c WHERE e.course_id=c.id AND c.id=$1 AND c.title=$2
    `, [fixture.id, fixture.title])
    await database.query(`
      DELETE FROM course_approvals a USING courses c WHERE a.course_id=c.id AND c.id=$1 AND c.title=$2
    `, [fixture.id, fixture.title])
    await database.query(`
      DELETE FROM audit_logs WHERE entity='course' AND entity_id IN (SELECT id FROM courses WHERE id=$1 AND title=$2)
    `, [fixture.id, fixture.title])
    await database.query('DELETE FROM courses WHERE id=$1 AND title=$2', [fixture.id, fixture.title])
  } finally { await database.end(); fixture = undefined }
})

test('T-006–010 course, playback, assignment and quiz workflows', async ({ page }) => {
  test.setTimeout(60000)
  if (!['test', 'development'].includes(process.env.APP_ENV ?? '')) throw new Error('Use a disposable demo environment')
  const password = process.env.DEMO_PASSWORD
  if (!password) throw new Error('Seed demo accounts first')
  const title = 'Synthetic course ' + randomUUID()
  const address = randomUUID().replaceAll('-', '').match(/.{4}/g)!.join(':')
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': address })
  async function signIn(role: string) {
    await page.getByLabel('Email').fill(role + '@vertexlearn.test')
    await page.getByLabel('Password').fill(password!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL('/' + role)
  }
  await page.goto('/login')
  await signIn('instructor')
  await page.getByRole('link', { name: 'My courses' }).click()
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Description').fill('A synthetic fixture for the Week 1 walkthrough')
  await page.getByLabel('Category').fill('Integration testing')
  await page.getByRole('button', { name: 'Create course' }).click()
  const link = page.getByRole('link', { name: title })
  await expect(link).toBeVisible()
  const id = (await link.getAttribute('href'))!.split('/').at(-1)!
  fixture = { id, title }
  await link.click()
  await page.getByLabel('Module title').fill('Sample module')
  await page.getByRole('button', { name: 'Add module' }).click()
  await expect(page.getByRole('heading', { name: 'Sample module' })).toBeVisible()
  const directory = mkdtempSync(join(tmpdir(), 'vertexlearn-browser-'))
  let video: Buffer
  try {
    const path = join(directory, 'fixture.mp4')
    execFileSync(process.env.FFMPEG_PATH ?? ffmpeg.path, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
      'color=c=blue:s=160x90:r=25:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { timeout: 15000 })
    video = readFileSync(path)
  } finally { rmSync(directory, { recursive: true, force: true }) }
  await page.getByLabel('Lecture title').fill('Sample lecture')
  await page.getByLabel('Video', { exact: true }).setInputFiles({ name: 'fixture.mp4', mimeType: 'video/mp4', buffer: video })
  await page.getByLabel('English captions').setInputFiles({ name: 'captions.vtt', mimeType: 'text/vtt',
    buffer: Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nSynthetic caption\n') })
  await page.getByRole('button', { name: 'Upload lecture' }).click()
  await expect(page.getByText('Sample lecture', { exact: true })).toBeVisible({ timeout: 15000 })
  await page.getByLabel('Assignment title').fill('Example assignment')
  await page.getByLabel('Instructions').fill('Submit a short code file.')
  const deadline = new Date(Date.now() + 3600000)
  const localTime = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  await page.getByLabel('Deadline (local time)').fill(localTime)
  await page.getByLabel('Label', { exact: true }).fill('Correctness')
  await page.getByRole('group', { name: 'Criterion 1' }).getByLabel('Maximum points').fill('10')
  await page.getByRole('button', { name: 'Create assignment' }).click()
  await expect(page.getByRole('heading', { name: 'Example assignment' })).toBeVisible()
  await page.getByText('Author a quiz', { exact: true }).click()
  await page.getByLabel('Question', { exact: true }).fill('Choose the first answer.')
  const editor = page.locator('details').filter({ hasText: 'Author a quiz' })
  await editor.getByLabel('Maximum points').fill('10')
  await editor.getByRole('group', { name: 'Option 1' }).getByLabel('Option text').fill('First answer')
  await editor.getByRole('group', { name: 'Option 1' }).getByLabel('Correct').check()
  await editor.getByRole('group', { name: 'Option 2' }).getByLabel('Option text').fill('Second answer')
  await page.getByRole('button', { name: 'Add question' }).click()
  await page.getByLabel('Quiz title').fill('Example quiz')
  await page.getByRole('button', { name: 'Save quiz draft' }).click()
  await page.getByRole('button', { name: 'Publish quiz' }).click()
  await expect(page.getByText('approved', { exact: true })).toBeVisible()
  expect(execFileSync(process.execPath, [
    '--env-file-if-exists=.env', 'backend/src/db/approve-demo-course.ts', id
  ], { encoding: 'utf8' })).toContain(id + ' approved')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn('student')
  await page.getByRole('link', { name: 'Course catalog' }).click()
  await page.getByLabel('Search').fill(title)
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await page.getByRole('button', { name: 'Enroll in ' + title }).click()
  await expect(page.getByRole('status')).toContainText('Enrolled')
  await page.getByRole('link', { name: 'My learning' }).click()
  await expect(page.getByRole('link', { name: title })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL('/login')
  await signIn('student')
  await expect(page.getByRole('link', { name: title })).toBeVisible()
  await page.getByRole('link', { name: title }).click()
  await page.getByRole('button', { name: 'Sample lecture' }).click()
  const player = page.locator('video')
  await expect.poll(() => player.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1)
  await expect(player.locator('track')).toHaveAttribute('src', /captions\.vtt\?grant=/)
  await page.getByLabel('Playback speed').selectOption('1.5')
  await expect.poll(() => player.evaluate(element => (element as HTMLVideoElement).playbackRate)).toBe(1.5)
  await player.evaluate(async element => {
    const video = element as HTMLVideoElement
    video.muted = true
    await video.play()
  })
  await expect(page.getByText('Completed', { exact: true })).toBeVisible({ timeout: 12000 })
  await page.getByLabel('Note at current time').fill('Synthetic note')
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(page.getByText('Synthetic note', { exact: false })).toBeVisible()
  await page.getByLabel('PDF, ZIP, or code file').setInputFiles({
    name: 'answer.py', mimeType: 'text/plain', buffer: Buffer.from('print("synthetic")')
  })
  await page.getByRole('button', { name: 'Submit assignment' }).click()
  await expect(page.getByText(/Awaiting grade/)).toBeVisible()
  await page.getByRole('button', { name: 'Start quiz' }).click()
  await page.getByRole('radio', { name: 'First answer' }).check()
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByText(/Final 100%/)).toBeVisible()
})
