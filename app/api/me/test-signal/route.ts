import { handle, json, miniAppUser } from '@/lib/http'
import { deliver } from '@/lib/ingest'
import { upsertChat } from '@/lib/db'
import { mid } from '@/lib/hl'

// Sends a realistic call built from the live testnet price, through the same
// parser and delivery path a Telegram post takes.
export const POST = handle(async req => {
  const user = await miniAppUser(req)
  const coin = user.settings.coins[0] ?? 'ETH'
  const p = await mid(coin)
  const r = (n: number) => Number(n.toPrecision(5))
  const text = `${coin} long ${r(p)} / stop ${r(p * 0.98)} / target ${r(p * 1.04)}`
  const chat = await upsertChat({ id: user.id, title: 'Sent to bot', type: 'private' }, c => ({ ...c, title: 'Sent to bot', owners: [user.id] }))
  const n = await deliver(chat, Date.now(), text, user.id)
  return json({ ok: n > 0, text })
})
