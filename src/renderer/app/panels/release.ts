import { Component, computed, effect, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'
import { Split } from '../ui/split'
import { TimeAgoPipe } from '../ui/time-ago'
import type { EnvConfig, PromoteResult, ReleaseItem, TrackerIssue } from '@shared/types'

type Tab = 'stage' | 'prod' | 'unreleased' | 'released'

function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

@Component({
  selector: 'pg-release',
  imports: [Icon, Panel, Split, TimeAgoPipe],
  template: `
    <div class="release">
      <div class="release-bar">
        <span class="muted">Environments</span>
        <label>dev <input [value]="cfg()?.dev ?? ''" (change)="setCfg('dev', $any($event.target).value)" /></label>
        <span class="muted">→</span>
        <label>stage <input [value]="cfg()?.stage ?? ''" (change)="setCfg('stage', $any($event.target).value)" /></label>
        <span class="muted">→</span>
        <label>prod <input [value]="cfg()?.prod ?? ''" (change)="setCfg('prod', $any($event.target).value)" /></label>
        <button class="btn small" title="Fetch all remotes, then re-analyse" (click)="fetchAndAnalyze()" [disabled]="store.releaseLoading()"><pg-icon name="fetch" [size]="14" />Fetch</button>
        <button class="btn small" title="Re-analyse" (click)="store.analyzeRelease()" [disabled]="store.releaseLoading()"><pg-icon name="refresh" [size]="14" /></button>
        <span style="flex:1"></span>
        @if (store.trackerStatus(); as ts) {
          @if (ts.provider === 'none' || !ts.configured) { <button class="btn small ghost" (click)="store.showSettings.set(true)" title="Connect Linear in Settings">Linear: not connected</button> }
          @else if (ts.error) { <span class="chip bad" [title]="ts.error">Linear: error</span> }
          @else { <span class="chip ok" [title]="ts.account">Linear ✓</span> }
        }
        @if (store.release(); as r) {
          @if (!r.rerere) { <button class="btn small ghost" title="git rerere remembers how you resolved a conflict and reuses it for the next environment" (click)="enableRerere()">Enable rerere</button> } @else { <span class="chip ok" title="Conflict resolutions are reused across environments">rerere ✓</span> }
        }
        <button class="btn small ghost" (click)="showHelp.set(!showHelp())">How we work</button>
      </div>

      @if (showHelp()) {
        <div class="release-help">
          <b>One branch per issue, cut from <code>{{ cfg()?.prod }}</code>, merged as-is into every environment.</b>
          <ol>
            <li><b>Start</b>: "Start work on issue…" creates <code>user/cyb4-123-title</code> from <code>{{ cfg()?.prod }}</code> (Linear → In Progress).</li>
            <li><b>QA</b>: PR feature → <code>{{ cfg()?.dev }}</code>, merge commit (no squash). Resolve conflicts once; rerere replays them later.</li>
            <li><b>UAT</b>: tab <i>To stage</i>, tick approved items, "Merge into stage". Only those branches move; <code>{{ cfg()?.dev }}</code> itself is never merged.</li>
            <li><b>Release</b>: tab <i>To production</i>, tick what product approved, "Create release branch", PR it into <code>{{ cfg()?.prod }}</code>, then "Finish release" tags and back-merges <code>{{ cfg()?.prod }} → {{ cfg()?.stage }} → {{ cfg()?.dev }}</code>.</li>
            <li><b>Hotfix</b>: branch from <code>{{ cfg()?.prod }}</code>, merge there, then "Sync environments".</li>
          </ol>
          <span class="muted">Full process: docs/WORKFLOW.md in the PakGit repository.</span>
        </div>
      }

      @if (!store.release() && store.releaseLoading()) { <div class="empty"><span class="spinner"></span> Analysing branches…</div> }
      @else if (store.release(); as r) {
        @if (!r.refs.prod) { <div class="state-banner">Production branch "{{ r.config.prod }}" not found. Set the environment branch names above.</div> }
        <pg-split dir="h" [initial]="860" storageKey="release-main" [min]="400">
          <pg-panel first [title]="'Release planning'">
            <ng-container actions>
              <button class="btn small" [class.active]="tab() === 'stage'" (click)="tab.set('stage')">To stage <span class="badge">{{ counts().stage }}</span></button>
              <button class="btn small" [class.active]="tab() === 'prod'" (click)="tab.set('prod')">To production <span class="badge">{{ counts().prod }}</span></button>
              <button class="btn small" [class.active]="tab() === 'unreleased'" (click)="tab.set('unreleased')">All unreleased <span class="badge">{{ counts().unreleased }}</span></button>
              <button class="btn small" [class.active]="tab() === 'released'" (click)="tab.set('released')">Released</button>
            </ng-container>
            <input class="filter-input" placeholder="Filter by issue, title, branch…" [value]="filter()" (input)="filter.set($any($event.target).value)" />
            <div class="log release-table">
              <table>
                <colgroup><col style="width:28px" /><col /><col style="width:170px" /><col style="width:44px" /><col style="width:44px" /><col style="width:44px" /><col style="width:60px" /><col style="width:80px" /></colgroup>
                <thead><tr>
                  <th><input type="checkbox" [checked]="allChecked()" (change)="toggleAll($any($event.target).checked)" title="Select all" /></th>
                  <th>Issue / work item</th><th>Branch</th><th title="On {{ r.config.dev }}">dev</th><th title="On {{ r.config.stage }}">stage</th><th title="On {{ r.config.prod }}">prod</th><th title="The branch's own commits not yet on production">Own commits</th><th>Updated</th>
                </tr></thead>
                <tbody>
                  @for (it of visible(); track it.id) {
                    <tr [class.selected]="selected()?.id === it.id" (click)="selected.set(it)">
                      <td><input type="checkbox" [checked]="checked().has(it.id)" (click)="$event.stopPropagation()" (change)="toggle(it.id, $any($event.target).checked)" /></td>
                      <td [title]="it.issue?.title ?? it.name">
                        @if (it.issueKey) { <span class="ref-pill issue">{{ it.issueKey }}</span> }
                        {{ it.issue?.title ?? it.name }}
                        @if (it.issue) { <span class="status-pill" [class]="'status-pill ' + it.issue.statusType">{{ it.issue.status }}</span> }
                        @if (it.needsCherryPick) { <span class="status-pill unknown" title="No branch left for this work; promotion will cherry-pick its commits">cherry-pick</span> }
                        @if (it.basedOnEnv) { <span class="status-pill canceled" title="This branch was cut from dev/stage, so it carries other unreleased work. Promoting it alone is not possible; recreate it from main (git rebase --onto main) before promoting.">branched from dev</span> }
                      </td>
                      <td [title]="branchTitle(it)"><span class="mono" style="font-size:11px">{{ it.branches[0]?.name ?? '—' }}</span>@if (it.branches.length > 1) { <span class="muted"> +{{ it.branches.length - 1 }}</span> }</td>
                      <td class="env">{{ it.inDev ? '✓' : '' }}</td><td class="env">{{ it.inStage ? '✓' : '' }}</td><td class="env">{{ it.inProd ? '✓' : '' }}</td>
                      <td class="muted">{{ it.commitsAheadOfProd ?? it.commits.length }}</td>
                      <td class="muted">{{ it.lastActivity ? (it.lastActivity | timeAgo) : '' }}</td>
                    </tr>
                  } @empty { <tr><td colspan="8"><div class="empty">{{ emptyText() }}</div></td></tr> }
                </tbody>
              </table>
            </div>
            <div class="release-actions">
              <label><input type="checkbox" [checked]="push()" (change)="push.set($any($event.target).checked)" />Push after merging</label>
              <label [title]="trackerOk() ? '' : 'Connect Linear in Settings'"><input type="checkbox" [checked]="updateTracker()" [disabled]="!trackerOk()" (change)="updateTracker.set($any($event.target).checked)" />Update Linear status</label>
              <span style="flex:1"></span>
              <span class="muted">{{ checked().size }} selected</span>
              @switch (tab()) {
                @case ('stage') { <button class="btn primary" [disabled]="!checked().size || busy()" (click)="promote('stage')">Merge into {{ r.config.stage }}</button> }
                @case ('prod') { <button class="btn primary" [disabled]="!checked().size || busy()" (click)="createRelease()">Create release branch…</button> }
                @default { <button class="btn" [disabled]="!checked().size || busy()" (click)="promote('dev')">Merge into {{ r.config.dev }}</button><button class="btn" [disabled]="!checked().size || busy()" (click)="promote('stage')">Merge into {{ r.config.stage }}</button> }
              }
              <button class="btn" [disabled]="busy() || !r.releaseBranches.length" (click)="finishRelease()" title="Merge a release branch into {{ r.config.prod }}, tag it, back-merge into {{ r.config.stage }} and {{ r.config.dev }}">Finish release…</button>
              <button class="btn" [disabled]="busy()" (click)="sync()" title="Back-merge {{ r.config.prod }} → {{ r.config.stage }} → {{ r.config.dev }}">Sync environments</button>
              <button class="btn" [disabled]="busy()" (click)="startIssue()" title="Create a branch for a Linear issue from {{ r.config.prod }}"><pg-icon name="branch" [size]="14" />Start work on issue…</button>
            </div>
          </pg-panel>
          <pg-panel second [title]="selected() ? (selected()!.issueKey ?? selected()!.name) : 'Details'">
            @if (selected(); as it) {
              <div class="commit-details">
                <h3>{{ it.issue?.title ?? it.name }}</h3>
                @if (it.issue; as iss) {
                  <div class="meta">
                    <span>Status</span><span><span class="status-pill" [class]="'status-pill ' + iss.statusType">{{ iss.status }}</span></span>
                    @if (iss.assignee) { <span>Assignee</span><span>{{ iss.assignee }}</span> }
                    <span>Linear</span><span><a href="#" (click)="$event.preventDefault(); open(iss.url)">{{ iss.key }} ↗</a></span>
                  </div>
                }
                <div class="meta">
                  <span>On</span><span>{{ envList(it) }}</span>
                </div>
                <div class="group-header">Branches<span class="count">{{ it.branches.length }}</span></div>
                <ul class="list">
                  @for (b of it.branches; track b.ref) { <li class="row" [title]="b.sha"><pg-icon name="branch" [size]="13" /><span class="grow mono" style="font-size:11.5px">{{ b.ref }}</span>@if (b.basedOnEnv) { <span class="status-pill canceled" title="cut from dev/stage">dev-based</span> }@if (b.own !== undefined) { <span class="muted" style="font-size:11px">{{ b.own }} own</span> }<span class="muted">{{ b.date | timeAgo }}</span></li> }
                  @empty { <li class="row muted">No branch (work exists only as commits)</li> }
                </ul>
                @if (it.commits.length) {
                  <div class="group-header">Commits on {{ r.config.dev }}/{{ r.config.stage }} not on {{ r.config.prod }}<span class="count">{{ it.commits.length }}</span></div>
                  <ul class="list">
                    @for (c of it.commits; track c.sha) { <li class="row" [title]="c.sha" (dblclick)="store.perspective.set('log'); store.selectCommit(c.sha)"><span class="mono muted">{{ c.shortSha }}</span><span class="grow">{{ c.subject }}</span></li> }
                  </ul>
                }
              </div>
            } @else { <div class="empty">Select a work item to see its branches and commits.</div> }
          </pg-panel>
        </pg-split>
      } @else { <div class="empty">Open a repository to plan a release.</div> }

      @if (issuePicker(); as issues) {
        <div class="modal-backdrop" (mousedown)="issuePicker.set(null)">
          <div class="modal wide" (mousedown)="$event.stopPropagation()">
            <h2>Start work on issue</h2>
            <p class="modal-message">Creates a branch from {{ cfg()?.remote }}/{{ cfg()?.prod }} using Linear's branch name{{ updateTracker() ? ', and moves the issue to "' + (store.settings()?.tracker?.stateOnStart ?? 'In Progress') + '"' : '' }}.</p>
            <input class="filter-input" placeholder="Filter my issues…" [value]="issueFilter()" (input)="issueFilter.set($any($event.target).value)" />
            <ul class="list rebase-list" style="max-height:50vh">
              @for (i of filteredIssues(issues); track i.key) {
                <li class="row" (dblclick)="pickIssue(i)" (click)="pickedIssue.set(i)" [class.selected]="pickedIssue()?.key === i.key"><span class="ref-pill issue">{{ i.key }}</span><span class="grow">{{ i.title }}</span><span class="status-pill" [class]="'status-pill ' + i.statusType">{{ i.status }}</span></li>
              } @empty { <li class="row muted">No open issues assigned to you.</li> }
            </ul>
            <div class="modal-actions"><button class="btn" (click)="issuePicker.set(null)">Cancel</button><button class="btn primary" [disabled]="!pickedIssue()" (click)="pickIssue(pickedIssue()!)">Create branch</button></div>
          </div>
        </div>
      }
    </div>`
})
export class Release {
  readonly store = inject(Store)
  readonly tab = signal<Tab>('stage')
  readonly filter = signal('')
  readonly checked = signal<Set<string>>(new Set())
  readonly selected = signal<ReleaseItem | null>(null)
  readonly push = signal(true)
  readonly updateTracker = signal(true)
  readonly showHelp = signal(false)
  readonly busy = signal(false)
  readonly issuePicker = signal<TrackerIssue[] | null>(null)
  readonly issueFilter = signal('')
  readonly pickedIssue = signal<TrackerIssue | null>(null)
  readonly cfg = computed<EnvConfig | null>(() => this.store.release()?.config ?? null)
  readonly trackerOk = computed(() => { const t = this.store.trackerStatus(); return !!t && t.configured && !t.error })

  constructor() {
    effect(() => { if (this.store.repo() && !this.store.release() && !this.store.releaseLoading()) void this.store.analyzeRelease() })
    void this.store.refreshTracker()
  }

  private items(): ReleaseItem[] { return this.store.release()?.items ?? [] }
  readonly counts = computed(() => {
    const it = this.items()
    return { stage: it.filter((i) => i.inDev && !i.inStage && !i.inProd).length, prod: it.filter((i) => i.inStage && !i.inProd).length, unreleased: it.filter((i) => !i.inProd).length }
  })
  readonly visible = computed(() => {
    const q = this.filter().toLowerCase()
    return this.items().filter((i) => {
      switch (this.tab()) {
        case 'stage': if (!(i.inDev && !i.inStage && !i.inProd)) return false; break
        case 'prod': if (!(i.inStage && !i.inProd)) return false; break
        case 'unreleased': if (i.inProd) return false; break
        case 'released': if (!i.inProd) return false; break
      }
      return !q || [i.issueKey, i.name, i.issue?.title, i.issue?.status, ...i.branches.map((b) => b.name)].join(' ').toLowerCase().includes(q)
    })
  })
  emptyText(): string {
    const c = this.cfg(); if (!c) return ''
    return { stage: `Nothing on ${c.dev} that is missing from ${c.stage}.`, prod: `Nothing on ${c.stage} that is missing from ${c.prod}.`, unreleased: 'Everything is released.', released: 'Nothing released yet.' }[this.tab()]
  }
  readonly allChecked = computed(() => this.visible().length > 0 && this.visible().every((i) => this.checked().has(i.id)))
  toggle(id: string, on: boolean): void { const n = new Set(this.checked()); on ? n.add(id) : n.delete(id); this.checked.set(n) }
  toggleAll(on: boolean): void { const n = new Set(this.checked()); for (const i of this.visible()) on ? n.add(i.id) : n.delete(i.id); this.checked.set(n) }
  branchTitle(it: ReleaseItem): string { return it.branches.map((b) => b.ref).join('\n') }
  envList(it: ReleaseItem): string { const c = this.cfg()!; return [it.inDev && c.dev, it.inStage && c.stage, it.inProd && c.prod].filter(Boolean).join(', ') || 'not merged anywhere' }
  open(url: string): void { window.open(url) }

  async setCfg(k: 'dev' | 'stage' | 'prod', v: string): Promise<void> {
    const r = this.store.repo(); const c = this.cfg(); if (!r || !c || !v.trim()) return
    await this.store.api.saveReleaseConfig(r.path, { ...c, [k]: v.trim() })
    await this.store.analyzeRelease()
  }
  async fetchAndAnalyze(): Promise<void> {
    const r = this.store.repo(); if (!r) return
    await this.store.run('Fetch', () => this.store.api.fetch(r.path, undefined, true), { silent: false })
    await this.store.analyzeRelease()
  }
  async enableRerere(): Promise<void> { const r = this.store.repo(); if (!r) return; await this.store.api.enableRerere(r.path); await this.store.analyzeRelease() }

  private selectedItems(): ReleaseItem[] { const ids = this.checked(); return this.items().filter((i) => ids.has(i.id)) }
  private toInput(it: ReleaseItem) { return { id: it.id, ref: it.branches[0]?.ref ?? null, commits: it.commits.map((c) => c.sha) } }
  private async afterOp(res: PromoteResult, items: ReleaseItem[], state: string | undefined): Promise<void> {
    if (res.conflict) {
      this.store.toast('error', `Conflict while applying ${res.conflict}. Resolve it in the Files panel, then continue the merge and run the remaining items again.\n${res.message.split('\n').slice(0, 3).join('\n')}`)
      this.store.perspective.set('standard')
    } else {
      this.store.toast('success', res.message)
      if (state && this.updateTracker() && this.trackerOk()) {
        for (const it of items) if (it.issueKey && res.merged.includes(it.id)) await this.store.api.trackerSetState(it.issueKey, state).catch((e) => this.store.toast('error', `Linear ${it.issueKey}: ${e instanceof Error ? e.message : String(e)}`))
      }
    }
    this.checked.set(new Set())
    await this.store.refresh(); await this.store.analyzeRelease()
  }
  async promote(env: 'dev' | 'stage'): Promise<void> {
    const r = this.store.repo(); const items = this.selectedItems(); if (!r || !items.length) return
    const c = this.cfg()!
    const ok = await this.store.prompt({ title: `Merge into ${c[env]}`, okLabel: 'Merge', message: `Merge ${items.length} item(s) into ${c[env]}:\n${items.map((i) => '• ' + (i.issueKey ?? i.name)).join('\n')}\n\nEach feature branch is merged with its own merge commit${this.push() ? ', then pushed' : ''}.` })
    if (!ok) return
    this.busy.set(true)
    try {
      const res = await this.store.api.promote(r.path, env, items.map((i) => this.toInput(i)), this.push())
      await this.afterOp(res, items, env === 'stage' ? this.store.settings()?.tracker.stateOnStage : this.store.settings()?.tracker.stateOnDev)
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async createRelease(): Promise<void> {
    const r = this.store.repo(); const items = this.selectedItems(); if (!r || !items.length) return
    const c = this.cfg()!
    const v = await this.store.prompt({ title: 'Create release branch', okLabel: 'Create', message: `From ${c.remote}/${c.prod} with ${items.length} item(s):\n${items.map((i) => '• ' + (i.issueKey ?? i.name)).join('\n')}`, fields: [{ key: 'name', label: 'Release name', value: `release-${isoWeek()}` }] })
    if (!v || !v.name) return
    this.busy.set(true)
    try {
      const res = await this.store.api.startRelease(r.path, String(v.name), items.map((i) => this.toInput(i)), this.push())
      await this.afterOp(res, items, undefined)
      if (!res.conflict) this.store.toast('info', `Open a pull request from ${c.releasePrefix}${String(v.name).replace(c.releasePrefix, '')} into ${c.prod}, then use "Finish release".`)
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async finishRelease(): Promise<void> {
    const r = this.store.repo(); const rel = this.store.release(); if (!r || !rel) return
    const c = rel.config
    const options = rel.releaseBranches.map((b) => b.ref)
    const v = await this.store.prompt({ title: 'Finish release', okLabel: 'Finish', message: `Merges the release branch into ${c.prod}, tags it, then back-merges ${c.prod} → ${c.stage} → ${c.dev}${this.push() ? ' and pushes' : ''}.`, fields: [
      { key: 'branch', label: 'Release branch', type: 'select', options },
      { key: 'tag', label: 'Tag (optional)', value: `v${isoWeek().replace('-W', '.')}` }
    ] })
    if (!v || !v.branch) return
    this.busy.set(true)
    try {
      const res = await this.store.api.finishRelease(r.path, String(v.branch), String(v.tag || '') || null, this.push())
      const released = this.items().filter((i) => i.branches.some((b) => rel.refs.stage && i.inStage) && !i.inProd)
      await this.afterOp(res, released, this.store.settings()?.tracker.stateOnRelease)
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async sync(): Promise<void> {
    const r = this.store.repo(); if (!r) return
    this.busy.set(true)
    try { await this.afterOp(await this.store.api.syncEnvironments(r.path, this.push()), [], undefined) }
    catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async startIssue(): Promise<void> {
    if (!this.trackerOk()) {
      const v = await this.store.prompt({ title: 'Start work', okLabel: 'Create branch', message: 'Linear is not connected; enter the branch name by hand.', fields: [{ key: 'name', label: 'Branch name', placeholder: 'user/cyb4-123-short-title' }] })
      if (!v || !v.name) return
      await this.doStart(String(v.name), null); return
    }
    try { this.pickedIssue.set(null); this.issueFilter.set(''); this.issuePicker.set(await this.store.api.trackerMyIssues()) }
    catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  filteredIssues(list: TrackerIssue[]): TrackerIssue[] { const q = this.issueFilter().toLowerCase(); return q ? list.filter((i) => `${i.key} ${i.title} ${i.status}`.toLowerCase().includes(q)) : list }
  async pickIssue(i: TrackerIssue): Promise<void> {
    this.issuePicker.set(null)
    await this.doStart(i.branchName || `${i.key.toLowerCase()}-${i.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`, i.key)
  }
  private async doStart(branch: string, key: string | null): Promise<void> {
    const r = this.store.repo(); if (!r) return
    const res = await this.store.run('Start work', () => this.store.api.startIssue(r.path, key ?? '', branch), { success: `Created ${branch} from ${this.cfg()?.remote}/${this.cfg()?.prod}` })
    if (res !== undefined && key && this.updateTracker() && this.trackerOk()) {
      const state = this.store.settings()?.tracker.stateOnStart
      if (state) await this.store.api.trackerSetState(key, state).catch((e) => this.store.toast('error', `Linear: ${e instanceof Error ? e.message : String(e)}`))
    }
    this.store.perspective.set('standard')
  }
}
