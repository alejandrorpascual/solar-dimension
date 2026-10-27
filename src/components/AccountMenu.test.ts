import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { SIGNED_OUT, UNREACHABLE, sessionOf, type AccountSession } from '../lib/account-session'
import { AccountMenu } from './AccountMenu'

// The menu reads its language from the root route's data, and the sign-in link needs a router: a test has neither.
vi.mock('../hooks/useRootData', () => ({ useRootData: () => ({ locale: 'en' }) }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: unknown; className?: string }) => createElement('a', { className, href: '/login' }, children as never),
}))

const google = { canConnect: false, connect: async () => {} }
const ANA = { id: 'user-ana', email: 'ana@example.com', name: 'Ana', googleLinked: false, canUseQuotes: true }

/** The header's account slot as a reader sees it. */
const menuText = (session: AccountSession): string =>
  renderToStaticMarkup(createElement(AccountMenu, { session, onSignOut: async () => {}, google })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('account menu', () => {
  test('signed out, it offers Sign in', () => {
    expect(menuText(SIGNED_OUT)).toBe('Sign in')
  })

  test('with the account unreachable, it offers no Sign in to someone who may be signed in', () => {
    expect(menuText(UNREACHABLE)).not.toContain('Sign in')
  })

  test('signed in, it names the account instead of offering Sign in', () => {
    const html = renderToStaticMarkup(createElement(AccountMenu, { session: sessionOf(ANA), onSignOut: async () => {}, google }))
    expect(html).toContain('Signed in as ana@example.com')
    expect(html).not.toContain('Sign in<')
  })
})
