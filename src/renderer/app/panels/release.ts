import { Component, computed, effect, inject, signal } from '@angular/core'
import { LS, Store } from '../store.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'
import { Split } from '../ui/split'
import { TimeAgoPipe } from '../ui/time-ago'
import { EnvConfigDialog } from './env-config-dialog'
import { PromoteDialog, isoWeek, type PromoteRequest } from './promote-dialog'
import { ContextMenuService } from '../ui/context-menu'
import type { EnvConfig, Environment, PendingPromotion, PromoteResult, ReleaseItem, TrackerIssue } from '@shared/types'

/** tab = environment id (items ready for it), or 'unreleased' / 'released' */
type Tab = string


@Component({
  selector: 'pg-release',
  imports: [Icon, Panel, Split, TimeAgoPipe, EnvConfigDialog, PromoteDialog],
  template: `
    <div class="release">
      <div class="release-bar">
        <span class="muted">Pipeline</span>
        @for (e of envs(); track e.id; let last = $last) { <span class="env-chip" [title]="e.strategy === 'release-branch' ? 'release branch + pull request' : e.strategy === 'feature-pr' ? 'one pull request per feature branch' : 'direct merge, no pull request'">{{ e.name || e.branch }} <span class="mono muted">{{ e.branch }}</span></span>@if (!last) { <span class="muted">→</span> } }
        <button class="btn small" (click)="showConfig.set(true)" title="Configure environments, branches and promotion strategy">Configure…</button>
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
          <b>One branch per issue, cut from <code>{{ baseEnv()?.branch }}</code>, merged as-is into every environment.</b>
          <ol>
            <li><b>Start</b>: "Start work on issue…" creates the branch from <code>{{ baseEnv()?.branch }}</code>{{ store.org()?.tracker?.stateOnStart ? ' (tracker → ' + store.org()!.tracker.stateOnStart + ')' : '' }}.</li>
            @for (e of envs(); track e.id; let i = $index; let first = $first) {
              <li><b>{{ e.name || e.branch }}</b> (<code>{{ e.branch }}</code>):
                @if (e.strategy === 'feature-pr') { tab <i>To {{ e.name || e.branch }}</i>: tick items and "Open pull requests" opens one PR per feature branch into <code>{{ e.branch }}</code>. Merge with a merge commit (no squash). Resolve conflicts once; rerere replays them later. }
                @else if (e.strategy === 'release-branch') { tab <i>To {{ e.name || e.branch }}</i>: tick approved items and "Create release branch". PakGit cuts <code>{{ cfg()?.releasePrefix }}…</code> from <code>{{ e.branch }}</code>, merges only those branches into it, pushes, and opens the pull request into <code>{{ e.branch }}</code>. Merge the PR on your hosting provider{{ cfg()?.backMerge ? ', then "Sync environments" opens the back-merge PRs' : '' }}. }
                @else { tab <i>To {{ e.name || e.branch }}</i>: tick items and "Merge into {{ e.branch }}" merges the feature branches directly (no pull request). }
                {{ e.trackerState ? '(tracker → ' + e.trackerState + ')' : '' }}
              </li>
            }
            <li><b>Hotfix</b>: branch from <code>{{ baseEnv()?.branch }}</code>, merge into <code>{{ lastEnv()?.branch }}</code>, then "Sync environments".</li>
          </ol>
          <span class="muted">Full process: docs/WORKFLOW.md in the PakGit repository. Environments, branches and strategies are configurable per repository.</span>
        </div>
      }

      @if (pending(); as p) {
        <div class="state-banner">
          Promotion paused on <span class="mono">{{ p.branch }}</span>: {{ p.remaining.length }} item(s) left to merge into it.
          <span style="flex:1"></span>
          <button class="btn small primary" [disabled]="busy() || mergeInProgress()" (click)="continuePending()" [title]="mergeInProgress() ? 'Finish the merge in the Files panel first' : ''">Continue</button>
          <button class="btn small" [disabled]="busy()" (click)="finishPending()" title="Skip the remaining items: push the branch and open the pull request now">Finish without them</button>
          <button class="btn small ghost" (click)="pending.set(null)">Dismiss</button>
        </div>
      }
      @if (!store.release() && store.releaseLoading()) { <div class="empty"><span class="spinner"></span> Analysing branches…</div> }
      @else if (store.release(); as r) {
        @for (e of envs(); track e.id) { @if (!r.refs[e.id]) { <div class="state-banner">Branch "{{ e.branch }}" for {{ e.name || e.id }} was not found. Fetch, or fix it under Configure.</div> } }
        <pg-split dir="h" [initial]="860" storageKey="release-main" [min]="420" [minSecond]="240">
          <pg-panel first [title]="'Release planning'">
            <ng-container actions>
              @for (e of envs(); track e.id) { <button class="btn small" [class.active]="tab() === e.id" (click)="tab.set(e.id)">To {{ e.name || e.branch }} <span class="badge">{{ counts()[e.id] }}</span></button> }
              <button class="btn small" [class.active]="tab() === 'unreleased'" (click)="tab.set('unreleased')">All unreleased <span class="badge">{{ counts()['unreleased'] }}</span></button>
              <button class="btn small" [class.active]="tab() === 'released'" (click)="tab.set('released')">Released</button>
              <button class="btn small" [class.active]="tab() === 'archived'" (click)="tab.set('archived')">Archived <span class="badge">{{ counts()['archived'] }}</span></button>
            </ng-container>
            <div class="filter-bar">
              <input class="filter-input" placeholder="Filter by issue, title, branch…" [value]="filter()" (input)="filter.set($any($event.target).value)" />
              <select (change)="statusFilter.set($any($event.target).value)" title="Linear status">
                <option value="" [selected]="!statusFilter()">Any status</option>
                @for (st of statuses(); track st) { <option [value]="st" [selected]="statusFilter() === st">{{ st }}</option> }
                <option value="__none" [selected]="statusFilter() === '__none'">No Linear issue</option>
              </select>
              <select (change)="sinceDays.set(+$any($event.target).value)" title="Updated within">
                <option value="0" [selected]="sinceDays() === 0">Any time</option><option value="7" [selected]="sinceDays() === 7">Last 7 days</option><option value="30" [selected]="sinceDays() === 30">Last 30 days</option><option value="90" [selected]="sinceDays() === 90">Last 90 days</option>
              </select>
              <input type="date" [value]="sinceDate()" (change)="sinceDate.set($any($event.target).value)" title="Updated since this date" />
              <label title="Hide branches that were cut from dev/stage"><input type="checkbox" [checked]="hideDevBased()" (change)="hideDevBased.set($any($event.target).checked)" />Hide dev-based</label>
              @if (filterActive()) { <button class="btn small ghost" (click)="clearFilters()">Clear</button> }
            </div>
            <div class="log release-table">
              <table>
                <colgroup><col style="width:28px" /><col /><col style="width:170px" />@for (e of envs(); track e.id) { <col style="width:52px" /> }<col style="width:60px" /><col style="width:80px" /></colgroup>
                <thead><tr>
                  <th><input type="checkbox" [checked]="allChecked()" (change)="toggleAll($any($event.target).checked)" title="Select all" /></th>
                  <th>Issue / work item</th><th>Branch</th>@for (e of envs(); track e.id) { <th [title]="'On ' + e.branch">{{ shortName(e) }}</th> }<th [title]="'Own commits of the branch not yet on ' + lastEnv()?.branch">Own</th><th>Updated</th>
                </tr></thead>
                <tbody>
                  @for (it of visible(); track it.id) {
                    <tr [class.selected]="selected()?.id === it.id" (click)="selected.set(it)" (contextmenu)="rowMenu($event, it)">
                      <td><input type="checkbox" [checked]="checked().has(it.id)" (click)="$event.stopPropagation()" (change)="toggle(it.id, $any($event.target).checked)" /></td>
                      <td [title]="it.issue?.title ?? it.name">
                        @if (it.issueKey) { <span class="ref-pill issue">{{ it.issueKey }}</span> }
                        @if (it.issue) { <span class="status-pill" [class]="'status-pill ' + it.issue.statusType" style="margin:0 6px 0 0">{{ it.issue.status }}</span> }
                        {{ it.issue?.title ?? it.name }}
                        @if (it.needsCherryPick) { <span class="status-pill unknown" title="No branch left for this work; promotion will cherry-pick its commits">cherry-pick</span> }
                        @if (it.basedOnEnv) { <span class="status-pill canceled" title="This branch was cut from dev/stage, so it carries other unreleased work. Promoting it alone is not possible; recreate it from main (git rebase --onto main) before promoting.">branched from dev</span> }
                      </td>
                      <td [title]="branchTitle(it)"><span class="mono" style="font-size:11px">{{ it.branches[0]?.name ?? '—' }}</span>@if (it.branches.length > 1) { <span class="muted"> +{{ it.branches.length - 1 }}</span> }</td>
                      @for (e of envs(); track e.id) { <td class="env" [class.manual]="e.id in it.overrides" [title]="e.id in it.overrides ? 'Set manually (right-click ▸ Fix tracking)' : ''">{{ it.inEnv[e.id] ? '✓' : (e.id in it.overrides ? '✗' : '') }}{{ e.id in it.overrides ? '*' : '' }}</td> }
                      <td class="muted">{{ it.commitsAheadOfProd ?? it.commits.length }}</td>
                      <td class="muted">{{ it.lastActivity ? (it.lastActivity | timeAgo) : '' }}</td>
                    </tr>
                  } @empty { <tr><td colspan="8"><div class="empty">{{ emptyText() }}</div></td></tr> }
                </tbody>
              </table>
            </div>
            <div class="release-actions">
              <label title="Sync environments and direct merges push what they create (sync branches or the environment branch). Promote selected… has its own push option."><input type="checkbox" [checked]="push()" (change)="push.set($any($event.target).checked)" />Push (sync &amp; direct merges)</label>
              <label [title]="trackerOk() ? 'After a promotion, move the Linear issue of each item to the state configured for that environment (Configure)' : 'Connect Linear in Settings'"><input type="checkbox" [checked]="updateTracker()" [disabled]="!trackerOk()" (change)="updateTracker.set($any($event.target).checked)" />Update Linear status on promote</label>
              <span style="flex:1"></span>
              <span class="muted">{{ checked().size }} selected</span>
              @if (tab() === 'archived') {
                <button class="btn" [disabled]="!checked().size || busy()" (click)="archive(false)">Unarchive selected</button>
              } @else {
                <button class="btn primary" [disabled]="!checked().size || busy()" (click)="promoteSelected()" title="Merge the selected items into one branch, then open the pull request">Promote selected…</button>
                @if (tabEnv()?.strategy === 'merge') { <button class="btn" [disabled]="!checked().size || busy()" (click)="promote(tabEnv()!)">Merge directly into {{ tabEnv()!.branch }}</button> }
                <button class="btn" [disabled]="!checked().size || busy()" (click)="archive(true)">Archive selected</button>
              }
              <button class="btn" [disabled]="busy()" (click)="openPrDialog()" title="Open a pull request from any branch into an environment">Open pull request…</button>
              @if (hasDirectMergeEnv()) { <button class="btn" [disabled]="busy() || !r.releaseBranches.length" (click)="finishRelease()" title="Direct-merge environments only: merge a release branch into its environment, tag it, back-merge into the earlier environments">Finish release…</button> }
              <button class="btn" [disabled]="busy() || envs().length < 2" (click)="sync()" [title]="'Back-merge ' + chainText() + ' (pull requests, or direct merges for direct-merge environments)'">Sync environments</button>
              <button class="btn" [disabled]="busy()" (click)="startIssue()" [title]="'Create a branch for an issue from ' + baseEnv()?.branch"><pg-icon name="branch" [size]="14" />Start work on issue…</button>
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
                  <div class="group-header">Commits not on {{ lastEnv()?.branch }}<span class="count">{{ it.commits.length }}</span></div>
                  <ul class="list">
                    @for (c of it.commits; track c.sha) { <li class="row" [title]="c.sha" (dblclick)="store.perspective.set('log'); store.selectCommit(c.sha)"><span class="mono muted">{{ c.shortSha }}</span><span class="grow">{{ c.subject }}</span></li> }
                  </ul>
                }
              </div>
            } @else { <div class="empty">Select a work item to see its branches and commits.</div> }
          </pg-panel>
        </pg-split>
      } @else { <div class="empty">Open a repository to plan a release.</div> }

      @if (showConfig()) { <pg-env-config-dialog [initial]="cfg()" (closed)="showConfig.set(false)" (saved)="configSaved($event)" /> }
      @if (promoteItems(); as pi) { <pg-promote-dialog [items]="pi" [envs]="envs()" [initialEnv]="promoteEnvId()" [branchNames]="allBranchNames()" [releasePrefix]="cfg()?.releasePrefix ?? 'release/'" [releasePattern]="store.org()?.conventions?.releasePattern ?? 'release/{env}-{week}'" [cfgRemote]="cfg()?.remote ?? 'origin'" (closed)="promoteItems.set(null)" (submitted)="runPromote($event)" /> }

      @if (issuePicker(); as issues) {
        <div class="modal-backdrop" (mousedown)="issuePicker.set(null)">
          <div class="modal wide" (mousedown)="$event.stopPropagation()">
            <h2>Start work on issue</h2>
            <p class="modal-message">Creates a branch from {{ cfg()?.remote }}/{{ baseEnv()?.branch }} using Linear's branch name{{ updateTracker() ? ', and moves the issue to "' + (store.org()?.tracker?.stateOnStart ?? 'In Progress') + '"' : '' }}.</p>
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
  readonly tab = signal<Tab>('unreleased')
  readonly showConfig = signal(false)
  readonly statusFilter = signal('')
  readonly sinceDays = signal(0)
  readonly sinceDate = signal('')
  readonly hideDevBased = signal(false)
  readonly pending = signal<PendingPromotion | null>(null)
  readonly promoteItems = signal<ReleaseItem[] | null>(null)
  readonly promoteEnvId = signal('')
  private readonly cm = inject(ContextMenuService)
  readonly statuses = computed(() => [...new Set(this.items().map((i) => i.issue?.status).filter((x): x is string => !!x))].sort())
  readonly filterActive = computed(() => !!(this.filter() || this.statusFilter() || this.sinceDays() || this.sinceDate() || this.hideDevBased()))
  readonly mergeInProgress = computed(() => { const st = this.store.status()?.state; return !!st && st !== 'clean' })
  readonly allBranchNames = computed(() => { const r = this.store.refs(); const names = new Set<string>(); for (const b of r?.branches ?? []) names.add(b.name); return [...names].sort() })
  clearFilters(): void { this.filter.set(''); this.statusFilter.set(''); this.sinceDays.set(0); this.sinceDate.set(''); this.hideDevBased.set(false) }
  readonly filter = signal('')
  readonly checked = signal<Set<string>>(new Set())
  readonly selected = signal<ReleaseItem | null>(null)
  /** remembered across views and restarts */
  readonly push = signal<boolean>(LS.get('release.push', true))
  readonly updateTracker = signal<boolean>(LS.get('release.updateTracker', true))
  readonly showHelp = signal(false)
  readonly busy = signal(false)
  readonly issuePicker = signal<TrackerIssue[] | null>(null)
  readonly issueFilter = signal('')
  readonly pickedIssue = signal<TrackerIssue | null>(null)
  readonly cfg = computed<EnvConfig | null>(() => this.store.release()?.config ?? null)
  readonly envs = computed<Environment[]>(() => this.cfg()?.environments ?? [])
  readonly lastEnv = computed<Environment | null>(() => this.envs()[this.envs().length - 1] ?? null)
  readonly baseEnv = computed<Environment | null>(() => { const c = this.cfg(); return c ? c.environments.find((e) => e.id === c.baseEnv) ?? this.lastEnv() : null })
  readonly tabEnv = computed<Environment | null>(() => this.envs().find((e) => e.id === this.tab()) ?? null)
  readonly hasDirectMergeEnv = computed(() => this.envs().some((e) => e.strategy === 'merge'))
  shortName(e: Environment): string { return e.branch.length <= 8 ? e.branch : e.branch.slice(0, 7) + '…' }
  chainText(): string { return [...this.envs()].reverse().map((e) => e.branch).join(' → ') }
  /** ready for environment i: in environment i-1 (or anywhere, for the first) and not in i or any later one */
  private readyFor(it: ReleaseItem, i: number): boolean {
    const envs = this.envs()
    if (envs.slice(i).some((e) => it.inEnv[e.id])) return false
    return i === 0 ? true : it.inEnv[envs[i - 1].id]
  }
  private isReleased(it: ReleaseItem): boolean { const l = this.lastEnv(); return !!l && it.inEnv[l.id] }
  configSaved(c: EnvConfig): void { this.showConfig.set(false); this.store.toast('success', `Pipeline: ${c.environments.map((e) => e.branch).join(' → ')}`); void this.store.analyzeRelease() }
  readonly trackerOk = computed(() => { const t = this.store.trackerStatus(); return !!t && t.configured && !t.error })

  constructor() {
    effect(() => LS.set('release.push', this.push()))
    effect(() => LS.set('release.updateTracker', this.updateTracker()))
    effect(() => { if (this.store.repo() && !this.store.release() && !this.store.releaseLoading()) void this.store.analyzeRelease() })
    // default tab: the first environment after the first one that has candidates, else 'unreleased'
    effect(() => { const envs = this.envs(); if (envs.length >= 2 && !envs.some((e) => e.id === this.tab()) && this.tab() === 'unreleased' && this.store.release()) this.tab.set(envs[1].id) })
    void this.store.refreshTracker()
  }

  private items(): ReleaseItem[] { return this.store.release()?.items ?? [] }
  readonly counts = computed<Record<string, number>>(() => {
    const all = this.items(); const it = all.filter((i) => !i.archived)
    const out: Record<string, number> = { unreleased: it.filter((i) => !this.isReleased(i)).length, archived: all.filter((i) => i.archived).length }
    this.envs().forEach((e, i) => { out[e.id] = it.filter((x) => this.readyFor(x, i)).length })
    return out
  })
  readonly visible = computed(() => {
    const q = this.filter().toLowerCase(); const tab = this.tab(); const envIdx = this.envs().findIndex((e) => e.id === tab)
    const status = this.statusFilter(); const days = this.sinceDays(); const since = this.sinceDate() ? new Date(this.sinceDate()).getTime() : 0
    const cutoff = Math.max(days ? Date.now() - days * 86400000 : 0, since)
    return this.items().filter((i) => {
      if (tab === 'archived') { if (!i.archived) return false } else if (i.archived) return false
      if (envIdx >= 0) { if (!this.readyFor(i, envIdx)) return false }
      else if (tab === 'unreleased') { if (this.isReleased(i)) return false }
      else if (tab === 'released') { if (!this.isReleased(i)) return false }
      if (status === '__none' ? !!i.issue : status && i.issue?.status !== status) return false
      if (cutoff && (!i.lastActivity || new Date(i.lastActivity).getTime() < cutoff)) return false
      if (this.hideDevBased() && i.basedOnEnv) return false
      return !q || [i.issueKey, i.name, i.issue?.title, i.issue?.status, ...i.branches.map((b) => b.name)].join(' ').toLowerCase().includes(q)
    })
  })
  emptyText(): string {
    const te = this.tabEnv(); const envs = this.envs(); const i = te ? envs.indexOf(te) : -1
    if (te) return i === 0 ? `Nothing waiting for ${te.branch}.` : `Nothing in ${envs[i - 1].branch} that is missing from ${te.branch}.`
    return this.tab() === 'unreleased' ? 'Everything is released.' : this.tab() === 'archived' ? 'No archived items.' : 'Nothing released yet.'
  }
  readonly allChecked = computed(() => this.visible().length > 0 && this.visible().every((i) => this.checked().has(i.id)))
  toggle(id: string, on: boolean): void { const n = new Set(this.checked()); on ? n.add(id) : n.delete(id); this.checked.set(n) }
  toggleAll(on: boolean): void { const n = new Set(this.checked()); for (const i of this.visible()) on ? n.add(i.id) : n.delete(i.id); this.checked.set(n) }
  branchTitle(it: ReleaseItem): string { return it.branches.map((b) => b.ref).join('\n') }
  envList(it: ReleaseItem): string { return this.envs().filter((e) => it.inEnv[e.id]).map((e) => e.branch).join(', ') || 'not merged anywhere' }
  open(url: string): void { window.open(url) }

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
      this.store.toast('success', res.message + (res.prUrls?.length ? `\nOpened ${res.prUrls.length} pull request page(s) in your browser.` : ''))
      if (state && this.updateTracker() && this.trackerOk()) {
        for (const it of items) if (it.issueKey && res.merged.includes(it.id)) await this.store.api.trackerSetState(it.issueKey, state).catch((e) => this.store.toast('error', `Linear ${it.issueKey}: ${e instanceof Error ? e.message : String(e)}`))
      }
    }
    this.checked.set(new Set())
    await this.store.refresh(); await this.store.analyzeRelease()
  }
  rowMenu(e: MouseEvent, it: ReleaseItem): void {
    if (!this.checked().has(it.id)) this.selected.set(it)
    const envs = this.envs()
    this.cm.open(e, [
      { label: 'Promote…', onClick: () => { if (!this.checked().has(it.id)) this.toggle(it.id, true); void this.promoteSelected() } },
      { label: 'Fix tracking… (which environments it is on)', onClick: () => void this.fixTracking(it) },
      ...(Object.keys(it.overrides).length ? [{ label: 'Reset tracking to detected', onClick: () => void this.resetTracking(it) }] : []),
      { separator: true, label: '' },
      ...(it.issue ? [{ label: `Open ${it.issue.key} in Linear`, onClick: () => this.open(it.issue!.url) }] : []),
      ...(it.branches.length ? [{ label: 'Copy branch name', onClick: () => void navigator.clipboard.writeText(it.branches[0].name) }] : []),
      { separator: true, label: '' },
      { label: it.archived ? 'Unarchive' : 'Archive', onClick: () => void this.archiveItems([it], !it.archived) },
      ...(envs.length ? [] : [])
    ])
  }
  async archive(archived: boolean): Promise<void> { await this.archiveItems(this.selectedItems(), archived) }
  private async archiveItems(items: ReleaseItem[], archived: boolean): Promise<void> {
    const r = this.store.repo(); if (!r || !items.length) return
    await this.store.api.setArchived(r.path, items.map((i) => i.id), archived)
    this.store.toast('success', `${archived ? 'Archived' : 'Unarchived'} ${items.length} item(s)`)
    this.checked.set(new Set()); await this.store.analyzeRelease()
  }
  async fixTracking(it: ReleaseItem): Promise<void> {
    const r = this.store.repo(); if (!r) return
    const v = await this.store.prompt({ title: `Fix tracking for ${it.issueKey ?? it.name}`, okLabel: 'Save', message: 'Tick the environments this work is really on. Use this when it was merged in a way git cannot trace (squash, cherry-pick, re-done branch). PakGit remembers the correction.', fields: this.envs().map((e) => ({ key: e.id, label: `${e.name || e.branch} (${e.branch})`, type: 'checkbox' as const, value: String(it.inEnv[e.id]) })) })
    if (!v) return
    const overrides: Record<string, boolean> = {}
    for (const e of this.envs()) overrides[e.id] = !!v[e.id]
    await this.store.api.setOverrides(r.path, it.id, overrides)
    await this.store.analyzeRelease()
  }
  async resetTracking(it: ReleaseItem): Promise<void> { const r = this.store.repo(); if (!r) return; await this.store.api.setOverrides(r.path, it.id, null); await this.store.analyzeRelease() }

  promoteSelected(): void {
    const items = this.selectedItems(); if (!items.length) return
    const te = this.tabEnv(); const envs = this.envs()
    // default target: the tab's environment, else the first environment the first item is not on
    const def = te ?? envs.find((e) => !items[0].inEnv[e.id]) ?? envs[envs.length - 1]
    this.promoteEnvId.set(def?.id ?? ''); this.promoteItems.set(items)
  }
  async runPromote(req: PromoteRequest, remaining?: PendingPromotion): Promise<void> {
    const r = this.store.repo(); if (!r) return
    const items = remaining ? this.items().filter((i) => remaining.remaining.some((x) => x.id === i.id)) : (this.promoteItems() ?? [])
    const inputs = remaining ? remaining.remaining : items.map((i) => this.toInput(i))
    this.promoteItems.set(null); this.busy.set(true)
    try {
      const res = await this.store.api.prepareBranch(r.path, req.env.id, req.target, inputs, req.options)
      if (res.conflict) {
        this.pending.set({ envId: req.env.id, branch: res.branch!, remaining: res.remaining ?? [], options: req.options })
        this.store.toast('error', res.message); this.store.perspective.set('standard')
        await this.store.refresh(); return
      }
      this.pending.set(null)
      await this.afterOp(res, items, req.env.trackerState || undefined)
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async continuePending(): Promise<void> {
    const p = this.pending(); const env = this.envs().find((e) => e.id === p?.envId); if (!p || !env) return
    await this.runPromote({ env, target: { name: p.branch, existing: true }, options: p.options }, p)
  }
  async finishPending(): Promise<void> {
    const p = this.pending(); const env = this.envs().find((e) => e.id === p?.envId); if (!p || !env) return
    await this.runPromote({ env, target: { name: p.branch, existing: true }, options: p.options }, { ...p, remaining: [] })
  }
  async openPrDialog(): Promise<void> {
    const r = this.store.repo(); const rel = this.store.release(); if (!r || !rel) return
    const envs = this.envs()
    const head = rel.currentBranch && rel.currentBranch !== 'HEAD' ? rel.currentBranch : ''
    const names = this.allBranchNames()
    const v = await this.store.prompt({ title: 'Open pull request', okLabel: 'Open', fields: [
      { key: 'head', label: 'From branch', type: 'select', options: head ? [head, ...names.filter((n) => n !== head)] : names },
      { key: 'env', label: 'Into environment', type: 'select', options: envs.map((e) => `${e.name || e.branch} (${e.branch})`) },
      { key: 'title', label: 'Title', placeholder: 'optional' }
    ] })
    if (!v || !v.head) return
    const env = envs[envs.findIndex((e) => `${e.name || e.branch} (${e.branch})` === String(v.env))] ?? envs[envs.length - 1]
    try {
      const pr = await this.store.api.openPullRequest(r.path, String(v.head), env.branch, String(v.title || `${v.head} → ${env.branch}`), 'Created by PakGit.')
      this.store.toast('success', `Opened the pull request page: ${pr.head} → ${pr.base}`)
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  async promote(env: Environment): Promise<void> {
    const r = this.store.repo(); const items = this.selectedItems(); if (!r || !items.length) return
    const ok = await this.store.prompt({ title: `Merge into ${env.branch}`, okLabel: 'Merge', message: `Merge ${items.length} item(s) into ${env.branch} (${env.name}):\n${items.map((i) => '• ' + (i.issueKey ?? i.name)).join('\n')}\n\nEach feature branch is merged with its own merge commit${this.push() ? ', then pushed' : ''}.` })
    if (!ok) return
    this.busy.set(true)
    try {
      const res = await this.store.api.promote(r.path, env.id, items.map((i) => this.toInput(i)), this.push())
      await this.afterOp(res, items, env.trackerState || undefined)
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async createRelease(env: Environment): Promise<void> {
    const r = this.store.repo(); const items = this.selectedItems(); const c = this.cfg(); if (!r || !items.length || !c) return
    const v = await this.store.prompt({ title: `Create release branch for ${env.name || env.branch}`, okLabel: 'Create', message: `Cuts a branch from ${c.remote}/${env.branch}, merges ${items.length} item(s) into it${this.push() ? ', pushes it and opens the pull request into ' + env.branch : ''}:\n${items.map((i) => '• ' + (i.issueKey ?? i.name)).join('\n')}`, fields: [{ key: 'name', label: 'Release branch name', value: `${env.branch}-${isoWeek()}` }] })
    if (!v || !v.name) return
    this.busy.set(true)
    try {
      const res = await this.store.api.startRelease(r.path, env.id, String(v.name), items.map((i) => this.toInput(i)), this.push())
      await this.afterOp(res, items, undefined)
      if (!res.conflict && !this.push()) this.store.toast('info', `Push ${res.branch} and open a pull request into ${env.branch} when ready.`)
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async openFeaturePRs(env: Environment): Promise<void> {
    const r = this.store.repo(); const items = this.selectedItems(); if (!r || !items.length) return
    const withBranch = items.filter((i) => i.branches.length)
    const ok = await this.store.prompt({ title: `Pull requests into ${env.branch}`, okLabel: 'Open', message: `Opens one pull request page per feature branch (${withBranch.length}):\n${withBranch.map((i) => '• ' + (i.issueKey ?? i.name) + ' ← ' + i.branches[0].name).join('\n')}${items.length !== withBranch.length ? `\n\n${items.length - withBranch.length} item(s) have no branch and will be skipped.` : ''}` })
    if (!ok) return
    this.busy.set(true)
    try { await this.afterOp(await this.store.api.openFeaturePRs(r.path, env.id, withBranch.map((i) => this.toInput(i))), withBranch, env.trackerState || undefined) }
    catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async finishRelease(): Promise<void> {
    const r = this.store.repo(); const rel = this.store.release(); if (!r || !rel) return
    const targets = this.envs().filter((e) => e.strategy === 'merge')
    const envOptions = (targets.length ? targets : this.envs()).map((e) => `${e.name || e.branch} (${e.branch})`)
    const v = await this.store.prompt({ title: 'Finish release', okLabel: 'Finish', message: `Merges the release branch into the chosen environment, tags it${rel.config.backMerge ? ', then back-merges into the earlier environments' : ''}${this.push() ? ' and pushes' : ''}.`, fields: [
      { key: 'branch', label: 'Release branch', type: 'select', options: rel.releaseBranches.map((b) => b.ref) },
      { key: 'env', label: 'Into environment', type: 'select', options: envOptions },
      { key: 'tag', label: 'Tag (optional)', value: `v${isoWeek().replace('-W', '.')}` }
    ] })
    if (!v || !v.branch) return
    const env = (targets.length ? targets : this.envs())[envOptions.indexOf(String(v.env))] ?? this.lastEnv()!
    this.busy.set(true)
    try {
      const res = await this.store.api.finishRelease(r.path, env.id, String(v.branch), String(v.tag || '') || null, this.push())
      const idx = this.envs().indexOf(env)
      const landed = this.items().filter((i) => idx > 0 && i.inEnv[this.envs()[idx - 1].id] && !i.inEnv[env.id])
      await this.afterOp(res, landed, env.trackerState || undefined)
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
    const res = await this.store.run('Start work', () => this.store.api.startIssue(r.path, key ?? '', branch), { success: `Created ${branch} from ${this.cfg()?.remote}/${this.baseEnv()?.branch}` })
    if (res !== undefined && key && this.updateTracker() && this.trackerOk()) {
      const state = this.store.org()?.tracker.stateOnStart
      if (state) await this.store.api.trackerSetState(key, state).catch((e) => this.store.toast('error', `Linear: ${e instanceof Error ? e.message : String(e)}`))
    }
    this.store.perspective.set('standard')
  }
}
