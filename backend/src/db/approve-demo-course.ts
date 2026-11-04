import { db } from './index.ts'
import { approve } from '../modules/courses/service.ts'
import { parse, uuid } from '../http.ts'
import { randomUUID } from 'node:crypto'

try {
  if (!['development', 'test'].includes(process.env.APP_ENV ?? '')) throw new Error('Use a disposable demo environment')
  const id = parse(uuid, process.argv[2])
  const { rows: [course] } = await db.query('SELECT revision, status FROM courses WHERE id = $1', [id])
  const { rows: [admin] } = await db.query(`
    SELECT u.id, u.full_name, u.email, u.is_active FROM users u JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id WHERE u.email = 'admin@vertexlearn.test' AND u.is_active AND r.name = 'admin'
  `)
  if (!course || !admin) throw new Error('Course or demo administrator unavailable')
  const { rows: [prior] } = await db.query(
    'SELECT request_revision FROM course_approvals WHERE course_id = $1 AND reviewed_by = $2 AND idempotency_key = $3',
    [id, admin.id, id + '-demo-' + (course.status === 'approved' ? course.revision - 1 : course.revision)])
  const revision = course.status === 'approved' ? course.revision - 1 : course.revision
  const result = await approve({ ...admin, roles: ['admin'], role: 'admin', revision: '"1"' },
    id, prior?.request_revision ?? `"${revision}"`, id + '-demo-' + revision, { decision: 'approved' }, randomUUID())
  console.log(result.id, result.status)
} finally {
  await db.end()
}
