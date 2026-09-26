import { Link, createFileRoute } from '@tanstack/react-router'
import { Fragment } from 'react'
import { HeaderBar } from '../components/HeaderBar'
import { useLocale } from '../hooks/useLocale'
import { fmtDate } from '../i18n/format'

const CONTACT_EMAIL = 'alexandros2707@gmail.com'
/** Change when the policy text changes; local date so it never shows as the day before in western time zones. */
const LAST_UPDATED = new Date(2026, 8, 26)

export const Route = createFileRoute('/privacy')({ component: PrivacyPage })

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

function PrivacyPage() {
  const { t, locale } = useLocale()
  const { privacy } = t
  return (
    <main className="page">
      <HeaderBar />
      <article className="stage stage--narrow prose">
        <Link to="/" search={{ step: 1 }} className="prose__back">← {t.ui.brand}</Link>
        <h1>{privacy.title}</h1>
        <p className="muted">{privacy.updated.replace('{date}', fmtDate(LAST_UPDATED, locale))}</p>
        {privacy.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            <p>{withEmailLink(s.body)}</p>
          </section>
        ))}
      </article>
    </main>
  )
}
