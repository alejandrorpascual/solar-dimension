import { Check, TriangleAlert } from 'lucide-react'
import { tr, type Dictionary } from '../i18n'
import type { CheckStatus, KitCheck } from '../lib/kit-checks'
import { CHECKS_ID } from './ChecksAttention'
import { Fold } from './Fold'

/** A pass or attention mark that always carries its own word for screen readers. */
export function CheckMark({ status, t }: { status: CheckStatus; t: Dictionary }) {
  const Icon = status === 'pass' ? Check : TriangleAlert
  return (
    <span className={`cmark cmark--${status}`} role="img" aria-label={status === 'pass' ? t.ui.checkPass : t.ui.checkWarn}>
      <Icon size={13} strokeWidth={3} aria-hidden="true" />
    </span>
  )
}

function CheckRows({ checks, t }: { checks: readonly KitCheck[]; t: Dictionary }) {
  return (
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
  )
}

/**
 * The engineering checks under the parts list. When every one passes they fold to one line that opens; when any needs
 * an installer's eye the whole list stays out, so nothing that needs attention is a press away.
 */
export function ChecksList({ checks, t }: { checks: readonly KitCheck[]; t: Dictionary }) {
  if (checks.length === 0) return null
  const isAllPass = checks.every((c) => c.status === 'pass')
  return (
    <section className="checks" aria-label={t.ui.checks} id={CHECKS_ID} tabIndex={-1}>
      {isAllPass ? (
        <Fold title={t.ui.checks} values={tr(t, 'checksAllPass', { count: checks.length })}>
          <div className="checks__fold"><CheckRows checks={checks} t={t} /></div>
        </Fold>
      ) : (
        <>
          <h2 className="lab">{t.ui.checks}</h2>
          <CheckRows checks={checks} t={t} />
        </>
      )}
    </section>
  )
}
