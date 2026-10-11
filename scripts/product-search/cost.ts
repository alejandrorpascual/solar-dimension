import type { Response } from 'openai/resources/responses/responses'

/** USD per 1M tokens, from developers.openai.com/api/docs on 2026-10-09. Cache writes bill at 1.25 × input. */
export const TOKEN_PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
  'gpt-6-sol': { input: 2, cached: 0.2, output: 10 },
}
const CACHE_WRITE_FACTOR = 1.25
const PER_MILLION = 1_000_000
/** $10 per 1,000 web search calls; the pages it reads are billed as input tokens at the model's rate. */
export const SEARCH_CALL_USD = 10 / 1000

export interface SearchCalls { total: number; byAction: Record<string, number> }

export function countSearchCalls(res: Pick<Response, 'output'>): SearchCalls {
  const calls = res.output.filter((o) => o.type === 'web_search_call')
  const byAction = calls.reduce<Record<string, number>>((acc, c) => {
    const action = c.action?.type ?? 'unknown'
    return { ...acc, [action]: (acc[action] ?? 0) + 1 }
  }, {})
  return { total: calls.length, byAction }
}

/** Every URL the search returned, so a product URL can be checked against what the model actually saw. */
export function searchSources(res: Pick<Response, 'output'>): string[] {
  return res.output.flatMap((o) =>
    o.type === 'web_search_call' && o.action?.type === 'search' ? (o.action.sources ?? []).map((s) => s.url) : [],
  )
}

export interface CostBreakdown {
  inputTokens: number; cachedTokens: number; cacheWriteTokens: number; outputTokens: number; reasoningTokens: number
  tokensUSD: number; searchUSD: number; searchUSDSearchOnly: number; totalUSD: number
}

/**
 * The run's cost. Every web_search_call is billed as a call (an upper bound: if only "search" actions bill, the
 * search-only figure applies). Throws for a model with no price on file rather than guessing one.
 */
export function costOf(model: string, usage: NonNullable<Response['usage']>, calls: SearchCalls): CostBreakdown {
  const price = TOKEN_PRICES[model]
  if (!price) throw new Error(`No price on file for ${model}; add it to TOKEN_PRICES.`)
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0
  const cacheWriteTokens = usage.input_tokens_details?.cache_write_tokens ?? 0
  const freshInput = Math.max(0, usage.input_tokens - cachedTokens - cacheWriteTokens)
  const tokensUSD =
    (freshInput * price.input + cachedTokens * price.cached + cacheWriteTokens * price.input * CACHE_WRITE_FACTOR +
      usage.output_tokens * price.output) / PER_MILLION
  const searchUSD = calls.total * SEARCH_CALL_USD
  const searchUSDSearchOnly = (calls.byAction.search ?? 0) * SEARCH_CALL_USD
  return {
    inputTokens: usage.input_tokens, cachedTokens, cacheWriteTokens, outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    tokensUSD, searchUSD, searchUSDSearchOnly, totalUSD: tokensUSD + searchUSD,
  }
}
