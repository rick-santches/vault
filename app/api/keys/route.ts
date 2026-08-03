import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUserId } from '@/lib/session'

// The user's sharing keypair. The server stores publicKey in the clear (it's
// public) and the private key ONLY as ciphertext (encPrivKey/encPrivKeyIv),
// AES-GCM-wrapped in the browser with the user's encKey. The server can never
// unwrap it.

export async function GET(): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true, encPrivKey: true, encPrivKeyIv: true },
  })
  return NextResponse.json({
    publicKey: user?.publicKey ?? null,
    encPrivKey: user?.encPrivKey ?? null,
    encPrivKeyIv: user?.encPrivKeyIv ?? null,
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    | { publicKey?: unknown; encPrivKey?: unknown; encPrivKeyIv?: unknown }
    | null
  const publicKey = typeof body?.publicKey === 'string' ? body.publicKey : ''
  const encPrivKey = typeof body?.encPrivKey === 'string' ? body.encPrivKey : ''
  const encPrivKeyIv = typeof body?.encPrivKeyIv === 'string' ? body.encPrivKeyIv : ''

  // P-256 SPKI ~124 b64 chars; wrapped pkcs8 ~280; IV 16. Cap generously.
  if (
    publicKey.length < 40 || publicKey.length > 500 ||
    encPrivKey.length < 40 || encPrivKey.length > 2000 ||
    encPrivKeyIv.length < 8 || encPrivKeyIv.length > 64
  ) {
    return NextResponse.json({ error: 'Invalid keypair' }, { status: 400 })
  }

  // Write-once: never let a re-post silently replace an existing public key
  // (that would orphan everything already shared to this user).
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true },
  })
  if (existing?.publicKey) {
    return NextResponse.json({ error: 'Keypair already set' }, { status: 409 })
  }

  await prisma.user.update({
    where: { id: userId },
    data: { publicKey, encPrivKey, encPrivKeyIv },
  })
  return NextResponse.json({ ok: true })
}
