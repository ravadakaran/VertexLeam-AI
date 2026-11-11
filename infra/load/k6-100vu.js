import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000'
const DEMO_PASSWORD = __ENV.DEMO_PASSWORD || ''
const LOAD_TOKENS = (__ENV.LOAD_TOKENS || '')
  .split(',')
  .map(t => t.trim())
  .filter(Boolean)

export const options = {
  stages: [
    { duration: '20s', target: 25 },
    { duration: '40s', target: 100 },
    { duration: '20s', target: 0 }
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:catalog}': ['p(95)<300'],
    'http_req_duration{endpoint:health}': ['p(95)<150']
  }
}

export function setup() {
  let token = null
  let courseId = null

  if (DEMO_PASSWORD) {
    const loginRes = http.post(
      `${BASE_URL}/api/v1/auth/login`,
      JSON.stringify({ email: 'student@vertexlearn.test', password: DEMO_PASSWORD }),
      {
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.254.0.10' },
        tags: { endpoint: 'auth_setup' }
      }
    )
    if (loginRes.status === 200) {
      token = loginRes.json('access_token')
    }
  }

  const catalogRes = http.get(`${BASE_URL}/api/v1/courses`, {
    headers: { 'X-Forwarded-For': '10.254.0.11' },
    tags: { endpoint: 'catalog_setup' }
  })
  if (catalogRes.status === 200) {
    const items = catalogRes.json('items')
    if (Array.isArray(items) && items.length > 0) {
      courseId = items[0].id
    }
  }

  return { token, courseId }
}

export default function (data) {
  const clientIp = `10.99.${Math.floor(__VU / 250)}.${(__VU % 250) + 1}`
  const commonHeaders = { 'X-Forwarded-For': clientIp }

  const live = http.get(`${BASE_URL}/health/live`, { headers: commonHeaders, tags: { endpoint: 'health' } })
  check(live, { 'health/live 200': r => r.status === 200 })

  const catalog = http.get(`${BASE_URL}/api/v1/courses`, { headers: commonHeaders, tags: { endpoint: 'catalog' } })
  check(catalog, { 'catalog 200': r => r.status === 200 })

  if (data.courseId) {
    const detail = http.get(`${BASE_URL}/api/v1/courses/${data.courseId}`, {
      headers: commonHeaders,
      tags: { endpoint: 'course_detail' }
    })
    check(detail, { 'course detail 200': r => r.status === 200 })
  }

  if (data.token || LOAD_TOKENS.length > 0) {
    const useDistributedToken = LOAD_TOKENS.length > 0
    const activeToken = useDistributedToken ? LOAD_TOKENS[(__VU - 1) % LOAD_TOKENS.length] : data.token
    // Keep single-account fallback under the 100/min/user budget while distributed LOAD_TOKENS run full authenticated mix.
    if (useDistributedToken || __VU <= 10) {
      const authHeaders = { ...commonHeaders, Authorization: `Bearer ${activeToken}` }
      const notifications = http.get(`${BASE_URL}/api/v1/notifications/me`, {
        headers: authHeaders,
        tags: { endpoint: 'notifications' }
      })
      check(notifications, { 'notifications 200': r => r.status === 200 })

      if (data.courseId) {
        const threads = http.get(`${BASE_URL}/api/v1/courses/${data.courseId}/threads`, {
          headers: authHeaders,
          tags: { endpoint: 'threads' }
        })
        check(threads, { 'threads 200 or 403': r => r.status === 200 || r.status === 403 })
      }
    }
  }

  sleep(0.25)
}
