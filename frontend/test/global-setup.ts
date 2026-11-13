import { createClient } from 'redis'

export default async function globalSetup() {
  const url = process.env.REDIS_CACHE_URL || 'redis://127.0.0.1:16379'
  try {
    const client = createClient({ url })
    await client.connect()
    const keys = await client.keys('vertexlearn:*')
    if (keys.length > 0) await client.del(keys)
    await client.quit()
  } catch {
    // Redis optional / best-effort cleanup
  }
}

