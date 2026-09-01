import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUserId } from '@/lib/session'

// Update a note's ciphertext. The browser re-encrypts the edited text and
// sends only { iv, ciphertext } — the server still can't read it.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await request.json().catch(() => null)) as
    | { iv?: unknown; ciphertext?: unknown }
    | null
  const iv = typeof body?.iv === 'string' ? body.iv : ''
  const ciphertext = typeof body?.ciphertext === 'string' ? body.ciphertext : ''
  if (!iv || iv.length > 64 || !ciphertext || ciphertext.length > 200_000) {
    return NextResponse.json({ error: 'Invalid note' }, { status: 400 })
  }

  // updateMany scoped to the session user: a foreign id updates nothing.
  // Bump updatedAt explicitly here (the column is no longer @updatedAt) so only
  // a real content edit marks the note "edited" — pinning must not.
  const result = await prisma.note.updateMany({
    where: { id, userId },
    data: { iv, ciphertext, updatedAt: new Date() },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

// Toggle the pinned flag — metadata only, no ciphertext involved.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await request.json().catch(() => null)) as { pinned?: unknown } | null
  if (typeof body?.pinned !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const result = await prisma.note.updateMany({ where: { id, userId }, data: { pinned: body.pinned } })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  // deleteMany scoped to the session user: a foreign id deletes nothing.
  const result = await prisma.note.deleteMany({ where: { id, userId } })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
