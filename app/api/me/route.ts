import { NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/session'

export async function GET(): Promise<NextResponse> {
  const userId = await getSessionUserId()
  return NextResponse.json({ authenticated: userId !== null })
}
