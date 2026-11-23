'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownRight, ArrowUpRight, Check, ChevronRight, Clock, Copy, Glasses, History, Megaphone, Minus,
  Plus, Radio, RefreshCw, Search, ShieldCheck, Users, Wallet, X, Send, CircleAlert, CircleDot,
} from 'lucide-react'
import { confirmDialog, haptic, openExternal, openTg, webApp } from './tg'

type Tab = 'Glasses' | 'Wallet' | 'Sources' | 'Activity'

interface Position { coin: string; side: 'long' | 'short'; size: number; entry: number; mark: number; pnl: number; roe: number; leverage: number; notional: number }
interface Signal {
  id: string; chatId: number; chatTitle: string; receivedAt: number; parser: string
  status: 'new' | 'filled' | 'skipped' | 'expired' | 'rejected' | 'failed'; note?: string
  signal: { coin: string; side: 'long' | 'short'; entry: number | null; stop: number | null; target: number | null; leverage: number | null }
  order?: { side: string; usd: number; size: string; avgPx: string | null; at: number }
}
interface State {
  user: { id: number; name: string; username?: string }
  settings: { orderUsd: number; maxPerTrade: number; dailyLossCap: number; requireStop: boolean; coins: string[]; quietHours: { from: string; to: string } | null }
  wallet: { mode: 'demo'; master: string | null } | { mode: 'own'; master: string; agent: string }
  account: { address: string; accountValue: number; unrealized: number; marginUsed: number; withdrawable: number; positions: Position[]; dayPnl: number } | null
  accountError: string | null
  sources: Array<{ id: number; title: string; type: string; username?: string; memberCount: number | null; signalsSeen: number; messagesSeen: number; firstSeen: number; lastSignalAt: number | null; enabled: boolean }>
  signals: Signal[]
  events: Array<{ id: string; kind: string; coin: string; text: string; usd?: number; at: number }>
  devices: Array<{ label: string; createdAt: number; lastSeen: number }>
  pairing: { code: string; expiresAt: number } | null
}

const BOT = 'WinkSignal_Bot'
const SUGGESTED = ['BTC', 'ETH', 'SOL', 'HYPE', 'DOGE', 'ARB', 'SUI']
const AV_COLORS = ['#d9822b', '#3a8f7a', '#5c7cba', '#b5654f', '#7d62b3', '#3f8fb5', '#a3854a']

