import React, { useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { Btn, Icon, Panel, timeAgo, useContextMenu } from './ui'
import { layoutGraph, LANE_COLORS } from '@/lib/graph'
import { useActions } from '@/lib/actions'
import type { Commit } from '@shared/types'

const ROW = 24, LANE_W = 14

function RefPills({ refs }: { refs: string[] }): JSX.Element | null {
  if (!refs.length) return null
  return <>{refs.map((r) => {
    const cls = r === 'HEAD' ? 'head' : r.startsWith('tag: ') ? 'tag' : r.includes('/') ? 'remote' : r.startsWith('refs/stash') ? 'stash' : ''
    return <span key={r} className={`ref-pill ${cls}`}>{r.replace('tag: ', '')}</span>
  })}</>
}

export function LogPanel(): JSX.Element {
  const { commits, selectedCommit, selectCommit, status } = useStore()
  const a = useActions()
  const [menu, openMenu] = useContextMenu()
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => filter ? commits.filter((c) => [c.subject, c.author, c.sha, c.refs.join(' ')].join(' ').toLowerCase().includes(filter.toLowerCase())) : commits, [commits, filter])
  const rows = useMemo(() => layoutGraph(filtered), [filtered])
  const maxLanes = Math.max(1, ...rows.map((r) => Math.max(r.lanes.length, ...r.edges.map((e) => Math.max(e.from, e.to) + 1))))
  const gw = Math.min(maxLanes, 12) * LANE_W + 8
  const headSha = commits.find((c) => c.refs.includes('HEAD'))?.sha
  const menuFor = (e: React.MouseEvent, c: Commit) => openMenu(e, [
    { label: 'Check Out Commit…', onClick: () => void a.checkoutCommit(c) },
    { label: 'Add Branch from here…', onClick: () => void a.addBranch(c.sha) },
    { label: 'Add Tag…', onClick: () => void a.addTag(c) },
    { separator: true, label: '' },
    { label: 'Cherry Pick', onClick: () => void a.cherryPick(c), disabled: c.sha === headSha },
    { label: 'Revert', onClick: () => void a.revert(c) },
    { label: 'Merge into current…', onClick: () => void a.merge(c.sha) },
    { label: 'Rebase current onto…', onClick: () => void a.rebase(c.sha) },
    { label: `Reset ${status?.branch ?? 'HEAD'} to here…`, danger: true, onClick: () => void a.reset(c) },
    { separator: true, label: '' },
    { label: 'Copy SHA', onClick: () => a.copy(c.sha) },
    { label: 'Copy subject', onClick: () => a.copy(c.subject) }
  ])
  return (
    <Panel title="Log" actions={<Btn small title="Fetch" onClick={() => void a.fetch()}><Icon name="fetch" size={14} /></Btn>}>
      {menu}
      <input className="filter-input" placeholder="Filter commits (subject, author, sha)…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {commits.length === 0 && <div className="empty">No commits yet.</div>}
      <div className="log">
        <table>
          <colgroup><col style={{ width: gw }} /><col /><col style={{ width: 140 }} /><col style={{ width: 90 }} /><col style={{ width: 70 }} /></colgroup>
          <thead><tr><th /><th>Message</th><th>Author</th><th>Date</th><th>SHA</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.commit.sha} className={selectedCommit?.sha === r.commit.sha ? 'selected' : ''} onClick={() => void selectCommit(r.commit.sha)} onContextMenu={(e) => menuFor(e, r.commit)}>
                <td className="graph">
                  <svg width={gw} height={ROW}>
                    {r.edges.map((e, i) => {
                      const x1 = e.from * LANE_W + LANE_W / 2 + 4, x2 = e.to * LANE_W + LANE_W / 2 + 4
                      const col = LANE_COLORS[e.color]
                      if (e.from === e.to) return <line key={i} x1={x1} y1={e.from === r.lane ? ROW / 2 : 0} x2={x1} y2={ROW} stroke={col} strokeWidth="2" />
                      return <path key={i} d={`M${x1},${ROW / 2} C${x1},${ROW} ${x2},${ROW / 2} ${x2},${ROW}`} stroke={col} strokeWidth="2" fill="none" />
                    })}
                    <line x1={r.lane * LANE_W + LANE_W / 2 + 4} y1={0} x2={r.lane * LANE_W + LANE_W / 2 + 4} y2={ROW / 2} stroke={LANE_COLORS[r.color]} strokeWidth="2" opacity={r.fresh ? 0 : 1} />
                    <circle cx={r.lane * LANE_W + LANE_W / 2 + 4} cy={ROW / 2} r={r.commit.sha === headSha ? 5 : 3.5} fill={r.commit.sha === headSha ? 'var(--bg2)' : LANE_COLORS[r.color]} stroke={LANE_COLORS[r.color]} strokeWidth="2" />
                  </svg>
                </td>
                <td title={r.commit.subject}><RefPills refs={r.commit.refs} />{r.commit.subject}</td>
                <td title={r.commit.email}>{r.commit.author}</td>
                <td title={new Date(r.commit.date).toLocaleString()}>{timeAgo(r.commit.date)}</td>
                <td className="mono muted">{r.commit.shortSha}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

export function CommitDetailsPanel(): JSX.Element {
  const { selectedCommit: c, selectedCommitFile, selectCommitFile } = useStore()
  const a = useActions()
  return (
    <Panel title="Commit Details">
      {!c ? <div className="empty">Select a commit.</div> : (
        <div className="commit-details">
          <h3>{c.subject}</h3>
          <div className="meta">
            <span>Author</span><span>{c.author} &lt;{c.email}&gt;</span>
            <span>Date</span><span>{new Date(c.date).toLocaleString()}</span>
            <span>SHA</span><span className="mono" style={{ cursor: 'pointer' }} onClick={() => a.copy(c.sha)} title="Copy">{c.sha}</span>
            <span>Parents</span><span className="mono">{c.parents.map((p) => p.slice(0, 7)).join(', ') || '—'}</span>
          </div>
          {c.body && <pre>{c.body}</pre>}
          <div className="group-header">Files<span className="count">{c.files.length}</span></div>
          <ul className="list">
            {c.files.map((f) => (
              <li key={f.path} className={`row ${selectedCommitFile === f.path ? 'selected' : ''}`} onClick={() => void selectCommitFile(f.path)}>
                <span className={`status-chip st-${f.status}`}>{f.status}</span>
                <span className="grow">{f.path}</span>
                <span className="muted" style={{ fontSize: 11 }}><span style={{ color: 'var(--add-fg)' }}>+{f.additions}</span> <span style={{ color: 'var(--del-fg)' }}>−{f.deletions}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}
