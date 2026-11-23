import { z } from 'zod'
import { handle, HttpError, json, miniAppUser } from '@/lib/http'
import { updateUser } from '@/lib/db'

const Patch = z.object({
  orderUsd: z.number().min(10).max(250).optional(),
  maxPerTrade: z.number().min(10).max(250).optional(),
  dailyLossCap: z.number().min(10).max(1000).optional(),
  requireStop: z.boolean().optional(),
  coins: z.array(z.string().regex(/^[A-Za-z0-9]{2,12}$/)).max(40).optional(),
  quietHours: z.object({ from: z.string().regex(/^\d\d:\d\d$/), to: z.string().regex(/^\d\d:\d\d$/) }).nullable().optional(),
})

export const POST = handle(async req => {
  const user = await miniAppUser(req)
  const parsed = Patch.safeParse(await req.json())
  if (!parsed.success) throw new HttpError(400, 'Invalid settings')
  const next = await updateUser(user.id, u => {
    const s = { ...u.settings, ...parsed.data }
    s.orderUsd = Math.min(s.orderUsd, s.maxPerTrade)
    if (parsed.data.coins) s.coins = [...new Set(parsed.data.coins.map(c => c.toUpperCase() === 'KPEPE' ? 'kPEPE' : c.toUpperCase()))]
    return { ...u, settings: s }
  })
  return json({ settings: next.settings })
})
