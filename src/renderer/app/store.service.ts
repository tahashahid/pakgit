import { Injectable, computed, effect, signal } from '@angular/core'
import type { BlameLine, Commit, CommitDetails, FileEntry, GitLogLine, RebaseTodoEntry, Refs, RepoEntry, RepoStatus, Settings, StashInfo, SubmoduleInfo, WorktreeInfo } from '@shared/types'

export type Perspective = 'standard' | 'log' | 'worktree'
export type Theme = 'light' | 'dark'
export interface Toast { id: number; kind: 'error' | 'info' | 'success'; text: string }
export interface DialogField { key: string; label: string; value?: string; type?: 'text' | 'textarea' | 'checkbox' | 'select'; options?: string[]; placeholder?: string }
export interface DialogSpec { title: string; fields?: DialogField[]; message?: string; okLabel?: string; danger?: boolean }
export interface RebaseSpec { base: string; todo: RebaseTodoEntry[] }
export type DialogResult = Record<string, string | boolean> | null

export const LS = {
  get: <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } },
  set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
}

/** Application state as Angular signals; the equivalent of the React store. */
@Injectable({ providedIn: 'root' })
export class Store {
  readonly api = window.pakgit

  readonly repos = signal<RepoEntry[]>([])
  readonly repo = signal<RepoEntry | null>(null)
  readonly status = signal<RepoStatus | null>(null)
  readonly refs = signal<Refs | null>(null)
  readonly submodules = signal<SubmoduleInfo[]>([])
  readonly worktrees = signal<WorktreeInfo[]>([])
  readonly commits = signal<Commit[]>([])
  readonly logAll = signal<boolean>(LS.get('logAll', true))
  readonly logPath = signal<string | null>(null)
  readonly logLimit = signal(0)
  readonly selectedFiles = signal<FileEntry[]>([])
  readonly selectedCommit = signal<CommitDetails | null>(null)
  readonly selectedCommitFile = signal<string | null>(null)
  readonly selectedStash = signal<StashInfo | null>(null)
  readonly blame = signal<{ path: string; lines: BlameLine[] } | null>(null)
  readonly diff = signal('')
  readonly busy = signal<string | null>(null)
  readonly toasts = signal<Toast[]>([])
  readonly perspective = signal<Perspective>(LS.get('perspective', 'standard'))
  readonly theme = signal<Theme>(LS.get('theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  readonly output = signal<GitLogLine[]>([])
  readonly error = signal<string | null>(null)
  readonly settings = signal<Settings | null>(null)
  readonly showSettings = signal(false)
  readonly rebase = signal<RebaseSpec | null>(null)
  readonly dialog = signal<{ spec: DialogSpec; resolve: (v: DialogResult) => void } | null>(null)
  readonly gitVersion = signal('')

  readonly effectiveLogLimit = computed(() => this.logLimit() || this.settings()?.logLimit || 400)
  readonly singleFile = computed(() => (this.selectedFiles().length === 1 ? this.selectedFiles()[0] : null))

  private toastId = 0
  private preselected = false
  private fetchTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    effect(() => { document.documentElement.dataset['theme'] = this.theme(); LS.set('theme', this.theme()) })
    effect(() => LS.set('perspective', this.perspective()))
    effect(() => LS.set('logAll', this.logAll()))
    // reload the log when its filters change
    effect(() => { this.logAll(); this.logPath(); this.logLimit(); void this.refresh() })
    // diff for the selected working-tree file or stash
    effect(() => {
      const r = this.repo(); const st = this.selectedStash(); const f = this.singleFile(); this.status()
      if (!r) return
      if (st) { this.api.stashShow(r.path, st.index).then((d) => this.diff.set(d)).catch(() => undefined); return }
      if (!f) { if (!this.selectedCommitFile()) this.diff.set(''); return }
      if (f.area === 'conflicted') { this.diff.set(''); return }
      this.api.diff({ repo: r.path, path: f.path, area: f.area, oldPath: f.oldPath }).then((d) => this.diff.set(d)).catch(() => undefined)
    })
    // background fetch
    effect(() => {
      const min = this.settings()?.autoFetchMinutes ?? 0; const r = this.repo()
      if (this.fetchTimer) clearInterval(this.fetchTimer)
      this.fetchTimer = min && r ? setInterval(() => this.api.fetch(r.path, undefined, true).catch(() => undefined), min * 60_000) : null
    })

    this.api.getSettings().then((s) => this.settings.set(s)).catch(() => undefined)
    this.api.gitVersion().then((v) => this.gitVersion.set(v)).catch(() => this.gitVersion.set('git not found'))
    this.api.listRepos().then((list) => {
      this.repos.set(list)
      const last = LS.get<string | null>('lastRepo', null)
      const entry = list.find((r) => r.path === last) ?? list[0] ?? null
      if (entry) this.openRepo(entry)
    })
    this.api.getGitLog().then((l) => this.output.set(l))
    this.api.onGitLog((line) => this.output.update((o) => [...o.slice(-499), line]))
    this.api.onRepoChanged((p) => { if (this.repo()?.path === p) void this.refresh() })
  }

  toast(kind: Toast['kind'], text: string): void {
    const id = ++this.toastId
    this.toasts.update((t) => [...t, { id, kind, text }])
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 3500)
  }

