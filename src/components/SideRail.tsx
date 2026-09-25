import { Download, LayoutGrid, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Dialog, Heading, Modal, ModalOverlay, Tab, TabList, TabPanel, Tabs } from 'react-aria-components'
import { useLocale } from '../hooks/useLocale'
import type { Store } from '../lib/schema'
import { ProjectCards } from './ProjectCards'

export type RailTab = 'projects' | 'download'

export interface SideRailProps {
  store: Store
  commit: (s: Store) => void
  tab: RailTab
  onTab: (tab: RailTab) => void
  /** The Download tab's content (DownloadPanel for the open project). */
  download: ReactNode
  onPicked?: () => void
}

/** Two tabs: every saved project at a glance, and downloads of the open one. */
export function SideRail({ store, commit, tab, onTab, download, onPicked }: SideRailProps) {
  const { t } = useLocale()
  return (
    <Tabs className="rtabs" selectedKey={tab} onSelectionChange={(key) => onTab(key === 'download' ? 'download' : 'projects')}>
      <TabList className="rtabs__list" aria-label={t.ui.projects}>
        <Tab id="projects" className="rtab">
          <LayoutGrid size={16} aria-hidden="true" />{t.ui.projects}<span className="rtab__count num">{store.projects.length}</span>
        </Tab>
        <Tab id="download" className="rtab"><Download size={16} aria-hidden="true" />{t.ui.download}</Tab>
      </TabList>
      <TabPanel id="projects" className="rtabs__panel">
        <ProjectCards store={store} commit={commit} onPicked={onPicked} />
      </TabPanel>
      <TabPanel id="download" className="rtabs__panel">{download}</TabPanel>
    </Tabs>
  )
}

interface SheetProps extends Omit<SideRailProps, 'onPicked'> {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

/** The rail on screens too narrow to keep it beside the page: a sheet from the bottom edge. */
export function RailSheet({ isOpen, onOpenChange, ...rail }: SheetProps) {
  const { t } = useLocale()
  return (
    <ModalOverlay className="rsheet__overlay" isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Modal className="rsheet">
        <Dialog className="rsheet__dialog">
          <div className="rsheet__head">
            <span className="bsel__grab" aria-hidden="true" />
            <Heading slot="title" className="visually-hidden">{rail.tab === 'download' ? t.ui.download : t.ui.projects}</Heading>
            <button type="button" className="rsheet__close" aria-label={t.ui.close} onClick={() => onOpenChange(false)}><X size={18} aria-hidden="true" /></button>
          </div>
          <SideRail {...rail} onPicked={() => onOpenChange(false)} />
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
