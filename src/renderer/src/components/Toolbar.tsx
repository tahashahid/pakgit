import React from 'react'
import { useStore } from '@/lib/store'
import { Btn, Icon } from './ui'
import { useActions } from '@/lib/actions'

export function Toolbar(): JSX.Element {
  const { repo, status, busy, perspective, setPerspective, theme, toggleTheme, refresh } = useStore()
  const a = useActions()
  const disabled = !repo || !!busy
  const mac = window.pakgitMenu.platform === 'darwin'
  return (
    <div className={`toolbar ${mac ? 'mac' : ''}`}>
      <div className="tool-group">
        <Btn title="Open repository (Cmd/Ctrl+O)" onClick={() => a.openRepo()}><Icon name="folder" />Open</Btn>
        <Btn title="Clone repository" onClick={() => a.clone()}>Clone</Btn>
      </div>
      <div className="tool-group">
        <Btn title="Pull" disabled={disabled} onClick={() => a.pull()}><Icon name="pull" />Pull</Btn>
        <Btn title="Push" disabled={disabled} onClick={() => a.push()}><Icon name="push" />Push{status && status.ahead > 0 ? <span className="badge">↑{status.ahead}</span> : null}</Btn>
        <Btn title="Fetch" disabled={disabled} onClick={() => a.fetch()}><Icon name="fetch" />Fetch{status && status.behind > 0 ? <span className="badge">↓{status.behind}</span> : null}</Btn>
      </div>
      <div className="tool-group">
        <Btn title="Commit (Cmd/Ctrl+K)" disabled={disabled} onClick={() => a.focusCommit()}><Icon name="commit" />Commit</Btn>
        <Btn title="Stash changes" disabled={disabled} onClick={() => a.stash()}><Icon name="stash" />Stash</Btn>
        <Btn title="Add branch" disabled={disabled} onClick={() => a.addBranch()}><Icon name="branch" />Branch</Btn>
        <Btn title="Merge" disabled={disabled} onClick={() => a.merge()}><Icon name="merge" />Merge</Btn>
        <Btn title="Rebase" disabled={disabled} onClick={() => a.rebase()}><Icon name="rebase" />Rebase</Btn>
      </div>
      <div className="tool-group">
        <Btn title="Refresh (F5)" disabled={!repo} onClick={() => void refresh()}><Icon name="refresh" /></Btn>
        <Btn title="Open terminal" disabled={!repo} onClick={() => a.terminal()}><Icon name="terminal" /></Btn>
      </div>
      <div className="spacer" />
      {repo && (
        <span className="repo-name" title={repo.path}>
          <span>{repo.name}</span>
          {status && <span className="branch-pill"><Icon name="branch" size={12} />{status.detached ? 'detached HEAD' : status.branch ?? '(no branch)'}{status.upstream ? <span className="badge">→ {status.upstream}</span> : null}</span>}
        </span>
      )}
      <div className="tool-group">
        <Btn small active={perspective === 'standard'} title="Standard window (Cmd/Ctrl+1)" onClick={() => setPerspective('standard')}>Standard</Btn>
        <Btn small active={perspective === 'log'} title="Log window (Cmd/Ctrl+2)" onClick={() => setPerspective('log')}>Log</Btn>
        <Btn small active={perspective === 'worktree'} title="Working tree window (Cmd/Ctrl+3)" onClick={() => setPerspective('worktree')}>Working Tree</Btn>
      </div>
      <Btn small kind="ghost" title="Toggle theme" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></Btn>
    </div>
  )
}
