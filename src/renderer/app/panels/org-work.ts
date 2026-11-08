import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { LS, Store } from '../store.service'
import { Icon } from '../ui/icon'
import { TimeAgoPipe } from '../ui/time-ago'
import { ContextMenuService } from '../ui/context-menu'
import { StartWorkDialog, type StartWorkIssue } from './start-work-dialog'
import { ViewsBar } from '../ui/views-bar'
import type { SavedView } from '@shared/types'
import type { IndexRepo, IssueQuery, TrackerIssue, WorkItem, WorkPart } from '@shared/types'

interface Row { key: string; issue: TrackerIssue | undefined; item: WorkItem | null; team: string; updated: string }
interface Cell { part: WorkPart | null; label: string; cls: string; title: string }
interface Filters { team: string; state: string; assignee: 'anyone' | 'me' | 'unassigned'; days: number; cycle: boolean }

/** Work tab: tracker issues × repositories. A cell is the issue's part in that repository. */
@Component({
  selector: 'pg-org-work',
  imports: [Icon, TimeAgoPipe, StartWorkDialog, ViewsBar],
  template: `
    <div class="org-pane">
      <div class="filter-bar">
        <input class="filter-input" placeholder="Filter by issue, title, branch…" [value]="text()" (input)="text.set($any($event.target).value); pinned.set(null)" />
        <select (change)="setFilter({ team: $any($event.target).value })" title="Team">
          <option value="" [selected]="!f().team">All teams</option>
          @for (t of teams(); track t) { <option [value]="t" [selected]="f().team === t">{{ t }}</option> }
        </select>
        <select (change)="setFilter({ state: $any($event.target).value })" title="Status">
          <option value="" [selected]="!f().state">Any status</option>
          <option value="__active" [selected]="f().state === '__active'">Active (to do + in progress)</option>
          @for (s of states(); track s) { <option [value]="s" [selected]="f().state === s">{{ s }}</option> }
        </select>
        <select (change)="setFilter({ assignee: $any($event.target).value })" title="Assignee">
          <option value="anyone" [selected]="f().assignee === 'anyone'">Anyone</option>
          <option value="me" [selected]="f().assignee === 'me'">Assigned to me</option>
          <option value="unassigned" [selected]="f().assignee === 'unassigned'">Unassigned</option>
        </select>
        <select (change)="setFilter({ days: +$any($event.target).value })" title="Updated within">
          <option value="0" [selected]="f().days === 0">Any time</option><option value="7" [selected]="f().days === 7">Last 7 days</option><option value="30" [selected]="f().days === 30">Last 30 days</option><option value="90" [selected]="f().days === 90">Last 90 days</option>
        </select>
        <label title="Only issues in the active cycle (Linear)"><input type="checkbox" [checked]="f().cycle" (change)="setFilter({ cycle: $any($event.target).checked })" />Active cycle</label>
        <label title="Only issues whose parts sit on different environments"><input type="checkbox" [checked]="warnOnly()" (change)="warnOnly.set($any($event.target).checked)" />Partly promoted</label>
        <button class="btn small" (click)="load()" [disabled]="loading()" title="Reload issues from the tracker"><pg-icon name="refresh" [size]="14" /></button>
        <pg-views-bar tab="work" [active]="activeView()" (apply)="applyView($event)" (save)="saveView()" />
      </div>
      @if (!trackerOk()) { <div class="state-banner">Linear is not connected for this organization, so rows come from git only. <a href="#" (click)="$event.preventDefault(); store.showOrgConfig.set('integrations')">Connect it under Configure ▸ Integrations</a> to see planned work too.</div> }
      @if (loadError()) { <div class="state-banner">{{ loadError() }}</div> }
      <div class="log release-table">
        <table>
          <colgroup><col />@for (r of columns(); track r.path) { <col style="width:150px" /> }<col style="width:76px" /></colgroup>
          <thead><tr><th>Issue</th>@for (r of columns(); track r.path) { <th [title]="r.path">{{ r.name }}</th> }<th>Updated</th></tr></thead>
          <tbody>
            @for (row of rows(); track row.key) {
              <tr [class.selected]="selected() === row.key" (click)="selected.set(row.key)" (dblclick)="showInReady(row)" (contextmenu)="menu($event, row)">
                <td [title]="row.issue?.title ?? ''">
                  <span class="ref-pill issue">{{ row.key }}</span>
                  @if (row.issue) { <span class="status-pill" [class]="'status-pill ' + row.issue.statusType" style="margin:0 6px 0 0">{{ row.issue.status }}</span> }
                  {{ row.issue?.title ?? row.item?.name ?? '' }}
                  @if (row.issue?.assignee) { <span class="muted" style="font-size:11px"> · {{ row.issue!.assignee }}</span> }
                  @if (row.item?.partlyPromoted) { <span class="status-pill unknown" title="Parts of this issue sit on different environments">⚠ partly promoted</span> }
                </td>
                @for (r of columns(); track r.path) { @let c = cell(row, r); <td [class]="'work-cell ' + c.cls" [title]="c.title">{{ c.label }}</td> }
                <td class="muted">{{ row.updated ? (row.updated | timeAgo) : '' }}</td>
              </tr>
            } @empty { <tr><td [attr.colspan]="columns().length + 2"><div class="empty">{{ emptyText() }}</div></td></tr> }
          </tbody>
        </table>
      </div>
      <div class="release-actions">
        <span class="muted">{{ rows().length }} issue(s)@if (nextCursor()) { · <a href="#" (click)="$event.preventDefault(); loadMore()">load more</a> }@if (loading()) { · loading… }</span>
        <span style="flex:1"></span>
        <button class="btn primary" [disabled]="!selectedRow()" (click)="startWork(selectedRow()!)" title="Create the issue branch in one or more repositories"><pg-icon name="branch" [size]="14" />Start work…</button>
        <button class="btn" [disabled]="!selectedRow()" (click)="linkBranch(selectedRow()!)" title="Attach a branch that follows no naming convention to this issue"><pg-icon name="link" [size]="14" />Link branch…</button>
        <button class="btn" [disabled]="!selectedRow() || !trackerOk()" (click)="setState(selectedRow()!)">Set status…</button>
        <button class="btn" [disabled]="!selectedRow() || !trackerOk()" (click)="assignToMe(selectedRow()!)">Assign to me</button>
        <button class="btn" [disabled]="!selectedRow()?.issue" (click)="open(selectedRow()!.issue!.url)">Open in Linear</button>
      </div>

      @if (startFor(); as sw) { <pg-start-work-dialog [issue]="sw" (closed)="startFor.set(null)" (done)="afterChange()" /> }
      @if (link(); as l) {
        <div class="modal-backdrop" (mousedown)="link.set(null)">
          <form class="modal" (mousedown)="$event.stopPropagation()" (submit)="$event.preventDefault(); submitLink()">
            <h2>Link a branch to {{ l.key }}</h2>
            <p class="modal-message">For branches that carry no issue key. PakGit remembers the link and treats the branch as part of the issue in that repository.</p>
            <label class="field"><span>Repository</span>
              <select (change)="linkRepo.set($any($event.target).value)">@for (r of columns(); track r.path) { <option [value]="r.path" [selected]="linkRepo() === r.path">{{ r.name }}</option> }</select></label>
            <label class="field"><span>Branch</span>
              @if (keylessIn(linkRepo()); as list) {
                @if (list.length) {
                  <select (change)="linkItem.set($any($event.target).value)"><option value="" [selected]="!linkItem()">Choose a branch…</option>@for (p of list; track p.itemId) { <option [value]="p.itemId" [selected]="linkItem() === p.itemId">{{ p.branch }}{{ p.highest ? ' (on ' + p.highest + ')' : '' }}</option> }</select>
                } @else { <small class="hint">Every branch in this repository already belongs to an issue.</small> }
              }
            </label>
            <div class="modal-actions"><button type="button" class="btn" (click)="link.set(null)">Cancel</button><button type="submit" class="btn primary" [disabled]="!linkItem()">Link</button></div>
          </form>
        </div>
      }
    </div>`
})
export class OrgWork {
  readonly store = inject(Store)
  private readonly cm = inject(ContextMenuService)
  readonly text = signal('')
  readonly f = signal<Filters>(LS.get<Filters>('work.filters', { team: '', state: '__active', assignee: 'anyone', days: 0, cycle: false }))
  readonly warnOnly = signal(false)
  readonly issues = signal<TrackerIssue[]>([])
  readonly loading = signal(false)
  readonly loadError = signal('')
  readonly nextCursor = signal<string | null>(null)
  readonly selected = signal<string | null>(null)
  /** key opened from Quick open: shown even when the filters would hide it, until the text filter changes */
  readonly pinned = signal<string | null>(null)
  readonly startFor = signal<StartWorkIssue | null>(null)
  readonly link = signal<{ key: string } | null>(null)
  readonly linkRepo = signal('')
  readonly linkItem = signal('')
  readonly trackerOk = computed(() => { const t = this.store.trackerStatus(); return !!t && t.configured && !t.error })
  readonly teams = computed(() => { const set = new Set<string>(this.store.trackerTeams().map((t) => t.key)); for (const it of this.store.index()?.items ?? []) if (it.issueKey) set.add(it.issueKey.split('-')[0]); return [...set].sort() })
  readonly states = computed(() => { const set = new Set([...this.issues().map((i) => i.status), ...(this.store.index()?.items ?? []).map((i) => i.issue?.status).filter((x): x is string => !!x)]); const cur = this.f().state; if (cur && cur !== '__active') set.add(cur); return [...set].sort() })
  readonly columns = computed<IndexRepo[]>(() => {
    const g = this.store.orgGroup()
    const list = this.store.index()?.repos ?? this.store.repos().map((r) => ({ path: r.path, name: r.name, group: r.group ?? null, remote: r.remote ?? null, environments: [] }))
    return list.filter((r) => !g || r.group === g)
  })
  /** keyless parts by "repo\nbranch" so a tracker branch name (linking rule 3) finds its branch without a key */
  private readonly keyless = computed(() => {
    const m = new Map<string, WorkPart>()
    for (const it of this.store.index()?.items ?? []) if (!it.issueKey) for (const p of it.parts) if (p.branch) m.set(`${p.repo}\n${p.branch}`, p)
    return m
  })
  readonly rows = computed<Row[]>(() => {
    const idx = this.store.index(); const list = this.issues()
    const byKey = new Map<string, WorkItem>(); for (const it of idx?.items ?? []) if (it.issueKey) byKey.set(it.issueKey, it)
    const rows: Row[] = []; const seen = new Set<string>()
    for (const i of list) { seen.add(i.key); const item = byKey.get(i.key) ?? null; rows.push({ key: i.key, issue: i, item, team: i.team ?? i.key.split('-')[0], updated: i.updatedAt ?? item?.lastActivity ?? '' }) }
    for (const it of idx?.items ?? []) if (it.issueKey && !seen.has(it.issueKey)) rows.push({ key: it.issueKey, issue: it.issue, item: it, team: it.issueKey.split('-')[0], updated: it.issue?.updatedAt ?? it.lastActivity })
    const q = this.text().trim().toLowerCase(); const f = this.f(); const cutoff = f.days ? Date.now() - f.days * 86400000 : 0; const pinned = this.pinned()
    // without a tracker the status, assignee and cycle filters cannot be evaluated: git-only rows are shown as they are
    const tracker = this.trackerOk()
    return rows.filter((r) => {
      if (pinned && r.key === pinned) return true
      if (f.team && r.team !== f.team) return false
      if (tracker && f.state) { if (!r.issue) return false; if (f.state === '__active' ? !(r.issue.statusType === 'unstarted' || r.issue.statusType === 'started') : r.issue.status !== f.state) return false }
      if (tracker && f.assignee === 'me' && !r.issue?.assigneeIsMe) return false
      if (tracker && f.assignee === 'unassigned' && r.issue?.assignee) return false
      if (cutoff && (!r.updated || new Date(r.updated).getTime() < cutoff)) return false
      if (tracker && f.cycle && !r.issue) return false
      if (this.warnOnly() && !r.item?.partlyPromoted) return false
      if (q) { const hay = [r.key, r.issue?.title, r.item?.name, ...(r.item?.parts.map((p) => p.branch) ?? [])].join(' ').toLowerCase(); if (!hay.includes(q)) return false }
      return true
    }).sort((a, b) => (a.updated < b.updated ? 1 : -1))
  })
  readonly selectedRow = computed(() => this.rows().find((r) => r.key === this.selected()) ?? null)
  readonly activeView = signal<string | null>(null)
  applyView(v: SavedView): void {
    const f = v.filters
    this.f.set({ team: String(f['team'] ?? ''), state: String(f['state'] ?? ''), assignee: (f['assignee'] as Filters['assignee']) ?? 'anyone', days: Number(f['days'] ?? 0), cycle: !!f['cycle'] })
    this.text.set(String(f['text'] ?? '')); this.warnOnly.set(!!f['warnOnly']); this.activeView.set(v.id)
  }
  async saveView(): Promise<void> {
    const v = await this.store.prompt({ title: 'Save view', okLabel: 'Save', message: 'The current filters of the Work tab become a chip for everyone who shares this organization.', fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. My QA queue' }] })
    if (!v || !String(v.name).trim()) return
    const f = this.f()
    await this.store.saveView({ name: String(v.name).trim(), tab: 'work', filters: { team: f.team, state: f.state, assignee: f.assignee, days: f.days, cycle: f.cycle, text: this.text(), warnOnly: this.warnOnly() } })
  }

  constructor() {
    effect(() => LS.set('work.filters', this.f()))
    effect(() => { const v = this.store.applyView(); if (v && v.tab === 'work') { this.applyView(v); this.store.applyView.set(null) } })
    // reload from the tracker when the server-side filters change (first run included)
    effect(() => { this.f(); if (this.trackerOk()) void this.load() })
    effect(() => { if (this.trackerOk() && !this.store.trackerTeamsLoaded()) void this.store.loadTrackerTeams() })
    // Quick open ▸ issue: filter to the key, and fetch it when the tracker list did not include it
    effect(() => {
      const key = this.store.workFocusKey(); if (!key) return
      this.text.set(key); this.selected.set(key); this.pinned.set(key)
      const known = untracked(() => this.issues().some((i) => i.key === key) || (this.store.index()?.items ?? []).some((i) => i.issueKey === key))
      if (!known && untracked(() => this.trackerOk())) this.store.api.trackerIssues([key]).then((list) => { if (list.length) this.issues.update((cur) => [...list, ...cur.filter((i) => i.key !== key)]) }).catch(() => undefined)
      this.store.workFocusKey.set(null)
    })
  }

  setFilter(patch: Partial<Filters>): void { this.f.update((f) => ({ ...f, ...patch })) }
  private query(): IssueQuery {
    const f = this.f()
    return { teams: f.team ? [f.team] : undefined, states: f.state && f.state !== '__active' ? [f.state] : undefined, stateTypes: f.state === '__active' ? ['unstarted', 'started'] : undefined, assignee: f.assignee, updatedWithinDays: f.days || undefined, activeCycle: f.cycle || undefined, first: 100 }
  }
  async load(): Promise<void> {
    if (!this.trackerOk()) return
    this.loading.set(true); this.loadError.set('')
    try { const page = await this.store.api.trackerListIssues(this.query()); this.issues.set(page.issues); this.nextCursor.set(page.nextCursor) }
    catch (e) { this.loadError.set(`Linear: ${e instanceof Error ? e.message : String(e)}`) } finally { this.loading.set(false) }
  }
  async loadMore(): Promise<void> {
    const after = this.nextCursor(); if (!after) return
    this.loading.set(true)
    try { const page = await this.store.api.trackerListIssues({ ...this.query(), after }); this.issues.update((cur) => [...cur, ...page.issues.filter((i) => !cur.some((c) => c.key === i.key))]); this.nextCursor.set(page.nextCursor) }
    catch (e) { this.loadError.set(`Linear: ${e instanceof Error ? e.message : String(e)}`) } finally { this.loading.set(false) }
  }
  partFor(row: Row, repo: string): WorkPart | null {
    const p = row.item?.parts.find((x) => x.repo === repo); if (p) return p
    const bn = row.issue?.branchName; if (bn) return this.keyless().get(`${repo}\n${bn}`) ?? null
    return null
  }
  cell(row: Row, repo: IndexRepo): Cell {
    const p = this.partFor(row, repo.path)
    if (!p) return { part: null, label: '—', cls: 'none', title: 'No branch or commits for this issue here' }
    const envName = (id: string) => repo.environments.find((e) => e.id === id)?.branch ?? id
    const branch = p.branch ?? (p.needsCherryPick ? 'commits only (branch deleted)' : '')
    if (p.archived) return { part: p, label: 'archived', cls: 'none', title: branch }
    if (!p.highest) return { part: p, label: 'branch', cls: 'branch', title: `${branch}: not merged anywhere yet` }
    const top = p.envIds[p.envIds.length - 1]
    const behind = row.item?.partlyPromoted && p.highest !== top && row.item.parts.some((o) => o.repo !== p.repo && !o.archived && o.highest && o.envIds.indexOf(o.highest) - (o.envIds.length - 1) > p.envIds.indexOf(p.highest!) - (p.envIds.length - 1))
    return { part: p, label: `${envName(p.highest)} ✓`, cls: behind ? 'low' : 'ok', title: `${branch}: on ${p.envIds.filter((e) => p.inEnv[e]).map(envName).join(', ')}${p.basedOnEnv ? ' · cut from dev/stage' : ''}${behind ? ' · behind the other repositories' : ''}` }
  }
  emptyText(): string {
    if (this.loading()) return 'Loading issues…'
    if (!this.store.index()) return this.store.indexLoading() ? 'Analysing repositories…' : 'No index yet.'
    return this.trackerOk() ? 'No issue matches these filters.' : 'No issue keys found in the branches of these repositories.'
  }
  open(url: string): void { window.open(url) }
  showInReady(row: Row): void { this.store.readyWarnOnly.set(false); this.store.readyText.set(row.key); this.store.orgTab.set('ready') }
  startWork(row: Row): void { this.startFor.set({ key: row.key, title: row.issue?.title ?? row.item?.name ?? '', branchName: row.issue?.branchName }) }
  afterChange(): void { void this.store.loadIndex(); void this.store.loadOverview() }
  linkBranch(row: Row): void { this.linkRepo.set(this.columns()[0]?.path ?? ''); this.linkItem.set(''); this.link.set({ key: row.key }) }
  keylessIn(repo: string): WorkPart[] { return [...this.keyless().values()].filter((p) => p.repo === repo).sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1)) }
  async submitLink(): Promise<void> {
    const l = this.link(); const repo = this.linkRepo(); const item = this.linkItem(); if (!l || !repo || !item) return
    try { await this.store.api.setLink(repo, item, l.key); this.store.toast('success', `Linked ${item} to ${l.key}`); this.link.set(null); this.afterChange() }
    catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  async setState(row: Row): Promise<void> {
    try {
      const states = await this.store.api.trackerStates(row.key)
      const v = await this.store.prompt({ title: `Set status of ${row.key}`, okLabel: 'Set', fields: [{ key: 'state', label: 'Status', type: 'select', options: row.issue ? [row.issue.status, ...states.filter((s) => s !== row.issue!.status)] : states }] })
      if (!v || !v.state) return
      await this.store.api.trackerSetState(row.key, String(v.state))
      this.store.toast('success', `${row.key} → ${v.state}`)
      await this.refreshIssue(row.key)
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  async assignToMe(row: Row): Promise<void> {
    try { await this.store.api.trackerAssignToMe(row.key); this.store.toast('success', `${row.key} assigned to you`); await this.refreshIssue(row.key) }
    catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  private async refreshIssue(key: string): Promise<void> {
    const list = await this.store.api.trackerIssues([key]).catch(() => [])
    if (list.length) this.issues.update((cur) => (cur.some((i) => i.key === key) ? cur.map((i) => (i.key === key ? list[0] : i)) : [list[0], ...cur]))
    void this.store.loadIndex()
  }
  menu(e: MouseEvent, row: Row): void {
    this.selected.set(row.key)
    this.cm.open(e, [
      { label: 'Start work in repositories…', onClick: () => this.startWork(row) },
      { label: 'Link branch…', onClick: () => this.linkBranch(row) },
      { label: 'Show in Ready', onClick: () => this.showInReady(row) },
      { separator: true, label: '' },
      { label: 'Set status…', disabled: !this.trackerOk(), onClick: () => void this.setState(row) },
      { label: 'Assign to me', disabled: !this.trackerOk(), onClick: () => void this.assignToMe(row) },
      ...(row.issue ? [{ label: `Open ${row.key} in Linear`, onClick: () => this.open(row.issue!.url) }] : []),
      { label: 'Copy issue key', onClick: () => void navigator.clipboard.writeText(row.key) }
    ])
  }
}
