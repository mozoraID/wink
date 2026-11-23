import { createHmac, createPublicKey, verify as edVerify } from 'node:crypto'
import { safeEqual } from './crypto'

const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(api(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { ok: boolean; result: T; description?: string }
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`)
  return json.result
}

export interface TgUser { id: number; first_name: string; last_name?: string; username?: string; language_code?: string }

// Telegram's Ed25519 key for third-party initData validation (production).
const TG_PUBLIC_KEY = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d'
const edKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(TG_PUBLIC_KEY, 'hex')]), format: 'der', type: 'spki' })

/**
 * Validates Telegram.WebApp.initData. Uses the bot-token HMAC when the token is
 * configured, otherwise Telegram's Ed25519 signature with the public bot id.
 */
export function verifyInitData(initData: string, maxAgeSec = 24 * 3600): TgUser | null {
  if (!initData) return null
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const botId = process.env.TELEGRAM_BOT_ID ?? botToken?.split(':')[0]
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  const signature = params.get('signature')
  params.delete('hash')
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  let valid = false
  if (botToken && hash) {
    const check = pairs.map(([k, v]) => `${k}=${v}`).join('\n')
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
    valid = safeEqual(createHmac('sha256', secret).update(check).digest('hex'), hash)
  }
  if (!valid && signature && botId) {
    const check = `${botId}:WebAppData\n` + pairs.filter(([k]) => k !== 'signature').map(([k, v]) => `${k}=${v}`).join('\n')
    try {
      valid = edVerify(null, Buffer.from(check), edKey, Buffer.from(signature, 'base64url'))
    } catch {
      valid = false
    }
  }
  if (!valid) return null
  const authDate = Number(params.get('auth_date') ?? 0)
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null
  try {
    return JSON.parse(params.get('user') ?? 'null') as TgUser
  } catch {
    return null
  }
}

export function appUrl(path = ''): string {
  const base = process.env.WINK_PUBLIC_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')
  return base.replace(/\/$/, '') + path
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
