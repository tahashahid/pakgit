import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { Btn, Icon, Panel } from './ui'
import { parseDiff, diffStats, splitHunks, toSideBySide, type DiffLine } from '@/lib/diff'
import { useActions } from '@/lib/actions'
import type { FileEntry } from '@shared/types'

function Rows({ lines, ignoreWs }: { lines: DiffLine[]; ignoreWs: boolean }): JSX.Element {
  return (
    <table><tbody>
      {lines.map((l, j) => {
        if (ignoreWs && (l.kind === 'add' || l.kind === 'del') && !l.text.trim()) return null
        return (
          <tr key={j} className={l.kind}>
            <td className="no">{l.oldNo ?? ''}</td><td className="no">{l.newNo ?? ''}</td>
            <td className="sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</td>
            <td>{l.text}</td>
          </tr>
        )
      })}
    </tbody></table>
  )
}

function SideBySide({ lines }: { lines: DiffLine[] }): JSX.Element {
  const rows = useMemo(() => toSideBySide(lines), [lines])
  return (
    <table className="sbs"><tbody>
      {rows.map((r, i) => r.kind === 'hunk' || r.kind === 'meta' ? (
        <tr key={i} className={r.kind}><td className="no" /><td colSpan={3}>{r.left?.text}</td></tr>
      ) : (
        <tr key={i} className={r.kind === 'ctx' ? 'ctx' : ''}>
          <td className="no">{r.left?.oldNo ?? ''}</td><td className={r.kind === 'change' && r.left ? 'del' : r.kind === 'change' ? 'blank' : ''}>{r.left?.text ?? ''}</td>
          <td className="no">{r.right?.newNo ?? ''}</td><td className={r.kind === 'change' && r.right ? 'add' : r.kind === 'change' ? 'blank' : ''}>{r.right?.text ?? ''}</td>
        </tr>
      ))}
    </tbody></table>
  )
}

