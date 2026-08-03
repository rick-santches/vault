import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUserId } from '@/lib/session'

// Look up a recipient's PUBLIC key so the caller can share TO them.
// Only a public key is ever returned — nothing secret. Requires a session so
// the endpoint can't be used by anonymous callers to probe the user list.
export async function GET(request: Request): Promise<NextResponse> {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const email = (new URL(request.url).searchParams.get('email') ?? '').trim().toLowerCase()
  if (!email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const target = await prisma.user.findUnique({
    where: { email },
    select: { email: true, publicKey: true },
  })
  // Same response whether the user doesn't exist or hasn't opened their vault
  // yet — either way there's no key to share to.
  if (!target?.publicKey) {
    return NextResponse.json(
      { error: 'No Vault user with that email is ready to receive shares yet.' },
      { status: 404 },
    )
  }

  return NextResponse.json({ email: target.email, publicKey: target.publicKey })
}
