import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUserId } from '@/lib/session'

export async function GET(): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const notes = await prisma.note.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, iv: true, ciphertext: true, createdAt: true },
  })
  return NextResponse.json({ notes })
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    | { iv?: unknown; ciphertext?: unknown }
    | null
  const iv = typeof body?.iv === 'string' ? body.iv : ''
  const ciphertext = typeof body?.ciphertext === 'string' ? body.ciphertext : ''
  if (!iv || !ciphertext || ciphertext.length > 200_000) {
    return NextResponse.json({ error: 'Invalid note' }, { status: 400 })
  }

  const note = await prisma.note.create({
    data: { userId, iv, ciphertext },
    select: { id: true, iv: true, ciphertext: true, createdAt: true },
  })
  return NextResponse.json({ note })
}
