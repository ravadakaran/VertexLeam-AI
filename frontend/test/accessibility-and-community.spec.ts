import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const DSA_COURSE_ID = '00000000-0000-4000-8000-00000000d5a1'
const run = randomUUID().slice(0, 8)
const tag = `[E2E-${run}]`
const disposableStudentEmail = `e2e-learner-${run}@vertexlearn.test`

async function auditContrastAndLandmarks(page: Page, contextLabel: string, requireNav = true) {
  const report = await page.evaluate(({ needNav }) => {
    const violations: string[] = []

    const main = document.querySelector('main')
    if (!main) violations.push('Missing <main> landmark')
    const h1 = document.querySelector('h1')
    if (!h1 || !h1.textContent?.trim()) violations.push('Missing <h1> heading')
    if (needNav) {
      const nav = document.querySelector('nav')
      if (!nav) violations.push('Missing <nav> landmark')
      const skip = document.querySelector('a.skip-link')
      if (!skip) violations.push('Missing skip-to-main-content link')
    }

    const probeCanvas = document.createElement('canvas')
    probeCanvas.width = 1
    probeCanvas.height = 1
    const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true })

    function parseRgba(input: string): [number, number, number, number] | null {
      const m = input.match(/rgba?\(([^)]+)\)/i)
      if (m) {
        const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
        if (parts.length < 3 || parts.some(Number.isNaN)) return null
        return [parts[0], parts[1], parts[2], parts[3] ?? 1]
      }
      if (!probeCtx || !input || input === 'none' || input === 'transparent') return null
      probeCtx.clearRect(0, 0, 1, 1)
      probeCtx.fillStyle = '#000000'
      probeCtx.fillStyle = input
      probeCtx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = probeCtx.getImageData(0, 0, 1, 1).data
      return [r, g, b, a / 255]
    }

    function composite(fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number, number] {
      const a = fg[3]
      return [
        fg[0] * a + bg[0] * (1 - a),
        fg[1] * a + bg[1] * (1 - a),
        fg[2] * a + bg[2] * (1 - a),
        1
      ]
    }

    function effectiveBg(el: Element): [number, number, number, number] {
      const layers: Array<[number, number, number, number]> = []
      let cur: Element | null = el
      while (cur) {
        const bg = parseRgba(getComputedStyle(cur).backgroundColor)
        if (bg && bg[3] > 0) layers.push(bg)
        cur = cur.parentElement
      }
      const rootTheme = document.documentElement.dataset.theme
      let color: [number, number, number, number] = rootTheme === 'dark' ? [11, 18, 32, 1] : [255, 255, 255, 1]
      for (let i = layers.length - 1; i >= 0; i--) {
        color = composite(layers[i], color)
      }
      return color
    }

    function relLuminance(rgb: [number, number, number, number]): number {
      const toLinear = (c: number) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2])
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim() ?? ''
      if (!text) continue
      const el = node.parentElement
      if (!el || el.classList.contains('skip-link')) continue
      if (el.closest('details') && !el.closest('details[open]') && !el.closest('summary')) continue
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue

      const fg = parseRgba(style.color)
      if (!fg) continue
      const bg = effectiveBg(el)
      const blendedFg = composite(fg, bg)
      const l1 = relLuminance(blendedFg)
      const l2 = relLuminance(bg)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)

      const fontSize = Number.parseFloat(style.fontSize) || 14
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700)
      const minRatio = isLarge ? 3.0 : 4.5
      if (ratio < minRatio) {
        violations.push(`${el.tagName.toLowerCase()} "${text.slice(0, 32)}" contrast ${ratio.toFixed(2)}:1 < ${minRatio}:1 (fg=${style.color}, bg=rgb(${Math.round(bg[0])},${Math.round(bg[1])},${Math.round(bg[2])}))`)
      }
    }

    return violations
  }, { needNav: requireNav })

  expect(report, `Accessibility/contrast audit failed on ${contextLabel}:\n${report.join('\n')}`).toEqual([])
}

test.beforeAll(() => {
  if (!['test', 'development'].includes(process.env.APP_ENV ?? '')) {
    throw new Error('Use a disposable demo environment')
  }
  execFileSync(process.execPath, ['--env-file-if-exists=.env', 'backend/src/db/seeders/dsa-demo.ts'], {
    encoding: 'utf8'
  })
})

