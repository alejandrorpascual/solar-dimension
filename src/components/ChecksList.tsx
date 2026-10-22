import { Check, TriangleAlert } from 'lucide-react'
import type { Dictionary } from '../i18n'
import type { CheckStatus, KitCheck } from '../lib/kit-checks'
import { CHECKS_ID } from './ChecksAttention'

/** A pass or attention mark that always carries its own word for screen readers. */
export function CheckMark({ status, t }: { status: CheckStatus; t: Dictionary }) {
  const Icon = status === 'pass' ? Check : TriangleAlert
  return (
    <span className={`cmark cmark--${status}`} role="img" aria-label={status === 'pass' ? t.ui.checkPass : t.ui.checkWarn}>
      <Icon size={13} strokeWidth={3} aria-hidden="true" />
    </span>
  )
}

/** The six engineering checks under the parts list: what passes, and what an installer should look at. */
export function ChecksList({ checks, t }: { checks: readonly KitCheck[]; t: Dictionary }) {
  if (checks.length === 0) return null
  return (
    <section className="checks" aria-label={t.ui.checks} id={CHECKS_ID} tabIndex={-1}>
      <h3 className="lab">{t.ui.checks}</h3>
      <ul className="checks__list">
        {checks.map((c) => (
          <li key={c.id} className={`check check--${c.status}`}>
            <CheckMark status={c.status} t={t} />
            <div className="check__body">
              <span className="check__name">{c.name}</span>
              {c.lines.map((line, i) => <span key={`${c.id}-${i}`} className="check__line">{line}</span>)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
