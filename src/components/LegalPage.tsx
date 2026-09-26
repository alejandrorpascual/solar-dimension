import { Link } from '@tanstack/react-router'
import { Fragment } from 'react'
import { useLocale } from '../hooks/useLocale'
import type { LegalPage as LegalText } from '../i18n'
import { fmtDate } from '../i18n/format'
import { APP_NAME } from '../lib/brand'
import { HeaderBar } from './HeaderBar'

export const CONTACT_EMAIL = 'alexandros2707@gmail.com'

/** Swap the `{email}` placeholder for a mailto link. */
function withEmailLink(body: string) {
  const parts = body.split('{email}')
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>}
    </Fragment>
  ))
}

/**
 * A long-form policy page (privacy, terms). `updated` is a local date so it never shows as the day before in
 * time zones west of UTC; change it whenever the text changes.
 */
export function LegalPage({ text, updated }: { text: LegalText; updated: Date }) {
  const { locale } = useLocale()
  return (
    <main className="page">
      <HeaderBar />
      <article className="stage stage--narrow prose">
        <Link to="/" search={{ step: 1 }} className="prose__back">← {APP_NAME}</Link>
        <h1>{text.title}</h1>
        <p className="muted">{text.updated.replace('{date}', fmtDate(updated, locale))}</p>
        {text.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            <p>{withEmailLink(s.body)}</p>
          </section>
        ))}
      </article>
    </main>
  )
}
