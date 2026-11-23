import { z } from 'zod'
import { handle, HttpError, json, miniAppUser } from '@/lib/http'
import { unlinkSource, updateUser } from '@/lib/db'

const Body = z.object({ chatId: z.number(), enabled: z.boolean().optional(), remove: z.boolean().optional() })

export const POST = handle(async req => {
  const user = await miniAppUser(req)
  const b = Body.safeParse(await req.json())
  if (!b.success || !(String(b.data.chatId) in user.sources)) throw new HttpError(400, 'Unknown source')
  if (b.data.remove) await unlinkSource(user.id, b.data.chatId)
  else await updateUser(user.id, u => ({ ...u, sources: { ...u.sources, [String(b.data.chatId)]: b.data.enabled ?? true } }))
  return json({ ok: true })
})
