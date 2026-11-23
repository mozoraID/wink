import { OsEventTypeList, waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { api, hasToken, setToken, type GlassesSignal, type GlassesState, type Intent, type Position } from './api'
import { Display, type Card } from './display'
import { Utterances } from './voice'
import { companion } from './companion'

type View =
  | { kind: 'pair' }
  | { kind: 'idle' }
  | { kind: 'signal'; signal: GlassesSignal }
  | { kind: 'confirm'; signal: GlassesSignal; side: 'buy' | 'sell'; usd: number; until: number }
  | { kind: 'closeConfirm'; pos: Position; fraction: number; until: number }
  | { kind: 'busy'; title: string; detail: string }
  | { kind: 'result'; ok: boolean; title: string; detail: string; until: number }
  | { kind: 'positions'; index: number }

const CONFIRM_MS = 10_000
const fmt = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  return n.toLocaleString('en-US', { maximumFractionDigits: a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 5 })
}
const money = (n: number, sign = true) => `${n < 0 ? '−' : sign ? '+' : ''}$${Math.abs(n).toFixed(2)}`
const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const sizeFor = (usd: number, price: number | null) => {
  if (!price) return null
  const s = usd / price
  return s >= 100 ? s.toFixed(0) : s >= 1 ? s.toFixed(2) : s >= 0.01 ? s.toFixed(3) : s.toFixed(4)
}

let bridge: EvenAppBridge
let display: Display
let view: View = { kind: 'pair' }
let state: GlassesState | null = null
const dismissed = new Set<string>()
let micOn = false
let listening = false
let pollTimer = 0
let tickTimer = 0
let holdPositionsUntil = 0

const ui = companion({
  onCode: code => pair(code),
  onUnpair: () => unpair(),
})

async function storageGet(k: string) {
  try { const v = await bridge.getLocalStorage(k); if (v) return v } catch { /* not in host */ }
  return localStorage.getItem(k) ?? ''
}
async function storageSet(k: string, v: string) {
  try { await bridge.setLocalStorage(k, v) } catch { /* not in host */ }
  if (v) localStorage.setItem(k, v)
  else localStorage.removeItem(k)
}

// ---------------------------------------------------------------- render

