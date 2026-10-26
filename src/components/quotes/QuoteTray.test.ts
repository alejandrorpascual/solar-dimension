import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { ProjectJobs } from '../../lib/quote-jobs'
import { QuoteTray } from './QuoteTray'

// Issue #144: while a quote is read, the tray looked frozen: a still file icon, and a bar at 0% until the read ended.

/** The signed-in user's quote jobs, as the tray reads them. No verdict page is open, so the tray is not hidden. */
const page = vi.hoisted(() => ({ jobs: [] as ProjectJobs[] }))
vi.mock('../../hooks/useLocale', async () => {
  const { getDictionary } = await import('../../i18n')
  return { useLocale: () => ({ locale: 'en', t: getDictionary('en') }) }
})
vi.mock('../../hooks/useQuoteJobs', () => ({ useQuoteJobs: () => ({ jobs: page.jobs, offline: false, markSeen: async () => {} }) }))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: { matches: [] }) => unknown }) => select({ matches: [] }),
  Link: ({ className, children }: { className?: string; children?: ReactNode }) => createElement('a', { className }, children),
}))

function trayHtml(pending: number, done: number): string {
  page.jobs = [{
    projectId: 'p1', projectName: 'Home', files: [], total: pending + done, done, pending, failed: 0, needsReview: 0,
    kitHold: null, unseen: done > 0, best: null,
  }]
  return renderToStaticMarkup(createElement(QuoteTray))
}

test('while a quote is read, the tray shows a turning spinner instead of a still file icon', () => {
  const html = trayHtml(1, 0)
  expect(html).toContain('class="qspin"')
  expect(html).not.toContain('lucide-file-text')
})

/** The tray's second line as it reads on screen, and the part of it a screen reader skips. */
function trayMeta(pending: number, done: number): { shown: string; hidden: string } {
  const inner = /<p class="qtray__meta num">(.*?)<\/p>/.exec(trayHtml(pending, done))?.[1] ?? ''
  return { shown: inner.replace(/<[^>]+>/g, ''), hidden: /<span aria-hidden="true">(.*?)<\/span>/.exec(inner)?.[1] ?? '' }
}

test('while a quote is read, the tray says how long the read has taken so far, a line that changes every second', () => {
  expect(trayMeta(1, 0).shown).toBe('0 of 1 read · 0:00 so far')
  expect(trayMeta(1, 1).shown).toBe('1 of 2 read · about 30 s · 0:00 so far')
})

test('the time so far is hidden from screen readers, so the live tray is not read out every second', () => {
  expect(trayMeta(1, 0).hidden).toBe(' · 0:00 so far')
})
