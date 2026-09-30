import { modelNames, openAiModel, type QuoteModel } from './model'
import type { ProcessDeps } from './process'
import { dbJobRepo } from './repo'
import { quoteStorage } from './storage'
import { stubModel } from './stub-model'

const DEFAULT_STUB_DELAY_MS = 1500

function quoteModel(env: Record<string, string | undefined>): QuoteModel {
  // The stub can never run on Vercel, even if the variable leaks into a deployment.
  if (env.QUOTES_MODEL_STUB === '1' && !env.VERCEL) return stubModel(Number(env.QUOTES_STUB_DELAY_MS ?? DEFAULT_STUB_DELAY_MS))
  const key = env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set.')
  return openAiModel(key)
}

let cached: ProcessDeps | null = null

/** Built on first use, so a server without quote settings still starts; the error surfaces on the first quote. */
export function defaultDeps(): ProcessDeps {
  cached ??= { repo: dbJobRepo, storage: quoteStorage(), model: quoteModel(process.env), models: modelNames() }
  return cached
}
