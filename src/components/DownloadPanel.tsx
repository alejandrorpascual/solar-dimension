import { Download, Share2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { canShareFiles, renderPdf, renderPng, saveBlob, shareFile } from '../client/export-file'
import { useLocale } from '../hooks/useLocale'
import { usePreviewScale } from '../hooks/usePreviewScale'
import { applianceName, tr, type Dictionary } from '../i18n'
import { fmtDate } from '../i18n/format'
import { buildCsv, exportFileName } from '../lib/export-csv'
import type { Project } from '../lib/schema'
import type { SizingResult } from '../lib/sizing'
import { KitSheet, type ExportInclude } from './KitSheet'
import { buildParts, type Part } from './KitSummary'

type Format = 'pdf' | 'png' | 'csv'
type Status = 'idle' | 'busy' | 'error'

const SHEET_WIDTH = 794
const PREVIEW_MAX_HEIGHT = 420
const FORMATS: ReadonlyArray<{ id: Format; name: 'fmtPdf' | 'fmtPng' | 'fmtCsv'; hint: 'fmtPdfHint' | 'fmtPngHint' | 'fmtCsvHint'; action: 'downloadPdf' | 'downloadPng' | 'downloadCsv' }> = [
  { id: 'pdf', name: 'fmtPdf', hint: 'fmtPdfHint', action: 'downloadPdf' },
  { id: 'png', name: 'fmtPng', hint: 'fmtPngHint', action: 'downloadPng' },
  { id: 'csv', name: 'fmtCsv', hint: 'fmtCsvHint', action: 'downloadCsv' },
]
const INCLUDES: ReadonlyArray<{ key: keyof ExportInclude; label: 'incSummary' | 'incAppliances' | 'incParts' | 'incNotes'; inCsv: boolean }> = [
  { key: 'summary', label: 'incSummary', inCsv: false },
  { key: 'appliances', label: 'incAppliances', inCsv: true },
  { key: 'parts', label: 'incParts', inCsv: true },
  { key: 'notes', label: 'incNotes', inCsv: false },
]

function csvFor(result: SizingResult, parts: Part[], include: ExportInclude, t: Dictionary): string {
  return buildCsv({
    headers: {
      appliances: [t.ui.appliance, t.ui.quantity, t.ui.eachW, t.ui.runningWatts, tr(t, 'whOver', { hours: result.hours })],
      parts: [t.ui.part, t.ui.specification, t.ui.note, t.ui.quantity],
    },
    appliances: result.items.map((i) => ({ name: applianceName(t, i), qty: i.qty, eachW: i.watts, runningW: i.totalWatts, wh: i.wh })),
    parts: parts.map((p) => ({ name: p.name, spec: p.spec, note: p.note, qty: p.qty })),
    include: { appliances: include.appliances, parts: include.parts },
  })
}

/** Download the open project as a PDF spec sheet, a phone-sized image or a CSV, with a live preview of the sheet. */
export function DownloadPanel({ project, result }: { project: Project; result: SizingResult }) {
  const { t, locale } = useLocale()
  const [format, setFormat] = useState<Format>('pdf')
  const [include, setInclude] = useState<ExportInclude>({ summary: true, appliances: true, parts: true, notes: true })
  const [status, setStatus] = useState<Status>('idle')
  const [canShare, setCanShare] = useState(false)
  const preview = usePreviewScale(SHEET_WIDTH, PREVIEW_MAX_HEIGHT)
  // Unique per panel: the rail and the sheet can both be mounted, and same-named radios would share one group.
  const radioName = useId()
  useEffect(() => setCanShare(canShareFiles()), [])

  const parts = buildParts(result, t, locale)
  const current = FORMATS.find((f) => f.id === format)!
  const isEmpty = result.empty
  const isBusy = status === 'busy'

  const run = async (task: () => Promise<void>) => {
    setStatus('busy')
    try {
      await task()
      setStatus('idle')
    } catch (err) {
      console.error('Kit export failed', { format, project: project.id, err })
      setStatus('error')
    }
  }
  const sheetNode = () => {
    const node = preview.contentRef.current
    if (!node) throw new Error('The kit preview is not on the page')
    return node
  }
  const download = () => run(async () => {
    const name = exportFileName(project.name, format)
    if (format === 'csv') {
      saveBlob(new Blob([csvFor(result, parts, include, t)], { type: 'text/csv;charset=utf-8' }), name)
      return
    }
    saveBlob(format === 'pdf' ? await renderPdf(sheetNode()) : await renderPng(sheetNode()), name)
  })
  const share = () => run(async () => {
    const blob = await renderPng(sheetNode())
    await shareFile(new File([blob], exportFileName(project.name, 'png'), { type: 'image/png' }), project.name)
  })

  return (
    <div className="dl">
      <div
        ref={preview.boxRef}
        className={`dl__preview${preview.height >= PREVIEW_MAX_HEIGHT ? ' dl__preview--clipped' : ''}`}
        style={{ height: preview.height }}
        aria-hidden="true"
      >
        <div className="dl__scaler" style={{ transform: `scale(${preview.scale})` }}>
          <KitSheet ref={preview.contentRef} projectName={project.name} result={result} parts={parts} include={include} date={fmtDate(new Date(), locale)} t={t} locale={locale} />
        </div>
      </div>

      <fieldset className="dl__group">
        <legend className="lab">{t.ui.format}</legend>
        {FORMATS.map((f) => (
          <label key={f.id} className={`dl__fmt${format === f.id ? ' dl__fmt--on' : ''}`}>
            <input type="radio" name={radioName} checked={format === f.id} onChange={() => setFormat(f.id)} />
            <span className="dl__fmt-text"><span className="dl__fmt-name">{t.ui[f.name]}</span><span className="dl__fmt-hint">{t.ui[f.hint]}</span></span>
          </label>
        ))}
      </fieldset>

      <fieldset className="dl__group">
        <legend className="lab">{t.ui.include}</legend>
        {INCLUDES.map((inc) => (
          <label key={inc.key} className="dl__check">
            <input
              type="checkbox"
              checked={include[inc.key]}
              disabled={format === 'csv' && !inc.inCsv}
              onChange={() => setInclude({ ...include, [inc.key]: !include[inc.key] })}
            />
            {t.ui[inc.label]}
          </label>
        ))}
      </fieldset>

      {isEmpty && <p className="muted dl__empty">{t.ui.footerEmpty}</p>}
      {status === 'error' && <p className="error dl__error" role="alert">{t.ui.exportFailed}</p>}
      <div className="dl__actions">
        <button type="button" className="btn btn--primary dl__go" disabled={isEmpty || isBusy} onClick={download}>
          <Download size={18} aria-hidden="true" />{isBusy ? t.ui.making : t.ui[current.action]}
        </button>
        {canShare && (
          <button type="button" className="btn dl__go" disabled={isEmpty || isBusy} onClick={share}>
            <Share2 size={18} aria-hidden="true" />{t.ui.share}
          </button>
        )}
      </div>
    </div>
  )
}
