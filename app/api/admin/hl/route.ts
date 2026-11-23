import { handle, HttpError, isAdmin, json } from '@/lib/http'
import { HL_API } from '@/lib/hl'

// Operator-only pass-through to the Hyperliquid TESTNET info/exchange API, for
// already-signed actions (e.g. approving an API wallet) from a machine that
// cannot reach the testnet API directly. Holds no keys.
export const POST = handle(async req => {
  if (!isAdmin(req)) throw new HttpError(404, 'Not found')
  const { path, body } = (await req.json()) as { path: 'info' | 'exchange'; body: unknown }
  if (path !== 'info' && path !== 'exchange') throw new HttpError(400, 'Bad path')
  const res = await fetch(`${HL_API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  let data: unknown = text
  try { data = JSON.parse(text) } catch { /* keep text */ }
  return json({ status: res.status, data })
})