test.afterEach(async () => {
  const database = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const like = `%${tag}%`
    await database.query("DELETE FROM outbox WHERE payload->>'course_id' = $1 AND status = 'pending'", [DSA_COURSE_ID])
    await database.query('DELETE FROM notifications WHERE course_id = $1 AND body LIKE $2', [DSA_COURSE_ID, like])
    await database.query('DELETE FROM post_reports WHERE reason LIKE $1', [like])
    await database.query("DELETE FROM moderation_reports WHERE entity_type = 'content' AND reason LIKE $1", [like])
    await database.query('DELETE FROM discussion_threads WHERE course_id = $1 AND title LIKE $2', [DSA_COURSE_ID, like])
    await database.query('DELETE FROM announcements WHERE course_id = $1 AND content LIKE $2', [DSA_COURSE_ID, like])
    const { rows: [learner] } = await database.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [disposableStudentEmail]
    )
    if (learner) {
      await database.query('DELETE FROM enrollments WHERE user_id = $1', [learner.id])
      await database.query('DELETE FROM audit_logs WHERE actor_id = $1', [learner.id])
      await database.query('DELETE FROM users WHERE id = $1', [learner.id])
    }
  } finally {
    await database.end()
  }
})

test('T-021, T-022 & T-025 DSA community workflows, notifications, theme, English-only navigation, and WCAG AA contrast', async ({ page }) => {
  test.setTimeout(60000)
  const password = process.env.DEMO_PASSWORD
  if (!password) throw new Error('Seed synthetic accounts with DEMO_PASSWORD')

  const address = randomUUID().replaceAll('-', '').match(/.{4}/g)!.join(':')
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': address })

  async function signIn(role: string, emailOverride?: string) {
    await page.getByLabel('Email').fill(emailOverride ?? `${role}@vertexlearn.test`)
    await page.getByLabel('Password', { exact: true }).fill(password!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(`/${role}`)
  }

  // Register a disposable learner and enroll in the DSA demo course so student@vertexlearn.test rate-limit budget remains free
  await page.goto('/register')
  await auditContrastAndLandmarks(page, 'Register screen (light)', false)
  await page.getByLabel('Full name').fill(`E2E Learner ${run}`)
  await page.getByLabel('Email').fill(disposableStudentEmail)
  await page.getByLabel('Password', { exact: true }).fill(password!)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/login')
  await auditContrastAndLandmarks(page, 'Login screen (light)', false)

  await signIn('student', disposableStudentEmail)
  await page.getByRole('link', { name: 'Course catalog' }).click()
  await page.getByLabel('Search').fill('Data Structures and Algorithms')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await page.getByRole('button', { name: 'Enroll in Data Structures and Algorithms' }).click()
  await expect(page.getByRole('status')).toContainText('Enrolled')
  await page.getByRole('button', { name: 'Sign out' }).click()

  // Instructor creates announcement + discussion thread in DSA demo course
  await signIn('instructor')
  await page.getByRole('link', { name: 'My courses' }).click()
  await page.getByRole('link', { name: 'Data Structures and Algorithms' }).click()
  await expect(page.getByRole('heading', { name: 'Course announcements' })).toBeVisible()
  await auditContrastAndLandmarks(page, 'Instructor DSA course (light)')

  await page.getByLabel('Announcement message').fill(`Live office hours scheduled ${tag}`)
  await page.getByRole('button', { name: 'Post announcement' }).click()
  await expect(page.getByText(`Live office hours scheduled ${tag}`)).toBeVisible()

  await page.getByLabel('Thread title').fill(`Trees & Complexity Discussion ${tag}`)
  await page.getByLabel('Message', { exact: true }).fill(`Ask questions about balanced BST rotations ${tag}`)
  await page.getByRole('button', { name: 'Start thread' }).click()
  await expect(page.getByRole('heading', { name: `Trees & Complexity Discussion ${tag}` })).toBeVisible()

  // Switch theme to Dark mode and verify persistence + contrast
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.waitForTimeout(250)
  await auditContrastAndLandmarks(page, 'Instructor DSA course (dark)')
  await page.getByRole('button', { name: 'Light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.waitForTimeout(250)

  await page.getByRole('button', { name: 'Sign out' }).click()

  // Student verifies notifications, marks read, posts reply, reports post, checks leaderboard, English navigation, and contrast
  await signIn('student', disposableStudentEmail)
  await expect(page.getByRole('heading', { name: 'Your progress' })).toBeVisible()
  await auditContrastAndLandmarks(page, 'Student workspace (light)')

  await expect.poll(async () => {
    const label = await page.getByRole('button', { name: /Notifications/ }).textContent()
    return label ?? ''
  }).toContain('Notifications')

  await page.getByRole('button', { name: /Notifications/ }).click()
  await expect(page.getByText(`Live office hours scheduled ${tag}`)).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Mark read' }).first().click()
  await page.getByRole('button', { name: 'Close notifications' }).click()

  await page.getByRole('link', { name: 'My learning' }).click()
  await page.getByRole('link', { name: 'Data Structures and Algorithms' }).click()
  await expect(page.getByRole('heading', { name: 'Course leaderboard' })).toBeVisible()
  await expect(page.getByText('Demo student').first()).toBeVisible()

  const threadCard = page.locator('article').filter({ hasText: `Trees & Complexity Discussion ${tag}` })
  await threadCard.getByRole('button', { name: 'Open thread' }).click()
  await expect(threadCard.getByText(`Ask questions about balanced BST rotations ${tag}`)).toBeVisible()

  await threadCard.getByRole('button', { name: 'Reply' }).first().click()
  await threadCard.getByLabel('Reply message').fill(`AVL rotations preserve O(log n) height ${tag}`)
  await threadCard.getByRole('button', { name: 'Post reply' }).click()
  await expect(threadCard.getByText(`AVL rotations preserve O(log n) height ${tag}`)).toBeVisible()

  // Report the reply
  await threadCard.locator('li').filter({ hasText: `AVL rotations preserve O(log n) height ${tag}` }).getByRole('button', { name: 'Report' }).click()
  await threadCard.getByLabel('Report reason').fill(`Flagged for moderation check ${tag}`)
  await threadCard.getByRole('button', { name: 'Submit report' }).click()

  await auditContrastAndLandmarks(page, 'Student DSA course + community (light)')

  // Verify dark mode contrast on student DSA page
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.waitForTimeout(250)
  await auditContrastAndLandmarks(page, 'Student DSA course + community (dark)')

  // The interface is English-only and has no language selector.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByLabel('Language', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Course leaderboard' })).toBeVisible()
  await page.getByRole('button', { name: 'Light mode' }).click()
  await page.waitForTimeout(250)

  await page.getByRole('button', { name: 'Sign out' }).click()

  // Admin reviews flagged discussion post in Moderation queue and hides it
  await signIn('admin')
  await page.getByRole('link', { name: 'Moderation queue' }).click()
  const flaggedArticle = page.locator('article').filter({ hasText: `AVL rotations preserve O(log n) height ${tag}` })
  await expect(flaggedArticle).toBeVisible()
  await auditContrastAndLandmarks(page, 'Admin moderation queue (light)')
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await page.waitForTimeout(250)
  await auditContrastAndLandmarks(page, 'Admin moderation queue (dark)')
  await page.getByRole('button', { name: 'Light mode' }).click()
  await page.waitForTimeout(250)

  await flaggedArticle.getByRole('button', { name: 'Hide' }).click()
  await expect(flaggedArticle).toBeHidden()
  await page.getByRole('button', { name: 'Sign out' }).click()

  // Student confirms hidden content is masked cleanly
  await signIn('student', disposableStudentEmail)
  await page.getByRole('link', { name: 'My learning' }).click()
  await page.getByRole('link', { name: 'Data Structures and Algorithms' }).click()
  const updatedThread = page.locator('article').filter({ hasText: `Trees & Complexity Discussion ${tag}` })
  await updatedThread.getByRole('button', { name: 'Open thread' }).click()
  await expect(updatedThread.getByText('Hidden by moderation', { exact: true })).toBeVisible()
  await expect(updatedThread.getByText('[Hidden by moderation]', { exact: true })).toBeVisible()
})