function cardFor(v: View): Card {
  const s = state
  switch (v.kind) {
    case 'pair':
      return { layout: 'plain', header: '● WINK', headerRight: '', headline: { big: 'Pair in Telegram' },
        sub: 'Open @WinkSignal_Bot › Glasses tab, then enter the\n6-character code in the Even app on your phone.\n\nDouble-tap to exit.' }
    case 'idle': {
      const n = s?.account?.positions.length ?? 0
      return { layout: 'plain', header: `● WATCHING${s ? ` · ${s.sources} SOURCES` : ''}`, headerRight: clock(Date.now()),
        headline: { big: 'No new calls', dim: true },
        sub: (s?.account ? `Account ${money(s.account.value, false)} · Today ${money(s.account.dayPnl)}\n` : '') +
          (n ? `${n} open position${n > 1 ? 's' : ''} · swipe to view` : 'Calls from your Telegram sources show up here.') +
          (s?.last ? `\nLast: ${s.last.coin} ${s.last.status}${s.last.note && s.last.status !== 'filled' ? ` · ${s.last.note}` : ''}` : '') }
    }
    case 'signal': {
      const g = v.signal
      const usd = s?.settings.orderUsd ?? 50
      const parts = [g.stop ? `Stop ${fmt(g.stop)}` : 'No stop given', g.target ? `Target ${fmt(g.target)}` : null, g.leverage ? `${g.leverage}×` : null].filter(Boolean)
      return { layout: 'card', header: `● SIGNAL · ${g.source.toUpperCase().slice(0, 28)}`, headerRight: listening ? '◉ LISTENING' : clock(g.receivedAt),
        headline: { big: `${g.coin} ${g.side} ${g.entry ? fmt(g.entry) : 'now'}` },
        sub: parts.join('  ·  '),
        left: `Tap · ${g.side === 'long' ? 'Buy' : 'Sell'} $${usd}`, right: 'Say “skip”' }
    }
    case 'confirm': {
      const g = v.signal
      const size = sizeFor(v.usd, g.price ?? g.entry)
      const lev = Math.min(g.leverage ?? 3, 5)
      return { layout: 'card', header: 'CONFIRM ORDER', headerRight: `${Math.ceil((v.until - Date.now()) / 1000)}s`,
        headline: { big: `${v.side === 'buy' ? 'Buy' : 'Sell'} ${size ?? ''} ${g.coin}?`.replace('  ', ' ') },
        sub: `@ ${fmt(g.price ?? g.entry)} · $${v.usd.toFixed(2)} · ${lev}× · testnet${g.stop && (v.side === 'buy') === (g.side === 'long') ? ` · SL ${fmt(g.stop)}` : ''}`,
        left: 'Tap · Yes', right: 'Hold · No' }
    }
    case 'closeConfirm': {
      const p = v.pos
      return { layout: 'card', header: 'CONFIRM CLOSE', headerRight: `${Math.ceil((v.until - Date.now()) / 1000)}s`,
        headline: { big: `Close ${v.fraction < 1 ? 'half ' : ''}${p.coin}?` },
        sub: `${fmt(p.size * v.fraction)} ${p.coin} @ ~${fmt(p.mark)} · PnL now ${money(p.pnl * v.fraction)}`,
        left: 'Tap · Yes', right: 'Hold · No' }
    }
    case 'busy':
      return { layout: 'plain', header: '● WINK', headerRight: '', headline: { big: v.title }, sub: v.detail }
    case 'result':
      return { layout: 'plain', header: v.ok ? '● DONE' : '● NOT PLACED', headerRight: '', headline: { big: v.title, dim: !v.ok }, sub: v.detail }
    case 'positions': {
      const list = s?.account?.positions ?? []
      const p = list[v.index]
      if (!p) return cardFor({ kind: 'idle' })
      return { layout: 'plain', header: `● ${p.coin} ${p.side.toUpperCase()} ${p.leverage}×`, headerRight: listening ? '◉ LISTENING' : `${v.index + 1} OF ${list.length}`,
        headline: { big: money(p.pnl), small: `${p.roe >= 0 ? '+' : '−'}${Math.abs(p.roe * 100).toFixed(1)}%` },
        sub: `Mark ${fmt(p.mark)}   Entry ${fmt(p.entry)}   Size ${p.size}\n\nTap, then say “close half” or “close”.${list.length > 1 ? ' Swipe for next.' : ''}` }
    }
  }
}

function go(v: View) {
  view = v
  display.show(cardFor(v))
  ui.mirror(view.kind, cardFor(v))
  syncMic()
}

// ------------------------------------------------------------------ mic

const utter = new Utterances(pcm => onUtterance(pcm))

async function syncMic() {
  const want = view.kind === 'signal' || view.kind === 'confirm' || view.kind === 'closeConfirm' || (view.kind === 'positions' && listening)
  if (want === micOn) return
  micOn = want
  utter.reset()
  try { await bridge.audioControl(want) } catch (e) { console.warn('mic', e) }
}

async function onUtterance(pcm: Uint8Array) {
  ui.status('Transcribing…')
  try {
    const r = await api.voice(pcm)
    ui.heard(r.transcript, r.intent.action, r.provider)
    handleIntent(r.intent)
  } catch (e) {
    ui.status(`Voice failed: ${(e as Error).message}`)
  }
}

function handleIntent(i: Intent) {
  if (view.kind === 'signal') {
    if (i.action === 'skip' || i.action === 'no') return skip(view.signal, 'voice')
    if (i.action === 'buy' || i.action === 'yes') return askConfirm(view.signal, 'buy', i.amountUsd)
    if (i.action === 'sell') return askConfirm(view.signal, 'sell', i.amountUsd)
  } else if (view.kind === 'confirm' || view.kind === 'closeConfirm') {
    if (i.action === 'yes') return confirmYes()
    if (i.action === 'no' || i.action === 'skip') return confirmNo()
  } else if (view.kind === 'positions') {
    listening = false
    const p = state?.account?.positions[view.index]
    if (p && i.action === 'close') return go({ kind: 'closeConfirm', pos: p, fraction: i.fraction ?? 1, until: Date.now() + CONFIRM_MS })
    if (i.action === 'next') return nextPosition(1)
    go(view)
  }
}

