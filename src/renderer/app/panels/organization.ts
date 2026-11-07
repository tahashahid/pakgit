import { Component, computed, effect, inject } from '@angular/core'
import { Store } from '../store.service'
import { Icon } from '../ui/icon'
import { TimeAgoPipe } from '../ui/time-ago'
import type { RepoOverviewCard } from '@shared/types'

/** Organization perspective, phase 1: overview cards per repository. */
@Component({
  selector: 'pg-organization',
  imports: [Icon, TimeAgoPipe],
  template: `
    <div class="org-view">
      <div class="org-header">
        <h2><span class="org-dot" [style.background]="store.org()?.color ?? '#888'"></span>{{ store.org()?.name ?? 'Personal' }}</h2>
        <span class="muted">{{ store.repos().length }} repositories</span>
        @if (store.trackerStatus(); as ts) {
          @if (ts.configured && !ts.error) { <span class="chip ok" [title]="ts.account">Linear ✓</span> }
          @else if (ts.error) { <span class="chip bad" [title]="ts.error">Linear: error</span> }
        }
        <span style="flex:1"></span>
        <button class="btn small" (click)="fetchAll()" [disabled]="store.busy() !== null" title="Fetch every repository"><pg-icon name="fetch" [size]="14" />Fetch all</button>
        <button class="btn small" (click)="store.loadOverview()" [disabled]="store.overviewLoading()" title="Recompute"><pg-icon name="refresh" [size]="14" /></button>
        <button class="btn small" (click)="store.showOrgConfig.set('general')"><pg-icon name="gear" [size]="14" />Configure…</button>
        <button class="btn small ghost" (click)="store.showNewOrg.set(true)">New organization…</button>
      </div>

      @if (store.overview(); as ov) {
        <div class="org-stats">
          @for (r of ov.totals.ready; track r.id) { <span>→ {{ r.name }}: <b>{{ r.count }}</b></span> }
          <span>unreleased: <b>{{ ov.totals.unreleased }}</b></span>
          @if (ov.totals.warnings) { <span style="color:var(--warning)">⚠ {{ ov.totals.warnings }} warning(s)</span> }
          <span class="muted">computed {{ iso(ov.generatedAt) | timeAgo }}</span>
        </div>
        @for (g of groups(ov.repos); track g.name) {
          @if (g.name) { <div class="org-group-title">{{ g.name }}</div> }
          <div class="cards">
            @for (c of g.cards; track c.repo.path) {
              <div class="card" [class.err]="c.error" (click)="open(c)" [title]="c.repo.path">
                <div class="title"><pg-icon name="folder" [size]="14" />{{ c.repo.name }}@if (c.repo.remote) { <span class="muted mono" style="font-size:11px">{{ shortRemote(c.repo.remote) }}</span> }</div>
                @if (c.error) { <div class="warn">{{ c.error }}</div> }
                @else {
                  <div class="line">
                    <span>on <b>{{ c.detached ? 'detached HEAD' : c.branch }}</b></span>
                    <span>{{ c.changed ? c.changed + ' changed' : 'clean' }}</span>
                    @if (c.ahead || c.behind) { <span>↑{{ c.ahead }} ↓{{ c.behind }}</span> }
                    @if (c.state && c.state !== 'clean') { <span style="color:var(--warning)">{{ c.state }}</span> }
                    <span>{{ c.lastFetch ? 'fetched ' + (iso(c.lastFetch) | timeAgo) : 'never fetched' }}</span>
                  </div>
                  <div class="envs">
                    @for (e of c.environments ?? []; track e.id) { <span [class.hot]="e.ready > 0" [class.missing]="e.missing" [title]="e.missing ? 'Branch ' + e.branch + ' not found' : 'Ready for ' + e.branch">→ {{ e.branch }} {{ e.ready }}</span> }
                  </div>
                  @if (c.drift) { <div class="warn">⚠ {{ c.drift.from }} is {{ c.drift.commits }} commits ahead of {{ c.drift.to }} (sync needed)</div> }
                  @if (c.devBased) { <div class="warn">⚠ {{ c.devBased }} unreleased branch(es) cut from dev</div> }
                  @if (c.staleReleaseBranches?.length) { <div class="warn">⚠ {{ c.staleReleaseBranches!.length }} release branch(es) not merged: {{ c.staleReleaseBranches!.slice(0, 2).join(', ') }}{{ c.staleReleaseBranches!.length > 2 ? '…' : '' }}</div> }
                }
              </div>
            }
          </div>
        }
        @if (!ov.repos.length) { <div class="empty">No repositories in this organization yet. Add some from the Repositories panel, or Configure ▸ Repositories.</div> }
      } @else if (store.overviewLoading()) { <div class="empty"><span class="spinner"></span> Analysing {{ store.repos().length }} repositories…</div> }
      @else { <div class="empty">No overview yet.</div> }
    </div>`
})
export class OrganizationView {
  readonly store = inject(Store)
  constructor() { effect(() => { if (this.store.perspective() === 'organization' && this.store.workspace() && !this.store.overview() && !this.store.overviewLoading()) void this.store.loadOverview() }) }
  groups(cards: RepoOverviewCard[]): { name: string; cards: RepoOverviewCard[] }[] {
    const map = new Map<string, RepoOverviewCard[]>()
    for (const c of cards) { const g = c.repo.group ?? ''; if (!map.has(g)) map.set(g, []); map.get(g)!.push(c) }
    return [...map.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0]))).map(([name, cs]) => ({ name, cards: cs }))
  }
  shortRemote(r: string): string { return r.split('/').slice(1).join('/') }
  iso(ms: number): string { return new Date(ms).toISOString() }
  open(c: RepoOverviewCard): void { if (c.error) return; this.store.openRepo(c.repo); this.store.perspective.set('standard') }
  async fetchAll(): Promise<void> {
    const repos = this.store.repos()
    await this.store.run(`Fetch ${repos.length} repositories`, async () => { for (const r of repos) await this.store.api.fetch(r.path, undefined, true).catch(() => undefined) }, { success: 'Fetched all repositories' })
    await this.store.loadOverview()
  }
}
