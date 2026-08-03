import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUserId } from '@/lib/session'

// Either party can remove a share: the recipient can clear it from their inbox,
// the sender can revoke what they sent. Scoped so a foreign id deletes nothing.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const result = await prisma.share.deleteMany({
    where: { id, OR: [{ fromUserId: userId }, { toUserId: userId }] },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
