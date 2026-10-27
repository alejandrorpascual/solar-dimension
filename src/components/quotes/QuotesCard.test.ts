import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { ProjectJobs } from '../../lib/quote-jobs'
import { ProjectSchema } from '../../lib/schema'
import { QuotesCard } from './QuotesCard'

// Issue #144: while a quote was read, the kit page's quotes card showed the same still file icon as before any upload.

/** The project's quote jobs and who the page is for; signed in and allowed to upload unless a test says otherwise. The dialog and the router are not there here. */
const page = vi.hoisted(() => ({ jobs: null as ProjectJobs | null, session: { status: 'signed-in', user: { id: 'u1', canUseQuotes: true } } as unknown }))
vi.mock('../../hooks/useLocale', async () => {
  const { getDictionary } = await import('../../i18n')
  return { useLocale: () => ({ locale: 'en', t: getDictionary('en') }) }
})
vi.mock('../../hooks/useRootData', () => ({ useRootData: () => ({ session: page.session }) }))
vi.mock('../../hooks/useQuoteJobs', () => ({ useProjectJobs: () => page.jobs }))
vi.mock('../../hooks/useQuoteUpload', () => ({
  useQuoteUpload: () => ({ items: [], isOpen: false, isUploading: false, setOpen: () => {}, start: async () => {} }),
}))
vi.mock('./HandoffDialog', () => ({ HandoffDialog: () => null }))
vi.mock('./QuotesLockedAction', () => ({ QuotesLockedAction: () => null }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ className, children }: { className?: string; children?: ReactNode }) => createElement('a', { className }, children),
}))

/** What the card shows in its icon square, for a project with that many quotes being read and read. */
function cardIcon(pending: number, done: number): string {
  page.jobs = {
    projectId: 'p1', projectName: 'Home', files: [], total: pending + done, done, pending, failed: 0, needsReview: 0,
    kitHold: null, unseen: false, best: null,
  }
  const project = ProjectSchema.parse({ id: 'p1', name: 'Home', qty: { fridge: 1 }, custom: [], hours: 10, volts: 48, chemistry: 'lifepo4' })
  const html = renderToStaticMarkup(createElement(QuotesCard, { project, isSaving: false }))
  return /<span class="qcard__icon"[^>]*>(.*?)<\/span>/.exec(html)?.[1] ?? ''
}

test('while a quote is read, the card shows a working indicator instead of the still file icon', () => {
  const icon = cardIcon(1, 1)
  expect(icon).toContain('class="qspin"')
  expect(icon).not.toContain('lucide-file-text')
})

test('once every quote is read, the card shows the file icon again', () => {
  const icon = cardIcon(0, 2)
  expect(icon).toContain('lucide-file-text')
  expect(icon).not.toContain('qspin')
})

/** The card for a page loaded with `session`, as markup. */
function cardFor(session: unknown): string {
  page.session = session
  page.jobs = null
  const project = ProjectSchema.parse({ id: 'p1', name: 'Home', qty: { fridge: 1 }, custom: [], hours: 10, volts: 48, chemistry: 'lifepo4' })
  const html = renderToStaticMarkup(createElement(QuotesCard, { project, isSaving: false }))
  page.session = { status: 'signed-in', user: { id: 'u1', canUseQuotes: true } }
  return html
}

test('signed out, the card offers signing in', () => {
  expect(cardFor({ status: 'signed-out' })).toContain('Sign in to compare quotes')
})

test('with the account unreachable, the card offers no sign-in to someone who may be signed in', () => {
  const html = cardFor({ status: 'unreachable' })
  expect(html).toContain('qcard__title')
  expect(html).not.toContain('Sign in to compare quotes')
})

test('a kit missing an appliance titles the card with the hold, not a best quote (#204)', () => {
  page.jobs = {
    projectId: 'p1', projectName: 'Home', files: [], total: 1, done: 1, pending: 0, failed: 0, needsReview: 0,
    kitHold: 'missing', unseen: false, best: null,
  }
  const project = ProjectSchema.parse({ id: 'p1', name: 'Home', qty: { fridge: 1 }, custom: [], hours: 10, volts: 48, chemistry: 'lifepo4' })
  const html = renderToStaticMarkup(createElement(QuotesCard, { project, isSaving: false }))
  expect(html).toContain('Your kit is missing appliances')
  expect(html).not.toContain('Verdict ready')
})
