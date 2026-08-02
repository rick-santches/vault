/**
 * Basic in-memory rate limiting for auth endpoints. Good enough for a
 * single dev/small deployment; production behind multiple instances
 * needs a shared store (Redis) instead.
 */
const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 10

const attempts = new Map<string, { count: number; resetAt: number }>()

export function rateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > MAX_ATTEMPTS
}

export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}
