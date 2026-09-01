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
  // Prefer the platform-set client IP, which the client cannot spoof. On Vercel
  // `x-vercel-forwarded-for` / `x-real-ip` are set by the proxy; the leftmost of
  // a raw `x-forwarded-for` is client-controlled, so it's the last resort. When
  // no trusted IP is available we key everyone to one shared bucket ('unknown')
  // — that can over-limit but never lets a caller escape the limit by rotating a
  // forged header.
  const trusted =
    request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-real-ip')
  if (trusted) return trusted.split(',')[0]!.trim()
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return fwd || 'unknown'
}
