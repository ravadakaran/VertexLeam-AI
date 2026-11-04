import { readFile, readdir } from 'node:fs/promises'
import { db, transaction } from './index.ts'

try {
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(784019)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())')
    const directory = new URL('./migrations/', import.meta.url)
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])).rowCount) continue
      await client.query(await readFile(new URL(name, directory), 'utf8'))
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name])
    }
  })
} finally {
  await db.end()
}

