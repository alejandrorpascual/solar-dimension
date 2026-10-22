import { defineConfig } from 'vitest/config'

// `npm run test:db`: the tests that write to a database, kept out of `npm test` so it needs none.
export default defineConfig({
  test: {
    include: ['src/**/*.db.test.ts'],
    environment: 'node',
    setupFiles: ['./vitest.db.setup.ts'],
  },
})
