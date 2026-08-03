import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUserId } from '@/lib/session'

// GET: everything shared with me, and everything I've shared out. Each item
// carries the *peer's* public key so the browser can derive the pairwise key
// and decrypt — the server itself still can't read a byte of it.
export async function GET(): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [received, sent] = await Promise.all([
    prisma.share.findMany({
      where: { toUserId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        iv: true,
        ciphertext: true,
        createdAt: true,
        fromUser: { select: { email: true, publicKey: true } },
      },
    }),
    prisma.share.findMany({
      where: { fromUserId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        iv: true,
        ciphertext: true,
        createdAt: true,
        toUser: { select: { email: true, publicKey: true } },
      },
    }),
  ])

  return NextResponse.json({
    received: received.map((s) => ({
      id: s.id,
      iv: s.iv,
      ciphertext: s.ciphertext,
      createdAt: s.createdAt,
      peerEmail: s.fromUser.email,
      peerPublicKey: s.fromUser.publicKey,
    })),
    sent: sent.map((s) => ({
      id: s.id,
      iv: s.iv,
      ciphertext: s.ciphertext,
      createdAt: s.createdAt,
      peerEmail: s.toUser.email,
      peerPublicKey: s.toUser.publicKey,
    })),
  })
}

// POST: store a note the browser already encrypted for a specific recipient.
export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    | { toEmail?: unknown; iv?: unknown; ciphertext?: unknown }
    | null
  const toEmail = typeof body?.toEmail === 'string' ? body.toEmail.trim().toLowerCase() : ''
  const iv = typeof body?.iv === 'string' ? body.iv : ''
  const ciphertext = typeof body?.ciphertext === 'string' ? body.ciphertext : ''

  if (!toEmail.includes('@') || !iv || !ciphertext || ciphertext.length > 200_000) {
    return NextResponse.json({ error: 'Invalid share' }, { status: 400 })
  }

  const recipient = await prisma.user.findUnique({
    where: { email: toEmail },
    select: { id: true, publicKey: true },
  })
  if (!recipient?.publicKey) {
    return NextResponse.json(
      { error: 'That recipient does not have a Vault yet.' },
      { status: 404 },
    )
  }

  await prisma.share.create({
    data: { fromUserId: userId, toUserId: recipient.id, iv, ciphertext },
  })
  return NextResponse.json({ ok: true })
}
