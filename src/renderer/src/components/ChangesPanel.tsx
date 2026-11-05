import React, { useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { Btn, Panel } from './ui'
import { parseDiff, diffStats } from '@/lib/diff'

export function DiffView({ raw, ignoreWs }: { raw: string; ignoreWs?: boolean }): JSX.Element {
  const files = useMemo(() => parseDiff(raw), [raw])
  if (!raw.trim()) return <div className="empty">No changes to show.</div>
  return (
    <div className="diff">
      {files.map((f, i) => {
        const st = diffStats(f.lines.map((l) => (l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ') + l.text).join('\n'))
        return (
          <div key={i}>
            {f.header && <div className="diff-file-header"><span>{f.header.replace(/^diff --git a\/(.*) b\/.*$/, '$1')}</span><span className="muted">+{st.add} −{st.del}</span></div>}
            {f.binary ? <div className="empty">Binary file</div> : (
              <table><tbody>
                {f.lines.map((l, j) => {
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
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ChangesPanel(): JSX.Element {
  const { diff, selectedFiles, selectedCommit, selectedCommitFile } = useStore()
  const [ignoreWs, setIgnoreWs] = useState(false)
  const title = selectedCommitFile ? `Changes: ${selectedCommitFile} @ ${selectedCommit?.shortSha}` : selectedFiles.length === 1 ? `Changes: ${selectedFiles[0].path}` : 'Changes'
  return (
    <Panel title={title} actions={<Btn small active={ignoreWs} title="Ignore whitespace-only lines" onClick={() => setIgnoreWs(!ignoreWs)}>⎵</Btn>}>
      {selectedFiles.length > 1 ? <div className="empty">{selectedFiles.length} files selected.</div> :
        !selectedFiles.length && !selectedCommitFile ? <div className="empty">Select a file to see its changes.</div> : <DiffView raw={diff} ignoreWs={ignoreWs} />}
    </Panel>
  )
}
