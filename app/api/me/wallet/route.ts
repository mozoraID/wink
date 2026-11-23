import { z } from 'zod'
import { handle, HttpError, json, miniAppUser } from '@/lib/http'
import { updateUser } from '@/lib/db'
import { verifyAgent } from '@/lib/hl'
import { seal } from '@/lib/crypto'

const Body = z.union([
  z.object({ mode: z.literal('demo') }),
  z.object({ mode: z.literal('own'), master: z.string().regex(/^0x[0-9a-fA-F]{40}$/), agentKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
])

export const POST = handle(async req => {
  const user = await miniAppUser(req)
  const b = Body.safeParse(await req.json())
  if (!b.success) throw new HttpError(400, 'Enter a 0x address and a 64-hex API wallet key')
  if (b.data.mode === 'demo') {
    await updateUser(user.id, u => ({ ...u, wallet: { mode: 'demo' } }))
    return json({ ok: true })
  }
  const check = await verifyAgent(b.data.master, b.data.agentKey as `0x${string}`)
  if (!check.ok) throw new HttpError(422, check.reason ?? 'API wallet not approved')
  const { master, agentKey } = b.data
  await updateUser(user.id, u => ({ ...u, wallet: { mode: 'own', master, agent: check.agent, agentKeyEnc: seal(agentKey) } }))
  return json({ ok: true, agent: check.agent })
})
