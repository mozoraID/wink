import { z } from 'zod'
import { handle, HttpError, json, preflight, glassesDevice } from '@/lib/http'
import { executeSignal, skipSignal } from '@/lib/trade'

export const OPTIONS = preflight
export const maxDuration = 30

const Body = z.object({
  signalId: z.string(),
  action: z.enum(['buy', 'sell', 'skip']),
  usd: z.number().positive().max(10_000).optional(),
})

export const POST = handle(async req => {
  const d = await glassesDevice(req)
  const b = Body.safeParse(await req.json())
  if (!b.success) throw new HttpError(400, 'Bad request')
  if (b.data.action === 'skip') return json({ signal: await skipSignal(d.userId, b.data.signalId) }, 200, true)
  const item = await executeSignal(d.userId, b.data.signalId, { side: b.data.action === 'buy' ? 'long' : 'short', usd: b.data.usd })
  return json({ signal: item }, 200, true)
}, true)