const usd = (n: number, sign = false) => {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? '−' : sign ? '+' : ''}$${s}`
}
const px = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const a = Math.abs(n)
  return n.toLocaleString('en-US', { maximumFractionDigits: a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 5 })
}
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const compact = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n)
const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
const initials = (t: string) => t.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '#'
const colorFor = (id: number) => AV_COLORS[Math.abs(id) % AV_COLORS.length]

function useApi() {
  const auth = useRef('')
  const call = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `tma ${auth.current}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`)
    return j as T
  }, [])
  return { auth, call }
}

export default function MiniApp() {
  const [tab, setTab] = useState<Tab>('Glasses')
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outside, setOutside] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [dark, setDark] = useState(false)
  const { auth, call } = useApi()

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 2600)
  }, [])

  const load = useCallback(async () => {
    try {
      setState(await call<State>('/api/me'))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [call])

  useEffect(() => {
    const wa = webApp()
    if (!wa?.initData) {
      setOutside(true)
      return
    }
    auth.current = wa.initData
    wa.ready()
    wa.expand()
    const applyScheme = () => setDark(wa.colorScheme === 'dark')
    applyScheme()
    wa.onEvent('themeChanged', applyScheme)
    try {
      wa.setHeaderColor?.('secondary_bg_color')
      wa.setBackgroundColor?.('secondary_bg_color')
    } catch { /* older clients */ }
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && ['Glasses', 'Wallet', 'Sources', 'Activity'].includes(t)) setTab(t as Tab)
    load()
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 5000)
    return () => window.clearInterval(id)
  }, [auth, load])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const act = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) { haptic.ok(); flash(ok) }
      await load()
    } catch (e) {
      haptic.err()
      flash((e as Error).message)
    }
  }, [flash, load])

  if (outside) return <Outside />

  return (
    <div className="shell">
      <main key={tab} className="view">
        {!state && !error && <Loading />}
        {error && !state && <div className="callout" role="alert"><b>Could not load.</b> {error}</div>}
        {state && tab === 'Glasses' && <GlassesTab s={state} call={call} act={act} flash={flash} />}
        {state && tab === 'Wallet' && <WalletTab s={state} call={call} act={act} />}
        {state && tab === 'Sources' && <SourcesTab s={state} call={call} act={act} />}
        {state && tab === 'Activity' && <ActivityTab s={state} call={call} act={act} />}
      </main>
      <nav className="tabs" aria-label="Sections">
        {([['Glasses', Glasses], ['Wallet', Wallet], ['Sources', Radio], ['Activity', History]] as const).map(([name, Icon]) => (
          <button key={name} className={`tab ${tab === name ? 'on' : ''}`} aria-current={tab === name ? 'page' : undefined}
            onClick={() => { haptic.tick(); setTab(name) }}>
            <Icon size={24} strokeWidth={1.75} aria-hidden />{name}
          </button>
        ))}
      </nav>
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}

type Call = <T>(path: string, body?: unknown) => Promise<T>
type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>

function Loading() {
  return (
    <div aria-busy="true">
      <div className="skel" style={{ height: 34, width: 200, marginTop: 12 }} />
      <div className="skel" style={{ height: 40, marginTop: 10 }} />
      <div className="skel" style={{ height: 200, marginTop: 20, borderRadius: 16 }} />
      <div className="skel" style={{ height: 120, marginTop: 24, borderRadius: 12 }} />
    </div>
  )
}

function Outside() {
  return (
    <div className="shell"><main>
      <h1 style={{ marginTop: 40 }}>Wink</h1>
      <p className="lead">Trade calls from your Telegram groups on Even G2 glasses. Glance at the call, say what you want, tap once to place it on Hyperliquid testnet.</p>
      <a className="btn" style={{ marginTop: 24 }} href={`https://t.me/${BOT}?startapp=open`}><Send size={18} aria-hidden />Open in Telegram</a>
      <p className="note"><ShieldCheck size={16} aria-hidden />This page runs inside Telegram so it knows who you are without a password.</p>
    </main></div>
  )
}

/* ------------------------------------------------------------- Glasses */

