import React, { useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { Btn, Icon, Panel, useContextMenu } from './ui'
import { useActions } from '@/lib/actions'
import type { FileArea, FileEntry } from '@shared/types'

const AREA_TITLES: Record<FileArea, string> = { conflicted: 'Conflicts', staged: 'Staged Changes', unstaged: 'Changes', untracked: 'Untracked Files' }
const ORDER: FileArea[] = ['conflicted', 'staged', 'unstaged', 'untracked']

function code(f: FileEntry): string {
  if (f.area === 'untracked') return '?'
  if (f.area === 'conflicted') return 'U'
  return f.area === 'staged' ? f.index : f.worktree
}

export function FilesPanel(): JSX.Element {
  const { status, selectedFiles, selectFiles } = useStore()
  const a = useActions()
  const [menu, openMenu] = useContextMenu()
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => {
    const g: Record<FileArea, FileEntry[]> = { conflicted: [], staged: [], unstaged: [], untracked: [] }
    for (const f of status?.files ?? []) if (!filter || f.path.toLowerCase().includes(filter.toLowerCase())) g[f.area].push(f)
    return g
  }, [status, filter])
  const isSel = (f: FileEntry) => selectedFiles.some((s) => s.path === f.path && s.area === f.area)
  const click = (e: React.MouseEvent, f: FileEntry, list: FileEntry[]) => {
    if (e.shiftKey && selectedFiles.length) {
      const i = list.findIndex((x) => x.path === selectedFiles[selectedFiles.length - 1].path)
      const j = list.indexOf(f)
      if (i >= 0) { selectFiles(list.slice(Math.min(i, j), Math.max(i, j) + 1)); return }
    }
    if (e.metaKey || e.ctrlKey) selectFiles(isSel(f) ? selectedFiles.filter((s) => !(s.path === f.path && s.area === f.area)) : [...selectedFiles, f])
    else selectFiles([f])
  }
  const target = (f: FileEntry) => (isSel(f) ? selectedFiles : [f])
  const toggle = (f: FileEntry) => (f.area === 'staged' ? a.unstage(target(f)) : a.stage(target(f)))
  const menuFor = (e: React.MouseEvent, f: FileEntry) => {
    const t = target(f)
    const conflicted = f.area === 'conflicted'
    openMenu(e, [
      ...(conflicted ? [
        { label: 'Take Ours (current branch)', onClick: () => void a.resolve(f, 'ours') },
        { label: 'Take Theirs (incoming)', onClick: () => void a.resolve(f, 'theirs') },
        { label: 'Mark Resolved', onClick: () => void a.markResolved(t) },
        { separator: true, label: '' }
      ] : [
        f.area === 'staged' ? { label: 'Unstage', onClick: () => void a.unstage(t) } : { label: 'Stage', onClick: () => void a.stage(t) },
        { label: 'Discard…', danger: true, onClick: () => void a.discard(t) },
        ...(f.area === 'untracked' ? [{ label: 'Move to Trash…', danger: true, onClick: () => void a.trash(t) }] : []),
        { separator: true, label: '' }
      ]),
      { label: 'Show File Log', onClick: () => a.fileLog(f), disabled: f.area === 'untracked' },
      { label: 'Blame', onClick: () => void a.blame(f), disabled: f.area === 'untracked' },
      { separator: true, label: '' },
      { label: 'Open in default editor', onClick: () => void a.openFile(f) },
      { label: 'Reveal in file manager', onClick: () => void a.reveal(f) },
      { label: 'Copy path', onClick: () => a.copy(f.path) },
      { separator: true, label: '' },
      { label: 'Ignore…', onClick: () => void a.ignore(f), disabled: f.area !== 'untracked' }
    ])
  }
  const total = status?.files.length ?? 0
  const unstagedCount = groups.unstaged.length + groups.untracked.length + groups.conflicted.length
  return (
    <Panel title="Files" actions={<>
      <Btn small title="Stage all" disabled={!unstagedCount} onClick={() => void a.stageAll()}><Icon name="stage" size={14} /></Btn>
      <Btn small title="Unstage all" disabled={!groups.staged.length} onClick={() => void a.unstageAll()}><Icon name="unstage" size={14} /></Btn>
      <Btn small title="Discard selected" disabled={!selectedFiles.length} kind="danger" onClick={() => void a.discard(selectedFiles)}><Icon name="discard" size={14} /></Btn>
    </>}>
      {menu}
      <input className="filter-input" placeholder="Filter files…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {total === 0 && <div className="empty">Working tree is clean.</div>}
      {ORDER.map((area) => groups[area].length === 0 ? null : (
        <React.Fragment key={area}>
          <div className="group-header" onClick={() => setCollapsed({ ...collapsed, [area]: !collapsed[area] })}>
            <span>{collapsed[area] ? '▸' : '▾'}</span>{AREA_TITLES[area]}<span className="count">{groups[area].length}</span>
          </div>
          {!collapsed[area] && (
            <ul className="list">
              {groups[area].map((f) => (
                <li key={area + f.path} className={`row ${isSel(f) ? 'selected' : ''}`} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                  onClick={(e) => click(e, f, groups[area])} onDoubleClick={() => void toggle(f)} onContextMenu={(e) => menuFor(e, f)}>
                  <input type="checkbox" checked={f.area === 'staged'} onChange={() => void toggle(f)} onClick={(e) => e.stopPropagation()} title={f.area === 'staged' ? 'Unstage' : 'Stage'} />
                  <span className={`status-chip st-${code(f)}`}>{code(f)}</span>
                  <span className="grow">{f.path.includes('/') ? <><span className="muted">{f.path.slice(0, f.path.lastIndexOf('/') + 1)}</span>{f.path.slice(f.path.lastIndexOf('/') + 1)}</> : f.path}</span>
                </li>
              ))}
            </ul>
          )}
        </React.Fragment>
      ))}
    </Panel>
  )
}
