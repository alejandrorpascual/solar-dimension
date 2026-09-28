import { expect, type APIRequestContext } from '@playwright/test'

// Matches the CATALOG_API_TOKEN the webServer command sets in playwright.config.ts.
export const CATALOG_API_TOKEN = 'e2e-catalog-token-0123456789abcdef0123456789abcdef'
export const catalogAuthHeader = { Authorization: `Bearer ${CATALOG_API_TOKEN}` }

/**
 * Best-effort cleanup for a test-created appliance: retires it so a mid-test failure never leaves it active in the
 * shared DB's picker. A 404 (never created, or already retired by the test's own happy path) is not a cleanup
 * failure; any other status is.
 */
export async function retireTestAppliance(request: APIRequestContext, id: string): Promise<void> {
  const response = await request.post(`/api/catalog/appliances/${id}/retire`, { headers: catalogAuthHeader })
  if (response.status() !== 404) expect(response.ok(), `cleanup: retiring "${id}" failed`).toBe(true)
}
