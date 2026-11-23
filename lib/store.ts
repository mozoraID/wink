// Small JSON key-value store on Vercel Blob (private access, origin reads,
// ETag-guarded writes). Falls back to process memory when no Blob token is set
// so `npm run dev` works without cloud credentials.
import { put, get, del, list, BlobPreconditionFailedError } from '@vercel/blob'

const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN)
const mem = (globalThis as { __winkMem?: Map<string, string> }).__winkMem ??= new Map()

const path = (key: string) => `wink/${key}.json`

export async function kvGetWithEtag<T>(key: string): Promise<{ value: T; etag: string } | null> {
  if (!hasBlob()) {
    const raw = mem.get(key)
    return raw ? { value: JSON.parse(raw) as T, etag: String(raw.length) + raw.slice(-8) } : null
  }
  const res = await get(path(key), { access: 'private', useCache: false })
  if (!res || res.statusCode !== 200) return null
  const text = await new Response(res.stream).text()
  return { value: JSON.parse(text) as T, etag: res.blob.etag }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  return (await kvGetWithEtag<T>(key))?.value ?? null
}

export async function kvSet<T>(key: string, value: T, ifMatch?: string): Promise<void> {
  const body = JSON.stringify(value)
  if (!hasBlob()) {
    mem.set(key, body)
    return
  }
  await put(path(key), body, {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    ...(ifMatch ? { ifMatch } : {}),
  })
}

/** Read-modify-write with optimistic concurrency. */
export async function kvUpdate<T>(key: string, fn: (cur: T | null) => T, retries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    const cur = await kvGetWithEtag<T>(key)
    const next = fn(cur ? structuredClone(cur.value) : null)
    try {
      await kvSet(key, next, cur?.etag)
      return next
    } catch (err) {
      const conflict = err instanceof BlobPreconditionFailedError || /precondition|etag/i.test(String(err))
      if (!conflict || i >= retries) throw err
      await new Promise(r => setTimeout(r, 40 + Math.random() * 120))
    }
  }
}

export async function kvDel(key: string): Promise<void> {
  if (!hasBlob()) {
    mem.delete(key)
    return
  }
  const res = await get(path(key), { access: 'private', useCache: false }).catch(() => null)
  if (res) await del(res.blob.url)
}

export async function kvKeys(prefix: string): Promise<string[]> {
  if (!hasBlob()) return [...mem.keys()].filter(k => k.startsWith(prefix))
  const out: string[] = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix: path(prefix).replace(/\.json$/, ''), cursor, limit: 1000 })
    for (const b of page.blobs) out.push(b.pathname.replace(/^wink\//, '').replace(/\.json$/, ''))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}
