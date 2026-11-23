/* Thin typed access to window.Telegram.WebApp. */
export interface WebApp {
  initData: string
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
  ready(): void
  expand(): void
  setHeaderColor?(c: string): void
  setBackgroundColor?(c: string): void
  openLink(url: string): void
  openTelegramLink(url: string): void
  showConfirm?(msg: string, cb: (ok: boolean) => void): void
  HapticFeedback?: { selectionChanged(): void; impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void; notificationOccurred(t: 'error' | 'success' | 'warning'): void }
  onEvent(e: string, cb: () => void): void
  version: string
  isVersionAtLeast?(v: string): boolean
}

export function webApp(): WebApp | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp ?? null
}

export const haptic = {
  tick: () => webApp()?.HapticFeedback?.selectionChanged(),
  tap: () => webApp()?.HapticFeedback?.impactOccurred('light'),
  ok: () => webApp()?.HapticFeedback?.notificationOccurred('success'),
  err: () => webApp()?.HapticFeedback?.notificationOccurred('error'),
}

export function confirmDialog(msg: string): Promise<boolean> {
  const wa = webApp()
  if (wa?.showConfirm && wa.isVersionAtLeast?.('6.2')) return new Promise(r => wa.showConfirm!(msg, r))
  return Promise.resolve(window.confirm(msg))
}

export function openTg(url: string) {
  const wa = webApp()
  if (wa?.initData) wa.openTelegramLink(url)
  else window.open(url, '_blank')
}

export function openExternal(url: string) {
  const wa = webApp()
  if (wa?.initData) wa.openLink(url)
  else window.open(url, '_blank')
}
