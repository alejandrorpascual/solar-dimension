import type { Dictionary } from '../i18n'
import type { KitCheck } from '../lib/kit-checks'
import { CheckMark } from './ChecksList'

/** The checks on the sheet, printed last: each row is one PDF block so a page break never splits a check. */
export function SheetChecks({ checks, t }: { checks: readonly KitCheck[]; t: Dictionary }) {
  if (checks.length === 0) return null
  return (
    <section>
      <h3 className="ksheet__h" data-pdf-block="keep">{t.ui.checks}</h3>
      <div className="ksheet__checks">
        {checks.map((c) => (
          <div key={c.id} className={`ksheet__check ksheet__check--${c.status}`} data-pdf-block="">
            <CheckMark status={c.status} t={t} />
            <div>
              <div className="ksheet__check-name">{c.name}</div>
              {c.lines.map((line, i) => <div key={`${c.id}-${i}`} className="ksheet__note">{line}</div>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
