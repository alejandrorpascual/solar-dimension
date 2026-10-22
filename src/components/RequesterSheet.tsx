import { ChevronLeft, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useLocale } from '../hooks/useLocale'
import { useRootData } from '../hooks/useRootData'
import {
  clearRequesterDraft, loadRequesterDraft, loadSavedClients, requesterStorage, saveSavedClients, type RequesterStorage,
} from '../lib/persistence'
import { defaultCountry, emptyRequester, type Requester } from '../lib/requester'
import { resumableDraft, type DraftTarget } from '../lib/requester-draft'
import { byRecent, matchingClient, removeClient, touchClient, upsertClient, type SavedClient } from '../lib/saved-clients'
import { ClientList, PROJECT_CHOICE, type ClientChoice } from './ClientList'
import { RequesterForm } from './RequesterForm'

interface Props {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** The open project's requester, or null. */
  requester: Requester | null
  onSave: (requester: Requester) => void
  onRemove: () => void
}

type View =
  | { kind: 'list'; selected: ClientChoice | null }
  | { kind: 'form'; target: DraftTarget; resumed: { draft: Requester; shouldRemember: boolean } | null }

/** Who the spec sheet is for, in a dialog (a bottom sheet on phones): saved clients to pick from, or the form. */
export function RequesterSheet({ isOpen, onOpenChange, ...flow }: Props) {
  return (
    <ModalOverlay className="qdialog__overlay" isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Modal className="qdialog">
        <Dialog className="qdialog__body">
          {({ close }) => <RequesterFlow {...flow} close={close} />}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

const newClientId = (): string => crypto.randomUUID()

/** Mounted each time the dialog opens: it reads the saved clients and any kept draft fresh. */
function RequesterFlow({ projectId, requester, onSave, onRemove, close }: Omit<Props, 'isOpen' | 'onOpenChange'> & { close: () => void }) {
  const { t, locale } = useLocale()
  // Saved clients and the draft belong to whoever is signed in, or to nobody signed out.
  const { user, isAccountUnreachable } = useRootData()
  const owner = user?.id ?? null
  const storage = requesterStorage(isAccountUnreachable)
  const [clients, setClients] = useState<SavedClient[]>(() => loadSavedClients(owner, storage))
  const [view, setView] = useState<View>(() => firstView(clients, requester, owner, projectId, storage))
  const titleRef = useRef<HTMLHeadingElement>(null)
  const viewKey = view.kind === 'form' ? `form:${JSON.stringify(view.target)}` : 'list'
  const isFirstView = useRef(true)

  // Moving between the list and the form removes the button that had focus; the new view's title takes it.
  useEffect(() => {
    if (isFirstView.current) { isFirstView.current = false; return }
    titleRef.current?.focus()
  }, [viewKey])

  const storeClients = (next: SavedClient[]) => {
    setClients(next)
    saveSavedClients(owner, next, storage)
  }
  const blank = () => emptyRequester(defaultCountry(locale))
  const clientById = (id: string) => clients.find((c) => c.id === id) ?? null
  const projectOnly = requester && !matchingClient(clients, requester) ? requester : null
  const listView = (selected: ClientChoice | null = choiceFor(clients, requester)): View => ({ kind: 'list', selected })
  const formOrList = (next: SavedClient[]): View =>
    next.length > 0 || requester ? listView(choiceFor(next, requester)) : { kind: 'form', target: requester ? 'project' : 'new', resumed: null }

  if (view.kind === 'list') {
    const use = () => {
      if (view.selected && view.selected !== PROJECT_CHOICE) {
        const chosen = clientById(view.selected)
        if (chosen) {
          onSave(chosen.requester)
          storeClients(touchClient(clients, chosen.id, Date.now()))
        }
      }
      close()
    }
    return (
      <>
        <CloseButton label={t.requester.close} onPress={close} />
        <Heading slot="title" ref={titleRef} tabIndex={-1} className="qdialog__title">{t.requester.listTitle}</Heading>
        <p className="qdialog__text">{t.requester.listHelp}</p>
        <ClientList
          clients={byRecent(clients)}
          projectOnly={projectOnly}
          selected={view.selected}
          onSelect={(selected) => setView({ kind: 'list', selected })}
          onEdit={(choice) => setView({ kind: 'form', target: choice === PROJECT_CHOICE ? 'project' : { client: choice }, resumed: null })}
          onNew={() => setView({ kind: 'form', target: 'new', resumed: null })}
          onUse={use}
          onRemove={requester ? () => { onRemove(); close() } : null}
        />
      </>
    )
  }

  const { target } = view
  const editing = typeof target === 'object' ? clientById(target.client) : null
  const base = editing?.requester ?? (target === 'project' && requester ? requester : blank())
  const hasList = clients.length > 0

  const save = (clean: Requester, shouldRemember: boolean) => {
    const now = Date.now()
    if (editing) {
      const saved = upsertClient(clients, clean, now, newClientId, editing.id)
      storeClients(saved.clients)
      setView(listView(saved.id))
      return
    }
    if (shouldRemember) storeClients(upsertClient(clients, clean, now, newClientId).clients)
    onSave(clean)
    close()
  }

  return (
    <>
      <CloseButton label={t.requester.close} onPress={close} />
      {hasList && (
        // Going back is deliberate, so the draft goes with it.
        <button type="button" className="rq-back" onClick={() => { clearRequesterDraft({ owner, projectId, target }, storage); setView(listView()) }}>
          <ChevronLeft size={18} aria-hidden="true" />{t.requester.backToClients}
        </button>
      )}
      <Heading slot="title" ref={titleRef} tabIndex={-1} className="qdialog__title">{t.requester.sheetTitle}</Heading>
      <p className="qdialog__text">{t.requester.sheetHelp}</p>
      <RequesterForm
        key={viewKey}
        owner={owner}
        projectId={projectId}
        target={target}
        base={base}
        resumed={view.resumed}
        canRemember={!editing}
        onSave={save}
        onRemove={target === 'project' && requester ? () => { onRemove(); close() } : null}
        onDelete={editing ? () => {
          const next = removeClient(clients, editing.id)
          storeClients(next)
          setView(formOrList(next))
        } : null}
      />
    </>
  )
}

function CloseButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <button type="button" className="qdialog__close" aria-label={label} onClick={onPress}><X size={16} aria-hidden="true" /></button>
}

/** The list row for the project's requester: its saved client, its own row, or none. */
function choiceFor(clients: readonly SavedClient[], requester: Requester | null): ClientChoice | null {
  if (!requester) return null
  return matchingClient(clients, requester)?.id ?? PROJECT_CHOICE
}

/** A draft kept for this project opens the form; saved clients open the list; otherwise the form, blank or the project's. */
function firstView(
  clients: readonly SavedClient[], requester: Requester | null, owner: string | null, projectId: string, storage: RequesterStorage | null,
): View {
  const kept = resumableDraft(loadRequesterDraft(storage), owner, projectId)
  if (kept) {
    // A draft for a client deleted since, or for a requester since removed, carries on as a new client.
    const clientId = typeof kept.target === 'object' ? kept.target.client : null
    const isGone = (clientId !== null && !clients.some((c) => c.id === clientId)) || (kept.target === 'project' && !requester)
    // The form rewrites the slot under its new target as soon as it mounts, so later clears still find it.
    return { kind: 'form', target: isGone ? 'new' : kept.target, resumed: { draft: kept.draft, shouldRemember: kept.shouldRemember } }
  }
  if (clients.length > 0) return { kind: 'list', selected: choiceFor(clients, requester) }
  return { kind: 'form', target: requester ? 'project' : 'new', resumed: null }
}
