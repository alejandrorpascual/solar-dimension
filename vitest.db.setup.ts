// Runs before each database test file is loaded, so before src/db/client.ts reads DATABASE_URL. The e2e guard takes
// the URL from .env.test.local (in CI, from the secret) and throws, so no test runs, when it is the production database
// or the one .env.local points at.
import { loadTestEnv } from './e2e/test-env.ts'

loadTestEnv()
