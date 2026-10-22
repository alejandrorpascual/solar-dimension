/**
 * The time limit of the server function that reads quotes, in seconds: 300 s, the default on every Vercel plan with
 * fluid compute (and the most Hobby allows). vite.config.ts sets it on the function, so a plan change cannot move it
 * unnoticed; one read is sized to end inside it (JOB_WORST_CASE_MS in process.ts). No imports: the Vite config loads it.
 */
export const FUNCTION_MAX_DURATION_S = 300
export const FUNCTION_MAX_DURATION_MS = FUNCTION_MAX_DURATION_S * 1000
