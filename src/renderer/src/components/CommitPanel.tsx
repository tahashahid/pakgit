import React, { useEffect, useState } from 'react'
import { LS, useStore } from '@/lib/store'
import { Btn, Icon, Panel } from './ui'
import { useActions } from '@/lib/actions'

export function CommitPanel(): JSX.Element {
  const { status, run, api, repo, commits, toast } = useStore()
  const a = useActions()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [amend, setAmend] = useState(false)
  const [all, setAll] = useState(false)
  const [noVerify, setNoVerify] = useState(false)
  const [signoff, setSignoff] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [recent, setRecent] = useState<string[]>(() => LS.get<string[]>('recentMessages', []))
  useEffect(() => { setSubject(''); setBody(''); setAmend(false) }, [repo])
  useEffect(() => {
    if (amend && commits[0] && !subject) { setSubject(commits[0].subject); setBody(commits[0].body) }
  }, [amend, commits, subject])
  const staged = status?.files.filter((f) => f.area === 'staged').length ?? 0
  const changed = status?.files.filter((f) => f.area !== 'staged').length ?? 0
  const canCommit = !!repo && subject.trim().length > 0 && (staged > 0 || (all && changed > 0) || amend)
  const doCommit = async (push: boolean) => {
    if (!repo) return
    const message = body.trim() ? `${subject.trim()}\n\n${body.trim()}` : subject.trim()
    const r = await run(push ? 'Commit & Push' : 'Commit', () => api.commit(repo.path, { message, amend, all, noVerify, signoff, push }), { success: push ? 'Committed and pushed' : 'Committed' })
    if (r !== undefined) {
      const next = [message, ...recent.filter((m) => m !== message)].slice(0, 15)
      setRecent(next); LS.set('recentMessages', next)
      setSubject(''); setBody(''); setAmend(false)
    }
  }
  const inState = status && status.state !== 'clean'
  return (
    <Panel title="Commit" actions={<Btn small title="Undo last commit" onClick={() => void a.undoLastCommit()} disabled={!commits.length}><Icon name="undo" size={14} /></Btn>}>
      {inState && (
        <div className="state-banner">
          {status.state === 'merging' ? 'Merge in progress' : status.state === 'rebasing' ? 'Rebase in progress' : `${status.state} in progress`}
          <span className="spacer" style={{ flex: 1 }} />
          {status.state === 'rebasing' ? <>
            <Btn small kind="primary" onClick={() => void a.rebaseAction('continue')}>Continue</Btn>
            <Btn small onClick={() => void a.rebaseAction('skip')}>Skip</Btn>
            <Btn small kind="danger" onClick={() => void a.rebaseAction('abort')}>Abort</Btn>
          </> : status.state === 'merging' ? <>
            <Btn small kind="primary" onClick={() => void a.mergeAction('continue')}>Continue</Btn>
            <Btn small kind="danger" onClick={() => void a.mergeAction('abort')}>Abort</Btn>
          </> : null}
        </div>
      )}
      <div className="commit-form" style={inState ? { height: 'calc(100% - 34px)' } : undefined}>
        <div className="subject-wrap">
          <input className="subject" placeholder="Commit message (subject)" value={subject} onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) void doCommit(false); if (e.key === 'Escape') setShowRecent(false) }} />
          {recent.length > 0 && <Btn small kind="ghost" title="Recent commit messages" onClick={() => setShowRecent(!showRecent)}>▾</Btn>}
          {showRecent && (
            <ul className="list recent-msgs" onMouseLeave={() => setShowRecent(false)}>
              {recent.map((m) => <li key={m} className="row" onClick={() => { const [sub, ...rest] = m.split('\n'); setSubject(sub); setBody(rest.join('\n').trim()); setShowRecent(false) }}>{m.split('\n')[0]}</li>)}
            </ul>
          )}
        </div>
        <textarea placeholder="Description (optional)" value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) void doCommit(false) }} />
        <div className="commit-footer">
          <label><input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />Amend</label>
          <label title="Commit all tracked changes (git commit -a)"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />All changes</label>
          <label title="Bypass commit hooks"><input type="checkbox" checked={noVerify} onChange={(e) => setNoVerify(e.target.checked)} />No verify</label>
          <label><input type="checkbox" checked={signoff} onChange={(e) => setSignoff(e.target.checked)} />Sign-off</label>
          <span style={{ flex: 1 }} />
          <span className="muted">{staged} staged</span>
          <Btn kind="primary" disabled={!canCommit} onClick={() => void doCommit(false)} title="Cmd/Ctrl+Enter">Commit</Btn>
          <Btn disabled={!canCommit || !status?.upstream && !status?.branch} onClick={() => { if (!status?.upstream) toast('info', 'No upstream yet: the push will use the Push dialog defaults'); void doCommit(true) }}>Commit & Push</Btn>
        </div>
      </div>
    </Panel>
  )
}
