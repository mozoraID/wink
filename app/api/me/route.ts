import { handle, json, miniAppUser } from '@/lib/http'
import { miniAppState } from '@/lib/view'

export const dynamic = 'force-dynamic'

export const GET = handle(async req => json(await miniAppState(await miniAppUser(req))))
