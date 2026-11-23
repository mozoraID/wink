import { getChat, getUser, linkSource, pushSignal, upsertChat, upsertUser } from './db'
import { coinList } from './hl'
import { llmSignal } from './ai'
import { DEFAULT_COINS, formatPrice, parseSignal, type TradeSignal } from './signal'
import { appUrl, escapeHtml, tg, type TgUser } from './telegram'
import type { Chat, SignalItem, User } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Update = Record<string, any>

const LOOKS_LIKE_CALL = /\b(long|short|buy|sell|entry|tp\d?|sl|stop|target|beli|jual)\b/i

async function knownCoins(): Promise<string[]> {
  const live = await coinList()
  return live.length ? live : DEFAULT_COINS
}

export async function extractSignal(text: string): Promise<{ signal: TradeSignal; parser: 'rules' | 'llm' } | null> {
  const coins = await knownCoins()
  const rules = parseSignal(text, coins)
  if (rules && rules.confidence >= 0.5) return { signal: rules, parser: 'rules' }
  if (LOOKS_LIKE_CALL.test(text) && /\d/.test(text) && text.length < 1200) {
    const llm = await llmSignal(text, coins)
    if (llm) return { signal: { ...llm, raw: text.slice(0, 500) }, parser: 'llm' }
  }
  return null
}

function inQuietHours(user: User, now = new Date()): boolean {
  const q = user.settings.quietHours
  if (!q) return false
  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: user.settings.tz }).format(now)
  return q.from <= q.to ? hm >= q.from && hm < q.to : hm >= q.from || hm < q.to
}

export function signalLine(s: TradeSignal): string {
  const parts = [`${s.coin} ${s.side} ${s.entry ? formatPrice(s.entry) : 'market'}`]
  if (s.stop) parts.push(`stop ${formatPrice(s.stop)}`)
  if (s.target) parts.push(`target ${formatPrice(s.target)}`)
  return parts.join(' · ')
}

/** Deliver a parsed call to every user watching the chat. Returns how many users got it. */
export async function deliver(chat: Chat, messageId: number | undefined, text: string, onlyUser?: number): Promise<number> {
  const found = await extractSignal(text)
  if (!found) return 0
  await upsertChat(chat, c => ({ ...c, signalsSeen: c.signalsSeen + 1, lastSignalAt: Date.now() }))
  const owners = onlyUser ? [onlyUser] : chat.owners
  let n = 0
  for (const uid of owners) {
    const user = await getUser(uid)
    if (!user) continue
    if (!onlyUser && user.sources[String(chat.id)] === false) continue
    const coins = user.settings.coins
    if (coins.length && !coins.includes(found.signal.coin)) continue
    if (user.settings.requireStop && (found.signal.entry === null || found.signal.stop === null)) continue
    if (inQuietHours(user)) continue
    const item: SignalItem = {
      id: `${chat.id}:${messageId ?? Date.now()}`,
      chatId: chat.id,
      chatTitle: chat.title,
      messageId,
      signal: found.signal,
      receivedAt: Date.now(),
      status: 'new',
      parser: found.parser,
    }
    await pushSignal(uid, item)
    n++
  }
  return n
}

const openAppButton = (text = 'Open Wink') => ({ inline_keyboard: [[{ text, web_app: { url: appUrl('/app') } }]] })

