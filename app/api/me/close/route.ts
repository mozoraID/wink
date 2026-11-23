import { z } from 'zod'
import { handle, HttpError, json, miniAppUser } from '@/lib/http'
import { closeCoin } from '@/lib/trade'

const Body = z.object({ coin: z.string().min(1).max(12), fraction: z.number().min(0.01).max(1) })

export const POST = handle(async req => {
  const user = await miniAppUser(req)
  const b = Body.safeParse(await req.json())
  if (!b.success) throw new HttpError(400, 'Bad request')
  return json({ order: await closeCoin(user.id, b.data.coin, b.data.fraction) })
})
