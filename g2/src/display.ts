// Glasses layout: a fixed set of containers reused across every card so most
// updates are cheap in-place text upgrades. The headline is drawn on a canvas
// and sent as two 288x104 image tiles, because firmware text has one size.
import {
  CreateStartUpPageContainer, ImageContainerProperty, ImageRawDataUpdate, RebuildPageContainer,
  TextContainerProperty, TextContainerUpgrade, type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

export const W = 576
const HEAD_Y = 38, HEAD_H = 104
const CHAR_W = 9.2 // approx. firmware glyph advance at the default size

export type Layout = 'card' | 'plain'

export interface Card {
  layout: Layout
  header: string
  headerRight?: string
  headline: Headline
  sub: string
  left?: string
  right?: string
}

export interface Headline { big: string; small?: string; dim?: boolean }

const T = {
  hdr: { id: 1, name: 'hdr' },
  hdrR: { id: 2, name: 'hdrR' },
  sub: { id: 3, name: 'sub' },
  btnL: { id: 4, name: 'btnL' },
  btnR: { id: 7, name: 'btnR' },
  imgL: { id: 5, name: 'imgL' },
  imgR: { id: 6, name: 'imgR' },
}

function text(c: { id: number; name: string }, x: number, y: number, w: number, h: number, extra: Partial<TextContainerProperty> = {}) {
  return new TextContainerProperty({
    xPosition: x, yPosition: y, width: w, height: h, borderWidth: 0, borderColor: 0, paddingLength: 4,
    containerID: c.id, containerName: c.name, content: ' ', isEventCapture: 0, ...extra,
  })
}

function pageFor(layout: Layout) {
  const textObject = layout === 'card'
    ? [
        text(T.hdr, 0, 0, 430, 36, { textColor: 3 }),
        text(T.hdrR, 430, 0, 146, 36, { textColor: 3 }),
        text(T.sub, 0, 146, W, 44),
        text(T.btnL, 0, 204, 282, 80, { borderWidth: 3, borderColor: 13, borderRadius: 8, paddingLength: 12, isEventCapture: 1 }),
        text(T.btnR, 294, 204, 282, 80, { borderWidth: 1, borderColor: 8, borderRadius: 8, paddingLength: 12, textColor: 3 }),
      ]
    : [
        text(T.hdr, 0, 0, 430, 36, { textColor: 3 }),
        text(T.hdrR, 430, 0, 146, 36, { textColor: 3 }),
        text(T.sub, 0, 146, W, 142, { isEventCapture: 1 }),
      ]
  const imageObject = [
    new ImageContainerProperty({ xPosition: 0, yPosition: HEAD_Y, width: 288, height: HEAD_H, containerID: T.imgL.id, containerName: T.imgL.name }),
    new ImageContainerProperty({ xPosition: 288, yPosition: HEAD_Y, width: 288, height: HEAD_H, containerID: T.imgR.id, containerName: T.imgR.name }),
  ]
  return { containerTotalNum: textObject.length + imageObject.length, textObject, imageObject }
}

/** Pads so text sits right-aligned / centered in a container (firmware text is left-aligned only). */
export const alignRight = (s: string, width: number) => ' '.repeat(Math.max(0, Math.floor((width - 8 - s.length * CHAR_W) / CHAR_W))) + s
export const center = (s: string, width: number, pad = 12) => ' '.repeat(Math.max(0, Math.floor((width - pad * 2 - s.length * CHAR_W) / 2 / CHAR_W))) + s

export class Display {
  private layout: Layout | null = null
  private last: Record<string, string> = {}
  private lastHeadline = ''
  private queue: Promise<unknown> = Promise.resolve()
  private canvas = document.createElement('canvas')

  constructor(private bridge: EvenAppBridge) {
    this.canvas.width = W
    this.canvas.height = HEAD_H
  }

  async start(layout: Layout) {
    const r = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(pageFor(layout)))
    this.layout = layout
    this.last = {}
    this.lastHeadline = ''
    return r
  }

  show(card: Card): Promise<void> {
    // serialize: BLE writes must not interleave
    const next = this.queue.then(() => this.apply(card)).catch(err => console.error('display', err))
    this.queue = next
    return next
  }

  private async apply(card: Card) {
    if (this.layout !== card.layout) {
      await this.bridge.rebuildPageContainer(new RebuildPageContainer(pageFor(card.layout)))
      this.layout = card.layout
      this.last = {}
      this.lastHeadline = ''
    }
    await this.setText(T.hdr, card.header)
    await this.setText(T.hdrR, alignRight(card.headerRight ?? '', 146))
    await this.setText(T.sub, card.sub)
    if (card.layout === 'card') {
      await this.setText(T.btnL, center(card.left ?? '', 282))
      await this.setText(T.btnR, center(card.right ?? '', 282))
    }
    await this.setHeadline(card.headline)
  }

  /** Cheap update of the header-right slot only (countdowns). */
  tick(headerRight: string) {
    this.queue = this.queue.then(() => this.setText(T.hdrR, alignRight(headerRight, 146))).catch(() => undefined)
  }

  private async setText(c: { id: number; name: string }, content: string) {
    const v = content || ' '
    if (this.last[c.name] === v) return
    this.last[c.name] = v
    await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: c.id, containerName: c.name, content: v }))
  }

  private async setHeadline(h: Headline) {
    const key = JSON.stringify(h)
    if (key === this.lastHeadline) return
    this.lastHeadline = key
    const ctx = this.canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, HEAD_H)
    const family = `"Inter", "Helvetica Neue", "Liberation Sans", Arial, sans-serif`
    let size = 66
    const fit = () => {
      ctx.font = `700 ${size}px ${family}`
      const bigW = ctx.measureText(h.big).width
      ctx.font = `600 ${Math.round(size * 0.5)}px ${family}`
      const smallW = h.small ? ctx.measureText(h.small).width + 18 : 0
      return bigW + smallW
    }
    while (fit() > W - 12 && size > 28) size -= 2
    const base = 76
    ctx.fillStyle = h.dim ? '#9a9a9a' : '#fff'
    ctx.font = `700 ${size}px ${family}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(h.big, 4, base)
    if (h.small) {
      const bw = ctx.measureText(h.big).width
      ctx.font = `600 ${Math.round(size * 0.5)}px ${family}`
      ctx.fillStyle = '#c8c8c8'
      ctx.fillText(h.small, 4 + bw + 18, base)
    }
    for (const [c, x] of [[T.imgL, 0], [T.imgR, 288]] as const) {
      const tile = document.createElement('canvas')
      tile.width = 288
      tile.height = HEAD_H
      tile.getContext('2d')!.drawImage(this.canvas, x, 0, 288, HEAD_H, 0, 0, 288, HEAD_H)
      const png = await new Promise<Blob>(r => tile.toBlob(b => r(b!), 'image/png'))
      const bytes = new Uint8Array(await png.arrayBuffer())
      await this.bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: c.id, containerName: c.name, imageData: Array.from(bytes) }))
    }
  }
}