// -------------------------------------------------------------- actions

function askConfirm(signal: GlassesSignal, side: 'buy' | 'sell', amount?: number) {
  const s = state?.settings
  const usd = Math.min(amount ?? s?.orderUsd ?? 50, s?.maxPerTrade ?? 250)
  go({ kind: 'confirm', signal, side, usd, until: Date.now() + CONFIRM_MS })
}

async function skip(signal: GlassesSignal, how: string) {
  dismissed.add(signal.id)
  go({ kind: 'result', ok: true, title: `Skipped ${signal.coin}`, detail: how === 'voice' ? 'You said “skip”.' : 'Skipped.', until: Date.now() + 1800 })
  api.act(signal.id, 'skip').catch(() => undefined)
}

async function confirmYes() {
  if (view.kind === 'confirm') {
    const v = view
    dismissed.add(v.signal.id)
    go({ kind: 'busy', title: 'Placing order…', detail: `${v.side === 'buy' ? 'Buying' : 'Selling'} $${v.usd} of ${v.signal.coin} on Hyperliquid testnet` })
    try {
      const r = await api.act(v.signal.id, v.side, v.usd)
      const o = r.signal.order
      go({ kind: 'result', ok: true, title: `Filled ${o?.size} ${v.signal.coin}`, detail: `@ ${fmt(Number(o?.avgPx))} · $${o?.usd.toFixed(2)}${o?.tpsl.length ? `\n${o.tpsl.join(' · ')} attached` : ''}`, until: Date.now() + 2500 })
      afterResult = 'positions'
      afterCoin = v.signal.coin
    } catch (e) {
      go({ kind: 'result', ok: false, title: 'Order not placed', detail: (e as Error).message.slice(0, 180), until: Date.now() + 4000 })
    }
  } else if (view.kind === 'closeConfirm') {
    const v = view
    go({ kind: 'busy', title: 'Closing…', detail: `${v.pos.coin} on Hyperliquid testnet` })
    try {
      const r = await api.close(v.pos.coin, v.fraction)
      go({ kind: 'result', ok: true, title: `Closed ${r.order.size} ${v.pos.coin}`, detail: `@ ${fmt(Number(r.order.avgPx))}`, until: Date.now() + 2500 })
    } catch (e) {
      go({ kind: 'result', ok: false, title: 'Not closed', detail: (e as Error).message.slice(0, 180), until: Date.now() + 4000 })
    }
  }
}

let afterResult: 'positions' | 'auto' = 'auto'
let afterCoin = ''

function confirmNo() {
  if (view.kind === 'confirm') go({ kind: 'signal', signal: view.signal })
  else if (view.kind === 'closeConfirm') go({ kind: 'positions', index: 0 })
}

function nextPosition(d: number) {
  const n = state?.account?.positions.length ?? 0
  if (!n) return
  const i = view.kind === 'positions' ? (view.index + d + n) % n : 0
  go({ kind: 'positions', index: i })
}

// ---------------------------------------------------------------- loop

async function poll() {
  if (!hasToken()) return
  try {
    state = await api.state()
    ui.connected(state)
  } catch (e) {
    const err = e as Error & { status?: number }
    if (err.status === 401) return unpair()
    ui.status(`Offline: ${err.message}`)
    return
  }
  const sig = state.signal && !dismissed.has(state.signal.id) ? state.signal : null
  switch (view.kind) {
    case 'idle':
    case 'positions':
      if (sig && (view.kind === 'idle' || Date.now() > holdPositionsUntil)) return go({ kind: 'signal', signal: sig })
      if (view.kind === 'positions' && !(state.account?.positions.length)) return go({ kind: 'idle' })
      return go(view)
    case 'signal':
      if (!sig) return go({ kind: 'idle' })
      if (sig.id !== view.signal.id) return go({ kind: 'signal', signal: sig })
      view.signal = sig
      return
    default:
      return
  }
}

