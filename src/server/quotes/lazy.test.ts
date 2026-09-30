import { describe, expect, test, vi } from 'vitest'
import type { QuoteModel } from './model'
import { lazyModel, lazyStorage } from './lazy'
import type { QuoteStorage } from './storage'

const missing = (name: string) => () => {
  throw new Error(`${name} is not set.`)
}

describe('lazyStorage', () => {
  test('a storage that cannot be built rejects the call instead of throwing synchronously', async () => {
    const storage = lazyStorage(missing('BLOB_READ_WRITE_TOKEN'))
    let call: Promise<void> | undefined
    expect(() => { call = storage.remove(['quotes/u/x.pdf']) }).not.toThrow()
    await expect(call).rejects.toThrow('BLOB_READ_WRITE_TOKEN is not set.')
    await expect(storage.get('quotes/u/x.pdf')).rejects.toThrow('BLOB_READ_WRITE_TOKEN')
    await expect(storage.put('quotes/u/x.pdf', new Uint8Array(), 'application/pdf')).rejects.toThrow('BLOB_READ_WRITE_TOKEN')
  })
  test('it is built once, on first use, and passes every call through', async () => {
    const real: QuoteStorage = { put: vi.fn(async () => {}), get: vi.fn(async () => new Uint8Array([7])), remove: vi.fn(async () => {}) }
    const build = vi.fn(() => real)
    const storage = lazyStorage(build)
    expect(build).not.toHaveBeenCalled()
    await storage.put('p', new Uint8Array([1]), 'image/png')
    expect(await storage.get('p')).toEqual(new Uint8Array([7]))
    await storage.remove(['p'])
    expect(build).toHaveBeenCalledTimes(1)
    expect(real.put).toHaveBeenCalledWith('p', new Uint8Array([1]), 'image/png')
    expect(real.remove).toHaveBeenCalledWith(['p'])
  })
})

describe('lazyModel', () => {
  test('a model that cannot be built rejects the extraction, so the job fails and can be retried', async () => {
    const model = lazyModel(missing('OPENAI_API_KEY'))
    const input = { bytes: new Uint8Array(), mime: 'application/pdf' as const, fileName: 'q.pdf' }
    let call: Promise<unknown> | undefined
    expect(() => { call = model.extract(input, 'm') }).not.toThrow()
    await expect(call).rejects.toThrow('OPENAI_API_KEY is not set.')
  })
  test('a build that failed is tried again on the next call, then kept', async () => {
    const real: QuoteModel = { extract: vi.fn(async () => ({ extraction: {} as never, input: 1, output: 2 })) }
    const build = vi.fn<() => QuoteModel>().mockImplementationOnce(missing('OPENAI_API_KEY')).mockReturnValue(real)
    const model = lazyModel(build)
    const input = { bytes: new Uint8Array(), mime: 'image/png' as const, fileName: 'q.png' }
    await expect(model.extract(input, 'm')).rejects.toThrow()
    await model.extract(input, 'm')
    await model.extract(input, 'm')
    expect(build).toHaveBeenCalledTimes(2)
    expect(real.extract).toHaveBeenCalledWith(input, 'm')
  })
})
