import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Database tests run with `npm run test:db` (vitest.db.config.ts), so this run needs no DATABASE_URL.
    exclude: [...configDefaults.exclude, 'src/**/*.db.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/i18n/**/*.ts', 'src/server/**/*.ts'],
      // A *.test-helper.ts module only serves tests (quote-tax-oracle.test-helper.ts, the differential test's oracle).
      exclude: ['src/**/*.test.ts', 'src/**/*.test-helper.ts'],
      // Per folder, because Vitest counts every included file into the top-level thresholds: there the server code,
      // tested less, would count toward the 80 that lib and i18n hold.
      thresholds: {
        'src/{lib,i18n}/**': { lines: 80, functions: 80, statements: 80, branches: 80 },
        // Server lines measured 42.1% when this was set, rounded down to 5. Raise it as server tests are added.
        'src/server/**': { lines: 40 },
      },
    },
  },
})
