import { addEvent, getFeed, getUser, updateSignal } from './db'
import { account, closePosition, masterOf, placeOrder, resolveWallet } from './hl'
import type { OrderResult, SignalItem, User } from './types'

export class LimitError extends Error {}

export function clampOrderUsd(user: User, requested?: number): number {
  const usd = requested && requested > 0 ? requested : user.settings.orderUsd
  if (usd > user.settings.maxPerTrade) throw new LimitError(`Max per trade is $${user.settings.maxPerTrade}`)
  return Math.round(usd * 100) / 100
}

async function checkDailyLoss(user: User): Promise<void> {
  const addr = masterOf(user.wallet)
  if (!addr) throw new LimitError('No trading account linked')
  const acct = await account(addr)
  const loss = Math.max(0, -acct.dayPnl)
  if (loss >= user.settings.dailyLossCap) {
    throw new LimitError(`Daily loss cap reached ($${loss.toFixed(2)} of $${user.settings.dailyLossCap})`)
  }
}

export async function executeSignal(userId: number, signalId: string, opts: { side?: 'long' | 'short'; usd?: number }): Promise<SignalItem> {
  const user = await getUser(userId)
  if (!user) throw new Error('Unknown user')
  const feed = await getFeed(userId)
  const item = feed.signals.find(s => s.id === signalId)
  if (!item) throw new Error('Signal not found')
  if (item.status !== 'new') throw new LimitError(`Signal is already ${item.status}`)
  const wallet = resolveWallet(user.wallet)
  if (!wallet) throw new LimitError('No trading account linked')
  const usd = clampOrderUsd(user, opts.usd)
  await checkDailyLoss(user)
  const side = opts.side ?? item.signal.side
  let order: OrderResult
  try {
    order = await placeOrder({
      wallet,
      coin: item.signal.coin,
      isBuy: side === 'long',
      usd,
      // only attach the call's stop/target when trading in the call's direction
      stop: side === item.signal.side ? item.signal.stop : null,
      target: side === item.signal.side ? item.signal.target : null,
      leverage: item.signal.leverage,
    })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const msg = /timed out|fetch failed|ECONN|ETIMEDOUT/i.test(raw)
      ? 'Hyperliquid testnet is not responding. Nothing was sent.'
      : /does not exist|Must deposit/i.test(raw)
        ? 'Testnet account not funded or API wallet not approved yet. Open Wallet in the Wink Mini App.'
        : raw
    await updateSignal(userId, signalId, s => ({ ...s, status: 'failed', note: msg }))
    throw err instanceof LimitError ? err : new Error(msg)
  }
  return updateSignal(userId, signalId, s => ({ ...s, status: 'filled', order }))
}

export async function skipSignal(userId: number, signalId: string, note = 'Skipped'): Promise<SignalItem> {
  return updateSignal(userId, signalId, s => (s.status === 'new' ? { ...s, status: 'skipped', note } : s))
}

export async function closeCoin(userId: number, coin: string, fraction: number): Promise<OrderResult> {
  const user = await getUser(userId)
  if (!user) throw new Error('Unknown user')
  const wallet = resolveWallet(user.wallet)
  if (!wallet) throw new LimitError('No trading account linked')
  const r = await closePosition(wallet, coin, fraction)
  await addEvent(userId, {
    id: `close-${r.oid ?? Date.now()}`,
    kind: 'close',
    coin,
    text: `${coin} ${fraction >= 1 ? 'closed' : `closed ${Math.round(fraction * 100)}%`} · ${r.size} @ ${r.avgPx}`,
    usd: r.usd,
    at: r.at,
  })
  return r
}
