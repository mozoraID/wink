// Hyperliquid TESTNET only. Reads with the info API, trades through an API
// (agent) wallet that can place and cancel orders but cannot withdraw.
import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import { formatPrice, formatSize } from '@nktkas/hyperliquid/utils'
import { privateKeyToAccount } from 'viem/accounts'
import { open } from './crypto'
import type { OrderResult, Wallet } from './types'

export const HL_API = 'https://api.hyperliquid-testnet.xyz'
export const HL_APP = 'https://app.hyperliquid-testnet.xyz'

const transport = new HttpTransport({ isTestnet: true, timeout: 12_000 })
export const info = new InfoClient({ transport })

interface AssetMeta { index: number; name: string; szDecimals: number; maxLeverage: number }
let metaCache: { at: number; byName: Map<string, AssetMeta> } | null = null

export async function assets(): Promise<Map<string, AssetMeta>> {
  if (metaCache && Date.now() - metaCache.at < 10 * 60_000) return metaCache.byName
  const meta = await info.meta()
  const byName = new Map<string, AssetMeta>()
  meta.universe.forEach((u, index) => {
    if (!u.isDelisted) byName.set(u.name, { index, name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage })
  })
  metaCache = { at: Date.now(), byName }
  return byName
}

export async function coinList(): Promise<string[]> {
  try {
    return [...(await assets()).keys()]
  } catch {
    return []
  }
}

export interface Resolved { master: `0x${string}`; agentKey: `0x${string}`; label: string }

export function resolveWallet(w: Wallet): Resolved | null {
  if (w.mode === 'own') {
    return { master: w.master as `0x${string}`, agentKey: open(w.agentKeyEnc) as `0x${string}`, label: 'Your testnet account' }
  }
  const master = process.env.HL_MASTER_ADDRESS
  const agentKey = process.env.HL_AGENT_PRIVATE_KEY
  if (!master || !agentKey) return null
  return { master: master as `0x${string}`, agentKey: agentKey as `0x${string}`, label: 'Shared demo account' }
}

export function masterOf(w: Wallet): string | null {
  return w.mode === 'own' ? w.master : process.env.HL_MASTER_ADDRESS ?? null
}

export interface PositionView {
  coin: string
  side: 'long' | 'short'
  size: number
  entry: number
  mark: number
  pnl: number
  roe: number
  leverage: number
  notional: number
  liq: number | null
}

export interface AccountView {
  address: string
  accountValue: number
  unrealized: number
  marginUsed: number
  withdrawable: number
  positions: PositionView[]
  dayPnl: number
  fetchedAt: number
}

export async function account(address: string): Promise<AccountView> {
  const since = startOfUtcDay()
  const [state, mids, fills] = await Promise.all([
    info.clearinghouseState({ user: address as `0x${string}` }),
    info.allMids(),
    info.userFillsByTime({ user: address as `0x${string}`, startTime: since }).catch(() => []),
  ])
  const positions: PositionView[] = state.assetPositions
    .map(p => p.position)
    .filter(p => Number(p.szi) !== 0)
    .map(p => {
      const size = Number(p.szi)
      const entry = Number(p.entryPx)
      const mark = Number((mids as Record<string, string>)[p.coin] ?? p.entryPx)
      const pnl = (mark - entry) * size
      const margin = Number(p.marginUsed) || Math.abs(size * entry) / Number(p.leverage.value)
      return {
        coin: p.coin,
        side: size > 0 ? 'long' : 'short',
        size: Math.abs(size),
        entry,
        mark,
        pnl,
        roe: margin ? pnl / margin : 0,
        leverage: Number(p.leverage.value),
        notional: Math.abs(size * mark),
        liq: p.liquidationPx ? Number(p.liquidationPx) : null,
      } satisfies PositionView
    })
  const dayPnl = (fills as Array<{ closedPnl: string; fee: string }>).reduce((s, f) => s + Number(f.closedPnl) - Number(f.fee), 0)
  return {
    address,
    accountValue: Number(state.marginSummary.accountValue),
    unrealized: positions.reduce((s, p) => s + p.pnl, 0),
    marginUsed: Number(state.marginSummary.totalMarginUsed),
    withdrawable: Number(state.withdrawable),
    positions,
    dayPnl,
    fetchedAt: Date.now(),
  }
}