export function DiffView({ raw, ignoreWs, sideBySide, hunkAction }: { raw: string; ignoreWs?: boolean; sideBySide?: boolean; hunkAction?: { label: string; onApply: (patch: string) => void } }): JSX.Element {
  const files = useMemo(() => parseDiff(raw), [raw])
  const { header, hunks } = useMemo(() => splitHunks(raw), [raw])
  if (!raw.trim()) return <div className="empty">No changes to show.</div>
  const stats = diffStats(raw)
  // hunk mode (single file): render each hunk with its own action button
  if (hunkAction && files.length === 1 && hunks.length) {
    const f = files[0]
    const hunkLines: DiffLine[][] = []
    let cur: DiffLine[] | null = null
    for (const l of f.lines) { if (l.kind === 'hunk') { cur = [l]; hunkLines.push(cur) } else if (cur) cur.push(l) }
    return (
      <div className="diff">
        <div className="diff-file-header"><span>{f.header.replace(/^diff --git a\/(.*) b\/.*$/, '$1')}</span><span className="muted">+{stats.add} −{stats.del}</span></div>
        {f.binary ? <div className="empty">Binary file</div> : hunkLines.map((hl, i) => (
          <div key={i} className="hunk">
            <div className="hunk-bar"><span className="muted">{hl[0].text}</span><Btn small onClick={() => hunkAction.onApply(header + '\n' + hunks[i] + '\n')}>{hunkAction.label}</Btn></div>
            {sideBySide ? <SideBySide lines={hl.slice(1)} /> : <Rows lines={hl.slice(1)} ignoreWs={!!ignoreWs} />}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="diff">
      {files.map((f, i) => (
        <div key={i}>
          {f.header && <div className="diff-file-header"><span>{f.header.replace(/^diff --git a\/(.*) b\/.*$/, '$1')}</span></div>}
          {f.binary ? <div className="empty">Binary file</div> : sideBySide ? <SideBySide lines={f.lines} /> : <Rows lines={f.lines} ignoreWs={!!ignoreWs} />}
        </div>
      ))}
    </div>
  )
}

function ConflictView({ file }: { file: FileEntry }): JSX.Element {
  const { api, repo, status } = useStore()
  const a = useActions()
  const [text, setText] = useState('')
  useEffect(() => { if (repo) api.conflictFile(repo.path, file.path).then(setText).catch(() => setText('')) }, [api, repo, file, status])
  const lines = text.split('\n')
  return (
    <div className="conflict">
      <div className="state-banner">
        Conflict in {file.path}
        <span style={{ flex: 1 }} />
        <Btn small onClick={() => void a.resolve(file, 'ours')} title="Keep the version from the current branch">Take Ours</Btn>
        <Btn small onClick={() => void a.resolve(file, 'theirs')} title="Keep the version being merged in">Take Theirs</Btn>
        <Btn small onClick={() => void a.openFile(file)}>Edit…</Btn>
        <Btn small kind="primary" onClick={() => void a.markResolved([file])} title="Stage the file as resolved after editing">Mark Resolved</Btn>
      </div>
      <div className="diff"><table><tbody>
        {lines.map((l, i) => {
          const marker = l.startsWith('<<<<<<<') ? 'ours' : l.startsWith('>>>>>>>') ? 'theirs' : l.startsWith('=======') ? 'sep' : l.startsWith('|||||||') ? 'base' : ''
          return <tr key={i} className={marker ? `marker ${marker}` : ''}><td className="no">{i + 1}</td><td>{l}</td></tr>
        })}
      </tbody></table></div>
    </div>
  )
}

function BlameView(): JSX.Element {
  const { blame, clearBlame, selectCommit, setPerspective } = useStore()
  if (!blame) return <></>
  let lastSha = ''
  return (
    <div className="diff blame">
      <div className="diff-file-header"><span>Blame: {blame.path}</span><span style={{ flex: 1 }} /><Btn small onClick={clearBlame}><Icon name="x" size={12} />Close</Btn></div>
      <table><tbody>
        {blame.lines.map((l) => {
          const first = l.sha !== lastSha; lastSha = l.sha
          return (
            <tr key={l.line} className={first ? 'blame-first' : ''} title={`${l.sha}\n${l.summary}`} onDoubleClick={() => { setPerspective('log'); void selectCommit(l.sha) }}>
              <td className="blame-meta">{first ? <><span className="mono">{l.sha.slice(0, 7)}</span> {l.author} <span className="muted">{l.date}</span></> : ''}</td>
              <td className="no">{l.line}</td><td>{l.text}</td>
            </tr>
          )
        })}
      </tbody></table>
    </div>
  )
}

export function ChangesPanel(): JSX.Element {
  const { diff, selectedFiles, selectedCommit, selectedCommitFile, selectedStash, blame, api, repo, run } = useStore()
  const [ignoreWs, setIgnoreWs] = useState(false)
  const [sbs, setSbs] = useState(false)
  const file = selectedFiles.length === 1 ? selectedFiles[0] : null
  const title = blame ? 'Blame' : selectedStash ? `Stash: ${selectedStash.message}` : selectedCommitFile ? `Changes: ${selectedCommitFile} @ ${selectedCommit?.shortSha}` : file ? `Changes: ${file.path}` : 'Changes'
  const hunkAction = file && repo && (file.area === 'unstaged' || file.area === 'staged') ? {
    label: file.area === 'staged' ? 'Unstage hunk' : 'Stage hunk',
    onApply: (patch: string) => void run(file.area === 'staged' ? 'Unstage hunk' : 'Stage hunk', () => api.applyPatch(repo.path, patch, { cached: true, reverse: file.area === 'staged' }))
  } : undefined
  return (
    <Panel title={title} actions={<>
      <Btn small active={sbs} title="Side-by-side" onClick={() => setSbs(!sbs)}>⫿</Btn>
      <Btn small active={ignoreWs} title="Hide whitespace-only lines" onClick={() => setIgnoreWs(!ignoreWs)}>⎵</Btn>
    </>}>
      {blame ? <BlameView /> :
        file?.area === 'conflicted' ? <ConflictView file={file} /> :
        selectedFiles.length > 1 ? <div className="empty">{selectedFiles.length} files selected.</div> :
        !file && !selectedCommitFile && !selectedStash ? <div className="empty">Select a file, commit file or stash to see changes.</div> :
        <DiffView raw={diff} ignoreWs={ignoreWs} sideBySide={sbs} hunkAction={hunkAction} />}
    </Panel>
  )
}
