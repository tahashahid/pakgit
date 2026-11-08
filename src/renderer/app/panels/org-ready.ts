import { Component, computed, effect, inject, signal } from '@angular/core'
import { LS, Store } from '../store.service'
import { TimeAgoPipe } from '../ui/time-ago'
import { ContextMenuService } from '../ui/context-menu'
import { ViewsBar } from '../ui/views-bar'
import type { PullRequestStatus, SavedView, WorkItem, WorkPart } from '@shared/types'

interface Row { id: string; part: WorkPart; item: WorkItem }

/** Ready tab: the Release table in organization scope, one row per issue and repository. */
@Component({
  selector: 'pg-org-ready',
  imports: [TimeAgoPipe, ViewsBar],
  template: `
    <div class="org-pane">
      @if (store.index(); as idx) {
        <div class="panel-header" style="gap:2px;flex-wrap:wrap">
          @for (e of idx.environments; track e.id) { <button class="btn small" [class.active]="store.readyTab() === e.id" (click)="store.readyTab.set(e.id)">To {{ e.name || e.id }} <span class="badge">{{ counts()[e.id] ?? 0 }}</span></button> }
          <button class="btn small" [class.active]="store.readyTab() === 'unreleased'" (click)="store.readyTab.set('unreleased')">All unreleased <span class="badge">{{ counts()['unreleased'] }}</span></button>
          <button class="btn small" [class.active]="store.readyTab() === 'released'" (click)="store.readyTab.set('released')">Released</button>
          <button class="btn small" [class.active]="store.readyTab() === 'archived'" (click)="store.readyTab.set('archived')">Archived <span class="badge">{{ counts()['archived'] }}</span></button>
          <span style="flex:1"></span>
          <span class="muted" style="font-size:11px">computed {{ iso(idx.generatedAt) | timeAgo }}</span>
        </div>
        <div class="filter-bar">
          <input class="filter-input" placeholder="Filter by issue, title, branch…" [value]="store.readyText()" (input)="store.readyText.set($any($event.target).value)" />
          <select (change)="repoFilter.set($any($event.target).value)" title="Repository">
            <option value="" [selected]="!repoFilter()">All repositories</option>
            @for (r of idx.repos; track r.path) { <option [value]="r.path" [selected]="repoFilter() === r.path">{{ r.name }}</option> }
          </select>
          <select (change)="statusFilter.set($any($event.target).value)" title="Linear status">
            <option value="" [selected]="!statusFilter()">Any status</option>
            @for (st of statuses(); track st) { <option [value]="st" [selected]="statusFilter() === st">{{ st }}</option> }
            <option value="__none" [selected]="statusFilter() === '__none'">No Linear issue</option>
          </select>
          <label title="Hide branches that were cut from dev/stage"><input type="checkbox" [checked]="hideDevBased()" (change)="hideDevBased.set($any($event.target).checked)" />Hide dev-based</label>
          <label title="Only issues whose parts sit on different environments"><input type="checkbox" [checked]="store.readyWarnOnly()" (change)="store.readyWarnOnly.set($any($event.target).checked)" />Partly promoted</label>
          @if (filterActive()) { <button class="btn small ghost" (click)="clearFilters()">Clear</button> }
          <pg-views-bar tab="ready" [active]="activeView()" (apply)="applyView($event)" (save)="saveView()" />
        </div>
        <div class="log release-table">
          <table>
            <colgroup><col style="width:28px" /><col /><col style="width:150px" /><col style="width:170px" />@for (e of idx.environments; track e.id) { <col style="width:56px" /> }<col style="width:52px" /><col style="width:80px" /></colgroup>
            <thead><tr>
              <th><input type="checkbox" [checked]="allChecked()" (change)="toggleAll($any($event.target).checked)" title="Select all" /></th>
              <th>Issue / work item</th><th>Repository</th><th>Branch</th>@for (e of idx.environments; track e.id) { <th [title]="'On ' + e.branch + ' (' + (e.name || e.id) + ')'">{{ shortName(e) }}</th> }<th title="Own commits of the branch not yet on the last environment">Own</th><th>Updated</th>
            </tr></thead>
            <tbody>
              @for (row of visible(); track row.id) {
                <tr [class.selected]="selected() === row.id" (click)="selected.set(row.id)" (dblclick)="openInRepo(row)" (contextmenu)="rowMenu($event, row)">
                  <td><input type="checkbox" [checked]="checked().has(row.id)" (click)="$event.stopPropagation()" (change)="toggle(row.id, $any($event.target).checked)" /></td>
                  <td [title]="row.item.issue?.title ?? row.part.name">
                    @if (row.part.issueKey) { <span class="ref-pill issue">{{ row.part.issueKey }}</span> }
                    @if (row.item.issue) { <span class="status-pill" [class]="'status-pill ' + row.item.issue.statusType" style="margin:0 6px 0 0">{{ row.item.issue.status }}</span> }
                    {{ row.item.issue?.title ?? row.part.name }}
                    @if (row.item.partlyPromoted) { <span class="status-pill unknown" [title]="partlyTitle(row)">⚠ partly promoted</span> }
                    @if (row.part.needsCherryPick) { <span class="status-pill unknown" title="No branch left for this work; promotion will cherry-pick its commits">cherry-pick</span> }
                    @if (row.part.basedOnEnv) { <span class="status-pill canceled" title="This branch was cut from dev/stage, so it carries other unreleased work">branched from dev</span> }
                    @if (row.part.linkedBy === 'manual') { <span class="status-pill" title="Linked to the issue by hand">linked</span> }
                  </td>
                  <td [title]="row.part.repo">{{ row.part.repoName }}@if (row.part.group) { <span class="muted" style="font-size:11px"> · {{ row.part.group }}</span> }</td>
                  <td [title]="row.part.ref ?? ''"><span class="mono" style="font-size:11px">{{ row.part.branch ?? '—' }}</span>@if (row.part.branchCount > 1) { <span class="muted"> +{{ row.part.branchCount - 1 }}</span> }@if (prFor(row); as pr) { <a href="#" class="status-pill" [class]="'status-pill ' + (pr.state === 'merged' ? 'completed' : pr.state === 'closed' ? 'canceled' : 'started')" [title]="pr.title + ' → ' + pr.base" (click)="$event.preventDefault(); $event.stopPropagation(); open(pr.url)">#{{ pr.number }} {{ pr.state }}</a> }</td>
                  @for (e of idx.environments; track e.id) {
                    @if (row.part.envIds.includes(e.id)) { <td class="env" [class.manual]="e.id in row.part.overrides" [title]="e.id in row.part.overrides ? 'Set manually (right-click ▸ Fix tracking)' : ''">{{ row.part.inEnv[e.id] ? '✓' : (e.id in row.part.overrides ? '✗' : '') }}{{ e.id in row.part.overrides ? '*' : '' }}</td> }
                    @else { <td class="env na" title="Not an environment of this repository">·</td> }
                  }
                  <td class="muted">{{ row.part.own ?? row.part.commits.length }}</td>
                  <td class="muted">{{ row.part.lastActivity ? (row.part.lastActivity | timeAgo) : '' }}</td>
                </tr>
              } @empty { <tr><td [attr.colspan]="idx.environments.length + 6"><div class="empty">{{ emptyText() }}</div></td></tr> }
            </tbody>
          </table>
        </div>
        <div class="release-actions">
          <span class="muted">{{ checked().size }} selected{{ selectedRepos().length > 1 ? ' in ' + selectedRepos().length + ' repositories' : '' }}</span>
          <span style="flex:1"></span>
          @if (store.readyTab() === 'archived') {
            <button class="btn" [disabled]="!checked().size || busy()" (click)="archive(false)">Unarchive selected</button>
          } @else {
            <button class="btn primary" [disabled]="!checked().size || busy()" (click)="promoteSelected()" title="One release across the selected repositories: pre-flight checks, one branch name, one pull request per repository">Promote selected…</button>
            <button class="btn" [disabled]="!checked().size || busy()" (click)="archive(true)">Archive selected</button>
          }
          <button class="btn" [disabled]="busy() || !idx.repos.length" (click)="syncAll()" title="Back-merge the last environment into the earlier ones in every repository (pull requests, or direct merges for direct-merge environments)">Sync all environments</button>
        </div>
      } @else if (store.indexLoading()) { <div class="empty"><span class="spinner"></span> Analysing {{ store.repos().length }} repositories…</div> }
      @else if (store.indexError()) { <div class="empty">{{ store.indexError() }} <button class="btn small" (click)="store.loadIndex(true)">Retry</button></div> }
      @else { <div class="empty">No index yet.</div> }
    </div>`
})
export class OrgReady {
  readonly store = inject(Store)
  private readonly cm = inject(ContextMenuService)
  readonly repoFilter = signal('')
  readonly statusFilter = signal('')
  readonly hideDevBased = signal(false)
  readonly checked = signal<Set<string>>(new Set())
  readonly selected = signal<string | null>(null)
  readonly busy = signal(false)
  readonly push = signal<boolean>(LS.get('release.push', true))
  /** pull requests per repository from the hosting provider, by head branch */
  readonly prs = signal<Record<string, PullRequestStatus[]>>({})
  readonly rows = computed<Row[]>(() => {
    const idx = this.store.index(); if (!idx) return []
    const out: Row[] = []
    for (const it of idx.items) for (const p of it.parts) out.push({ id: `${p.repo}::${p.itemId}`, part: p, item: it })
    return out
  })
  readonly statuses = computed(() => [...new Set(this.rows().map((r) => r.item.issue?.status).filter((x): x is string => !!x))].sort())
  readonly filterActive = computed(() => !!(this.store.readyText() || this.repoFilter() || this.statusFilter() || this.hideDevBased() || this.store.readyWarnOnly()))
  constructor() {
    // default tab: the second environment, like the per-repository view
    effect(() => { const idx = this.store.index(); if (idx && this.store.readyTab() === '' ) this.store.readyTab.set(idx.environments[1]?.id ?? 'unreleased') })
    effect(() => { const v = this.store.applyView(); if (v && v.tab === 'ready') { this.applyView(v); this.store.applyView.set(null) } })
    // pull requests by branch once the hosting provider is available
    effect(() => { const idx = this.store.index(); const hs = this.store.hostingStatus(); if (idx && hs?.available) void this.loadPrs(idx.repos.map((r) => r.path)) })
  }
  private async loadPrs(repos: string[]): Promise<void> {
    const out: Record<string, PullRequestStatus[]> = {}
    await Promise.all(repos.map(async (p) => { try { out[p] = await this.store.api.hostingPullRequests(p) } catch { out[p] = [] } }))
    this.prs.set(out)
  }
  prFor(row: Row): PullRequestStatus | null {
    const b = row.part.branch; if (!b) return null
    const list = this.prs()[row.part.repo]; if (!list) return null
    return list.find((pr) => pr.head === b && pr.state !== 'closed') ?? list.find((pr) => pr.head === b) ?? null
  }
  open(url: string): void { window.open(url) }
  clearFilters(): void { this.store.readyText.set(''); this.repoFilter.set(''); this.statusFilter.set(''); this.hideDevBased.set(false); this.store.readyWarnOnly.set(false); this.activeView.set(null) }
  readonly activeView = signal<string | null>(null)
  applyView(v: SavedView): void {
    const f = v.filters
    if (f['tab']) this.store.readyTab.set(String(f['tab']))
    this.store.readyText.set(String(f['text'] ?? '')); this.repoFilter.set(String(f['repo'] ?? '')); this.statusFilter.set(String(f['status'] ?? '')); this.hideDevBased.set(!!f['hideDevBased']); this.store.readyWarnOnly.set(!!f['warnOnly'])
    if (f['group'] !== undefined) this.store.orgGroup.set(String(f['group']) || null)
    this.activeView.set(v.id)
  }
  async saveView(): Promise<void> {
    const v = await this.store.prompt({ title: 'Save view', okLabel: 'Save', message: 'The current tab, filters and group chip of Ready become a chip for everyone who shares this organization.', fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. Ready for stage, Portals' }] })
    if (!v || !String(v.name).trim()) return
    await this.store.saveView({ name: String(v.name).trim(), tab: 'ready', filters: { tab: this.store.readyTab(), text: this.store.readyText(), repo: this.repoFilter(), status: this.statusFilter(), hideDevBased: this.hideDevBased(), warnOnly: this.store.readyWarnOnly(), group: this.store.orgGroup() ?? '' } })
  }
  /** ready for environment id: in the previous environment of that repository (or anywhere, for its first) and not in it or any later one */
  private readyFor(p: WorkPart, envId: string): boolean {
    const i = p.envIds.indexOf(envId); if (i < 0) return false
    if (p.envIds.slice(i).some((id) => p.inEnv[id])) return false
    return i === 0 ? true : p.inEnv[p.envIds[i - 1]]
  }
  private isReleased(p: WorkPart): boolean { const last = p.envIds[p.envIds.length - 1]; return !!last && p.inEnv[last] }
  private inGroup(p: WorkPart): boolean { const g = this.store.orgGroup(); return !g || p.group === g }
  readonly counts = computed<Record<string, number>>(() => {
    const rows = this.rows().filter((r) => this.inGroup(r.part)); const live = rows.filter((r) => !r.part.archived)
    const out: Record<string, number> = { unreleased: live.filter((r) => !this.isReleased(r.part)).length, archived: rows.filter((r) => r.part.archived).length }
    for (const e of this.store.index()?.environments ?? []) out[e.id] = live.filter((r) => this.readyFor(r.part, e.id)).length
    return out
  })
  readonly visible = computed<Row[]>(() => {
    const tab = this.store.readyTab(); const q = this.store.readyText().trim().toLowerCase(); const repo = this.repoFilter(); const status = this.statusFilter()
    const envTab = (this.store.index()?.environments ?? []).some((e) => e.id === tab)
    return this.rows().filter((r) => {
      const p = r.part
      if (!this.inGroup(p)) return false
      if (tab === 'archived') { if (!p.archived) return false } else if (p.archived) return false
      if (envTab) { if (!this.readyFor(p, tab)) return false }
      else if (tab === 'unreleased') { if (this.isReleased(p)) return false }
      else if (tab === 'released') { if (!this.isReleased(p)) return false }
      if (repo && p.repo !== repo) return false
      if (status === '__none' ? !!r.item.issue : status && r.item.issue?.status !== status) return false
      if (this.hideDevBased() && p.basedOnEnv) return false
      if (this.store.readyWarnOnly() && !r.item.partlyPromoted) return false
      return !q || [p.issueKey, p.name, r.item.issue?.title, r.item.issue?.status, p.branch, p.repoName].join(' ').toLowerCase().includes(q)
    })
  })
  readonly allChecked = computed(() => this.visible().length > 0 && this.visible().every((r) => this.checked().has(r.id)))
  readonly selectedRows = computed(() => { const ids = this.checked(); return this.rows().filter((r) => ids.has(r.id)) })
  readonly selectedRepos = computed(() => [...new Set(this.selectedRows().map((r) => r.part.repo))])
  toggle(id: string, on: boolean): void { const n = new Set(this.checked()); on ? n.add(id) : n.delete(id); this.checked.set(n) }
  toggleAll(on: boolean): void { const n = new Set(this.checked()); for (const r of this.visible()) on ? n.add(r.id) : n.delete(r.id); this.checked.set(n) }
  shortName(e: { id: string; name: string; branch: string }): string { const n = e.branch || e.name || e.id; return n.length <= 8 ? n : n.slice(0, 7) + '…' }
  iso(ms: number): string { return new Date(ms).toISOString() }
  emptyText(): string {
    const tab = this.store.readyTab(); const env = (this.store.index()?.environments ?? []).find((e) => e.id === tab)
    if (env) return `Nothing waiting for ${env.name || env.id} in these repositories.`
    return tab === 'unreleased' ? 'Everything is released.' : tab === 'archived' ? 'No archived items.' : tab === 'released' ? 'Nothing released yet.' : ''
  }
  partlyTitle(row: Row): string {
    return row.item.parts.map((p) => `${p.repoName}: ${p.highest ? 'on ' + p.highest : p.archived ? 'archived' : 'not merged anywhere'}`).join('\n')
  }
  openInRepo(row: Row): void { this.store.openInRelease(row.part.repo, [row.part.itemId], row.part.itemId) }
  promoteSelected(): void {
    const rows = this.selectedRows(); if (!rows.length) return
    this.store.releaseDraft.set(rows.map((r) => ({ repo: r.part.repo, repoName: r.part.repoName, itemId: r.part.itemId, issueKey: r.part.issueKey, title: r.item.issue?.title, ref: r.part.ref, commits: r.part.commits })))
  }
  async archive(archived: boolean): Promise<void> { await this.archiveRows(this.selectedRows(), archived) }
  private async archiveRows(rows: Row[], archived: boolean): Promise<void> {
    if (!rows.length) return
    const byRepo = new Map<string, string[]>()
    for (const r of rows) { if (!byRepo.has(r.part.repo)) byRepo.set(r.part.repo, []); byRepo.get(r.part.repo)!.push(r.part.itemId) }
    this.busy.set(true)
    try { for (const [repo, ids] of byRepo) await this.store.api.setArchived(repo, ids, archived); this.store.toast('success', `${archived ? 'Archived' : 'Unarchived'} ${rows.length} item(s)`); this.checked.set(new Set()); await this.store.loadIndex(); void this.store.loadOverview() }
    catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async fixTracking(row: Row): Promise<void> {
    const p = row.part; const repo = this.store.index()?.repos.find((r) => r.path === p.repo); if (!repo) return
    const v = await this.store.prompt({ title: `Fix tracking for ${p.issueKey ?? p.name} in ${p.repoName}`, okLabel: 'Save', message: 'Tick the environments this work is really on. Use this when it was merged in a way git cannot trace (squash, cherry-pick, re-done branch). PakGit remembers the correction.', fields: repo.environments.map((e) => ({ key: e.id, label: `${e.name || e.branch} (${e.branch})`, type: 'checkbox' as const, value: String(!!p.inEnv[e.id]) })) })
    if (!v) return
    const overrides: Record<string, boolean> = {}
    for (const e of repo.environments) overrides[e.id] = !!v[e.id]
    await this.store.api.setOverrides(p.repo, p.itemId, overrides); await this.store.loadIndex(); void this.store.loadOverview()
  }
  async resetTracking(row: Row): Promise<void> { await this.store.api.setOverrides(row.part.repo, row.part.itemId, null); await this.store.loadIndex(); void this.store.loadOverview() }
  async linkToIssue(row: Row): Promise<void> {
    const v = await this.store.prompt({ title: `Link ${row.part.branch ?? row.part.name} to an issue`, okLabel: 'Link', message: 'The branch carries no issue key. Enter the issue it belongs to; PakGit remembers the link for this repository.', fields: [{ key: 'key', label: 'Issue key', placeholder: 'CYB4-123' }] })
    if (!v || !String(v.key).trim()) return
    try { await this.store.api.setLink(row.part.repo, row.part.itemId, String(v.key).trim()); await this.store.loadIndex(); void this.store.loadOverview() } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  async unlink(row: Row): Promise<void> {
    const p = row.part; const base = (p.branch ?? p.name).replace(/-(dev|develop|stage|staging|main|prod|production)$/i, '').toLowerCase()
    try { await this.store.api.setLink(p.repo, base, null); await this.store.loadIndex(); void this.store.loadOverview() } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  async syncAll(): Promise<void> {
    const repos = this.store.index()?.repos.filter((r) => !r.error && this.inGroupRepo(r.group)) ?? []
    const v = await this.store.prompt({ title: 'Sync all environments', okLabel: 'Sync', message: `Back-merges the last environment into the earlier ones in ${repos.length} repositories:\n${repos.map((r) => '• ' + r.name).join('\n')}\n\nEach repository checks out the branches it needs; a conflict stops that repository only.`, fields: [{ key: 'push', label: 'Push what is created (sync branches, direct merges)', type: 'checkbox', value: String(this.push()) }] })
    if (!v) return
    this.push.set(!!v.push); LS.set('release.push', !!v.push)
    this.busy.set(true)
    try {
      for (const r of repos) {
        try { const res = await this.store.api.syncEnvironments(r.path, !!v.push); this.store.toast(res.conflict ? 'error' : 'info', `${r.name}: ${res.message}`) }
        catch (e) { this.store.toast('error', `${r.name}: ${e instanceof Error ? e.message : String(e)}`) }
      }
      await this.store.loadIndex(true); void this.store.loadOverview(true)
    } finally { this.busy.set(false) }
  }
  private inGroupRepo(group: string | null): boolean { const g = this.store.orgGroup(); return !g || group === g }
  rowMenu(e: MouseEvent, row: Row): void {
    this.selected.set(row.id)
    const p = row.part
    this.cm.open(e, [
      { label: `Open in ${p.repoName} ▸ Release`, onClick: () => this.openInRepo(row) },
      { label: 'Promote…', onClick: () => { if (!this.checked().has(row.id)) this.toggle(row.id, true); this.promoteSelected() } },
      { label: `Promote in ${p.repoName} only (per-repository Release view)`, onClick: () => { this.store.openInRelease(p.repo, [p.itemId], null) } },
      { label: 'Fix tracking… (which environments it is on)', onClick: () => void this.fixTracking(row) },
      ...(Object.keys(p.overrides).length ? [{ label: 'Reset tracking to detected', onClick: () => void this.resetTracking(row) }] : []),
      ...(p.issueKey ? (p.linkedBy === 'manual' ? [{ label: 'Unlink from issue', onClick: () => void this.unlink(row) }] : []) : [{ label: 'Link to issue…', onClick: () => void this.linkToIssue(row) }]),
      { separator: true, label: '' },
      ...(row.item.issue ? [{ label: `Open ${row.item.issue.key} in Linear`, onClick: () => window.open(row.item.issue!.url) }] : []),
      ...(p.branch ? [{ label: 'Copy branch name', onClick: () => void navigator.clipboard.writeText(p.branch!) }] : []),
      { separator: true, label: '' },
      { label: p.archived ? 'Unarchive' : 'Archive', onClick: () => void this.archiveRows([row], !p.archived) }
    ])
  }
}
