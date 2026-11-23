// Phone-side WebView: pairing code entry and a live mirror of what the glasses show.
import type { Card } from './display'
import type { GlassesState } from './api'

interface Handlers { onCode(code: string): void; onUnpair(): void }

export function companion(h: Handlers) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const form = $<HTMLFormElement>('pair')
  const input = $<HTMLInputElement>('code')
  form.addEventListener('submit', e => {
    e.preventDefault()
    h.onCode(input.value)
  })
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    if (input.value.length === 6) h.onCode(input.value)
  })
  $('unpair').addEventListener('click', () => h.onUnpair())

  const set = (id: string, text: string) => { $(id).textContent = text }
  return {
    status: (s: string) => set('status', s),
    paired(name: string) {
      document.body.dataset.state = 'paired'
      set('status', name ? `Linked to ${name}` : 'Linked')
    },
    unpaired() {
      document.body.dataset.state = 'pair'
      input.value = ''
      set('status', 'Enter the code from the Wink Mini App in Telegram')
    },
    connected(s: GlassesState) {
      set('who', s.name)
      set('status', s.accountError ? `Hyperliquid: ${s.accountError}` : `Live · ${plural(s.sources, 'source')} · ${plural(s.account?.positions.length ?? 0, 'position')}`)
    },
    heard(text: string, action: string, provider: string) {
      set('heard', `“${text.trim()}” → ${action}`)
      $('heard').title = provider
    },
    mirror(kind: string, c: Card) {
      $('mirror').dataset.kind = kind
      set('m-h', c.header)
      set('m-hr', c.headerRight ?? '')
      set('m-big', c.headline.big + (c.headline.small ? `  ${c.headline.small}` : ''))
      set('m-sub', c.sub)
      set('m-l', c.left ?? '')
      set('m-r', c.right ?? '')
    },
  }
}

function plural(n: number, w: string) { return `${n} ${w}${n === 1 ? '' : 's'}` }
