import { useLocale } from '../../hooks/useLocale'
import { GAUGE_ZONES, type SizedId, type Sizing, type SizingZone } from '../../lib/quote-sizing'
import { gaugeLabel, gaugeTitle, zoneName, zonePill } from '../../lib/quote-text'

const PILL: Record<SizingZone, string> = { short: 'qpill qpill--warn', just: 'qpill qpill--ok', roomy: 'qpill qpill--unk', over: 'qpill qpill--info' }
const COLUMNS = GAUGE_ZONES.map((z) => `${z.width}fr`).join(' ')

/** One component against the kit: a four-zone bar with a marker, and the zone named in words. */
export function SizingGauge({ id, s }: { id: SizedId; s: Sizing }) {
  const { t } = useLocale()
  return (
    <div className="qgauge">
      <div className="qgauge__head">
        <span className="qgauge__title num">{gaugeTitle(t, id, s)}</span>
        <span className={PILL[s.zone]}>{zonePill(t, s)}</span>
      </div>
      <div className="qgauge__scale" role="img" aria-label={gaugeLabel(t, id, s)}>
        <div className="qgauge__bar" style={{ gridTemplateColumns: COLUMNS }}>
          {GAUGE_ZONES.map((z) => <span key={z.zone} className={`qgauge__z qgauge__z--${z.zone}`} />)}
        </div>
        <svg className="qgauge__marker" style={{ left: `${s.pos}%` }} width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
          <path d="M7 12 0 0h14z" fill="currentColor" />
        </svg>
        <div className="qgauge__names" style={{ gridTemplateColumns: COLUMNS }} aria-hidden="true">
          {GAUGE_ZONES.map((z) => (
            <span key={z.zone} className={z.zone === s.zone ? `qgauge__name qgauge__name--on qgauge__name--${z.zone}` : 'qgauge__name'}>
              {zoneName(t, z.zone)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
