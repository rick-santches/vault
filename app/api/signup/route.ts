import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { clientIp, rateLimited } from '@/lib/rate-limit'
import { createSession } from '@/lib/session'

export async function POST(request: Request): Promise<NextResponse> {
  if (rateLimited(clientIp(request))) {
    return NextResponse.json({ error: 'Too many attempts — wait a few minutes.' }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; authKey?: unknown }
    | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const authKey = typeof body?.authKey === 'string' ? body.authKey : ''
  // authKey is 32 random-looking bytes base64 (44 chars) — never a password.
  if (!email.includes('@') || authKey.length < 40) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'That email is already registered.' }, { status: 409 })
  }

  const authHash = await bcrypt.hash(authKey, 12)
  const user = await prisma.user.create({ data: { email, authHash } })
  await createSession(user.id)
  return NextResponse.json({ ok: true })
}
