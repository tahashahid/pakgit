import { Component, computed, effect, inject } from '@angular/core'
import { Store } from '../store.service'
import { Icon } from '../ui/icon'
import { OrgOverview } from './org-overview'
import { OrgWork } from './org-work'
import { OrgReady } from './org-ready'
import { OrgReleases } from './org-releases'
import { ReleaseDialog } from './release-dialog'
import { ConfigDiffDialog } from './config-diff-dialog'
import { CleanupDialog } from './cleanup-dialog'
import type { Freeze, ReleaseRecord } from '@shared/types'

/** Organization perspective: header with the tabs (Overview · Work · Ready) and the group chips. */
@Component({
  selector: 'pg-organization',
  imports: [Icon, OrgOverview, OrgWork, OrgReady, OrgReleases, ReleaseDialog, ConfigDiffDialog, CleanupDialog],
  template: `
    <div class="org-view">
      <div class="org-header">
        <h2><span class="org-dot" [style.background]="store.org()?.color ?? '#888'"></span>{{ store.org()?.name ?? 'Personal' }}</h2>
        <div class="seg org-tabs">
          <button class="btn small" [class.active]="store.orgTab() === 'overview'" (click)="store.orgTab.set('overview')">Overview</button>
          <button class="btn small" [class.active]="store.orgTab() === 'work'" (click)="store.orgTab.set('work')" title="Issues from the tracker across every repository">Work</button>
          <button class="btn small" [class.active]="store.orgTab() === 'ready'" (click)="store.orgTab.set('ready')" title="Everything waiting for an environment, in one table">Ready @if (readyTotal() !== null) { <span class="badge">{{ readyTotal() }}</span> }</button>
          <button class="btn small" [class.active]="store.orgTab() === 'releases'" (click)="store.orgTab.set('releases')" title="Named releases across repositories: branches, pull requests, finish">Releases @if (store.inProgressReleases()) { <span class="badge">{{ store.inProgressReleases() }}</span> }</button>
        </div>
        @if (store.groups().length) {
          <div class="chips">
            <button class="chip" [class.active]="!store.orgGroup()" (click)="store.orgGroup.set(null)">All</button>
            @for (g of store.groups(); track g) { <button class="chip" [class.active]="store.orgGroup() === g" (click)="store.orgGroup.set(store.orgGroup() === g ? null : g)">{{ g }}</button> }
          </div>
        }
        <span class="muted">{{ store.repos().length }} repositories</span>
        @if (store.trackerStatus(); as ts) {
          @if (ts.configured && !ts.error) { <span class="chip ok" [title]="ts.account">Linear ✓</span> }
          @else if (ts.error) { <span class="chip bad" [title]="ts.error">Linear: error</span> }
          @else if (ts.provider !== 'none') { <button class="btn small ghost" (click)="store.showOrgConfig.set('integrations')">Linear: sign in</button> }
        }
        @if (store.hostingStatus(); as hs) {
          @if (hs.available) { <span class="chip ok" [title]="'Pull requests through ' + (hs.via === 'gh' ? 'the gh CLI' : 'a token') + (hs.account ? ' as ' + hs.account : '')">GitHub ✓</span> }
          @else if (hs.provider !== 'none') { <button class="btn small ghost" (click)="store.showOrgConfig.set('integrations')" [title]="hs.error ?? ''">GitHub: not connected</button> }
        }
        @if (store.indexLoading() || store.overviewLoading()) { <span class="busy" title="Analysing repositories"><span class="spinner"></span></span> }
        <span style="flex:1"></span>
        <button class="btn small" (click)="fetchAll()" [disabled]="store.busy() !== null" title="Fetch every repository, then re-analyse"><pg-icon name="fetch" [size]="14" />Fetch all</button>
        <button class="btn small" (click)="refresh()" [disabled]="store.indexLoading()" title="Re-analyse every repository (bypasses the cache) and reload tracker data"><pg-icon name="refresh" [size]="14" /></button>
        <button class="btn small" (click)="store.showQuickOpen.set(true)" title="Quick open (Cmd/Ctrl+K)"><pg-icon name="search" [size]="14" /></button>
        <button class="btn small" (click)="store.showCleanup.set(true)" title="Delete remote branches already merged into the last environment">Clean up…</button>
        <button class="btn small" (click)="store.showOrgConfig.set('general')" title="Organization settings; New organization… is in the organization switcher"><pg-icon name="gear" [size]="14" />Configure…</button>
      </div>
      @if (store.configSync(); as cs) {
        @if (cs.changed && store.configDismissed() !== cs.remote) {
          <div class="state-banner config"><span>⇅ The shared configuration changed: {{ cs.changes.length }} setting(s) differ from this organization.</span><span style="flex:1"></span><button class="btn small primary" (click)="store.showConfigDiff.set(true)">Review…</button><button class="btn small ghost" (click)="store.configDismissed.set(cs.remote)">Later</button></div>
        }
      }
      @for (f of freezes(); track f.envId) {
        <div class="state-banner freeze"><span>❄ {{ f.envName }} is frozen{{ f.note ? ': ' + f.note : '' }}{{ f.until ? ' (until ' + f.until + ')' : '' }}. Promotions into it are blocked by the freeze gate.</span><span style="flex:1"></span><button class="btn small" (click)="lift(f.envId)">Lift</button></div>
      }
      @switch (store.orgTab()) {
        @case ('work') { <pg-org-work /> }
        @case ('ready') { <pg-org-ready /> }
        @case ('releases') { <pg-org-releases /> }
        @default { <pg-org-overview /> }
      }
      @if (store.releaseDraft(); as sel) { <pg-release-dialog [selection]="sel" [initialEnv]="store.readyTab()" (closed)="store.releaseDraft.set(null)" (created)="created($event)" /> }
      <pg-config-diff-dialog />
      <pg-cleanup-dialog />
    </div>`
})
export class OrganizationView {
  readonly store = inject(Store)
  readonly readyTotal = computed(() => { const ov = this.store.overview(); return ov ? ov.totals.ready.reduce((n, r) => n + r.count, 0) : null })
  /** active freezes with the environment name from the template or the index */
  readonly freezes = computed(() => {
    const org = this.store.org(); if (!org) return []
    const envs = this.store.index()?.environments ?? org.pipeline?.environments ?? []
    const active = (f: Freeze): boolean => !f.until || Date.now() <= new Date(f.until + 'T23:59:59').getTime()
    return Object.entries(org.freezes ?? {}).filter(([, f]) => active(f)).map(([envId, f]) => ({ envId, envName: envs.find((e) => e.id === envId)?.name || envId, note: f.note, until: f.until }))
  })
  constructor() {
    const s = this.store
    effect(() => { if (s.perspective() === 'organization' && s.workspace() && !s.index() && !s.indexLoading() && !s.indexError()) void s.loadIndex() })
    effect(() => { if (s.perspective() === 'organization' && s.workspace() && !s.overview() && !s.overviewLoading() && !s.overviewError()) void s.loadOverview() })
    effect(() => { if (s.perspective() === 'organization' && s.workspace() && !s.hostingStatus()) void s.refreshHosting() })
    effect(() => { if (s.perspective() === 'organization' && s.workspace() && !s.releases().length && !s.releasesLoading()) void s.loadReleases() })
    effect(() => { if (s.perspective() === 'organization' && s.org() && !s.configSync() && !s.configSyncLoading()) void s.loadConfigSync() })
    effect(() => { const o = s.org(); if (o && s.perspective() === 'organization') void s.loadNextReleases() })
    void s.refreshTracker()
  }
  async lift(envId: string): Promise<void> {
    try { this.store.org.set(await this.store.api.orgSetFreeze(this.store.activeOrgId(), envId, null)); this.store.toast('success', 'Freeze lifted') } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) }
  }
  created(rec: ReleaseRecord): void {
    this.store.releaseDraft.set(null)
    const paused = rec.repos.filter((r) => r.paused).length, errors = rec.repos.filter((r) => r.error).length
    this.store.toast(paused || errors ? 'error' : 'success', `${rec.name}: ${rec.repos.length} repositor${rec.repos.length === 1 ? 'y' : 'ies'}${paused ? `, ${paused} paused on a conflict` : ''}${errors ? `, ${errors} with errors` : ''}`)
    this.store.releaseFocus.set(rec.id); this.store.orgTab.set('releases')
    void this.store.afterRelease()
  }
  async fetchAll(): Promise<void> {
    const repos = this.store.repos()
    await this.store.run(`Fetch ${repos.length} repositories`, async () => { for (const r of repos) await this.store.api.fetch(r.path, undefined, true).catch(() => undefined) }, { success: 'Fetched all repositories' })
    this.refresh()
  }
  refresh(): void { void this.store.loadIndex(true); void this.store.loadOverview(true) }
}
