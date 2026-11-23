import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

function key(): Buffer {
  const secret = process.env.WINK_SECRET
  if (!secret) throw new Error('WINK_SECRET is not set')
  return createHash('sha256').update(secret).digest()
}

export function seal(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64url')).join('.')
}

export function open(sealed: string): string {
  const [iv, tag, enc] = sealed.split('.').map(s => Buffer.from(s, 'base64url'))
  const d = createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function token(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L
export function pairCode(): string {
  const b = randomBytes(6)
  return Array.from(b, x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('')
}
