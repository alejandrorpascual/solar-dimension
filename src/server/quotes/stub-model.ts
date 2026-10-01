import { SAMPLE_QUOTES, type SampleQuoteId } from '../../lib/quote-fixtures'
import { ModelError, type QuoteModel } from './model'

/**
 * Development and E2E only (QUOTES_MODEL_STUB=1, never on Vercel): answers with the sample quote whose key appears in
 * the file name ("solartec.pdf"), after a delay so the "reading" state can be seen.
 */
export function stubModel(delayMs: number): QuoteModel {
  return {
    async extract(input) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      const name = input.fileName.toLowerCase()
      const key = (Object.keys(SAMPLE_QUOTES) as SampleQuoteId[]).find((k) => name.includes(k))
      if (!key) throw new ModelError('invalid', `No stub fixture matches ${input.fileName}`)
      return { extraction: SAMPLE_QUOTES[key], input: 0, output: 0 }
    },
  }
}
