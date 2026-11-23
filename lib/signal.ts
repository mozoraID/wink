// Turns a free-form Telegram post into a structured trade call.
// Deterministic first; the webhook may ask an LLM only when this returns null
// for a message that still looks like a call.

export type Side = 'long' | 'short'

export interface TradeSignal {
  coin: string
  side: Side
  entry: number | null
  entryHigh?: number | null
  stop: number | null
  target: number | null
  leverage: number | null
  /** 0..1, how sure the parser is that this is an actionable call */
  confidence: number
  raw: string
}

export const DEFAULT_COINS = [
  'BTC', 'ETH', 'SOL', 'HYPE', 'DOGE', 'ARB', 'SUI', 'AVAX', 'BNB', 'XRP', 'LINK', 'OP', 'APT', 'TIA',
  'SEI', 'INJ', 'WIF', 'PEPE', 'kPEPE', 'TON', 'LTC', 'ADA', 'DOT', 'NEAR', 'AAVE', 'ENA', 'TRUMP', 'PENDLE', 'ONDO', 'JUP',
]

const LONG_WORDS = /\b(long|longs|longing|buy|buying|beli|bullish|bid)\b/i
const SHORT_WORDS = /\b(short|shorts|shorting|sell|selling|jual|bearish)\b/i

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?[kK])?`

export function parseNumber(s: string, k?: string): number {
  const n = Number(s.replace(/[,\s]/g, ''))
  return k ? n * 1000 : n
}

function grab(text: string, labels: string): number | null {
  const re = new RegExp(String.raw`(?:${labels})(?:\d(?![\d.]))?\s*[:=\-–@]?\s*\$?\s*${NUM}`, 'i')
  const m = text.match(re)
  return m ? parseNumber(m[1], m[2]) : null
}

function findCoin(text: string, coins: string[]): string | null {
  const upper = new Map(coins.map(c => [c.toUpperCase(), c]))
  // Prefer explicit #TAG / $TAG / TAG/USDT / TAGUSDT / TAG-PERP forms.
  const tagged = text.match(/[#$]([A-Za-z]{2,10})\b/)
  if (tagged && upper.has(tagged[1].toUpperCase())) return upper.get(tagged[1].toUpperCase())!
  const pair = text.match(/\b([A-Za-z]{2,10})[\/\-]?(?:USDT|USDC|USD|PERP)\b/i)
  if (pair && upper.has(pair[1].toUpperCase())) return upper.get(pair[1].toUpperCase())!
  for (const word of text.split(/[^A-Za-z0-9]+/)) {
    const hit = upper.get(word.toUpperCase())
    if (hit && word.length >= 2) {
      // avoid matching ordinary words: require upper-case in the post, or a known ticker longer than 3
      if (word === word.toUpperCase() || word.length >= 3) return hit
    }
  }
  return null
}

export function parseSignal(raw: string, coins: string[] = DEFAULT_COINS): TradeSignal | null {
  const text = raw.replace(/\u00a0/g, ' ').replace(/[*_`]/g, '')
  if (text.length > 1500) return null
  const coin = findCoin(text, coins)
  if (!coin) return null

  const isLong = LONG_WORDS.test(text)
  const isShort = SHORT_WORDS.test(text)
  if (isLong === isShort) return null
  const side: Side = isLong ? 'long' : 'short'

  const stop = grab(text, String.raw`stop[\s-]?loss|stoploss|stop|sl|invalidation|invalid`)
  const target = grab(text, String.raw`take[\s-]?profit|targets?|tgt|tp`)
  const leverageM = text.match(/\b(\d{1,3})\s?[xX×]\b/) ?? text.match(/lev(?:erage)?\s*[:=]?\s*(\d{1,3})/i)
  const leverage = leverageM ? Number(leverageM[1]) : null

  // Entry: explicit label, a range, or the first number after the side/coin word.
  let entry: number | null = null
  let entryHigh: number | null = null
  const range = text.match(new RegExp(String.raw`(?:entry|entries|buy zone|zone|masuk|@|at)\s*[:=]?\s*\$?\s*${NUM}\s*(?:-|–|to|~)\s*\$?\s*${NUM}`, 'i'))
  if (range) {
    entry = parseNumber(range[1], range[2])
    entryHigh = parseNumber(range[3], range[4])
  } else {
    entry = grab(text, String.raw`entry|entries|price|masuk|@|\bat\b`)
  }
  if (entry === null) {
    const after = new RegExp(String.raw`(?:${coin}|long|short|buy|sell|beli|jual)\b[^\d\n]{0,12}${NUM}`, 'i')
    const m = text.match(after)
    if (m) {
      const n = parseNumber(m[1], m[2])
      if (n !== stop && n !== target && n !== leverage) entry = n
    }
  }

  let confidence = 0.45
  if (entry !== null) confidence += 0.2
  if (stop !== null) confidence += 0.2
  if (target !== null) confidence += 0.1
  const ref = entryHigh && entry ? (entry + entryHigh) / 2 : entry
  if (ref !== null && stop !== null) {
    const ordered = side === 'long' ? stop < ref : stop > ref
    if (!ordered) confidence -= 0.35
  }
  if (ref !== null && target !== null) {
    const ordered = side === 'long' ? target > ref : target < ref
    if (!ordered) confidence -= 0.25
  }
  if (/\b(closed?|tp hit|sl hit|stopped out|recap|result|profit taken)\b/i.test(text)) confidence -= 0.4

  return {
    coin,
    side,
    entry,
    entryHigh,
    stop,
    target,
    leverage,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    raw: raw.slice(0, 500),
  }
}

export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}
