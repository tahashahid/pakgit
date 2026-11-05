import React from 'react'
import { useStore } from '@/lib/store'
import { Btn, Icon, Panel, useContextMenu } from './ui'
import { useActions } from '@/lib/actions'

export function RepositoriesPanel(): JSX.Element {
  const { repos, repo, openRepo, removeRepo } = useStore()
  const a = useActions()
  const [menu, openMenu] = useContextMenu()
  return (
    <Panel title="Repositories" actions={<><Btn small title="Open repository" onClick={() => a.openRepo()}><Icon name="plus" size={14} /></Btn></>}>
      {menu}
      {repos.length === 0 && <div className="empty">No repositories yet.<br />Open, clone or initialize one.</div>}
      <ul className="list">
        {repos.map((r) => (
          <li key={r.path} className={`row ${repo?.path === r.path ? 'selected' : ''}`} title={r.path}
            onClick={() => openRepo(r)}
            onContextMenu={(e) => openMenu(e, [
              { label: 'Open', onClick: () => openRepo(r) },
              { label: 'Open in Terminal', onClick: () => window.pakgit.openTerminal(r.path) },
              { label: 'Reveal in File Manager', onClick: () => window.pakgit.revealInFinder(r.path) },
              { separator: true, label: '' },
              { label: 'Remove from list', danger: true, onClick: () => void removeRepo(r.path) }
            ])}>
            <Icon name="folder" size={14} /><span className="grow">{r.name}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
