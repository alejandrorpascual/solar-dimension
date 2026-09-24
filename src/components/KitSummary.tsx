import { CHEMISTRIES } from '../lib/catalog'
import { fmtHours, fmtInt, fmtKwh, fmtW } from '../lib/format'
import type { SizingResult } from '../lib/sizing'

export interface Part { name: string; spec: string; note: string; qty: string }

export function buildParts(r: SizingResult): Part[] {
  const b = r.battery
  if (r.empty || !b) return []
  const cm = Math.round(r.cable.linkLengthM * 100)
  const perRun = r.cable.runs > 1 ? ' per run' : ''
  return [
    { name: 'Inverter', spec: `${fmtW(r.inverter.w)} pure sine, ${r.volts} V DC input`, note: `${fmtW(r.inverter.surge)} surge · covers ${fmtW(r.runningW)} running, ${fmtW(r.surgeW)} peak`, qty: '1' },
    { name: 'Batteries', spec: b.unitLabel, note: `${b.series} in series × ${b.parallel} in parallel (${b.config}) · ${fmtKwh(b.bankWh)} bank, ${fmtKwh(b.usableWh)} usable`, qty: String(b.count) },
    { name: 'Main cable', spec: `${r.cable.gauge} (${r.cable.mm2} mm²) copper, ${r.cable.mainLengthM} m each`, note: `Battery to inverter · ${fmtInt(r.cable.amps)} A at full inverter load · ${r.cable.dropPct}% drop`, qty: String(r.cable.mainCount) },
    { name: 'Interconnects', spec: `${r.cable.gauge} jumpers, ${cm} cm each`, note: `${r.cable.seriesLinks} series links · ${r.cable.parallelLinks} parallel jumpers`, qty: String(r.cable.seriesLinks + r.cable.parallelLinks) },
    { name: 'Fuse', spec: `${r.cable.fuseA} A class T${perRun}`, note: 'Inline on the positive lead, as close to the bank as possible', qty: String(r.cable.runs) },
  ]
}

interface Props { result: SizingResult; projectName: string; onEditAppliances: () => void; onEditWindow: () => void }

export function KitSummary({ result: r, projectName, onEditAppliances, onEditWindow }: Props) {
  const parts = buildParts(r)
  const dod = Math.round(CHEMISTRIES[r.chemistry].dod * 100)
  return (
    <div className="kit">
      <div className="kit__head">
        <p className="muted">{r.empty ? 'Add appliances first.' : `Backs up ${r.count} appliances for ${r.hours} hours on a ${r.volts} V ${r.chemistryLabel} bank.`}</p>
        <div className="kit__edit">
          <button type="button" className="chip" onClick={onEditAppliances}>Edit appliances</button>
          <button type="button" className="chip" onClick={onEditWindow}>Edit window</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="lab">Running load</div><div className="stat__v num">{fmtW(r.runningW)}</div></div>
        <div className="stat"><div className="lab">Start-up peak</div><div className="stat__v num">{fmtW(r.surgeW)}</div></div>
        <div className="stat"><div className="lab">Energy needed</div><div className="stat__v num">{fmtKwh(r.requiredWh)}</div></div>
        <div className="stat stat--accent"><div className="lab">Runtime</div><div className="stat__v num">{r.battery && !r.empty ? `~${fmtHours(r.battery.hoursActual)}` : '—'}</div></div>
      </div>
      <div className="parts">
        <div className="parts__head"><div className="lab">Part</div><div className="lab">Specification</div><div className="lab parts__qty">Quantity</div></div>
        {parts.map((pt) => (
          <div key={pt.name} className="part">
            <div className="part__name">{pt.name}</div>
            <div className="part__body"><div className="part__spec">{pt.spec}</div><div className="part__note">{pt.note}</div></div>
            <div className="part__qty num">×{pt.qty}</div>
          </div>
        ))}
        {parts.length === 0 && <p className="muted">{projectName} has nothing selected yet.</p>}
      </div>
      {r.warnings.length > 0 && (
        <div className="warn" role="status">
          {r.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}
      <p className="fine muted">Assumes 90% inverter efficiency, 25% inverter headroom, {dod}% depth of discharge, 1,100 W per ton of cooling and one motor starting at a time. Verify conductor sizes against local code.</p>
    </div>
  )
}
