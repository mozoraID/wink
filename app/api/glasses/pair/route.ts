import { z } from 'zod'
import { handle, HttpError, json, preflight } from '@/lib/http'
import { claimPairing, getUser } from '@/lib/db'

export const OPTIONS = preflight

export const POST = handle(async req => {
  const b = z.object({ code: z.string().min(6).max(12), label: z.string().max(40).optional() }).safeParse(await req.json())
  if (!b.success) throw new HttpError(400, 'Enter the 6-character code')
  const d = await claimPairing(b.data.code, b.data.label ?? 'Even G2')
  if (!d) throw new HttpError(404, 'Code not found or expired')
  const u = await getUser(d.userId)
  return json({ token: d.token, name: u?.name ?? 'Wink' }, 200, true)
}, true)
