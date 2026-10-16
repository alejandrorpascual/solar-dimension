import { SAMPLE_QUOTES, SLOW_READ_MARK, type SampleQuoteId } from '../../lib/quote-fixtures'
import { ModelError, type QuoteModel } from './model'

/**
 * How long the stub takes over a file marked slow: a full status poll at the default rate (DEFAULT_POLL_MS in
 * quote-jobs.ts) at the least, so the page asks about the quote once more while it is still being read.
 */
export const SLOW_READ_MS = 3000

/**
 * Development and E2E only (QUOTES_MODEL_STUB=1, never on Vercel): answers with the sample quote whose key appears in
 * the file name ("solartec.pdf"), after a delay so the "reading" state can be seen. A file marked slow
 * ("solartec-slow.pdf") takes SLOW_READ_MS however short that delay is.
 */
export function stubModel(delayMs: number): QuoteModel {
  return {
    async extract(input) {
      const name = input.fileName.toLowerCase()
      const waitMs = name.includes(SLOW_READ_MARK) ? Math.max(delayMs, SLOW_READ_MS) : delayMs
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      const key = (Object.keys(SAMPLE_QUOTES) as SampleQuoteId[]).find((k) => name.includes(k))
      if (!key) throw new ModelError('invalid', `No stub fixture matches ${input.fileName}`)
      return { extraction: SAMPLE_QUOTES[key], input: 0, output: 0 }
    },
  }
}
