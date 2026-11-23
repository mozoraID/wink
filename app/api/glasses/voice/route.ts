import { handle, HttpError, json, preflight, glassesDevice } from '@/lib/http'
import { pcmToWav, speechToText } from '@/lib/ai'
import { parseIntent } from '@/lib/intent'

export const OPTIONS = preflight
export const maxDuration = 30

// Body: raw PCM s16le, 16 kHz, mono (what the G2 mic delivers), up to ~8 s.
export const POST = handle(async req => {
  await glassesDevice(req)
  const pcm = new Uint8Array(await req.arrayBuffer())
  if (pcm.length < 3200) throw new HttpError(400, 'Too little audio')
  if (pcm.length > 16000 * 2 * 8) throw new HttpError(413, 'Keep it under 8 seconds')
  const t = Date.now()
  const { text, provider } = await speechToText(pcmToWav(pcm))
  return json({ transcript: text, intent: parseIntent(text), provider, ms: Date.now() - t }, 200, true)
}, true)
