import { defineConfig, devices } from '@playwright/test'
import { BUDGET_DAILY_READS, BUDGET_PORT, E2E_ADMIN, E2E_DAILY_READS, E2E_PORT as PORT } from './e2e/servers'
import { loadTestEnv } from './e2e/test-env'

loadTestEnv()

const GOOGLE_TEST_CLIENT_ID = 'e2e-google-client-id'

/**
 * Auth only trusts its own origin, so it has to follow the port. Dummy Google credentials turn the Google button on;
 * tests stop at Google's URL, and inline vars win over anything in .env.local.
 */
const serverEnv = (port: number, dailyReads: number) => [
  `PORT=${port}`, `BETTER_AUTH_URL=http://localhost:${port}`,
  `GOOGLE_CLIENT_ID=${GOOGLE_TEST_CLIENT_ID}`, 'GOOGLE_CLIENT_SECRET=e2e-google-client-secret', `ADMIN_EMAILS=${E2E_ADMIN.email}`,
  'QUOTES_STORAGE=local', 'QUOTES_LOCAL_DIR=.data/e2e-quotes', 'QUOTES_MODEL_STUB=1', 'QUOTES_STUB_DELAY_MS=3000', `QUOTES_DAILY_READS=${dailyReads}`,
  'CATALOG_API_TOKEN=e2e-catalog-token-0123456789abcdef0123456789abcdef',
].join(' ')

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // In CI a test that fails once runs again, and the run's summary names every test that needed it (the github
  // reporter): a flaky test stays visible without failing the run. Locally a failure is a failure.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // A `test.only` left in a commit would skip the rest of the suite and still pass.
  forbidOnly: !!process.env.CI,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  // Never reuse a running server: its database is whatever it started with, which loadTestEnv() can't check. A dev
  // server on the port makes the run fail ("already used") instead; set E2E_PORT to run beside it.
  webServer: [
    {
      command: `npm run build && ${serverEnv(PORT, E2E_DAILY_READS)} npm run start`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // The same build, started once the first server is up (Playwright starts them in order), with a spent budget.
      command: `${serverEnv(BUDGET_PORT, BUDGET_DAILY_READS)} npm run start`,
      url: `http://localhost:${BUDGET_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
