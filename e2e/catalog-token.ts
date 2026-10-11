// Matches the CATALOG_API_TOKEN the webServer command sets in playwright.config.ts.
export const CATALOG_API_TOKEN = 'e2e-catalog-token-0123456789abcdef0123456789abcdef'
export const catalogAuthHeader = { Authorization: `Bearer ${CATALOG_API_TOKEN}` }
export const wrongTokenHeader = { Authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong' }
/** Shaped like a Neon endpoint id, and no database of ours. */
export const ANOTHER_DATABASE = 'ep-not-this-one-12345678'
/** The token plus the database the request means to reach: a server on any other database answers 412. */
export const expectingDatabase = (endpoint: string) => ({ ...catalogAuthHeader, 'X-Expect-Database': endpoint })
