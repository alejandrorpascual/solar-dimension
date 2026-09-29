// Matches the CATALOG_API_TOKEN the webServer command sets in playwright.config.ts.
export const CATALOG_API_TOKEN = 'e2e-catalog-token-0123456789abcdef0123456789abcdef'
export const catalogAuthHeader = { Authorization: `Bearer ${CATALOG_API_TOKEN}` }
