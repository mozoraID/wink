import { handle, HttpError, json, preflight, glassesDevice } from '@/lib/http'
import { getFeed, getUser } from '@/lib/db'
import { accountFor, within } from '@/lib/view'
import { SIGNAL_TTL_MS } from '@/lib/types'
import { mid } from '@/lib/hl'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

export const GET = handle(async req => {
  const d = await glassesDevice(req)
  const user = await getUser(d.userId)
  if (!user) throw new HttpError(401, 'Unknown user')
  const url = new URL(req.url)
  const withAccount = url.searchParams.get('account') !== '0'
  const feed = await getFeed(user.id)
  const pending = feed.signals.find(s => s.status === 'new') ?? null
  const [acct, price] = await Promise.all([
    withAccount ? accountFor(user, 4000) : Promise.resolve(null),
    pending ? within(mid(pending.signal.coin), 3000).catch(() => null) : Promise.resolve(null),
  ])
  const last = feed.signals.find(s => s.status !== 'new') ?? null
  return json({
    name: user.name.split(' ')[0],
    signal: pending && {
      id: pending.id,
      source: pending.chatTitle,
      coin: pending.signal.coin,
      side: pending.signal.side,
      entry: pending.signal.entry,
      stop: pending.signal.stop,
      target: pending.signal.target,
      leverage: pending.signal.leverage,
      receivedAt: pending.receivedAt,
      expiresAt: pending.receivedAt + SIGNAL_TTL_MS,
      price,
    },
    sources: Object.values(user.sources).filter(Boolean).length,
    last: last && { id: last.id, coin: last.signal.coin, status: last.status, note: last.note ?? null, order: last.order ?? null },
    settings: { orderUsd: user.settings.orderUsd, maxPerTrade: user.settings.maxPerTrade, dailyLossCap: user.settings.dailyLossCap },
    account: acct?.account
      ? { value: acct.account.accountValue, unrealized: acct.account.unrealized, dayPnl: acct.account.dayPnl, positions: acct.account.positions }
      : null,
    accountError: acct?.error ?? null,
    now: Date.now(),
  }, 200, true)
}, true)
