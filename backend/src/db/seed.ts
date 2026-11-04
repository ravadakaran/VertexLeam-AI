import argon2 from 'argon2'

if (!['development', 'test'].includes(process.env.APP_ENV ?? '') ||
    !process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12) {
  throw new Error('Seeding requires development/test and DEMO_PASSWORD of at least 12 characters')
}
const { db, transaction } = await import('./index.ts')
try {
  const passwordHash = await argon2.hash(process.env.DEMO_PASSWORD)
  await transaction(async client => {
    for (const role of ['student', 'instructor', 'admin']) {
      await client.query(`
        WITH fixture AS (
          INSERT INTO users(full_name, email, password_hash) VALUES ($1, $2, $3)
          ON CONFLICT (email) DO NOTHING RETURNING id
        )
        INSERT INTO user_roles(user_id, role_id)
        SELECT fixture.id, roles.id FROM fixture CROSS JOIN roles WHERE roles.name = $4
      `, [`Demo ${role}`, `${role}@vertexlearn.test`, passwordHash, role])
    }
  })
} finally {
  await db.end()
}

