import { handle, json, miniAppUser } from '@/lib/http'
import { unpairAll } from '@/lib/db'

export const POST = handle(async req => {
  const user = await miniAppUser(req)
  await unpairAll(user.id)
  return json({ ok: true })
})
