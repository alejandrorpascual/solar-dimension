import { waitUntil } from '@vercel/functions'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defaultDeps } from './deps'
import { kickQuotes } from './kick'
import { processQuote } from './process'

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }))
vi.mock('./deps', () => ({ defaultDeps: vi.fn() }))
vi.mock('./process', () => ({ processQuote: vi.fn() }))

const kicked = (): Promise<unknown>[] => vi.mocked(waitUntil).mock.calls.map(([p]) => p)

describe('kickQuotes', () => {
  afterEach(() => { vi.clearAllMocks() })

  test('a dependency that throws while being built never throws out of the caller; it is logged', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(defaultDeps).mockImplementation(() => { throw new Error('OPENAI_API_KEY is not set.') })
    expect(() => kickQuotes(['a', 'b'])).not.toThrow()
    await Promise.all(kicked())
    expect(kicked()).toHaveLength(2)
    expect(errors).toHaveBeenCalledWith('[quotes] processing failed', expect.objectContaining({ id: 'a' }))
    errors.mockRestore()
  })
  test('each id is read in the background with the default dependencies', async () => {
    const deps = {} as ReturnType<typeof defaultDeps>
    vi.mocked(defaultDeps).mockReturnValue(deps)
    vi.mocked(processQuote).mockResolvedValue('ready')
    kickQuotes(['a'])
    await Promise.all(kicked())
    expect(processQuote).toHaveBeenCalledWith('a', deps)
  })
})