  async refresh(): Promise<void> {
    const r = this.repo()
    if (!r) { this.status.set(null); this.refs.set(null); this.commits.set([]); return }
    try {
      const path = this.logPath()
      const [s, rf, lg, sm, wt] = await Promise.all([
        this.api.status(r.path), this.api.refs(r.path),
        this.api.log(r.path, { limit: this.effectiveLogLimit(), all: this.logAll() && !path, path: path ?? undefined, follow: !!path }),
        this.api.submodules(r.path).catch(() => []), this.api.worktrees(r.path).catch(() => [])
      ])
      if (this.repo()?.path !== r.path) return
      this.status.set(s); this.refs.set(rf); this.commits.set(lg); this.submodules.set(sm); this.worktrees.set(wt); this.error.set(null)
      this.selectedFiles.update((sel) => sel.map((f) => s.files.find((x) => x.path === f.path && x.area === f.area)).filter((x): x is FileEntry => !!x))
      this.selectedStash.update((st) => (st ? rf.stashes.find((x) => x.ref === st.ref) ?? null : null))
      const want = new URLSearchParams(location.search).get('select')
      if (want && !this.preselected) { this.preselected = true; const f = s.files.find((x) => x.path === want); if (f) this.selectedFiles.set([f]) }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e))
    }
  }

  async run<T>(label: string, fn: () => Promise<T>, opts?: { silent?: boolean; success?: string }): Promise<T | undefined> {
    this.busy.set(label)
    try {
      const v = await fn()
      if (opts?.success) this.toast('success', opts.success)
      return v
    } catch (e) {
      if (!opts?.silent) this.toast('error', `${label}: ${e instanceof Error ? e.message : String(e)}`)
      return undefined
    } finally {
      this.busy.set(null)
      void this.refresh()
    }
  }

  openRepo(entry: RepoEntry): void {
    this.selectedFiles.set([]); this.selectedCommit.set(null); this.selectedCommitFile.set(null); this.selectedStash.set(null); this.blame.set(null); this.diff.set('')
    this.logPath.set(null); this.logLimit.set(0)
    this.repo.set(entry)
    LS.set('lastRepo', entry.path)
    void this.refresh()
  }
  async addRepo(path?: string): Promise<void> {
    try {
      const entry = await this.api.addRepo(path)
      if (!entry) return
      this.repos.set(await this.api.listRepos())
      this.openRepo(entry)
    } catch (e) { this.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  async removeRepo(path: string): Promise<void> {
    await this.api.removeRepo(path)
    const list = await this.api.listRepos()
    this.repos.set(list)
    if (this.repo()?.path === path) { if (list[0]) this.openRepo(list[0]); else { this.repo.set(null); void this.refresh() } }
  }

  private clearOthers(): void { this.selectedCommit.set(null); this.selectedCommitFile.set(null); this.selectedStash.set(null); this.blame.set(null) }
  selectFiles(files: FileEntry[]): void { this.selectedFiles.set(files); this.clearOthers() }
  async selectCommit(sha: string | null): Promise<void> {
    this.selectedCommitFile.set(null); this.diff.set(''); this.selectedStash.set(null); this.blame.set(null)
    const r = this.repo()
    if (!sha || !r) { this.selectedCommit.set(null); return }
    this.selectedFiles.set([])
    try { this.selectedCommit.set(await this.api.commitDetails(r.path, sha)) } catch (e) { this.toast('error', String(e)) }
  }
  async selectCommitFile(path: string | null): Promise<void> {
    this.selectedCommitFile.set(path); this.blame.set(null)
    const r = this.repo(); const c = this.selectedCommit()
    if (!path || !c || !r) { this.diff.set(''); return }
    try { this.diff.set(await this.api.commitFileDiff(r.path, c.sha, path)) } catch (e) { this.toast('error', String(e)) }
  }
  selectStash(st: StashInfo | null): void { this.selectedFiles.set([]); this.selectedCommit.set(null); this.selectedCommitFile.set(null); this.blame.set(null); this.selectedStash.set(st) }
  async showBlame(path: string, rev?: string): Promise<void> {
    const r = this.repo(); if (!r) return
    try { this.blame.set({ path, lines: await this.api.blameStructured(r.path, path, rev) }) } catch (e) { this.toast('error', `Blame: ${e instanceof Error ? e.message : String(e)}`) }
  }
  setLogPath(p: string | null): void { this.logPath.set(p); this.logLimit.set(0) }
  loadMore(): void { this.logLimit.set(this.effectiveLogLimit() + 500) }
  toggleTheme(): void { this.theme.update((t) => (t === 'dark' ? 'light' : 'dark')) }

  prompt(spec: DialogSpec): Promise<DialogResult> {
    return new Promise((resolve) => this.dialog.set({ spec, resolve: (v) => { this.dialog.set(null); resolve(v) } }))
  }
  async saveSettings(s: Settings): Promise<void> { this.settings.set(await this.api.saveSettings(s)); this.toast('success', 'Settings saved') }
}