function GlassesTab({ s, call, act, flash }: { s: State; call: Call; act: Act; flash: (m: string) => void }) {
  const [now, setNow] = useState(Date.now())
  const paired = s.devices.length > 0
  const requested = useRef(false)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    if (!s.pairing && !paired && !requested.current) {
      requested.current = true
      act(() => call('/api/me/pair', {}))
    }
  }, [s.pairing, paired, act, call])

  const code = s.pairing?.code ?? ''
  const left = s.pairing ? Math.max(0, s.pairing.expiresAt - now) : 0
  const frac = s.pairing ? left / (5 * 60_000) : 0
  const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000)

  return (
    <>
      <h1>{paired ? 'Your G2' : 'Pair your G2'}</h1>
      <p className="lead">{paired ? 'Calls from your sources appear on the glasses. Tap to buy, say “skip” to pass.' : 'Open Wink on your glasses from the Even app, then enter this code.'}</p>
      <div className="steps" aria-label="Pairing steps">
        <span className="st done"><i><Check size={12} strokeWidth={3} aria-hidden /></i>Open app</span><span className="ln" />
        <span className={`st ${paired ? 'done' : 'cur'}`}><i>{paired ? <Check size={12} strokeWidth={3} aria-hidden /> : 2}</i>Enter code</span><span className="ln" />
        <span className={`st ${paired ? 'cur' : ''}`}><i>3</i>Tap to trade</span>
      </div>

      <div className="code">
        <div className="code-l">
          <span>Pairing code</span>
          {s.pairing && left > 0
            ? <span className="timer num"><span className="ring" style={{ background: `conic-gradient(var(--tg-link) 0 ${frac * 100}%, var(--tg-separator) 0)` }} />Expires in {mm}:{String(ss).padStart(2, '0')}</span>
            : <span>{paired ? 'Pair another device' : 'Expired'}</span>}
        </div>
        <div className="cells" aria-label={code ? `Code ${code.split('').join(' ')}` : 'No code'}>
          {[0, 1, 2].map(i => <div key={i} className={`cell ${code && left > 0 ? '' : 'empty'}`}>{code && left > 0 ? code[i] : '·'}</div>)}
          <div className="dash" />
          {[3, 4, 5].map(i => <div key={i} className={`cell ${code && left > 0 ? '' : 'empty'}`}>{code && left > 0 ? code[i] : '·'}</div>)}
        </div>
        <div className="code-a">
          <button className="btn ghost" disabled={!code || left <= 0} onClick={() => { navigator.clipboard?.writeText(code); haptic.tap(); flash('Code copied') }}><Copy size={18} aria-hidden />Copy code</button>
          <button className="btn ghost" onClick={() => act(() => call('/api/me/pair', {}))}><RefreshCw size={18} aria-hidden />New code</button>
        </div>
      </div>

      <div className="sec-h"><span>Devices</span>{paired && <button onClick={async () => { if (await confirmDialog('Unpair all glasses?')) act(() => call('/api/me/unpair', {}), 'Glasses unpaired') }}>Unpair</button>}</div>
      <div className="group" style={{ ['--inset' as string]: '64px' }}>
        {paired ? s.devices.map((d, i) => (
          <div className="row" key={i}>
            <div className="dev"><Glasses size={20} strokeWidth={1.75} aria-hidden /></div>
            <div className="grow"><div className="t">{d.label}</div><div className="s">Paired {ago(d.createdAt)} · seen {ago(d.lastSeen)}</div></div>
            <span className={`badge ${Date.now() - d.lastSeen < 120_000 ? 'b-up' : 'b-mute'}`}>{Date.now() - d.lastSeen < 120_000 ? 'Live' : 'Idle'}</span>
          </div>
        )) : (
          <div className="row">
            <div className="dev"><Glasses size={20} strokeWidth={1.75} aria-hidden /></div>
            <div className="grow"><div className="t">Even G2</div><div className="s">Waiting for code…</div></div>
            <span className="pulse" aria-hidden />
          </div>
        )}
        <div className="row">
          <div className="dev"><CircleDot size={20} strokeWidth={1.75} aria-hidden /></div>
          <div className="grow"><div className="t">R1 ring or temple</div><div className="s">Tap = yes · hold = no · swipe = next</div></div>
        </div>
      </div>

      <div className="sec-h"><span>Try it</span></div>
      <button className="btn ghost" onClick={() => act(async () => {
        const r = await call<{ ok: boolean; text: string }>('/api/me/test-signal', {})
        if (!r.ok) throw new Error('Filtered by your coin list')
      }, 'Test call sent to your glasses')}><Send size={18} aria-hidden />Send a test call</button>
      <p className="foot" style={{ padding: '8px 4px 0' }}>Builds a call from the live testnet price and runs it through the same parser as your groups.</p>

      <p className="note"><ShieldCheck size={16} aria-hidden style={{ marginTop: 1 }} /><span>Wink never holds funds. Orders go to your Hyperliquid testnet account only after you confirm on the glasses. Not financial advice.</span></p>
    </>
  )
}

/* -------------------------------------------------------------- Wallet */

function HlMark() {
  return <span className="hl-mark"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M1 7c2-4 3.5-4 6 0s4 4 6 0" stroke="#97fce4" strokeWidth="2.2" fill="none" strokeLinecap="round" /></svg></span>
}

