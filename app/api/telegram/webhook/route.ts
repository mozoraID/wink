import { NextResponse } from 'next/server'
import { handleUpdate } from '@/lib/ingest'
import { safeEqual } from '@/lib/crypto'

export const maxDuration = 30

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''
  const got = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!secret || !safeEqual(secret, got)) return new NextResponse('forbidden', { status: 403 })
  const update = await req.json()
  try {
    await handleUpdate(update)
  } catch (err) {
    console.error('update failed', update?.update_id, err)
  }
  return NextResponse.json({ ok: true })
}
