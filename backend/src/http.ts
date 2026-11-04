import type { Response } from 'express'
import { z } from 'zod'

export class HttpError extends Error {
  declare status: number
  declare code: string
  declare field?: string | number
  constructor(status: number, code: string, message: string, field?: string | number) {
    super(message)
    Object.assign(this, { status, code, field })
  }
}

export function parse<T>(schema: z.ZodType<T>, input: unknown) {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request input', typeof issue.path[0] === 'symbol' ? undefined : issue.path[0])
  }
  return result.data
}

export const uuid = z.uuid()
export const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Invalid credentials or session')
export const forbidden = () => new HttpError(403, 'FORBIDDEN', 'Role does not permit this action')

export function sendResource(res: Response, value: { revision: string }, status = 200) {
  return res.set('ETag', value.revision).status(status).json(value)
}