export function startOfUtcDay(): number {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

function exchangeFor(agentKey: `0x${string}`) {
  return new ExchangeClient({ transport, wallet: privateKeyToAccount(agentKey) })
}

export async function mid(coin: string): Promise<number> {
  const mids = (await info.allMids()) as Record<string, string>
  const m = Number(mids[coin])
  if (!m) throw new Error(`No testnet price for ${coin}`)
  return m
}

export interface PlaceInput {
  wallet: Resolved
  coin: string
  isBuy: boolean
  usd: number
  stop?: number | null
  target?: number | null
  leverage?: number | null
}

/** Market-style IOC order with optional attached stop-loss / take-profit. */
export async function placeOrder(input: PlaceInput): Promise<OrderResult> {
  const meta = (await assets()).get(input.coin)
  if (!meta) throw new Error(`${input.coin} is not listed on Hyperliquid testnet`)
  const price = await mid(input.coin)
  const size = formatSize(input.usd / price, meta.szDecimals)
  if (Number(size) * price < 10) throw new Error('Order is below the $10 minimum')
  const ex = exchangeFor(input.wallet.agentKey)

  const lev = Math.max(1, Math.min(input.leverage ?? 3, 5, meta.maxLeverage))
  await ex.updateLeverage({ asset: meta.index, isCross: true, leverage: lev }).catch(() => undefined)

  const slip = input.isBuy ? 1.01 : 0.99
  const orders: Parameters<ExchangeClient['order']>[0]['orders'] = [
    { a: meta.index, b: input.isBuy, p: formatPrice(price * slip, meta.szDecimals), s: size, r: false, t: { limit: { tif: 'Ioc' } } },
  ]
  const tpsl: string[] = []
  const valid = (px: number | null | undefined, kind: 'sl' | 'tp') => {
    if (!px || !Number.isFinite(px)) return false
    const below = px < price
    // stop must be on the losing side, target on the winning side
    return kind === 'sl' ? (input.isBuy ? below : !below) : (input.isBuy ? !below : below)
  }
  if (valid(input.stop, 'sl')) {
    const trig = formatPrice(input.stop!, meta.szDecimals)
    orders.push({ a: meta.index, b: !input.isBuy, p: formatPrice(input.stop! * (input.isBuy ? 0.97 : 1.03), meta.szDecimals), s: size, r: true, t: { trigger: { isMarket: true, triggerPx: trig, tpsl: 'sl' } } })
    tpsl.push(`SL ${trig}`)
  }
  if (valid(input.target, 'tp')) {
    const trig = formatPrice(input.target!, meta.szDecimals)
    orders.push({ a: meta.index, b: !input.isBuy, p: formatPrice(input.target! * (input.isBuy ? 0.97 : 1.03), meta.szDecimals), s: size, r: true, t: { trigger: { isMarket: true, triggerPx: trig, tpsl: 'tp' } } })
    tpsl.push(`TP ${trig}`)
  }
  const res = await ex.order({ orders, grouping: orders.length > 1 ? 'normalTpsl' : 'na' })
  const first = res.response.data.statuses[0] as Record<string, unknown>
  if ('error' in first) throw new Error(String(first.error))
  const filled = (first as { filled?: { totalSz: string; avgPx: string; oid: number } }).filled
  const resting = (first as { resting?: { oid: number } }).resting
  if (!filled) throw new Error(resting ? 'Order rested instead of filling' : 'Order was not filled')
  return {
    side: input.isBuy ? 'buy' : 'sell',
    usd: Number(filled.totalSz) * Number(filled.avgPx),
    size: filled.totalSz,
    avgPx: filled.avgPx,
    oid: filled.oid,
    tpsl,
    at: Date.now(),
  }
}

export async function closePosition(wallet: Resolved, coin: string, fraction: number): Promise<OrderResult> {
  const meta = (await assets()).get(coin)
  if (!meta) throw new Error(`${coin} is not listed`)
  const state = await info.clearinghouseState({ user: wallet.master })
  const pos = state.assetPositions.map(p => p.position).find(p => p.coin === coin && Number(p.szi) !== 0)
  if (!pos) throw new Error(`No open ${coin} position`)
  const szi = Number(pos.szi)
  const isBuy = szi < 0
  const size = formatSize(Math.abs(szi) * Math.min(1, Math.max(0.01, fraction)), meta.szDecimals)
  if (Number(size) === 0) throw new Error('Position too small to split')
  const price = await mid(coin)
  const ex = exchangeFor(wallet.agentKey)
  const res = await ex.order({
    orders: [{ a: meta.index, b: isBuy, p: formatPrice(price * (isBuy ? 1.01 : 0.99), meta.szDecimals), s: size, r: true, t: { limit: { tif: 'Ioc' } } }],
    grouping: 'na',
  })
  const first = res.response.data.statuses[0] as Record<string, unknown>
  if ('error' in first) throw new Error(String(first.error))
  const filled = (first as { filled?: { totalSz: string; avgPx: string; oid: number } }).filled
  if (!filled) throw new Error('Close order was not filled')
  return { side: isBuy ? 'buy' : 'sell', usd: Number(filled.totalSz) * Number(filled.avgPx), size: filled.totalSz, avgPx: filled.avgPx, oid: filled.oid, tpsl: [], at: Date.now() }
}

/** Checks that an API wallet key really is an agent of `master` (and not the master key itself). */
export async function verifyAgent(master: string, agentKey: `0x${string}`): Promise<{ ok: boolean; agent: string; reason?: string }> {
  const agent = privateKeyToAccount(agentKey).address
  if (agent.toLowerCase() === master.toLowerCase()) {
    return { ok: false, agent, reason: 'That is the main wallet key. Use an API wallet key, which cannot withdraw.' }
  }
  const agents = await info.extraAgents({ user: master as `0x${string}` }).catch(() => [])
  const found = (agents as Array<{ address: string }>).some(a => a.address.toLowerCase() === agent.toLowerCase())
  return found ? { ok: true, agent } : { ok: false, agent, reason: 'This API wallet is not approved for that account on testnet.' }
}
