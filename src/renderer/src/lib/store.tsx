import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Commit, CommitDetails, FileEntry, GitLogLine, Refs, RepoEntry, RepoStatus } from '@shared/types'

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

interface State {
  repos: RepoEntry[]
  repo: RepoEntry | null
  status: RepoStatus | null
  refs: Refs | null
  commits: Commit[]
  selectedFiles: FileEntry[]
  selectedCommit: CommitDetails | null
  selectedCommitFile: string | null
  diff: string
  busy: string | null
  toasts: Toast[]
  perspective: Perspective
  theme: Theme
  output: GitLogLine[]
  error: string | null
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
  setPerspective(p: Perspective): void
  toggleTheme(): void
  toast(kind: Toast['kind'], text: string): void
  prompt(spec: DialogSpec): Promise<Record<string, string | boolean> | null>
  dialog: { spec: DialogSpec; resolve: (v: Record<string, string | boolean> | null) => void } | null
}

const Ctx = createContext<Store | null>(null)
export const useStore = (): Store => {
  const s = useContext(Ctx)
  if (!s) throw new Error('store missing')
  return s
}

const LS = {
  get: <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } },
  set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
}

export function StoreProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const api = window.pakgit
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [repo, setRepo] = useState<RepoEntry | null>(null)
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [refs, setRefs] = useState<Refs | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [selectedFiles, setSelectedFiles] = useState<FileEntry[]>([])
  const [selectedCommit, setSelectedCommit] = useState<CommitDetails | null>(null)
  const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [perspective, setPerspective] = useState<Perspective>(() => LS.get('perspective', 'standard'))
  const [theme, setTheme] = useState<Theme>(() => LS.get('theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const [output, setOutput] = useState<GitLogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Store['dialog']>(null)
  const repoRef = useRef<RepoEntry | null>(null)
  repoRef.current = repo
  const toastId = useRef(0)

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 3500)
  }, [])

  useEffect(() => { document.documentElement.dataset.theme = theme; LS.set('theme', theme) }, [theme])
  useEffect(() => { LS.set('perspective', perspective) }, [perspective])

  const refresh = useCallback(async () => {
    const r = repoRef.current
    if (!r) { setStatus(null); setRefs(null); setCommits([]); return }
    try {
      const [s, rf, lg] = await Promise.all([api.status(r.path), api.refs(r.path), api.log(r.path, { limit: 400 })])
      if (repoRef.current?.path !== r.path) return
      setStatus(s); setRefs(rf); setCommits(lg); setError(null)
      setSelectedFiles((sel) => sel.map((f) => s.files.find((x) => x.path === f.path && x.area === f.area)).filter((x): x is FileEntry => !!x))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
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
    setSelectedFiles([]); setSelectedCommit(null); setSelectedCommitFile(null); setDiff('')
    if (repo) LS.set('lastRepo', repo.path)
    void refresh()
  }, [repo, refresh])

  // diff for the selected working-tree file
  useEffect(() => {
    const r = repo
    const f = selectedFiles[0]
    if (!r || !f || selectedFiles.length !== 1) { if (!selectedCommitFile) setDiff(''); return }
    let live = true
    api.diff({ repo: r.path, path: f.path, area: f.area, oldPath: f.oldPath }).then((d) => { if (live) setDiff(d) }).catch(() => undefined)
    return () => { live = false }
  }, [api, repo, selectedFiles, status, selectedCommitFile])

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

  const selectFiles = useCallback((files: FileEntry[]) => { setSelectedFiles(files); setSelectedCommit(null); setSelectedCommitFile(null) }, [])
  const selectCommit = useCallback(async (sha: string | null) => {
    setSelectedCommitFile(null); setDiff('')
    if (!sha || !repoRef.current) { setSelectedCommit(null); return }
    setSelectedFiles([])
    try { setSelectedCommit(await api.commitDetails(repoRef.current.path, sha)) } catch (e) { toast('error', String(e)) }
  }, [api, toast])
  const selectCommitFile = useCallback(async (path: string | null) => {
    setSelectedCommitFile(path)
    if (!path || !selectedCommit || !repoRef.current) { setDiff(''); return }
    try { setDiff(await api.commitFileDiff(repoRef.current.path, selectedCommit.sha, path)) } catch (e) { toast('error', String(e)) }
  }, [api, selectedCommit, toast])

  const prompt = useCallback((spec: DialogSpec) => new Promise<Record<string, string | boolean> | null>((resolve) => {
    setDialog({ spec, resolve: (v) => { setDialog(null); resolve(v) } })
  }), [])

  const value = useMemo<Store>(() => ({
    api, repos, repo, status, refs, commits, selectedFiles, selectedCommit, selectedCommitFile, diff, busy, toasts,
    perspective, theme, output, error, dialog,
    openRepo, addRepo, removeRepo, refresh, run, selectFiles, selectCommit, selectCommitFile,
    setPerspective, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), toast, prompt
  }), [api, repos, repo, status, refs, commits, selectedFiles, selectedCommit, selectedCommitFile, diff, busy, toasts,
    perspective, theme, output, error, dialog, openRepo, addRepo, removeRepo, refresh, run, selectFiles, selectCommit, selectCommitFile, toast, prompt])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
