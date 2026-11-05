import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { BlameLine, Commit, CommitDetails, FileEntry, GitLogLine, RebaseTodoEntry, Refs, RepoEntry, RepoStatus, Settings, StashInfo, SubmoduleInfo, WorktreeInfo } from '@shared/types'

export type Perspective = 'standard' | 'log' | 'worktree'
export type Theme = 'light' | 'dark'

export interface Toast { id: number; kind: 'error' | 'info' | 'success'; text: string }

export interface DialogSpec {
  title: string
  fields?: { key: string; label: string; value?: string; type?: 'text' | 'textarea' | 'checkbox' | 'select'; options?: string[]; placeholder?: string }[]
  message?: string
  okLabel?: string
  danger?: boolean
}

export interface RebaseSpec { base: string; todo: RebaseTodoEntry[] }

interface State {
  repos: RepoEntry[]
  repo: RepoEntry | null
  status: RepoStatus | null
  refs: Refs | null
  submodules: SubmoduleInfo[]
  worktrees: WorktreeInfo[]
  commits: Commit[]
  logAll: boolean
  logPath: string | null
  logLimit: number
  selectedFiles: FileEntry[]
  selectedCommit: CommitDetails | null
  selectedCommitFile: string | null
  selectedStash: StashInfo | null
  blame: { path: string; lines: BlameLine[] } | null
  diff: string
  busy: string | null
  toasts: Toast[]
  perspective: Perspective
  theme: Theme
  output: GitLogLine[]
  error: string | null
  settings: Settings | null
  showSettings: boolean
  rebase: RebaseSpec | null
}

interface Store extends State {
  api: typeof window.pakgit
  openRepo(entry: RepoEntry): void
  addRepo(path?: string): Promise<void>
  removeRepo(path: string): Promise<void>
  refresh(): Promise<void>
  run<T>(label: string, fn: () => Promise<T>, opts?: { silent?: boolean; success?: string }): Promise<T | undefined>
  selectFiles(files: FileEntry[]): void
  selectCommit(sha: string | null): Promise<void>
  selectCommitFile(path: string | null): Promise<void>
  selectStash(st: StashInfo | null): void
  showBlame(path: string, rev?: string): Promise<void>
  clearBlame(): void
  setLogAll(all: boolean): void
  setLogPath(path: string | null): void
  loadMore(): void
  setPerspective(p: Perspective): void
  toggleTheme(): void
  toast(kind: Toast['kind'], text: string): void
  prompt(spec: DialogSpec): Promise<Record<string, string | boolean> | null>
  dialog: { spec: DialogSpec; resolve: (v: Record<string, string | boolean> | null) => void } | null
  saveSettings(s: Settings): Promise<void>
  setShowSettings(v: boolean): void
  setRebase(r: RebaseSpec | null): void
}

const Ctx = createContext<Store | null>(null)
export const useStore = (): Store => {
  const s = useContext(Ctx)
  if (!s) throw new Error('store missing')
  return s
}

export const LS = {
  get: <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } },
  set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
}

