import { defineConfig, devices } from '@playwright/test'

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
    command: `npm run build && PORT=${PORT} BETTER_AUTH_URL=http://localhost:${PORT} GOOGLE_CLIENT_ID=${GOOGLE_TEST_CLIENT_ID} GOOGLE_CLIENT_SECRET=e2e-google-client-secret npm run start`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
