import { createServerFn } from '@tanstack/react-start'
import { authBaseURL } from '../lib/auth-url'

/**
 * The address the app is served from, with no trailing slash: the page names its preview image by it. It is the one
 * address sign-in already trusts (an explicit BETTER_AUTH_URL, else the production domain, else this deployment's), so
 * a preview deployment's links point at itself, not at production.
 */
export const getSiteOrigin = createServerFn({ method: 'GET' }).handler(async (): Promise<string> => authBaseURL(process.env).replace(/\/+$/, ''))
