const { app } = await import('../src/app.ts')
if (!['test', 'development'].includes(process.env.APP_ENV)) throw new Error('Browser tests require a disposable environment')
process.env.SYNTHETIC_UPLOADS = 'true'
app.set('trust proxy', 'loopback')
await import('../src/server.ts')
