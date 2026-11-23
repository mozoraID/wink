// Backend client. Same origin when served from the Wink deployment (/g2/),
// or VITE_WINK_API when packaged as an .ehpk.
export const API = (import.meta.env.VITE_WINK_API || (location.protocol.startsWith('http') ? location.origin : 'https://wink-signal.vercel.app')).replace(/\/$/, '')

export interface GlassesSignal {
  id: string; source: string; coin: string; side: 'long' | 'short'
  entry: number | null; stop: number | null; target: number | null; leverage: number | null
  receivedAt: number; expiresAt: number; price: number | null
}
export interface Position { coin: string; side: 'long' | 'short'; size: number; entry: number; mark: number; pnl: number; roe: number; leverage: number; notional: number }
export interface GlassesState {
  name: string
  signal: GlassesSignal | null
  last: { id: string; coin: string; status: string; note: string | null } | null
  settings: { orderUsd: number; maxPerTrade: number; dailyLossCap: number }
  account: { value: number; unrealized: number; dayPnl: number; positions: Position[] } | null
  accountError: string | null
  sources: number
  now: number
}
export interface Intent { action: 'buy' | 'sell' | 'skip' | 'yes' | 'no' | 'close' | 'next' | 'unknown'; amountUsd?: number; fraction?: number }

let token = ''
export const setToken = (t: string) => { token = t }
export const hasToken = () => token.length > 0

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(j.error ?? `HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return j as T
}

const jsonBody = (b: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })

export const api = {
  pair: (code: string) => req<{ token: string; name: string }>('/api/glasses/pair', jsonBody({ code, label: 'Even G2' })),
  state: () => req<GlassesState>('/api/glasses/state'),
  act: (signalId: string, action: 'buy' | 'sell' | 'skip', usd?: number) =>
    req<{ signal: { status: string; note?: string; order?: { size: string; avgPx: string; usd: number; tpsl: string[] } } }>('/api/glasses/act', jsonBody({ signalId, action, usd })),
  close: (coin: string, fraction: number) => req<{ order: { size: string; avgPx: string; usd: number } }>('/api/glasses/close', jsonBody({ coin, fraction })),
  voice: (pcm: Uint8Array) =>
    req<{ transcript: string; intent: Intent; provider: string; ms: number }>('/api/glasses/voice', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pcm as BodyInit }),
}
