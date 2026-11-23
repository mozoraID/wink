import { z } from 'zod'
import { handle, HttpError, json, preflight, glassesDevice } from '@/lib/http'
import { closeCoin } from '@/lib/trade'

export const OPTIONS = preflight
export const maxDuration = 30

export const POST = handle(async req => {
  const d = await glassesDevice(req)
  const b = z.object({ coin: z.string().min(1).max(12), fraction: z.number().min(0.01).max(1) }).safeParse(await req.json())
  if (!b.success) throw new HttpError(400, 'Bad request')
  return json({ order: await closeCoin(d.userId, b.data.coin, b.data.fraction) }, 200, true)
}, true)
