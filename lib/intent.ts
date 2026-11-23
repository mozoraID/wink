// Maps a short spoken phrase to a glasses action. English plus casual Indonesian.
export type Intent =
  | { action: 'buy'; amountUsd?: number }
  | { action: 'sell'; amountUsd?: number }
  | { action: 'skip' }
  | { action: 'yes' }
  | { action: 'no' }
  | { action: 'close'; fraction: number }
  | { action: 'next' }
  | { action: 'unknown' }

const AMOUNT = /\$?\s?(\d{1,4})(?:\s?(?:dollars?|bucks|usd|usdc|dolar))?/i

export function parseIntent(transcript: string): Intent {
  const t = transcript.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return { action: 'unknown' }
  if (/\b(close|tutup)\b.*\b(half|setengah|50)\b|\bhalf\b.*\bclose\b/.test(t)) return { action: 'close', fraction: 0.5 }
  if (/\b(close|tutup|exit)\b/.test(t)) return { action: 'close', fraction: 1 }
  if (/\b(skip|pass|ignore|lewati|lewat|skip it|nope|not this)\b/.test(t)) return { action: 'skip' }
  if (/\b(cancel|batal|batalkan|no|nggak|gak|tidak|stop)\b/.test(t)) return { action: 'no' }
  if (/\b(yes|yeah|yep|confirm|do it|ya|iya|oke|ok|okay|gas)\b/.test(t) && !/\b(buy|sell|beli|jual|long|short)\b/.test(t))
    return { action: 'yes' }
  const amt = t.match(AMOUNT)
  const amountUsd = amt ? Number(amt[1]) : undefined
  if (/\b(buy|long|beli|go long|take it|take the trade|enter)\b/.test(t)) return { action: 'buy', amountUsd }
  if (/\b(sell|short|jual|go short)\b/.test(t)) return { action: 'sell', amountUsd }
  if (/\b(next|berikutnya|lanjut)\b/.test(t)) return { action: 'next' }
  return { action: 'unknown' }
}
