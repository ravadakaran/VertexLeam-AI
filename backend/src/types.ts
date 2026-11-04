export type Role = 'student' | 'instructor' | 'admin'

export type Profile = {
  id: string
  full_name: string
  email: string
  roles: Role[]
  role: Role
  is_active: boolean
  revision: string
}

export type Pagination = { page: number; limit: number }

declare global {
  namespace Express {
    interface Request {
      requestId: string
      sessionId: string
      user?: Profile
    }
  }
}

