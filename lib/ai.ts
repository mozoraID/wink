// Optional model help through Vercel AI Gateway (OIDC on Vercel, or AI_GATEWAY_API_KEY).
import { generateObject, transcribe } from 'ai'
import { z } from 'zod'
import type { TradeSignal } from './signal'

export const aiAvailable = () => Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL)

const SignalSchema = z.object({
  isTradeCall: z.boolean().describe('true only if the post tells readers to open a new position now'),
  coin: z.string().describe('ticker, e.g. BTC').nullable(),
  side: z.enum(['long', 'short']).nullable(),
  entry: z.number().nullable(),
  stop: z.number().nullable(),
  target: z.number().nullable().describe('first take-profit'),
  leverage: z.number().nullable(),
})

export async function llmSignal(text: string, coins: string[]): Promise<TradeSignal | null> {
  if (!aiAvailable()) return null
  try {
    const { object } = await generateObject({
      model: 'openai/gpt-5-mini',
      schema: SignalSchema,
      abortSignal: AbortSignal.timeout(8000),
      prompt: `Extract a perpetual futures trade call from this Telegram post. Known tickers: ${coins.slice(0, 200).join(', ')}.\nIgnore recaps, results, news and questions.\n\nPost:\n"""${text.slice(0, 1200)}"""`,
    })
    if (!object.isTradeCall || !object.coin || !object.side) return null
    const coin = coins.find(c => c.toUpperCase() === object.coin!.toUpperCase().replace(/^[#$]/, ''))
    if (!coin) return null
    return { coin, side: object.side, entry: object.entry, stop: object.stop, target: object.target, leverage: object.leverage, confidence: 0.7, raw: text.slice(0, 500) }
  } catch {
    return null
  }
}

/** 16 kHz mono s16le PCM -> WAV container, for STT providers that want a file. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 16000): Uint8Array {
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, pcm.length, true)
  const out = new Uint8Array(44 + pcm.length)
  out.set(new Uint8Array(header), 0)
  out.set(pcm, 44)
  return out
}

export async function speechToText(audio: Uint8Array): Promise<{ text: string; provider: string }> {
  if (process.env.ELEVENLABS_API_KEY) {
    const form = new FormData()
    form.append('model_id', 'scribe_v1')
    form.append('file', new Blob([audio as BlobPart], { type: 'audio/wav' }), 'voice.wav')
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      body: form,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}`)
    const j = (await res.json()) as { text: string }
    return { text: j.text ?? '', provider: 'elevenlabs/scribe_v1' }
  }
  const model = process.env.WINK_STT_MODEL ?? 'openai/gpt-transcribe'
  const r = await transcribe({ model, audio, abortSignal: AbortSignal.timeout(15000) })
  return { text: r.text, provider: model }
}
