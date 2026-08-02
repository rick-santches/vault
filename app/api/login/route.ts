import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { clientIp, rateLimited } from '@/lib/rate-limit'
import { createSession } from '@/lib/session'

// Same message for unknown email and wrong key — no account enumeration.
const GENERIC = 'Email or password is incorrect.'

export async function POST(request: Request): Promise<NextResponse> {
  if (rateLimited(clientIp(request))) {
    return NextResponse.json({ error: 'Too many attempts — wait a few minutes.' }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; authKey?: unknown }
    | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const authKey = typeof body?.authKey === 'string' ? body.authKey : ''
  if (!email || !authKey) {
    return NextResponse.json({ error: GENERIC }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { email } })
  const ok = user !== null && (await bcrypt.compare(authKey, user.authHash))
  if (!user || !ok) {
    return NextResponse.json({ error: GENERIC }, { status: 401 })
  }

  await createSession(user.id)
  return NextResponse.json({ ok: true })
}
