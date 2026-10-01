import { Fragment } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { NEED_POS, SIZED_IDS, type QuoteSizing } from '../../lib/quote-sizing'
import { gaugeLabel, ratioLabel } from '../../lib/quote-text'

/** Inverter and battery as small bars, with a tick where the kit's need sits. Screen readers get the same as one sentence. */
export function SizingBars({ sizing }: { sizing: QuoteSizing }) {
  const { t } = useLocale()
  const rows = SIZED_IDS.flatMap((id) => {
    const s = sizing[id]
    return s ? [{ id, s }] : []
  })
  if (rows.length === 0) return null
  return (
    <>
      <div className="qbars" aria-hidden="true">
        {rows.map(({ id, s }) => (
          <Fragment key={id}>
            <span className="qmeta">{t.quoteItemsShort[id]}</span>
            <span className="qbars__track">
              <span className={`qbars__fill qbars__fill--${s.zone}`} style={{ width: `${s.pos}%` }} />
              <span className="qbars__tick" style={{ left: `${NEED_POS}%` }} />
            </span>
            <span className={`qbars__val qbars__val--${s.zone} num`}>{ratioLabel(t, s.ratio)}</span>
          </Fragment>
        ))}
      </div>
      <p className="visually-hidden">{rows.map(({ id, s }) => gaugeLabel(t, id, s)).join('. ')}</p>
    </>
  )
}
