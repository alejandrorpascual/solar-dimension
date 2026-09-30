import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { localDiskStorage, quotePath, quoteStorage } from './storage'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('quotePath', () => {
  test('quotes/<user>/<id>.<ext>', () => {
    expect(quotePath('user_123', ID, 'application/pdf')).toBe(`quotes/user_123/${ID}.pdf`)
    expect(quotePath('u', ID, 'image/jpeg')).toBe(`quotes/u/${ID}.jpg`)
  })
  test('refuses a user id that could escape the folder', () => {
    expect(() => quotePath('../etc', ID, 'application/pdf')).toThrow('Unsafe quote path')
  })
})

describe('localDiskStorage', () => {
  let root = ''
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'quotes-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  test('stores, reads back and removes a file', async () => {
    const s = localDiskStorage(root)
    const p = quotePath('u', ID, 'application/pdf')
    await s.put(p, new Uint8Array([1, 2, 3]), 'application/pdf')
    expect(await s.get(p)).toEqual(new Uint8Array([1, 2, 3]))
    await s.remove([p])
    expect(await s.get(p)).toBeNull()
  })
  test('refuses to overwrite and refuses unsafe paths', async () => {
    const s = localDiskStorage(root)
    const p = quotePath('u', ID, 'application/pdf')
    await s.put(p, new Uint8Array([1]), 'application/pdf')
    await expect(s.put(p, new Uint8Array([2]), 'application/pdf')).rejects.toThrow()
    await expect(s.get('../../etc/passwd')).rejects.toThrow('Unsafe quote path')
  })
})

test('quoteStorage needs a Blob token unless storage is local', () => {
  expect(() => quoteStorage({})).toThrow('BLOB_READ_WRITE_TOKEN')
  expect(quoteStorage({ QUOTES_STORAGE: 'local' })).toBeDefined()
})