function tick() {
  const now = Date.now()
  if ((view.kind === 'confirm' || view.kind === 'closeConfirm')) {
    if (now >= view.until) return confirmNo()
    display.tick(`${Math.ceil((view.until - now) / 1000)}s`)
  } else if (view.kind === 'result' && now >= view.until) {
    if (afterResult === 'positions' && state) {
      afterResult = 'auto'
      poll().then(() => {
        const list = state?.account?.positions ?? []
        const i = Math.max(0, list.findIndex(p => p.coin === afterCoin))
        go(list.length ? { kind: 'positions', index: i } : { kind: 'idle' })
      })
      view = { kind: 'busy', title: '', detail: '' }
      return
    }
    go({ kind: 'idle' })
    poll()
  }
}

// --------------------------------------------------------------- input

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

function onInput(type: OsEventTypeList) {
  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      if (view.kind === 'signal') return askConfirm(view.signal, view.signal.side === 'long' ? 'buy' : 'sell')
      if (view.kind === 'confirm' || view.kind === 'closeConfirm') return confirmYes()
      if (view.kind === 'positions') { listening = !listening; return go(view) }
      if (view.kind === 'idle' && state?.account?.positions.length) return go({ kind: 'positions', index: 0 })
      if (view.kind === 'result') { view.until = 0; return tick() }
      return
    case OsEventTypeList.LONG_PRESS_EVENT:
      if (view.kind === 'confirm' || view.kind === 'closeConfirm') return confirmNo()
      if (view.kind === 'signal') return skip(view.signal, 'hold')
      return
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
    case OsEventTypeList.SCROLL_TOP_EVENT: {
      const d = type === OsEventTypeList.SCROLL_BOTTOM_EVENT ? 1 : -1
      if (view.kind === 'positions') { holdPositionsUntil = Date.now() + 15_000; return nextPosition(d) }
      if ((view.kind === 'idle' || view.kind === 'signal') && state?.account?.positions.length) {
        holdPositionsUntil = Date.now() + 15_000
        return go({ kind: 'positions', index: 0 })
      }
      return
    }
  }
}

// ----------------------------------------------------------- lifecycle

async function pair(code: string) {
  ui.status('Linking…')
  try {
    const r = await api.pair(code)
    setToken(r.token)
    await storageSet('wink.token', r.token)
    ui.paired(r.name)
    go({ kind: 'idle' })
    await poll()
  } catch (e) {
    ui.status((e as Error).message)
  }
}

async function unpair() {
  setToken('')
  await storageSet('wink.token', '')
  ui.unpaired()
  go({ kind: 'pair' })
}

async function main() {
  bridge = await waitForEvenAppBridge()
  display = new Display(bridge)
  await display.start('plain')
  const saved = await storageGet('wink.token')
  if (saved) {
    setToken(saved)
    ui.paired('')
    go({ kind: 'idle' })
    poll()
  } else {
    ui.unpaired()
    go({ kind: 'pair' })
  }

  const unsubscribe = bridge.onEvenHubEvent(event => {
    const pcm = event.audioEvent?.audioPcm
    if (pcm && micOn) utter.feed(pcm)
    const sys = eventTypeOf(event.sysEvent)
    const txt = eventTypeOf(event.textEvent)
    const t = sys ?? txt
    if (t === null) return
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) { bridge.shutDownPageContainer(1); return }
    if (t === OsEventTypeList.SYSTEM_EXIT_EVENT || t === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      bridge.audioControl(false).catch(() => undefined)
      window.clearInterval(pollTimer)
      window.clearInterval(tickTimer)
      unsubscribe()
      return
    }
    if (event.audioEvent && !event.sysEvent && !event.textEvent) return
    onInput(t)
  })

  pollTimer = window.setInterval(poll, 2500)
  tickTimer = window.setInterval(tick, 500)
}

main()
