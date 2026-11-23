import { handle, json, miniAppUser } from '@/lib/http'
import { newPairing } from '@/lib/db'

export const POST = handle(async req => {
  const user = await miniAppUser(req)
  const p = await newPairing(user.id)
  return json({ code: p.code, expiresAt: p.expiresAt })
})
