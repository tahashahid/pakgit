import { Injectable, computed, effect, signal } from '@angular/core'
import type { BlameLine, Commit, CommitDetails, ConfigSyncState, FileEntry, GitLogLine, HostingStatus, NextRelease, OrgOverview, Organization, RebaseTodoEntry, Refs, ReleaseAnalysis, ReleaseRecord, ReleaseSelection, RepoEntry, RepoStatus, SavedView, Settings, StashInfo, SubmoduleInfo, TrackerStatus, TrackerTeam, WorkIndex, WorkspaceState, WorktreeInfo } from '@shared/types'

export type Perspective = 'standard' | 'log' | 'worktree' | 'release' | 'organization'
export type OrgTab = 'overview' | 'work' | 'ready' | 'releases'
/** what the Release dialog opens with: the selected parts plus display names */
export type ReleaseDraft = (ReleaseSelection & { repoName: string })[]
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
  readonly groups = signal<string[]>([])
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
  readonly perspective = signal<Perspective>((new URLSearchParams(location.search).get('perspective') as Perspective | null) ?? LS.get('perspective', 'standard'))
  readonly theme = signal<Theme>(LS.get('theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  readonly output = signal<GitLogLine[]>([])
  readonly error = signal<string | null>(null)
  readonly settings = signal<Settings | null>(null)
  readonly showSettings = signal(false)
  readonly rebase = signal<RebaseSpec | null>(null)
  readonly dialog = signal<{ spec: DialogSpec; resolve: (v: DialogResult) => void } | null>(null)
  readonly gitVersion = signal('')
  // release planning
  readonly release = signal<ReleaseAnalysis | null>(null)
  readonly releaseLoading = signal(false)
  readonly trackerStatus = signal<TrackerStatus | null>(null)
  // organizations
  readonly workspace = signal<WorkspaceState | null>(null)
  readonly org = signal<Organization | null>(null)
  readonly activeOrgId = computed(() => this.workspace()?.active ?? 'personal')
  readonly showOrgConfig = signal<string | null>(null)
  readonly showNewOrg = signal(false)
  readonly overview = signal<OrgOverview | null>(null)
  readonly overviewLoading = signal(false)
  // phase 2: the cross-repository index, the Organization tabs and Quick open
  readonly index = signal<WorkIndex | null>(null)
  readonly indexLoading = signal(false)
  readonly indexError = signal<string | null>(null)
  readonly overviewError = signal<string | null>(null)
  readonly orgTab = signal<OrgTab>(LS.get<OrgTab>('orgTab', 'overview'))
  /** group chip in the Organization view; null = all groups */
  readonly orgGroup = signal<string | null>(null)
  readonly showQuickOpen = signal(false)
  /** Quick open ▸ issue: the Work tab filters to this key once */
  readonly workFocusKey = signal<string | null>(null)
  /** Overview ▸ "partly promoted": the Ready tab shows only warnings once */
  readonly readyWarnOnly = signal(false)
  /** Ready tab: environment id, 'unreleased', 'released' or 'archived' ('' = not chosen yet) and its text filter */
  readonly readyTab = signal<string>('')
  readonly readyText = signal('')
  /** Ready ▸ Promote / open: item ids to tick and the item to select when the Release view opens */
  readonly releasePreselect = signal<{ check: string[]; focus: string | null } | null>(null)
  readonly trackerTeams = signal<TrackerTeam[]>([])
  // phase 3: releases, hosting
  readonly releases = signal<ReleaseRecord[]>([])
  readonly releasesLoading = signal(false)
  readonly hostingStatus = signal<HostingStatus | null>(null)
  /** Ready ▸ Promote selected…: the Release dialog is open with this selection */
  readonly releaseDraft = signal<ReleaseDraft | null>(null)
  /** release id to highlight in the Releases tab once */
  readonly releaseFocus = signal<string | null>(null)
  readonly inProgressReleases = computed(() => this.releases().filter((r) => r.status === 'in-progress').length)
  // phase 4: shared configuration, calendar, cleanup, saved views
  readonly configSync = signal<ConfigSyncState | null>(null)
  readonly configSyncLoading = signal(false)
  /** the diff dialog for the configuration repository is open */
  readonly showConfigDiff = signal(false)
  readonly configDismissed = signal<string | null>(null)
  readonly nextReleases = signal<NextRelease[]>([])
  readonly showCleanup = signal(false)
  /** a saved view the Work or Ready tab should apply once */
  readonly applyView = signal<SavedView | null>(null)

  readonly effectiveLogLimit = computed(() => this.logLimit() || this.settings()?.logLimit || 400)
  readonly singleFile = computed(() => (this.selectedFiles().length === 1 ? this.selectedFiles()[0] : null))

  private toastId = 0
  private preselected = false
  private fetchTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    effect(() => { document.documentElement.dataset['theme'] = this.theme(); LS.set('theme', this.theme()) })
    effect(() => LS.set('perspective', this.perspective()))
    effect(() => LS.set('orgTab', this.orgTab()))
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
    void this.loadWorkspace()
    this.api.gitVersion().then((v) => this.gitVersion.set(v)).catch(() => this.gitVersion.set('git not found'))
    this.reloadRepos().then((list) => {
      const last = LS.get<string | null>('lastRepo', null)
      const entry = list.find((r) => r.path === last) ?? list[0] ?? null
      if (entry) this.openRepo(entry)
    })
    this.api.getGitLog().then((l) => this.output.set(l))
    this.api.onGitLog((line) => this.output.update((o) => [...o.slice(-499), line]))
    this.api.onRepoChanged((p) => {
      if (this.repo()?.path === p) void this.refresh()
      // keep the organization index current while it is on screen (the analysis cache makes this cheap)
      if (this.perspective() === 'organization' && this.index() && this.repos().some((r) => r.path === p)) {
        clearTimeout(this.indexTimer ?? undefined)
        this.indexTimer = setTimeout(() => { void this.loadIndex() }, 1500)
      }
    })
  }
  private indexTimer: ReturnType<typeof setTimeout> | null = null

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

  async analyzeRelease(refresh = false): Promise<void> {
    const r = this.repo(); if (!r) { this.release.set(null); return }
    this.releaseLoading.set(true)
    try { const a = await this.api.releaseAnalyze(r.path, { refresh }); if (this.repo()?.path === r.path) this.release.set(a) } catch (e) { this.toast('error', `Release analysis: ${e instanceof Error ? e.message : String(e)}`) }
    finally { this.releaseLoading.set(false) }
  }
  async refreshTracker(): Promise<void> { try { this.trackerStatus.set(await this.api.trackerStatus()) } catch { this.trackerStatus.set(null) } }

  // ---- organizations
  async loadWorkspace(): Promise<void> {
    try { const w = await this.api.workspace(); this.workspace.set(w); this.org.set(await this.api.orgGet(w.active)); void this.firstRunHint(w) } catch { /* pre-organization main process */ }
  }
  /** Once: when only Personal exists and several repositories share a hosting owner, suggest an organization. */
  private async firstRunHint(w: WorkspaceState): Promise<void> {
    if (w.organizations.length > 1 || LS.get('orgHintShown', false)) return
    try {
      const p = (await this.api.orgProposals()).find((x) => x.repos.length >= 2)
      if (!p) return
      LS.set('orgHintShown', true)
      this.toast('info', `${p.repos.length} repositories share the owner "${p.owner}". Create an organization for them: Repositories ▸ Personal ▸ New organization…`)
    } catch { /* ignore */ }
  }
  async switchOrg(id: string): Promise<void> {
    if (id === this.activeOrgId()) return
    this.workspace.set(await this.api.orgSetActive(id)); this.org.set(await this.api.orgGet(id))
    this.overview.set(null); this.release.set(null); this.trackerStatus.set(null); this.index.set(null); this.trackerTeams.set([]); this.orgGroup.set(null); this.indexError.set(null); this.overviewError.set(null); this.readyTab.set(''); this.readyText.set(''); this.releases.set([]); this.hostingStatus.set(null); this.configSync.set(null); this.nextReleases.set([]); this.configDismissed.set(null)
    const list = await this.reloadRepos()
    const last = LS.get<Record<string, string>>('lastRepoByOrg', {})[id]
    const entry = list.find((r) => r.path === last) ?? list[0] ?? null
    if (entry) this.openRepo(entry); else { this.repo.set(null); await this.refresh() }
    void this.refreshTracker()
    if (this.perspective() === 'organization') void this.loadOverview()
  }
  async reloadOrg(): Promise<void> { const w = await this.api.workspace(); this.workspace.set(w); this.org.set(await this.api.orgGet(w.active)); await this.reloadRepos() }
  async loadOverview(refresh = false): Promise<void> {
    const id = this.activeOrgId(); this.overviewLoading.set(true)
    try { const ov = await this.api.orgOverview(id, { refresh }); if (this.activeOrgId() === id) { this.overview.set(ov); this.overviewError.set(null) } }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); this.overviewError.set(msg); this.toast('error', `Overview: ${msg}`) } finally { this.overviewLoading.set(false) }
  }
  private indexPending: Promise<WorkIndex | null> | null = null
  /** Load (or re-check) the work-item index of the active organization; concurrent calls share one request. */
  loadIndex(refresh = false): Promise<WorkIndex | null> {
    if (this.indexPending && !refresh) return this.indexPending
    const id = this.activeOrgId(); this.indexLoading.set(true)
    let p: Promise<WorkIndex | null> | null = null
    p = (async () => {
      try { const idx = await this.api.orgIndex(id, { refresh }); if (this.activeOrgId() === id) { this.index.set(idx); this.indexError.set(null) } return idx }
      catch (e) { const msg = e instanceof Error ? e.message : String(e); this.indexError.set(msg); this.toast('error', `Index: ${msg}`); return null }
      finally { if (this.indexPending === p) { this.indexPending = null; this.indexLoading.set(false) } }
    })()
    this.indexPending = p
    return p
  }
  async loadTrackerTeams(): Promise<void> { try { this.trackerTeams.set(await this.api.trackerTeams()) } catch { this.trackerTeams.set([]) } }
  async loadReleases(): Promise<void> {
    const id = this.activeOrgId(); this.releasesLoading.set(true)
    try { const list = await this.api.orgReleases(id); if (this.activeOrgId() === id) this.releases.set(list) } catch (e) { this.toast('error', `Releases: ${e instanceof Error ? e.message : String(e)}`) } finally { this.releasesLoading.set(false) }
  }
  async refreshHosting(): Promise<void> { try { this.hostingStatus.set(await this.api.orgHostingStatus(this.activeOrgId())) } catch { this.hostingStatus.set(null) } }
  /** after a release changed: records, index and overview */
  async afterRelease(): Promise<void> { await Promise.all([this.loadReleases(), this.loadIndex(), this.loadOverview()]) }
  async loadConfigSync(fresh = false): Promise<ConfigSyncState | null> {
    const id = this.activeOrgId(); this.configSyncLoading.set(true)
    try { const st = await this.api.orgConfigSync(id, fresh); if (this.activeOrgId() === id) this.configSync.set(st); return st }
    catch (e) { this.toast('error', `Shared configuration: ${e instanceof Error ? e.message : String(e)}`); return null } finally { this.configSyncLoading.set(false) }
  }
  async loadNextReleases(): Promise<void> { try { this.nextReleases.set(await this.api.orgNextReleases(this.activeOrgId())) } catch { this.nextReleases.set([]) } }
  async saveView(view: Omit<SavedView, 'id'> & { id?: string }): Promise<void> {
    const org = this.org(); if (!org) return
    const id = view.id ?? Math.random().toString(36).slice(2, 10)
    const views = org.views.filter((v) => v.id !== id && !(v.tab === view.tab && v.name.toLowerCase() === view.name.toLowerCase()))
    this.org.set(await this.api.orgUpdate(org.id, { views: [...views, { ...view, id }] }))
    this.toast('success', `View "${view.name}" saved`)
  }
  async deleteView(viewId: string): Promise<void> { const org = this.org(); if (!org) return; this.org.set(await this.api.orgUpdate(org.id, { views: org.views.filter((v) => v.id !== viewId) })) }
  /** Open a repository of the active organization in the Release view, ticking and selecting items there. */
  openInRelease(path: string, check: string[], focus: string | null): void {
    const entry = this.repos().find((r) => r.path === path); if (!entry) return
    if (this.repo()?.path !== path) this.openRepo(entry)
    this.releasePreselect.set({ check, focus })
    this.perspective.set('release')
  }

  openRepo(entry: RepoEntry): void {
    this.release.set(null)
    this.selectedFiles.set([]); this.selectedCommit.set(null); this.selectedCommitFile.set(null); this.selectedStash.set(null); this.blame.set(null); this.diff.set('')
    this.logPath.set(null); this.logLimit.set(0)
    this.repo.set(entry)
    LS.set('lastRepo', entry.path)
    LS.set('lastRepoByOrg', { ...LS.get<Record<string, string>>('lastRepoByOrg', {}), [this.activeOrgId()]: entry.path })
    void this.refresh()
  }
  /** Reload the repository list and groups from disk. */
  async reloadRepos(): Promise<RepoEntry[]> {
    const [list, groups] = await Promise.all([this.api.listRepos(), this.api.listGroups().catch(() => [])])
    this.repos.set(list); this.groups.set(groups)
    this.api.workspace().then((w) => this.workspace.set(w)).catch(() => undefined)
    return list
  }
  async addRepo(path?: string, group?: string | null): Promise<void> {
    try {
      const entry = await this.api.addRepo(path)
      if (!entry) return
      if (group) await this.api.setRepoGroup(entry.path, group)
      await this.reloadRepos()
      this.openRepo(entry)
    } catch (e) { this.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  async removeRepo(path: string): Promise<void> {
    await this.api.removeRepo(path)
    const list = await this.reloadRepos()
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
  async saveSettings(s: Settings, quiet = false): Promise<void> { this.settings.set(await this.api.saveSettings(s)); if (!quiet) this.toast('success', 'Settings saved') }
}
