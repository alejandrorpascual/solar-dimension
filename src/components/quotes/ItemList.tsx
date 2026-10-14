import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import { confirmsSize } from '../../lib/quote-caveats'
import { OVERRIDES, type ItemCheck, type ItemId, type KitNeeds, type Override } from '../../lib/quote-items'
import { itemText, markLabel } from '../../lib/quote-text'
import { ItemMark } from './ItemMark'

interface Props {
  items: readonly ItemCheck[]
  kit: KitNeeds
  currency: string
  onOverride: (item: ItemId, value: Override | null) => void
}

/**
 * Every check of one quote, with what the quote said. An unknown item gets two buttons: Included / Not included when the
 * quote leaves it out, or Installer confirmed / ruled out when what is open is a size, a class or a count.
 */
export function ItemList({ items, kit, currency, onOverride }: Props) {
  const { t } = useLocale()
  return (
    <ul className="qitems">
      {items.map((c) => {
        const { label, detail } = itemText(t, c, kit, currency)
        const current: Override | null = c.facts.confirmed ? (c.status === 'ok' ? 'included' : 'not_included') : null
        const canSet = c.status === 'unknown' || current !== null
        const labels = confirmsSize(c)
          ? { included: t.quotes.overrideConfirmed, not_included: t.quotes.overrideRuledOut }
          : { included: t.quotes.included, not_included: t.quotes.notIncluded }
        return (
          <li key={c.id} className="qitem">
            <ItemMark status={c.status} label={markLabel(t, c)} />
            <div className="qitem__text">
              <div className="qitem__line">
                <span className="qitem__name">{t.quoteItems[c.id]}</span>
                <span className="qitem__label">{label}</span>
              </div>
              {detail && <p className="qitem__detail">{detail}</p>}
              {c.source?.text && (
                <p className="qitem__ev">
                  “{c.source.text}”{c.source.page ? ` · ${trq(t, 'evidence', { page: c.source.page })}` : ''}
                </p>
              )}
              {canSet && (
                <div className="qseg" role="group" aria-label={t.quoteItems[c.id]}>
                  {OVERRIDES.map((v) => (
                    <button key={v} type="button" className="qseg__b" aria-pressed={current === v}
                      onClick={() => onOverride(c.id, current === v ? null : v)}>
                      {labels[v]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
