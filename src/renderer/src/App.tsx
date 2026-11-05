import React, { useEffect, useState } from 'react'
import { StoreProvider, useStore } from './lib/store'
import { Toolbar } from './components/Toolbar'
import { RepositoriesPanel } from './components/RepositoriesPanel'
import { BranchesPanel } from './components/BranchesPanel'
import { FilesPanel } from './components/FilesPanel'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitPanel } from './components/CommitPanel'
import { CommitDetailsPanel, LogPanel } from './components/LogPanel'
import { OutputPanel } from './components/OutputPanel'
import { Btn, Dialog, Split, Toasts } from './components/ui'
import { RebaseDialog } from './components/RebaseDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { useActions } from './lib/actions'

function Layout(): JSX.Element {
  const { repo, perspective, status, busy, error } = useStore()
  const a = useActions()
  const [gitVersion, setGitVersion] = useState('')
  useEffect(() => { window.pakgit.gitVersion().then(setGitVersion).catch(() => setGitVersion('git not found')) }, [])
  useEffect(() => window.pakgitMenu.on((action) => {
    const map: Record<string, () => unknown> = {
      'repo:open': a.openRepo, 'repo:clone': a.clone, 'repo:init': a.init, 'repo:refresh': () => window.dispatchEvent(new Event('pakgit:refresh')),
      'repo:terminal': a.terminal, 'remote:fetch': a.fetch, 'remote:pull': a.pull, 'remote:push': a.push,
      'local:commit': a.focusCommit, 'local:stage-all': a.stageAll, 'local:stash': a.stash,
      'local:empty-commit': a.emptyCommit, 'repo:apply-patch': a.applyPatch, 'repo:clean': a.clean
    }
    map[action]?.()
  }), [a])
  const { setPerspective, toggleTheme, refresh, setShowSettings } = useStore()
  useEffect(() => window.pakgitMenu.on((action) => {
    if (action === 'view:settings') setShowSettings(true)
    if (action === 'view:standard') setPerspective('standard')
    if (action === 'view:log') setPerspective('log')
    if (action === 'view:worktree') setPerspective('worktree')
    if (action === 'view:theme') toggleTheme()
    if (action === 'repo:refresh') void refresh()
  }), [setPerspective, toggleTheme, refresh, setShowSettings])

  if (!repo) {
    return (
      <div className="welcome">
        <h1>PakGit</h1>
        <p>A cross-platform Git client. Open an existing repository, clone one, or initialize a new one.</p>
        <div className="actions">
          <Btn kind="primary" onClick={() => a.openRepo()}>Open Repository…</Btn>
          <Btn onClick={() => a.clone()}>Clone…</Btn>
          <Btn onClick={() => a.init()}>Initialize…</Btn>
        </div>
        <div style={{ width: 320, marginTop: 20 }}><RepositoriesPanel /></div>
      </div>
    )
  }

  const left = (
    <Split dir="v" initial={220} storageKey="left" min={80}>
      <RepositoriesPanel />
      <BranchesPanel />
    </Split>
  )
  const body = perspective === 'log' ? (
    <Split dir="h" initial={700} storageKey="log-main" min={300}>
      <LogPanel />
      <Split dir="v" initial={300} storageKey="log-right" min={120}>
        <CommitDetailsPanel />
        <ChangesPanel />
      </Split>
    </Split>
  ) : perspective === 'worktree' ? (
    <Split dir="h" initial={420} storageKey="wt-main" min={200}>
      <Split dir="v" initial={520} storageKey="wt-left" min={120}>
        <FilesPanel />
        <CommitPanel />
      </Split>
      <ChangesPanel />
    </Split>
  ) : (
    <Split dir="v" initial={380} storageKey="std-top" min={160}>
      <Split dir="h" initial={380} storageKey="std-top-h" min={200}>
        <FilesPanel />
        <ChangesPanel />
      </Split>
      <Split dir="h" initial={700} storageKey="std-bottom-h" min={300}>
        <Split dir="v" initial={260} storageKey="std-log" min={100}>
          <LogPanel />
          <CommitDetailsPanel />
        </Split>
        <Split dir="v" initial={220} storageKey="std-commit" min={120}>
          <CommitPanel />
          <OutputPanel />
        </Split>
      </Split>
    </Split>
  )

  return (
    <>
      <div className="main" style={{ padding: 6, gap: 6 }}>
        <Split dir="h" initial={260} storageKey="root" min={160}>
          {left}
          {body}
        </Split>
      </div>
      <div className="statusbar">
        <span>{repo.path}</span>
        {status && <span>{status.files.length} changed · ↑{status.ahead} ↓{status.behind}</span>}
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
        <span style={{ flex: 1 }} />
        {busy && <span className="busy"><span className="spinner" />{busy}…</span>}
        <span>{gitVersion}</span>
      </div>
    </>
  )
}

function RebaseDialogGate(): JSX.Element | null {
  const { rebase } = useStore()
  // keyed so the dialog's local state resets for every new rebase request
  return rebase ? <RebaseDialog key={rebase.base + rebase.todo.length} /> : null
}

export default function App(): JSX.Element {
  return (
    <StoreProvider>
      <div className="app">
        <Toolbar />
        <Layout />
        <Dialog />
        <RebaseDialogGate />
        <SettingsDialog />
        <Toasts />
      </div>
    </StoreProvider>
  )
}