function WalletTab({ s, call, act }: { s: State; call: Call; act: Act }) {
  const a = s.account
  const [editing, setEditing] = useState(false)
  const [master, setMaster] = useState('')
  const [key, setKey] = useState('')
  const addr = a?.address ?? s.wallet.master ?? ''
  const [whole, cents] = (a?.accountValue ?? 0).toFixed(2).split('.')

  const closeAll = async () => {
    if (!a?.positions.length) return
    if (!(await confirmDialog(`Close all ${a.positions.length} positions at market on testnet?`))) return
    act(async () => { for (const p of a.positions) await call('/api/me/close', { coin: p.coin, fraction: 1 }) }, 'Positions closed')
  }

  return (
    <>
      <div className="acct">
        <div className="acct-top">
          <div className="hl"><HlMark />Hyperliquid<span className="badge b-accent" style={{ marginLeft: 2 }}>TESTNET</span></div>
          {addr && <button className="addr mono" onClick={() => { navigator.clipboard?.writeText(addr); haptic.tap() }} aria-label="Copy address">{short(addr)}<Copy size={14} aria-hidden /></button>}
        </div>
        <div className={`big num ${a ? '' : 'skel'}`} style={a ? undefined : { width: 180 }}>${Number(whole).toLocaleString('en-US')}<small>.{cents}</small></div>
        <div className="lbl" style={{ marginTop: 2 }}>Account value</div>
        <div className="stats num">
          <div><span className="lbl">Unrealized</span><b className={a && a.unrealized < 0 ? 'down' : 'up'}>{a ? usd(a.unrealized, true) : '—'}</b></div>
          <div><span className="lbl">Margin used</span><b>{a ? usd(a.marginUsed) : '—'}</b></div>
          <div><span className="lbl">Withdrawable</span><b>{a ? usd(a.withdrawable) : '—'}</b></div>
        </div>
      </div>

      {s.accountError && <div className="callout" role="alert"><b>Hyperliquid did not answer.</b> {s.accountError}</div>}
      {a && a.accountValue === 0 && (
        <div className="callout"><b>No testnet USDC yet.</b> Claim mock USDC from the Hyperliquid testnet faucet with a wallet that has used Hyperliquid mainnet, then send it to this account or link your own account below. <button style={{ color: 'var(--tg-link)' }} onClick={() => openExternal('https://app.hyperliquid-testnet.xyz/drip')}>Open faucet</button></div>
      )}

      <div className="sec-h"><span>Open positions · {a?.positions.length ?? 0}</span>{!!a?.positions.length && <button onClick={closeAll}>Close all</button>}</div>
      <div className="group pos" style={{ ['--inset' as string]: '64px' }}>
        {!a?.positions.length && <div className="empty-row">No open positions. Confirm a call on the glasses and it shows up here.</div>}
        {a?.positions.map(p => (
          <div className="row" key={p.coin}>
            <div className="tk">{p.coin.slice(0, 4)}</div>
            <div className="grow">
              <div className="t">{p.coin} <span className={`badge ${p.side === 'long' ? 'b-up' : 'b-down'}`}>{p.side === 'long' ? 'Long' : 'Short'} {p.leverage}×</span></div>
              <div className="s num">{p.size} · Entry {px(p.entry)}</div>
            </div>
            <div className="v num"><b className={p.pnl < 0 ? 'down' : 'up'}>{usd(p.pnl, true)}</b><span className={p.pnl < 0 ? 'down' : 'up'}>{p.roe >= 0 ? '+' : '−'}{Math.abs(p.roe * 100).toFixed(1)}%</span></div>
          </div>
        ))}
      </div>

      <div className="sec-h"><span>Connection</span></div>
      <div className="group">
        <div className="row">
          <div className="grow">
            <div className="t">{s.wallet.mode === 'own' ? 'Your testnet account' : 'Shared demo account'}</div>
            <div className="s">API key · trades only, no withdrawals</div>
          </div>
          <span className={`badge ${s.wallet.master ? 'b-up' : 'b-warn'}`}>{s.wallet.master ? 'Active' : 'Not set'}</span>
        </div>
        {s.wallet.mode === 'own'
          ? <button className="row" onClick={() => act(() => call('/api/me/wallet', { mode: 'demo' }), 'Switched to demo account')}><div className="grow"><div className="t" style={{ color: 'var(--tg-link)', fontWeight: 400 }}>Use the shared demo account</div></div></button>
          : <button className="row" onClick={() => setEditing(e => !e)} aria-expanded={editing}><div className="grow"><div className="t" style={{ color: 'var(--tg-link)', fontWeight: 400 }}>Link my own testnet account</div></div><ChevronRight size={16} className="chev" aria-hidden /></button>}
      </div>
      {editing && s.wallet.mode !== 'own' && (
        <form className="callout" onSubmit={e => { e.preventDefault(); act(() => call('/api/me/wallet', { mode: 'own', master: master.trim(), agentKey: key.trim() }), 'Account linked').then(() => setEditing(false)) }}>
          On <button type="button" style={{ color: 'var(--tg-link)' }} onClick={() => openExternal('https://app.hyperliquid-testnet.xyz/API')}>app.hyperliquid-testnet.xyz/API</button>, create an API wallet and approve it. It can trade but cannot withdraw. Paste your main address and the API wallet&apos;s private key.
          <input className="field mono" placeholder="Main address 0x…" value={master} onChange={e => setMaster(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Main address" />
          <input className="field mono" placeholder="API wallet private key 0x…" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" spellCheck={false} type="password" aria-label="API wallet private key" />
          <button className="btn" style={{ marginTop: 12, height: 44 }} disabled={!master || !key}>Link account</button>
        </form>
      )}
    </>
  )
}

/* ------------------------------------------------------------- Sources */

function SourcesTab({ s, call, act }: { s: State; call: Call; act: Act }) {
  const [adding, setAdding] = useState(false)
  const [coin, setCoin] = useState('')
  const coins = s.settings.coins
  const all = useMemo(() => [...new Set([...coins, ...SUGGESTED])], [coins])
  const on = s.sources.filter(x => x.enabled).length
  const setCoins = (next: string[]) => act(() => call('/api/me/settings', { coins: next }))

  return (
    <>
      <button className="search" onClick={() => openTg(`https://t.me/${BOT}?startgroup=watch&admin=delete_messages`)}><Search size={17} aria-hidden />Add a group or channel…</button>
      <div className="sec-h"><span className="num">Watching · {on} of {s.sources.length}</span></div>
      <div className="group src" style={{ ['--inset' as string]: '64px' }}>
        {!s.sources.length && <div className="empty-row">No sources yet. Add @{BOT} to a group as admin, or forward a channel post to the bot.</div>}
        {s.sources.map(src => {
          const Icon = src.type === 'channel' ? Megaphone : Users
          const kind = src.type === 'channel' ? 'Channel' : 'Group'
          return (
            <div className="row" key={src.id}>
              <div className="av" style={{ background: colorFor(src.id) }}>{initials(src.title)}</div>
              <div className="grow">
                <div className="t">{src.title}<Icon size={14} color="var(--tg-hint)" aria-hidden /></div>
                <div className="s num">{kind}{src.memberCount ? ` · ${compact(src.memberCount)} ${src.type === 'channel' ? 'subscribers' : 'members'}` : ''} · {src.signalsSeen} {src.signalsSeen === 1 ? 'call' : 'calls'}{src.lastSignalAt ? ` · last ${ago(src.lastSignalAt)}` : ''}</div>
              </div>
              <button role="switch" aria-checked={src.enabled} aria-label={`Watch ${src.title}`} className={`toggle ${src.enabled ? 'on' : ''}`}
                onClick={() => { haptic.tick(); act(() => call('/api/me/sources', { chatId: src.id, enabled: !src.enabled })) }} />
            </div>
          )
        })}
      </div>
      <div className="foot">Add @{BOT} to a group or channel, or forward a channel post to the bot.</div>

      <div className="sec-h"><span>Coins</span><span style={{ textTransform: 'none' }}>{coins.length ? `${coins.length} selected` : 'All coins'}</span></div>
      <div className="chips">
        {all.map(c => {
          const sel = coins.includes(c)
          return <button key={c} className={`chip ${sel ? 'on' : ''}`} aria-pressed={sel} onClick={() => { haptic.tick(); setCoins(sel ? coins.filter(x => x !== c) : [...coins, c]) }}>{sel && <Check size={14} strokeWidth={2.5} aria-hidden />}{c}</button>
        })}
        {adding
          ? <form onSubmit={e => { e.preventDefault(); const c = coin.trim().toUpperCase(); if (c) setCoins([...coins, c]); setCoin(''); setAdding(false) }}>
              <input className="chip-in" autoFocus value={coin} onChange={e => setCoin(e.target.value)} onBlur={() => setAdding(false)} placeholder="AVAX" aria-label="Add coin" maxLength={10} />
            </form>
          : <button className="chip add" onClick={() => setAdding(true)}><Plus size={14} strokeWidth={2.5} aria-hidden />Add</button>}
      </div>

      <div className="sec-h" style={{ marginTop: 20 }}><span>Filters</span></div>
      <div className="group">
        <div className="row" style={{ minHeight: 48 }}>
          <div className="grow"><div className="t" style={{ fontWeight: 400 }}>Require entry and stop-loss</div></div>
          <button role="switch" aria-checked={s.settings.requireStop} aria-label="Require entry and stop-loss" className={`toggle ${s.settings.requireStop ? 'on' : ''}`}
            onClick={() => { haptic.tick(); act(() => call('/api/me/settings', { requireStop: !s.settings.requireStop })) }} />
        </div>
        <div className="row" style={{ minHeight: 48 }}>
          <div className="grow"><div className="t" style={{ fontWeight: 400 }}>Quiet hours</div><div className="s num">{s.settings.quietHours ? `${s.settings.quietHours.from}–${s.settings.quietHours.to}` : 'Off'}</div></div>
          <button role="switch" aria-checked={!!s.settings.quietHours} aria-label="Quiet hours 23:00 to 07:00" className={`toggle ${s.settings.quietHours ? 'on' : ''}`}
            onClick={() => { haptic.tick(); act(() => call('/api/me/settings', { quietHours: s.settings.quietHours ? null : { from: '23:00', to: '07:00' } })) }} />
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------ Activity */

function ActivityTab({ s, call, act }: { s: State; call: Call; act: Act }) {
  const [range, setRange] = useState<'Today' | '7 days' | 'All'>('Today')
  const since = range === 'Today' ? new Date().setHours(0, 0, 0, 0) : range === '7 days' ? Date.now() - 7 * 86400_000 : 0
  const signals = s.signals.filter(x => x.receivedAt >= since)
  const events = s.events.filter(x => x.at >= since)
  const filled = signals.filter(x => x.status === 'filled').length
  type Item = { key: string; at: number; el: React.ReactNode }
  const items: Item[] = [
    ...signals.map(x => ({ key: x.id, at: x.receivedAt, el: <SignalRow x={x} /> })),
    ...events.map(e => ({
      key: e.id, at: e.at, el: (
        <div className="row"><div className="ico i-mute"><X size={17} strokeWidth={2} aria-hidden /></div>
          <div className="grow"><div className="t">{e.text.split(' · ')[0]}</div><div className="s num">{e.text.split(' · ').slice(1).join(' · ')}</div></div>
          <div className="v num"><b>{e.usd ? usd(e.usd) : '—'}</b>{hhmm(e.at)}</div></div>
      ),
    })),
  ].sort((a, b) => b.at - a.at)

  const st = s.settings
  const loss = Math.max(0, -(s.account?.dayPnl ?? 0))
  const lossPct = Math.min(100, (loss / st.dailyLossCap) * 100)
  const step = (d: number) => {
    const next = Math.min(st.maxPerTrade, Math.max(10, st.orderUsd + d))
    haptic.tick()
    act(() => call('/api/me/settings', { orderUsd: next }))
  }

  return (
    <>
      <div className="seg" role="tablist">
        {(['Today', '7 days', 'All'] as const).map(r => <button key={r} role="tab" aria-selected={range === r} className={range === r ? 'on' : ''} onClick={() => { haptic.tick(); setRange(r) }}>{r}</button>)}
      </div>
      <div className="sec-h" style={{ marginTop: 20 }}><span>Recent</span><span className="num">{signals.length} {signals.length === 1 ? 'signal' : 'signals'} · {filled} filled</span></div>
      <div className="group act" style={{ ['--inset' as string]: '60px' }}>
        {!items.length && <div className="empty-row">Nothing yet{range !== 'All' ? ' in this range' : ''}. Calls from your sources land here with what you did.</div>}
        {items.slice(0, 30).map(i => <div key={i.key} style={{ display: 'contents' }}>{i.el}</div>)}
      </div>

      <div className="sec-h"><span>Order limits</span></div>
      <div className="group set">
        <div className="row">
          <div className="grow"><div className="t">Default order size</div></div>
          <div className="stepper num">
            <button aria-label="Decrease" disabled={st.orderUsd <= 10} onClick={() => step(-10)}><Minus size={16} strokeWidth={2.5} aria-hidden /></button>
            <b>${st.orderUsd}</b>
            <button aria-label="Increase" disabled={st.orderUsd >= st.maxPerTrade} onClick={() => step(10)}><Plus size={16} strokeWidth={2.5} aria-hidden /></button>
          </div>
        </div>
        <button className="row" onClick={() => act(() => call('/api/me/settings', { maxPerTrade: st.maxPerTrade === 250 ? 100 : 250 }))}>
          <div className="grow"><div className="t">Max per trade</div></div><span className="val num">${st.maxPerTrade}<ChevronRight size={16} className="chev" aria-hidden /></span>
        </button>
        <button className="row" style={{ display: 'block', paddingTop: 12, paddingBottom: 12 }} onClick={() => act(() => call('/api/me/settings', { dailyLossCap: st.dailyLossCap === 100 ? 50 : 100 }))}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="t">Daily loss cap</span><span className="val num">{usd(loss)} of ${st.dailyLossCap}<ChevronRight size={16} className="chev" aria-hidden /></span></div>
          <div className="bar"><i className={lossPct > 80 ? 'hot' : ''} style={{ width: `${Math.max(lossPct, 1)}%` }} /></div>
        </button>
        <div className="row"><div className="grow"><div className="t">Confirm with</div></div><span className="val">Tap or R1 ring</span></div>
      </div>
      <p className="foot">Every order needs a tap on the glasses. Wink blocks new orders once today&apos;s realized loss reaches the cap.</p>
    </>
  )
}

function SignalRow({ x }: { x: Signal }) {
  const sig = x.signal
  const title = `${sig.coin} ${sig.side}`
  const map: Record<Signal['status'], { label: string; icon: React.ReactNode; cls: string }> = {
    new: { label: 'On glasses', icon: <Glasses size={17} strokeWidth={2} aria-hidden />, cls: 'i-new' },
    filled: { label: 'Filled', icon: x.order?.side === 'sell' ? <ArrowDownRight size={17} strokeWidth={2} aria-hidden /> : <ArrowUpRight size={17} strokeWidth={2} aria-hidden />, cls: x.order?.side === 'sell' ? 'i-down' : 'i-up' },
    skipped: { label: 'Skipped', icon: <X size={17} strokeWidth={2} aria-hidden />, cls: 'i-mute' },
    expired: { label: 'Expired', icon: <Clock size={17} strokeWidth={2} aria-hidden />, cls: 'i-mute' },
    rejected: { label: 'Blocked', icon: <CircleAlert size={17} strokeWidth={2} aria-hidden />, cls: 'i-mute' },
    failed: { label: 'Not filled', icon: <CircleAlert size={17} strokeWidth={2} aria-hidden />, cls: 'i-mute' },
  }
  const m = map[x.status]
  const sub = x.status === 'filled' && x.order
    ? `${x.chatTitle} · ${x.order.size} @ ${px(Number(x.order.avgPx))}`
    : x.status === 'skipped' ? `${x.chatTitle} · ${x.note === 'voice' ? 'said “skip”' : 'skipped'}`
    : x.status === 'expired' ? `${x.chatTitle} · no confirm in 10 min`
    : x.status === 'new' ? `${x.chatTitle} · ${px(sig.entry)}${sig.stop ? ` / stop ${px(sig.stop)}` : ''}`
    : `${x.chatTitle} · ${x.note ?? ''}`
  return (
    <div className="row">
      <div className={`ico ${m.cls}`}>{m.icon}</div>
      <div className="grow"><div className="t">{title} · {m.label}</div><div className="s num">{sub}</div></div>
      <div className="v num"><b>{x.order ? usd(x.order.usd) : '—'}</b>{hhmm(x.receivedAt)}</div>
    </div>
  )
}
