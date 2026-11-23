import { json } from '@/lib/http'
import { info } from '@/lib/hl'

export const dynamic = 'force-dynamic'

export async function GET() {
  const t = Date.now()
  let hyperliquid: string
  try {
    const mids = (await info.allMids()) as Record<string, string>
    hyperliquid = `ok · ETH ${mids.ETH} · ${Date.now() - t}ms`
  } catch (e) {
    hyperliquid = `error: ${(e as Error).message}`
  }
  return json({
    ok: true,
    network: 'hyperliquid-testnet',
    hyperliquid,
    storage: process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'memory',
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    demoAccount: process.env.HL_MASTER_ADDRESS ?? null,
  })
}
