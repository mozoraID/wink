// Shapes shared by the Mini App and glasses endpoints.
import { currentPairing, devicesFor, getChat, getFeed } from './db'
import { account, masterOf, type AccountView } from './hl'
import type { User } from './types'

export async function accountFor(user: User): Promise<{ account: AccountView | null; error?: string }> {
  const addr = masterOf(user.wallet)
  if (!addr) return { account: null, error: 'No trading account linked' }
  try {
    return { account: await account(addr) }
  } catch (e) {
    return { account: null, error: (e as Error).message }
  }
}

export async function miniAppState(user: User) {
  const [feed, acct, devices, pairing] = await Promise.all([getFeed(user.id), accountFor(user), devicesFor(user.id), currentPairing(user.id)])
  const sources = (await Promise.all(Object.keys(user.sources).map(id => getChat(Number(id)))))
    .filter(Boolean)
    .filter(c => c!.type !== 'private')
    .map(c => ({
      id: c!.id, title: c!.title, type: c!.type, username: c!.username, memberCount: c!.memberCount ?? null,
      signalsSeen: c!.signalsSeen, messagesSeen: c!.messagesSeen, firstSeen: c!.firstSeen, lastSignalAt: c!.lastSignalAt ?? null,
      enabled: user.sources[String(c!.id)] !== false,
    }))
  return {
    user: { id: user.id, name: user.name, username: user.username },
    settings: user.settings,
    wallet: user.wallet.mode === 'own'
      ? { mode: 'own' as const, master: user.wallet.master, agent: user.wallet.agent }
      : { mode: 'demo' as const, master: process.env.HL_MASTER_ADDRESS ?? null },
    account: acct.account,
    accountError: acct.error ?? null,
    sources,
    signals: feed.signals.slice(0, 40),
    events: feed.events.slice(0, 40),
    devices: devices.map(d => ({ label: d.label, createdAt: d.createdAt, lastSeen: d.lastSeen })),
    pairing: pairing ? { code: pairing.code, expiresAt: pairing.expiresAt } : null,
  }
}
