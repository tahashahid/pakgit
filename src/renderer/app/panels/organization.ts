import { Component, computed, effect, inject } from '@angular/core'
import { Store } from '../store.service'
import { Icon } from '../ui/icon'
import { OrgOverview } from './org-overview'
import { OrgWork } from './org-work'
import { OrgReady } from './org-ready'

/** Organization perspective: header with the tabs (Overview · Work · Ready) and the group chips. */
@Component({
  selector: 'pg-organization',
  imports: [Icon, OrgOverview, OrgWork, OrgReady],
  template: `
    <div class="org-view">
      <div class="org-header">
        <h2><span class="org-dot" [style.background]="store.org()?.color ?? '#888'"></span>{{ store.org()?.name ?? 'Personal' }}</h2>
        <div class="seg org-tabs">
          <button class="btn small" [class.active]="store.orgTab() === 'overview'" (click)="store.orgTab.set('overview')">Overview</button>
          <button class="btn small" [class.active]="store.orgTab() === 'work'" (click)="store.orgTab.set('work')" title="Issues from the tracker across every repository">Work</button>
          <button class="btn small" [class.active]="store.orgTab() === 'ready'" (click)="store.orgTab.set('ready')" title="Everything waiting for an environment, in one table">Ready @if (readyTotal() !== null) { <span class="badge">{{ readyTotal() }}</span> }</button>
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
        @if (store.indexLoading() || store.overviewLoading()) { <span class="busy" title="Analysing repositories"><span class="spinner"></span></span> }
        <span style="flex:1"></span>
        <button class="btn small" (click)="fetchAll()" [disabled]="store.busy() !== null" title="Fetch every repository, then re-analyse"><pg-icon name="fetch" [size]="14" />Fetch all</button>
        <button class="btn small" (click)="refresh()" [disabled]="store.indexLoading()" title="Re-analyse every repository (bypasses the cache) and reload tracker data"><pg-icon name="refresh" [size]="14" /></button>
        <button class="btn small" (click)="store.showQuickOpen.set(true)" title="Quick open (Cmd/Ctrl+K)"><pg-icon name="search" [size]="14" /></button>
        <button class="btn small" (click)="store.showOrgConfig.set('general')"><pg-icon name="gear" [size]="14" />Configure…</button>
        <button class="btn small ghost" (click)="store.showNewOrg.set(true)">New organization…</button>
      </div>
      @switch (store.orgTab()) {
        @case ('work') { <pg-org-work /> }
        @case ('ready') { <pg-org-ready /> }
        @default { <pg-org-overview /> }
      }
    </div>`
})
export class OrganizationView {
  readonly store = inject(Store)
  readonly readyTotal = computed(() => { const ov = this.store.overview(); return ov ? ov.totals.ready.reduce((n, r) => n + r.count, 0) : null })
  constructor() {
    const s = this.store
    effect(() => { if (s.perspective() === 'organization' && s.workspace() && !s.index() && !s.indexLoading() && !s.indexError()) void s.loadIndex() })
    effect(() => { if (s.perspective() === 'organization' && s.workspace() && !s.overview() && !s.overviewLoading() && !s.overviewError()) void s.loadOverview() })
    void s.refreshTracker()
  }
  async fetchAll(): Promise<void> {
    const repos = this.store.repos()
    await this.store.run(`Fetch ${repos.length} repositories`, async () => { for (const r of repos) await this.store.api.fetch(r.path, undefined, true).catch(() => undefined) }, { success: 'Fetched all repositories' })
    this.refresh()
  }
  refresh(): void { void this.store.loadIndex(true); void this.store.loadOverview(true) }
}
