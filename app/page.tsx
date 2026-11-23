import Link from 'next/link'

export default function Home() {
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '72px 20px', minHeight: '100dvh' }}>
      <p className="mono" style={{ color: 'var(--tg-hint)', fontSize: 13 }}>wink</p>
      <h1 style={{ marginTop: 8 }}>Trade calls on your glasses.</h1>
      <p className="lead">Wink watches the Telegram groups and channels you pick, finds the trade calls, and shows them on Even G2. Glance, say what you want, tap once to place it on Hyperliquid testnet.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        <a className="btn" href="https://t.me/WinkSignal_Bot" style={{ flex: 1 }}>Open @WinkSignal_Bot</a>
        <Link className="btn ghost" href="/g2/index.html" style={{ flex: 1 }}>Glasses app</Link>
      </div>
      <p className="note" style={{ marginTop: 24 }}>Testnet only. Wink never holds funds. Not financial advice.</p>
    </main>
  )
}