async function reply(chatId: number, html: string, extra: Record<string, unknown> = {}) {
  await tg('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra }).catch(() => undefined)
}

function chatFrom(c: any): Chat {
  return {
    id: c.id,
    title: c.title ?? [c.first_name, c.last_name].filter(Boolean).join(' ') ?? 'Chat',
    type: c.type,
    username: c.username,
    owners: [],
    messagesSeen: 0,
    signalsSeen: 0,
    firstSeen: Date.now(),
  }
}

export async function handleUpdate(update: Update): Promise<void> {
  // Bot added to / removed from a group or channel.
  if (update.my_chat_member) {
    const m = update.my_chat_member
    const status = m.new_chat_member?.status
    const from: TgUser = m.from
    if (m.chat.type === 'private') return
    if (status === 'member' || status === 'administrator') {
      await upsertUser(from)
      const chat = await upsertChat(chatFrom(m.chat))
      await linkSource(from.id, chat)
      const count = await tg<number>('getChatMemberCount', { chat_id: chat.id }).catch(() => undefined)
      if (count) await upsertChat(chat, c => ({ ...c, memberCount: count }))
      const needsAdmin = m.chat.type !== 'channel' && status !== 'administrator'
      await reply(from.id,
        `Watching <b>${escapeHtml(chat.title)}</b>. Trade calls posted there will show up on your glasses.` +
        (needsAdmin ? `\n\nTelegram only shows bots every group message when the bot is an admin. Promote @WinkSignal_Bot to admin (no permissions needed), or calls will only arrive when someone replies to the bot.` : ''),
        { reply_markup: openAppButton('Manage sources') })
    }
    return
  }

  const msg = update.message ?? update.channel_post ?? update.edited_channel_post
  if (!msg) return
  const text: string = msg.text ?? msg.caption ?? ''

  if (msg.chat.type === 'private') {
    const from: TgUser = msg.from
    const user = await upsertUser(from)
    if (/^\/start\b/.test(text)) {
      await reply(msg.chat.id,
        `<b>Wink</b> puts trade calls from your Telegram groups on Even G2 glasses, and lets you place them on Hyperliquid testnet with one tap.\n\n` +
        `1. Open Wink and pair your glasses with the 6-character code.\n` +
        `2. Add @WinkSignal_Bot to a group or channel that posts calls, or forward a call here.\n` +
        `3. Tap on the glasses to buy, say “skip” to pass.\n\nTestnet only. Wink never holds funds and this is not financial advice.`,
        { reply_markup: openAppButton() })
      return
    }
    if (/^\/help\b/.test(text)) {
      await reply(msg.chat.id, `Forward a channel post or paste a call like <code>ETH long 3400 stop 3320 target 3560</code>. I will send it to your paired glasses.`, { reply_markup: openAppButton() })
      return
    }
    // Forwarded channel/group post: treat that chat as a source.
    const origin = msg.forward_origin
    let chat: Chat
    if (origin?.type === 'channel' || origin?.type === 'chat') {
      const src = origin.chat ?? origin.sender_chat
      chat = (await getChat(src.id)) ?? chatFrom(src)
      chat = await upsertChat(chat, c => ({ ...c, messagesSeen: c.messagesSeen + 1 }))
      await linkSource(user.id, chat)
    } else {
      chat = await upsertChat({ id: msg.chat.id, title: 'Sent to bot', type: 'private' }, c => ({ ...c, title: 'Sent to bot', messagesSeen: c.messagesSeen + 1, owners: [user.id] }))
    }
    const n = await deliver(chat, origin?.message_id ?? msg.message_id, text, user.id)
    const found = n ? (await extractSignal(text))?.signal : null
    await reply(msg.chat.id, found
      ? `Sent to your glasses: <b>${escapeHtml(signalLine(found))}</b>`
      : `I could not find a trade call in that message, or it was filtered by your coin list. Try <code>ETH long 3400 stop 3320 target 3560</code>.`)
    return
  }

  // Group / supergroup / channel message.
  const chat = await upsertChat(chatFrom(msg.chat), c => ({ ...c, messagesSeen: c.messagesSeen + 1 }))
  if (/^\/watch(@\w+)?\b/.test(text) && msg.from) {
    await upsertUser(msg.from)
    await linkSource(msg.from.id, chat)
    await reply(msg.chat.id, `Calls from this chat now go to ${escapeHtml(msg.from.first_name)}'s glasses.`)
    return
  }
  if (!text || !chat.owners.length) return
  await deliver(chat, msg.message_id, text)
}
