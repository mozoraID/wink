import { NextResponse } from 'next/server'
import { deviceFromToken, getUser, touchDevice, upsertUser } from './db'
import { safeEqual } from './crypto'
import { LimitError } from './trade'
import { verifyInitData } from './telegram'
import type { Device, User } from './types'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

export const json = (data: unknown, status = 200, cors = false) =>
  NextResponse.json(data, { status, headers: { 'cache-control': 'no-store', ...(cors ? CORS : {}) } })

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS })

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function isAdmin(req: Request): boolean {
  const want = process.env.WINK_ADMIN_TOKEN ?? ''
  const got = req.headers.get('x-wink-admin') ?? ''
  return want.length >= 32 && got.length === want.length && safeEqual(want, got)
}

export async function miniAppUser(req: Request): Promise<User> {
  // Operator preview: lets the owner load the Mini App outside Telegram for testing.
  if (isAdmin(req) && req.headers.get('x-wink-user')) {
    const id = Number(req.headers.get('x-wink-user'))
    const existing = await getUser(id)
    if (existing) return existing
    return upsertUser({ id, first_name: 'Preview' })
  }
  const h = req.headers.get('authorization') ?? ''
  const initData = h.startsWith('tma ') ? h.slice(4) : req.headers.get('x-telegram-init-data') ?? ''
  const tu = verifyInitData(initData)
  if (!tu) throw new HttpError(401, 'Open Wink from Telegram')
  return upsertUser(tu)
}

export async function glassesDevice(req: Request): Promise<Device> {
  const h = req.headers.get('authorization') ?? ''
  const d = await deviceFromToken(h.startsWith('Bearer ') ? h.slice(7) : null)
  if (!d) throw new HttpError(401, 'Glasses not paired')
  await touchDevice(d).catch(() => undefined)
  return d
}

export function handle(fn: (req: Request) => Promise<Response>, cors = false) {
  return async (req: Request) => {
    try {
      return await fn(req)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof LimitError ? 422 : 500
      const message = err instanceof Error ? err.message : 'Something went wrong'
      if (status === 500) console.error(err)
      return json({ error: message }, status, cors)
    }
  }
}
