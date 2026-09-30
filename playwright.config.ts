import { defineConfig, devices } from '@playwright/test'
import { loadTestEnv } from './e2e/test-env'

loadTestEnv()

// E2E_PORT lets a second checkout (a worktree) run its own build while another dev server holds :3000.
const PORT = Number(process.env.E2E_PORT ?? 3000)
const GOOGLE_TEST_CLIENT_ID = 'e2e-google-client-id'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    // Auth only trusts its own origin, so it has to follow the port. Dummy Google credentials turn the Google
    // button on; tests stop at Google's URL, and inline vars win over anything in .env.local.
    command: `npm run build && PORT=${PORT} BETTER_AUTH_URL=http://localhost:${PORT} GOOGLE_CLIENT_ID=${GOOGLE_TEST_CLIENT_ID} GOOGLE_CLIENT_SECRET=e2e-google-client-secret ADMIN_EMAILS=e2e-admin@example.com QUOTES_STORAGE=local QUOTES_LOCAL_DIR=.data/e2e-quotes QUOTES_MODEL_STUB=1 QUOTES_STUB_DELAY_MS=3000 CATALOG_API_TOKEN=e2e-catalog-token-0123456789abcdef0123456789abcdef npm run start`,
    url: `http://localhost:${PORT}`,
    // Never reuse a running server: its database is whatever it started with, which loadTestEnv() can't check. A
    // dev server on the port makes the run fail ("already used") instead; set E2E_PORT to run beside it.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
