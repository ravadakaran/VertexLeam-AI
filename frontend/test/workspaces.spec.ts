import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('T-005 all fixture roles reach their workspace and protected URLs enforce access', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': randomUUID().replaceAll('-', '').match(/.{4}/g)!.join(':') })
  const password = process.env.DEMO_PASSWORD
  if (!password) throw new Error('Seed synthetic accounts with DEMO_PASSWORD')
  await page.goto('/admin/users')
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('button', { name: 'Show password' })).toBeVisible()
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.locator('input[name="password"]')).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password' }).click()
  await expect(page.locator('input[name="password"]')).toHaveAttribute('type', 'password')

  for (const [role, label, section] of [
    ['student', 'Student', 'Course catalog'],
    ['instructor', 'Instructor', 'My courses'],
    ['admin', 'Admin', 'Course approvals']
  ]) {
    await page.getByLabel('Email').fill(`${role}@vertexlearn.test`)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(`/${role}`)
    await expect(page.getByRole('heading', { name: `${label} workspace` })).toBeVisible()
    await page.getByRole('navigation', { name: `${label} navigation` }).getByRole('link', { name: section }).click()
    await expect(page.getByRole('heading', { name: section })).toBeVisible()

    if (role === 'student') {
      await page.evaluate(() => {
        history.pushState({}, '', '/admin/users')
        dispatchEvent(new PopStateEvent('popstate'))
      })
      await expect(page).toHaveURL('/forbidden')
      await page.getByRole('link', { name: 'Return home' }).click()
    }

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL('/login')
  }
})

