/** E2E_PORT lets a second checkout (a worktree) run its own build while another dev server holds :3000. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3000)
/** The main server's daily read budget: high enough that every run on the same day stays under it. */
export const E2E_DAILY_READS = 1_000_000
/**
 * A second server on the same build and database, whose daily read budget is 1. The day's counter is shared, so a
 * test can spend this server's budget without touching the main server's, which every other test relies on.
 */
export const BUDGET_PORT = E2E_PORT + 1
export const BUDGET_DAILY_READS = 1
