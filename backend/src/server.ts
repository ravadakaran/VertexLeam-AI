import { app } from './app.ts'
import { cache } from './cache.ts'
import { db } from './db/index.ts'

const port = Number(process.env.PORT ?? 3000)
cache.connect().catch(() => console.error('Redis startup failed'))
const server = app.listen(port, '127.0.0.1', () => console.log(`VertexLearn API on port ${port}`))

async function shutdown() {
  server.close(async () => {
    if (cache.isOpen) cache.destroy()
    await db.end()
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

