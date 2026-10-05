import { CircleCheck, Download, LoaderCircle, Share2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { canShareFiles, renderPdf, renderPng, saveBlob, shareFile } from '../client/export-file'
import { useLocale } from '../hooks/useLocale'
import { usePreparedImage } from '../hooks/usePreparedImage'
import { usePreviewScale } from '../hooks/usePreviewScale'
import { applianceName, tr, type Dictionary } from '../i18n'
import { fmtDate } from '../i18n/format'
import { buildCsv, exportFileName } from '../lib/export-csv'
import type { Requester } from '../lib/requester'
import type { Project } from '../lib/schema'
import type { SizingResult } from '../lib/sizing'
import { KitSheet, type ExportInclude } from './KitSheet'
import { buildParts, type Part } from './KitSummary'
import { RequesterCard } from './RequesterCard'
import { RequesterSheet } from './RequesterSheet'

type Format = 'pdf' | 'png' | 'csv'
type Status = 'idle' | 'busy' | 'error' | 'success'

const SHEET_WIDTH = 794
const PREVIEW_MAX_HEIGHT = 420
const FORMATS: ReadonlyArray<{ id: Format; name: 'fmtPdf' | 'fmtPng' | 'fmtCsv'; hint: 'fmtPdfHint' | 'fmtPngHint' | 'fmtCsvHint'; action: 'downloadPdf' | 'downloadPng' | 'downloadCsv' }> = [
  { id: 'pdf', name: 'fmtPdf', hint: 'fmtPdfHint', action: 'downloadPdf' },
  { id: 'png', name: 'fmtPng', hint: 'fmtPngHint', action: 'downloadPng' },
  { id: 'csv', name: 'fmtCsv', hint: 'fmtCsvHint', action: 'downloadCsv' },
]
const INCLUDES: ReadonlyArray<{ key: keyof ExportInclude; label: 'incSummary' | 'incAppliances' | 'incParts' | 'incNotes' | 'incRequester'; inCsv: boolean }> = [
  { key: 'summary', label: 'incSummary', inCsv: false },
  { key: 'appliances', label: 'incAppliances', inCsv: true },
  { key: 'parts', label: 'incParts', inCsv: true },
  { key: 'notes', label: 'incNotes', inCsv: false },
  { key: 'requester', label: 'incRequester', inCsv: false },
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
export function DownloadPanel({ project, result, onRequesterChange }: { project: Project; result: SizingResult; onRequesterChange: (requester: Requester | null) => void }) {
  const { t, locale } = useLocale()
  const [format, setFormat] = useState<Format>('pdf')
  const [include, setInclude] = useState<ExportInclude>({ summary: true, appliances: true, parts: true, notes: true, requester: true })
  const [status, setStatus] = useState<Status>('idle')
  const [canShare, setCanShare] = useState(false)
  const preview = usePreviewScale(SHEET_WIDTH, PREVIEW_MAX_HEIGHT)
  // Unique per panel: the rail and the sheet can both be mounted, and same-named radios would share one group.
  const radioName = useId()
  const requesterLabelId = useId()
  const requesterRef = useRef<HTMLElement>(null)
  const [isRequesterOpen, setRequesterOpen] = useState(false)
  const onRequesterOpenChange = (open: boolean) => {
    setRequesterOpen(open)
    if (open) return
    // Save and Remove swap the add button and the card, so the dialog can't hand focus back to the button that opened
    // it. Once the dialog has restored what it could (two frames), a page left without focus gets the section's button.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body) requesterRef.current?.querySelector('button')?.focus()
    }))
  }
  useEffect(() => setCanShare(canShareFiles()), [])
  const shareImage = usePreparedImage(preview.contentRef, canShare, `${project.id}:${project.updatedAt}:${locale}:${JSON.stringify(include)}`)

  const parts = buildParts(result, t, locale)
  const current = FORMATS.find((f) => f.id === format)!
  const isEmpty = result.empty
  const isBusy = status === 'busy'

  const run = async (task: () => Promise<void>, completed: 'idle' | 'success' = 'idle') => {
    setStatus('busy')
    try {
      await task()
      setStatus(completed)
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
    // Paint the busy state before capture/encoding can occupy the main thread.
    await new Promise<void>((resolve) => requestAnimationFrame(() => { setTimeout(resolve, 0) }))
    const name = exportFileName(project.name, format)
    if (format === 'csv') {
      saveBlob(new Blob([csvFor(result, parts, include, t)], { type: 'text/csv;charset=utf-8' }), name)
      return
    }
    saveBlob(format === 'pdf' ? await renderPdf(sheetNode()) : await renderPng(sheetNode()), name)
  }, 'success')
  // `run` calls the task synchronously, so navigator.share starts inside the tap's activation window.
  const share = () => {
    if (!shareImage) return
    void run(async () => {
      await shareFile(new File([shareImage], exportFileName(project.name, 'png'), { type: 'image/png' }), project.name)
    })
  }

  return (
    <div className="dl">
      <div
        ref={preview.boxRef}
        className={`dl__preview${preview.height >= PREVIEW_MAX_HEIGHT ? ' dl__preview--clipped' : ''}`}
        style={{ height: preview.height }}
        aria-hidden="true"
      >
        <div className="dl__scaler" style={{ transform: `scale(${preview.scale})` }}>
          <KitSheet ref={preview.contentRef} projectName={project.name} result={result} parts={parts} requester={include.requester ? project.requester : null} include={include} date={fmtDate(new Date(), locale)} t={t} locale={locale} />
        </div>
      </div>

      <section ref={requesterRef} className="dl__group" aria-labelledby={requesterLabelId}>
        <span className="lab" id={requesterLabelId}>{t.requester.section}</span>
        <RequesterCard requester={project.requester} isDisabled={isBusy} onOpen={() => setRequesterOpen(true)} />
      </section>
      <RequesterSheet
        isOpen={isRequesterOpen}
        onOpenChange={onRequesterOpenChange}
        requester={project.requester}
        onSave={onRequesterChange}
        onRemove={() => onRequesterChange(null)}
      />

      <fieldset className="dl__group" disabled={isBusy}>
        <legend className="lab">{t.ui.format}</legend>
        {FORMATS.map((f) => (
          <label key={f.id} className={`dl__fmt${format === f.id ? ' dl__fmt--on' : ''}`}>
            <input type="radio" name={radioName} checked={format === f.id} onChange={() => setFormat(f.id)} />
            <span className="dl__fmt-text"><span className="dl__fmt-name">{t.ui[f.name]}</span><span className="dl__fmt-hint">{t.ui[f.hint]}</span></span>
          </label>
        ))}
      </fieldset>

      <fieldset className="dl__group" disabled={isBusy}>
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
      {status === 'success' && <p className="dl__success" role="status"><CircleCheck size={18} aria-hidden="true" />{t.ui.downloadReady}</p>}
      {isBusy && (
        <div className="dl__progress" role="status">
          <span>{t.ui.making}</span>
          <progress aria-label={t.ui.making} />
        </div>
      )}
      <div className="dl__actions">
        <button type="button" className="btn btn--primary dl__go" disabled={isEmpty || isBusy} onClick={download}>
          {isBusy ? <LoaderCircle className="dl__spinner" size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}{isBusy ? t.ui.making : t.ui[current.action]}
        </button>
        {canShare && (
          <button type="button" className="btn dl__go" disabled={isEmpty || isBusy || !shareImage} aria-busy={!shareImage} onClick={share}>
            <Share2 size={18} aria-hidden="true" />{t.ui.share}
          </button>
        )}
      </div>
    </div>
  )
}
