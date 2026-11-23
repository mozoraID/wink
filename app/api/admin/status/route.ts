import { NextResponse } from 'next/server'
import { safeEqual } from '@/lib/crypto'
import { getUser } from '@/lib/db'
import { miniAppState } from '@/lib/view'

export const dynamic = 'force-dynamic'

// Operator-only snapshot of one user's state, for checking a deployment.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const want = process.env.WINK_ADMIN_TOKEN ?? ''
  const got = url.searchParams.get('token') ?? ''
  if (want.length < 32 || got.length !== want.length || !safeEqual(want, got)) return new NextResponse('Not found', { status: 404 })
  const user = await getUser(Number(url.searchParams.get('uid')))
  if (!user) return NextResponse.json({ user: null })
  const s = await miniAppState(user)
  return NextResponse.json({ ...s, wallet: { mode: s.wallet.mode } }, { headers: { 'cache-control': 'no-store' } })
}
