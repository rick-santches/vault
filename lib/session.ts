import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const COOKIE = 'vault_session'
const WEEK_SECONDS = 7 * 24 * 60 * 60

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(value)
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret())

  const store = await cookies()
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: WEEK_SECONDS,
    path: '/',
  })
}

/** Returns the userId or null. */
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies()
  const token = store.get(COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE)
}
