import { randomUUID } from 'node:crypto'

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

/**
 * A third server on the same build whose database cannot be reached: its DATABASE_URL names this machine, where
 * nothing answers, so every query is refused at once (ECONNREFUSED). Signed in on the main server, a browser carries
 * its session cookie here too, so the page has a session to read that it cannot check.
 */
export const DOWN_PORT = E2E_PORT + 2
export const DOWN_DATABASE_URL = 'postgresql://e2e:e2e@localhost:9/e2e'

/**
 * The admin test's account, made new for every run so the repository holds no email and password for it. Only this
 * account: the other tests still sign up with a password written in their specs. The runner sets the two variables
 * when it loads the config and its workers inherit them, so the server's ADMIN_EMAILS and the test agree on the
 * account.
 */
export const E2E_ADMIN = {
  email: (process.env.E2E_ADMIN_EMAIL ??= `e2e-admin-${randomUUID()}@example.com`),
  password: (process.env.E2E_ADMIN_PASSWORD ??= randomUUID()),
}
