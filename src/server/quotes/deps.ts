import { lazyModel, lazyStorage } from './lazy'
import { modelNames, openAiModel, type QuoteModel } from './model'
import type { ProcessDeps } from './process'
import { dbJobRepo, dbTrashRepo } from './repo'
import { quoteStorage } from './storage'
import { stubModel } from './stub-model'
import { emptyTrash, type TrashResult } from './trash'

const DEFAULT_STUB_DELAY_MS = 1500

function quoteModel(env: Record<string, string | undefined>): QuoteModel {
  // The stub can never run on Vercel, even if the variable leaks into a deployment.
  if (env.QUOTES_MODEL_STUB === '1' && !env.VERCEL) return stubModel(Number(env.QUOTES_STUB_DELAY_MS ?? DEFAULT_STUB_DELAY_MS))
  const key = env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set.')
  return openAiModel(key)
}

/**
 * Storage and model are built on first use, inside each call, so a server without quote settings still starts and
 * nothing throws synchronously: a missing Blob token rejects that storage call, and a missing OpenAI key fails the
 * claimed quote, which the user can retry. Deleting a quote never needs the OpenAI key.
 */
export const defaultStorage = lazyStorage(() => quoteStorage())
const defaultModel = lazyModel(() => quoteModel(process.env))

/** Removes trashed quote files and clears their rows: `paths` right after a delete, or the oldest rows for the sweep. */
export const emptyQuoteTrash = (paths?: readonly string[]): Promise<TrashResult> =>
  emptyTrash({ storage: defaultStorage, trash: dbTrashRepo }, paths)

export function defaultDeps(): ProcessDeps {
  return { repo: dbJobRepo, storage: defaultStorage, model: defaultModel, models: modelNames() }
}
