import type { TradeSignal } from './signal'

export interface Settings {
  orderUsd: number
  maxPerTrade: number
  dailyLossCap: number
  requireStop: boolean
  coins: string[]
  quietHours: { from: string; to: string } | null
  tz: string
}

export type Wallet =
  | { mode: 'demo' }
  | { mode: 'own'; master: string; agent: string; agentKeyEnc: string }

export interface User {
  id: number
  name: string
  username?: string
  createdAt: number
  settings: Settings
  wallet: Wallet
  /** chatId -> enabled */
  sources: Record<string, boolean>
}

export interface Chat {
  id: number
  title: string
  type: 'group' | 'supergroup' | 'channel' | 'private'
  username?: string
  memberCount?: number
  owners: number[]
  messagesSeen: number
  signalsSeen: number
  firstSeen: number
  lastSignalAt?: number
}

export type SignalStatus = 'new' | 'filled' | 'skipped' | 'expired' | 'rejected' | 'failed'

export interface OrderResult {
  side: 'buy' | 'sell'
  usd: number
  size: string
  avgPx: string | null
  oid: number | null
  tpsl: string[]
  at: number
}

export interface SignalItem {
  id: string
  chatId: number
  chatTitle: string
  messageId?: number
  signal: TradeSignal
  receivedAt: number
  status: SignalStatus
  order?: OrderResult
  note?: string
  parser: 'rules' | 'llm'
}

export interface FeedEvent {
  id: string
  kind: 'close' | 'order'
  coin: string
  text: string
  usd?: number
  at: number
}

export interface Feed {
  signals: SignalItem[]
  events: FeedEvent[]
}

export interface Device {
  token: string
  userId: number
  createdAt: number
  lastSeen: number
  label: string
}

export interface Pairing {
  code: string
  userId: number
  expiresAt: number
  claimedBy?: string
}

export const DEFAULT_SETTINGS: Settings = {
  orderUsd: 50,
  maxPerTrade: 250,
  dailyLossCap: 100,
  requireStop: false,
  coins: ['BTC', 'ETH', 'SOL', 'HYPE'],
  quietHours: null,
  tz: 'Asia/Jakarta',
}

export const SIGNAL_TTL_MS = 10 * 60 * 1000
