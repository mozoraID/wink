// Energy-based utterance detector for 16 kHz s16le mono PCM frames (100 ms each).
export class Utterances {
  private pre: Uint8Array[] = []
  private frames: Uint8Array[] = []
  private speaking = false
  private silenceMs = 0
  private speechMs = 0
  private floor = 300
  private maxMs: number

  constructor(private onUtterance: (pcm: Uint8Array) => void, opts: { maxMs?: number } = {}) {
    this.maxMs = opts.maxMs ?? 4500
  }

  reset() {
    this.pre = []; this.frames = []; this.speaking = false; this.silenceMs = 0; this.speechMs = 0
  }

  get isSpeaking() { return this.speaking }

  feed(pcm: Uint8Array) {
    const ms = (pcm.length / 2 / 16000) * 1000
    const level = rms(pcm)
    const threshold = Math.max(700, this.floor * 3)
    if (!this.speaking) {
      this.floor = this.floor * 0.95 + Math.min(level, 4000) * 0.05
      this.pre.push(pcm)
      if (this.pre.length > 4) this.pre.shift()
      if (level > threshold) {
        this.speaking = true
        this.frames = [...this.pre]
        this.speechMs = 0
        this.silenceMs = 0
      }
      return
    }
    this.frames.push(pcm)
    this.speechMs += ms
    this.silenceMs = level < threshold * 0.6 ? this.silenceMs + ms : 0
    if (this.silenceMs >= 700 || this.speechMs >= this.maxMs) {
      const out = concat(this.frames)
      this.reset()
      if (out.length >= 16000 * 2 * 0.4) this.onUtterance(out)
    }
  }
}

export function rms(pcm: Uint8Array): number {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let sum = 0
  const n = Math.floor(pcm.byteLength / 2)
  for (let i = 0; i < n; i++) {
    const s = v.getInt16(i * 2, true)
    sum += s * s
  }
  return n ? Math.sqrt(sum / n) : 0
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
