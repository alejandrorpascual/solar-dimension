import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { del, get, put } from '@vercel/blob'
import { EXTENSIONS, type QuoteMime } from '../../lib/quote-limits'

export interface QuoteStorage {
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(pathname: string): Promise<Uint8Array | null>
  remove(pathnames: readonly string[]): Promise<void>
}

const SAFE_PATH = /^quotes\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/

/** Whether `pathname` has the one shape storage accepts, so it can name a quote file at all. */
export function isQuotePath(pathname: string): boolean {
  return SAFE_PATH.test(pathname)
}

function assertSafe(pathname: string): string {
  if (!isQuotePath(pathname)) throw new Error('Unsafe quote path')
  return pathname
}

/** `quotes/<userId>/<quoteId>.<ext>`: the only shape storage accepts, so a path can never leave its user's folder. */
export function quotePath(userId: string, quoteId: string, mime: QuoteMime): string {
  return assertSafe(`quotes/${userId}/${quoteId}.${EXTENSIONS[mime]}`)
}

/** Development and E2E storage under a folder on disk. */
export function localDiskStorage(root: string): QuoteStorage {
  const file = (p: string) => path.join(root, assertSafe(p))
  return {
    async put(p, bytes) {
      const f = file(p)
      await mkdir(path.dirname(f), { recursive: true })
      await writeFile(f, bytes, { flag: 'wx' })
    },
    async get(p) {
      try {
        return new Uint8Array(await readFile(file(p)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async remove(ps) {
      await Promise.all(ps.map((p) => rm(file(p), { force: true })))
    },
  }
}

/** Private Vercel Blob storage: files are only reachable with the token, and are served to their owner by /api/quotes/:id/file. */
export function blobStorage(token: string): QuoteStorage {
  return {
    async put(p, bytes, contentType) {
      await put(assertSafe(p), Buffer.from(bytes), { access: 'private', contentType, addRandomSuffix: false, token })
    },
    async get(p) {
      const result = await get(assertSafe(p), { access: 'private', token })
      if (!result) return null
      return new Uint8Array(await new Response(result.stream).arrayBuffer())
    },
    async remove(ps) {
      if (ps.length) await del(ps.map(assertSafe), { token })
    },
  }
}

export function quoteStorage(env: Record<string, string | undefined> = process.env): QuoteStorage {
  if (env.QUOTES_STORAGE === 'local') return localDiskStorage(env.QUOTES_LOCAL_DIR ?? '.data/quotes')
  const token = env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not set. Set QUOTES_STORAGE=local for development.')
  return blobStorage(token)
}
