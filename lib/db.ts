import { kvDel, kvGet, kvSet, kvUpdate } from './store'
import { token, pairCode } from './crypto'
import {
  DEFAULT_SETTINGS, SIGNAL_TTL_MS,
  type Chat, type Device, type Feed, type FeedEvent, type Pairing, type SignalItem, type User,
} from './types'
import type { TgUser } from './telegram'

export const userKey = (id: number) => `users/${id}`
export const feedKey = (id: number) => `feeds/${id}`
export const chatKey = (id: number) => `chats/${id}`

export async function getUser(id: number): Promise<User | null> {
  return kvGet<User>(userKey(id))
}

export async function upsertUser(tu: TgUser): Promise<User> {
  return kvUpdate<User>(userKey(tu.id), cur => {
    const name = [tu.first_name, tu.last_name].filter(Boolean).join(' ')
    if (cur) return { ...cur, name, username: tu.username, settings: { ...DEFAULT_SETTINGS, ...cur.settings } }
    return { id: tu.id, name, username: tu.username, createdAt: Date.now(), settings: { ...DEFAULT_SETTINGS }, wallet: { mode: 'demo' }, sources: {} }
  })
}

export async function updateUser(id: number, fn: (u: User) => User): Promise<User> {
  return kvUpdate<User>(userKey(id), cur => {
    if (!cur) throw new Error('unknown user')
    return fn(cur)
  })
}

export async function getChat(id: number): Promise<Chat | null> {
  return kvGet<Chat>(chatKey(id))
}

export async function upsertChat(chat: { id: number; title?: string; type: Chat['type']; username?: string }, patch?: (c: Chat) => Chat): Promise<Chat> {
  return kvUpdate<Chat>(chatKey(chat.id), cur => {
    const base: Chat = cur ?? {
      id: chat.id, title: chat.title ?? 'Chat', type: chat.type, username: chat.username,
      owners: [], messagesSeen: 0, signalsSeen: 0, firstSeen: Date.now(),
    }
    base.title = chat.title ?? base.title
    base.username = chat.username ?? base.username
    return patch ? patch(base) : base
  })
}

/** Link a chat to a user as a signal source. */
export async function linkSource(userId: number, chat: Chat): Promise<void> {
  await upsertChat(chat, c => ({ ...c, owners: [...new Set([...c.owners, userId])] }))
  await kvUpdate<User>(userKey(userId), cur => {
    if (!cur) throw new Error('unknown user')
    return { ...cur, sources: { ...cur.sources, [String(chat.id)]: cur.sources[String(chat.id)] ?? true } }
  })
}

export async function unlinkSource(userId: number, chatId: number): Promise<void> {
  await upsertChat({ id: chatId, type: 'group' }, c => ({ ...c, owners: c.owners.filter(o => o !== userId) }))
  await updateUser(userId, u => {
    const sources = { ...u.sources }
    delete sources[String(chatId)]
    return { ...u, sources }
  })
}

export async function getFeed(userId: number): Promise<Feed> {
  const f = (await kvGet<Feed>(feedKey(userId))) ?? { signals: [], events: [] }
  const now = Date.now()
  for (const s of f.signals) if (s.status === 'new' && now - s.receivedAt > SIGNAL_TTL_MS) s.status = 'expired'
  return f
}

export async function pushSignal(userId: number, item: SignalItem): Promise<void> {
  await kvUpdate<Feed>(feedKey(userId), cur => {
    const f = cur ?? { signals: [], events: [] }
    if (f.signals.some(s => s.id === item.id)) return f
    f.signals = [item, ...f.signals].slice(0, 60)
    return f
  })
}

export async function updateSignal(userId: number, id: string, fn: (s: SignalItem) => SignalItem): Promise<SignalItem> {
  let out: SignalItem | undefined
  await kvUpdate<Feed>(feedKey(userId), cur => {
    const f = cur ?? { signals: [], events: [] }
    f.signals = f.signals.map(s => (s.id === id ? (out = fn(s)) : s))
    return f
  })
  if (!out) throw new Error('Signal not found')
  return out
}

export async function addEvent(userId: number, ev: FeedEvent): Promise<void> {
  await kvUpdate<Feed>(feedKey(userId), cur => {
    const f = cur ?? { signals: [], events: [] }
    f.events = [ev, ...f.events].slice(0, 60)
    return f
  })
}

// ---- pairing -------------------------------------------------------------

const PAIR_TTL = 5 * 60_000

export async function newPairing(userId: number): Promise<Pairing> {
  const prev = await kvGet<{ code: string }>(`pair-by-user/${userId}`)
  if (prev) await kvDel(`pair/${prev.code}`)
  const p: Pairing = { code: pairCode(), userId, expiresAt: Date.now() + PAIR_TTL }
  await kvSet(`pair/${p.code}`, p)
  await kvSet(`pair-by-user/${userId}`, { code: p.code })
  return p
}

export async function currentPairing(userId: number): Promise<Pairing | null> {
  const ref = await kvGet<{ code: string }>(`pair-by-user/${userId}`)
  if (!ref) return null
  const p = await kvGet<Pairing>(`pair/${ref.code}`)
  return p && p.expiresAt > Date.now() && !p.claimedBy ? p : null
}

export async function claimPairing(code: string, label: string): Promise<Device | null> {
  const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (norm.length !== 6) return null
  const p = await kvGet<Pairing>(`pair/${norm}`)
  if (!p || p.expiresAt < Date.now() || p.claimedBy) return null
  const d: Device = { token: token(), userId: p.userId, createdAt: Date.now(), lastSeen: Date.now(), label }
  await kvSet(`devices/${d.token}`, d)
  await kvSet(`pair/${norm}`, { ...p, claimedBy: d.token.slice(0, 6) })
  await kvUpdate<{ tokens: string[] }>(`devices-by-user/${p.userId}`, cur => ({ tokens: [...(cur?.tokens ?? []), d.token].slice(-5) }))
  return d
}

export async function deviceFromToken(tok: string | null): Promise<Device | null> {
  if (!tok || tok.length < 20) return null
  return kvGet<Device>(`devices/${tok}`)
}

export async function touchDevice(d: Device): Promise<void> {
  if (Date.now() - d.lastSeen < 30_000) return
  await kvSet(`devices/${d.token}`, { ...d, lastSeen: Date.now() })
}

export async function devicesFor(userId: number): Promise<Device[]> {
  const ref = await kvGet<{ tokens: string[] }>(`devices-by-user/${userId}`)
  const out: Device[] = []
  for (const t of ref?.tokens ?? []) {
    const d = await kvGet<Device>(`devices/${t}`)
    if (d) out.push(d)
  }
  return out
}

export async function unpairAll(userId: number): Promise<void> {
  const ref = await kvGet<{ tokens: string[] }>(`devices-by-user/${userId}`)
  for (const t of ref?.tokens ?? []) await kvDel(`devices/${t}`)
  await kvDel(`devices-by-user/${userId}`)
}