export function StoreProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const api = window.pakgit
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [repo, setRepo] = useState<RepoEntry | null>(null)
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [refs, setRefs] = useState<Refs | null>(null)
  const [submodules, setSubmodules] = useState<SubmoduleInfo[]>([])
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [commits, setCommits] = useState<Commit[]>([])
  const [logAll, setLogAllState] = useState<boolean>(() => LS.get('logAll', true))
  const [logPath, setLogPathState] = useState<string | null>(null)
  const [logLimit, setLogLimit] = useState(0)
  const [selectedFiles, setSelectedFiles] = useState<FileEntry[]>([])
  const [selectedCommit, setSelectedCommit] = useState<CommitDetails | null>(null)
  const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>(null)
  const [selectedStash, setSelectedStash] = useState<StashInfo | null>(null)
  const [blame, setBlame] = useState<State['blame']>(null)
  const [diff, setDiff] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [perspective, setPerspective] = useState<Perspective>(() => LS.get('perspective', 'standard'))
  const [theme, setTheme] = useState<Theme>(() => LS.get('theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const [output, setOutput] = useState<GitLogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Store['dialog']>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [rebase, setRebase] = useState<RebaseSpec | null>(null)
  const repoRef = useRef<RepoEntry | null>(null)
  repoRef.current = repo
  const logOpts = useRef({ all: true, path: null as string | null, limit: 400 })
  logOpts.current = { all: logAll, path: logPath, limit: logLimit || settings?.logLimit || 400 }
  const toastId = useRef(0)
  const preselected = useRef(false)

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 3500)
  }, [])

  useEffect(() => { document.documentElement.dataset.theme = theme; LS.set('theme', theme) }, [theme])
  useEffect(() => { LS.set('perspective', perspective) }, [perspective])
  useEffect(() => { LS.set('logAll', logAll) }, [logAll])

  const refresh = useCallback(async () => {
    const r = repoRef.current
    if (!r) { setStatus(null); setRefs(null); setCommits([]); return }
    try {
      const o = logOpts.current
      const [s, rf, lg, sm, wt] = await Promise.all([
        api.status(r.path), api.refs(r.path),
        api.log(r.path, { limit: o.limit, all: o.all && !o.path, path: o.path ?? undefined, follow: !!o.path }),
        api.submodules(r.path).catch(() => []), api.worktrees(r.path).catch(() => [])
      ])
      if (repoRef.current?.path !== r.path) return
      setStatus(s); setRefs(rf); setCommits(lg); setSubmodules(sm); setWorktrees(wt); setError(null)
      // dev helper: ?select=<path> preselects a working-tree file (used by PAKGIT_SCREENSHOT_SELECT)
      const want = new URLSearchParams(location.search).get('select')
      if (want && !preselected.current) { preselected.current = true; const f = s.files.find((x) => x.path === want); if (f) setSelectedFiles([f]) }
      setSelectedFiles((sel) => sel.map((f) => s.files.find((x) => x.path === f.path && x.area === f.area)).filter((x): x is FileEntry => !!x))
      setSelectedStash((st) => (st ? rf.stashes.find((x) => x.ref === st.ref) ?? null : null))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings(null))
    api.listRepos().then((list) => {
      setRepos(list)
      const last = LS.get<string | null>('lastRepo', null)
      const entry = list.find((r) => r.path === last) ?? list[0] ?? null
      if (entry) setRepo(entry)
    })
    api.getGitLog().then(setOutput)
    const offLog = api.onGitLog((line) => setOutput((o) => [...o.slice(-499), line]))
    const offChange = api.onRepoChanged((p) => { if (repoRef.current?.path === p) void refresh() })
    return () => { offLog(); offChange() }
  }, [api, refresh])

  useEffect(() => {
    setSelectedFiles([]); setSelectedCommit(null); setSelectedCommitFile(null); setSelectedStash(null); setBlame(null); setDiff(''); setLogPathState(null); setLogLimit(0)
    if (repo) LS.set('lastRepo', repo.path)
    void refresh()
  }, [repo, refresh])
  useEffect(() => { void refresh() }, [logAll, logPath, logLimit, refresh])

  // auto fetch
  useEffect(() => {
    const min = settings?.autoFetchMinutes ?? 0
    if (!min || !repo) return
    const t = setInterval(() => { api.fetch(repo.path, undefined, true).catch(() => undefined) }, min * 60_000)
    return () => clearInterval(t)
  }, [settings?.autoFetchMinutes, repo, api])

  // diff for the selected working-tree file or stash
  useEffect(() => {
    const r = repo
    if (!r) return
    let live = true
    if (selectedStash) {
      api.stashShow(r.path, selectedStash.index).then((d) => { if (live) setDiff(d) }).catch(() => undefined)
      return () => { live = false }
    }
    const f = selectedFiles[0]
    if (!f || selectedFiles.length !== 1) { if (!selectedCommitFile) setDiff(''); return }
    if (f.area === 'conflicted') { setDiff(''); return }
    api.diff({ repo: r.path, path: f.path, area: f.area, oldPath: f.oldPath }).then((d) => { if (live) setDiff(d) }).catch(() => undefined)
    return () => { live = false }
  }, [api, repo, selectedFiles, selectedStash, status, selectedCommitFile])

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, opts?: { silent?: boolean; success?: string }) => {
    setBusy(label)
    try {
      const v = await fn()
      if (opts?.success) toast('success', opts.success)
      return v
    } catch (e) {
      if (!opts?.silent) toast('error', `${label}: ${e instanceof Error ? e.message : String(e)}`)
      return undefined
    } finally {
      setBusy(null)
      void refresh()
    }
  }, [refresh, toast])

  const openRepo = useCallback((entry: RepoEntry) => setRepo(entry), [])
  const addRepo = useCallback(async (path?: string) => {
    try {
      const entry = await api.addRepo(path)
      if (!entry) return
      setRepos(await api.listRepos())
      setRepo(entry)
    } catch (e) { toast('error', e instanceof Error ? e.message : String(e)) }
  }, [api, toast])
  const removeRepo = useCallback(async (path: string) => {
    await api.removeRepo(path)
    const list = await api.listRepos()
    setRepos(list)
    if (repoRef.current?.path === path) setRepo(list[0] ?? null)
  }, [api])

  const clearOthers = () => { setSelectedCommit(null); setSelectedCommitFile(null); setSelectedStash(null); setBlame(null) }
  const selectFiles = useCallback((files: FileEntry[]) => { setSelectedFiles(files); clearOthers() }, [])
  const selectCommit = useCallback(async (sha: string | null) => {
    setSelectedCommitFile(null); setDiff(''); setSelectedStash(null); setBlame(null)
    if (!sha || !repoRef.current) { setSelectedCommit(null); return }
    setSelectedFiles([])
    try { setSelectedCommit(await api.commitDetails(repoRef.current.path, sha)) } catch (e) { toast('error', String(e)) }
  }, [api, toast])
  const selectCommitFile = useCallback(async (path: string | null) => {
    setSelectedCommitFile(path); setBlame(null)
    if (!path || !selectedCommit || !repoRef.current) { setDiff(''); return }
    try { setDiff(await api.commitFileDiff(repoRef.current.path, selectedCommit.sha, path)) } catch (e) { toast('error', String(e)) }
  }, [api, selectedCommit, toast])
  const selectStash = useCallback((st: StashInfo | null) => { setSelectedFiles([]); setSelectedCommit(null); setSelectedCommitFile(null); setBlame(null); setSelectedStash(st) }, [])
  const showBlame = useCallback(async (path: string, rev?: string) => {
    if (!repoRef.current) return
    try { setBlame({ path, lines: await api.blameStructured(repoRef.current.path, path, rev) }) } catch (e) { toast('error', `Blame: ${e instanceof Error ? e.message : String(e)}`) }
  }, [api, toast])
  const clearBlame = useCallback(() => setBlame(null), [])

  const prompt = useCallback((spec: DialogSpec) => new Promise<Record<string, string | boolean> | null>((resolve) => {
    setDialog({ spec, resolve: (v) => { setDialog(null); resolve(v) } })
  }), [])
  const saveSettings = useCallback(async (s: Settings) => { setSettings(await api.saveSettings(s)); toast('success', 'Settings saved') }, [api, toast])

  const value = useMemo<Store>(() => ({
    api, repos, repo, status, refs, submodules, worktrees, commits, logAll, logPath, logLimit, selectedFiles, selectedCommit, selectedCommitFile, selectedStash, blame, diff, busy, toasts,
    perspective, theme, output, error, dialog, settings, showSettings, rebase,
    openRepo, addRepo, removeRepo, refresh, run, selectFiles, selectCommit, selectCommitFile, selectStash, showBlame, clearBlame,
    setLogAll: setLogAllState, setLogPath: (p) => { setLogPathState(p); setLogLimit(0) }, loadMore: () => setLogLimit((l) => (l || settings?.logLimit || 400) + 500),
    setPerspective, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), toast, prompt, saveSettings, setShowSettings, setRebase
  }), [api, repos, repo, status, refs, submodules, worktrees, commits, logAll, logPath, logLimit, selectedFiles, selectedCommit, selectedCommitFile, selectedStash, blame, diff, busy, toasts,
    perspective, theme, output, error, dialog, settings, showSettings, rebase, openRepo, addRepo, removeRepo, refresh, run, selectFiles, selectCommit, selectCommitFile, selectStash, showBlame, clearBlame, toast, prompt, saveSettings])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
