import net from 'node:net'
import { getConfig } from '../config/env.ts'
import { logger } from '../utils/logger.ts'

export type EmailMessage = {
  to: string
  subject: string
  text: string
  dedupeKey: string
}

function sendViaSmtp(host: string, port: number, from: string, msg: EmailMessage): Promise<string> {
  const messageId = `<${msg.dedupeKey}@vertexlearn.local>`
  const body = msg.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
  const payload = [
    `From: <${from}>`,
    `To: <${msg.to}>`,
    `Subject: ${msg.subject.replace(/[\r\n]+/g, ' ')}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '.'
  ].join('\r\n')

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    socket.setTimeout(5000)
    let buffer = ''
    let step = 0
    const commands = [
      `EHLO vertexlearn.local\r\n`,
      `MAIL FROM:<${from}>\r\n`,
      `RCPT TO:<${msg.to}>\r\n`,
      `DATA\r\n`,
      `${payload}\r\n`,
      `QUIT\r\n`
    ]
    const expectedCodes = [220, 250, 250, 250, 354, 250]

    const fail = (err: Error) => {
      socket.destroy()
      reject(err)
    }

    socket.on('timeout', () => fail(new Error('SMTP timeout')))
    socket.on('error', err => fail(err))
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\r\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line || /^\d{3}-/.test(line)) continue
        const code = Number(line.slice(0, 3))
        if (step < expectedCodes.length) {
          if (code !== expectedCodes[step]) {
            fail(new Error(`SMTP rejected step ${step}: ${code}`))
            return
          }
          socket.write(commands[step])
          step++
          if (step === commands.length) {
            socket.end()
            resolve(messageId)
            return
          }
        }
      }
    })
  })
}

export async function sendEmail(msg: EmailMessage): Promise<{ providerRef: string }> {
  const { smtpHost, smtpPort, emailFrom, emailWebhookUrl, appEnv } = getConfig()
  const messageId = `<${msg.dedupeKey}@vertexlearn.local>`

  if (emailWebhookUrl) {
    const response = await fetch(emailWebhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': msg.dedupeKey,
        'x-message-id': messageId
      },
      body: JSON.stringify({
        from: emailFrom,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        dedupe_key: msg.dedupeKey,
        message_id: messageId
      }),
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) throw new Error(`Email webhook returned ${response.status}`)
    const data = await response.json().catch(() => ({})) as { id?: string }
    return { providerRef: data.id ?? messageId }
  }

  if (smtpHost) {
    const providerRef = await sendViaSmtp(smtpHost, smtpPort, emailFrom, msg)
    return { providerRef }
  }

  if (appEnv === 'development' || appEnv === 'test') {
    logger.info('email.sandbox', { dedupe_key: msg.dedupeKey, subject: msg.subject })
    return { providerRef: `sandbox:${msg.dedupeKey}` }
  }

  throw new Error('Email transport is not configured')
}

