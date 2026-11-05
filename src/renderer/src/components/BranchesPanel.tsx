import React, { useState } from 'react'
import { useStore } from '@/lib/store'
import { Btn, Icon, Panel, useContextMenu } from './ui'
import { useActions } from '@/lib/actions'
import type { BranchInfo } from '@shared/types'

function Group({ title, count, children, defaultOpen = true }: { title: string; count: number; children: React.ReactNode; defaultOpen?: boolean }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <>
      <div className="group-header" onClick={() => setOpen(!open)}><span>{open ? '▾' : '▸'}</span>{title}<span className="count">{count}</span></div>
      {open && <ul className="list">{children}</ul>}
    </>
  )
}

export function BranchesPanel(): JSX.Element {
  const { refs, status, submodules, worktrees, selectedStash, selectStash } = useStore()
  const a = useActions()
  const [menu, openMenu] = useContextMenu()
  const [filter, setFilter] = useState('')
  const f = (n: string) => !filter || n.toLowerCase().includes(filter.toLowerCase())
  const local = (refs?.branches ?? []).filter((b) => !b.remote && f(b.name))
  const remotes = refs?.remotes ?? []
  const remoteBranches = (remote: string) => (refs?.branches ?? []).filter((b) => b.remote === remote && f(b.name))
  const tags = (refs?.tags ?? []).filter((t) => f(t.name))
  const stashes = refs?.stashes ?? []

  const branchMenu = (e: React.MouseEvent, b: BranchInfo) => openMenu(e, [
    { label: b.remote ? 'Check Out (track)' : 'Check Out', onClick: () => void a.checkout(b), disabled: b.current },
    { label: 'Merge into current', onClick: () => void a.merge(b.fullName), disabled: b.current },
    { label: 'Rebase current onto', onClick: () => void a.rebase(b.fullName), disabled: b.current },
    { label: 'Add Branch from here…', onClick: () => void a.addBranch(b.fullName) },
    { separator: true, label: '' },
    ...(b.remote ? [] : [
      { label: 'Push…', onClick: () => void a.pushBranch(b) },
      { label: 'Track Remote Branch…', onClick: () => void a.setUpstream(b) },
      { label: 'Rename…', onClick: () => void a.renameBranch(b) }
    ]),
    { label: 'Copy name', onClick: () => a.copy(b.fullName) },
    { separator: true, label: '' },
    { label: 'Delete…', danger: true, onClick: () => void a.deleteBranch(b), disabled: b.current }
  ])

  return (
    <Panel title="Branches" actions={<><Btn small title="Add branch" onClick={() => void a.addBranch()}><Icon name="plus" size={14} /></Btn><Btn small title="Fetch all" onClick={() => void a.fetch()}><Icon name="fetch" size={14} /></Btn></>}>
      {menu}
      <input className="filter-input" placeholder="Filter branches, tags…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <Group title="Local Branches" count={local.length}>
        {local.map((b) => (
          <li key={b.fullName} className={`row ${b.current ? 'selected' : ''}`} onDoubleClick={() => void a.checkout(b)} onContextMenu={(e) => branchMenu(e, b)}>
            <Icon name="branch" size={13} /><span className="grow" style={{ fontWeight: b.current ? 600 : 400 }}>{b.name}</span>
            {b.upstream && <span className="muted" style={{ fontSize: 11 }}>{b.ahead ? `↑${b.ahead} ` : ''}{b.behind ? `↓${b.behind}` : ''}</span>}
          </li>
        ))}
        {local.length === 0 && <li className="row muted">—</li>}
      </Group>
      {remotes.map((r) => (
        <Group key={r.name} title={`Remote: ${r.name}`} count={remoteBranches(r.name).length} defaultOpen={remotes.length === 1}>
          {remoteBranches(r.name).map((b) => (
            <li key={b.fullName} className="row" title={r.fetchUrl} onDoubleClick={() => void a.checkout(b)} onContextMenu={(e) => branchMenu(e, b)}>
              <span className="tree-indent" /><Icon name="branch" size={13} /><span className="grow">{b.name}</span>
            </li>
          ))}
          <li className="row muted" style={{ fontSize: 11 }} onContextMenu={(e) => openMenu(e, [
            { label: 'Fetch', onClick: () => void a.fetch(r.name) },
            { label: 'Copy URL', onClick: () => a.copy(r.fetchUrl) },
            { label: 'Delete remote…', danger: true, onClick: () => void a.removeRemote(r.name) }
          ])}><span className="tree-indent" />{r.fetchUrl}</li>
        </Group>
      ))}
      {remotes.length === 0 && <div className="group-header" onClick={() => void a.addRemote()}>+ Add remote repository…</div>}
      <Group title="Tags" count={tags.length} defaultOpen={tags.length <= 20}>
        {tags.map((t) => (
          <li key={t.name} className="row" onDoubleClick={() => void a.checkoutTag(t)} onContextMenu={(e) => openMenu(e, [
            { label: 'Check Out Tag', onClick: () => void a.checkoutTag(t) },
            { label: 'Copy name', onClick: () => a.copy(t.name) },
            { label: 'Delete…', danger: true, onClick: () => void a.deleteTag(t) }
          ])}><Icon name="tag" size={13} /><span className="grow">{t.name}</span><span className="mono muted">{t.sha.slice(0, 7)}</span></li>
        ))}
      </Group>
      <Group title="Stashes" count={stashes.length}>
        {stashes.map((st) => (
          <li key={st.ref} className={`row ${selectedStash?.ref === st.ref ? 'selected' : ''}`} onClick={() => selectStash(st)} onDoubleClick={() => void a.stashApply(st, false)} onContextMenu={(e) => openMenu(e, [
            { label: 'Apply Stash', onClick: () => void a.stashApply(st, false) },
            { label: 'Apply & Drop (pop)', onClick: () => void a.stashApply(st, true) },
            { label: 'Drop…', danger: true, onClick: () => void a.stashDrop(st) }
          ])}><Icon name="stash" size={13} /><span className="grow">{st.message}</span><span className="muted">{st.ref}</span></li>
        ))}
        {stashes.length === 0 && <li className="row muted">No stash available</li>}
      </Group>
      {submodules.length > 0 && (
        <Group title="Submodules" count={submodules.length}>
          {submodules.map((sm) => (
            <li key={sm.path} className="row" title={`${sm.sha} ${sm.ref}`} onDoubleClick={() => sm.state !== 'uninitialized' && a.openPath(sm.path)} onContextMenu={(e) => openMenu(e, [
              { label: 'Open Submodule', onClick: () => a.openPath(sm.path), disabled: sm.state === 'uninitialized' },
              { label: sm.state === 'uninitialized' ? 'Initialize' : 'Update', onClick: () => void a.submoduleUpdate([sm.path]) },
              { label: 'Update all submodules', onClick: () => void a.submoduleUpdate() }
            ])}><Icon name="submodule" size={13} /><span className="grow">{sm.path}</span><span className="sub-state">{sm.state}</span></li>
          ))}
        </Group>
      )}
      <Group title="Worktrees" count={worktrees.length} defaultOpen={worktrees.length > 1}>
        {worktrees.map((wt) => (
          <li key={wt.path} className="row" title={wt.path} onDoubleClick={() => !wt.main && a.openPath(wt.path)} onContextMenu={(e) => openMenu(e, [
            { label: 'Open Worktree', onClick: () => a.openPath(wt.path), disabled: wt.main },
            { label: 'Copy path', onClick: () => a.copy(wt.path) },
            { label: 'Remove…', danger: true, onClick: () => void a.worktreeRemove(wt.path), disabled: wt.main }
          ])}><Icon name="worktree" size={13} /><span className="grow">{wt.branch ?? wt.sha.slice(0, 7)}</span><span className="muted" style={{ fontSize: 11 }}>{wt.main ? 'main' : wt.path.split('/').pop()}</span></li>
        ))}
        <li className="row muted" style={{ cursor: 'pointer' }} onClick={() => void a.worktreeAdd()}>+ Add worktree…</li>
      </Group>
      {status?.state && status.state !== 'clean' && <div className="group-header">State: {status.state}</div>}
    </Panel>
  )
}
