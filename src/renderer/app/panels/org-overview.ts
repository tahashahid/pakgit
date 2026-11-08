import { Component, inject } from '@angular/core'
import { Store } from '../store.service'
import { Icon } from '../ui/icon'
import { TimeAgoPipe } from '../ui/time-ago'
import type { RepoOverviewCard } from '@shared/types'

/** Overview tab: one card per repository with branch state, ready counts and health warnings. */
@Component({
  selector: 'pg-org-overview',
  imports: [Icon, TimeAgoPipe],
  template: `
    <div class="org-overview">
      @if (store.overview(); as ov) {
        <div class="org-stats">
          @for (r of ov.totals.ready; track r.id) { <span>→ {{ r.name }}: <b>{{ r.count }}</b></span> }
          <span>unreleased: <b>{{ ov.totals.unreleased }}</b></span>
          @if (ov.totals.partlyPromoted) { <a href="#" style="color:var(--warning)" (click)="$event.preventDefault(); showPartly()" title="Issues whose parts sit on different environments: open them in Ready">⚠ {{ ov.totals.partlyPromoted }} issue(s) partly promoted</a> }
          @if (ov.totals.warnings) { <span style="color:var(--warning)">⚠ {{ ov.totals.warnings }} warning(s)</span> }
          @for (n of store.nextReleases(); track n.envId) { <span [title]="'Release cadence from Configure ▸ Conventions'">📅 next {{ n.envName }} release {{ when(n.at) }} ({{ countdown(n.inHours) }})</span> }
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
                    @for (e of c.environments ?? []; track e.id) { <span [class.hot]="e.ready > 0" [class.missing]="e.missing" [title]="e.missing ? 'Branch ' + e.branch + ' not found' : 'Ready for ' + e.branch + ': open in Ready'" (click)="$event.stopPropagation(); showReady(e.id)">→ {{ e.branch }} {{ e.ready }}</span> }
                  </div>
                  @for (d of c.deployed ?? []; track d.envId) {
                    <div [class]="d.status === 'same' ? 'muted' : 'warn'" style="font-size:12px" [title]="d.error ?? (d.deployed ? 'deployed: ' + d.deployed : '')">{{ d.status === 'same' ? '✓' : '⚠' }} {{ envBranch(c, d.envId) }} deployed: {{ d.status === 'same' ? '= branch' : d.status === 'behind' ? d.behind + ' commit(s) behind the branch' : d.status === 'ahead' ? 'ahead of the branch' : 'unknown (' + (d.error ?? 'no data') + ')' }}</div>
                  }
                  @if (c.partlyPromoted) { <div class="warn">⚠ {{ c.partlyPromoted }} issue(s) partly promoted across repositories</div> }
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
      @else if (store.overviewError()) { <div class="empty">{{ store.overviewError() }} <button class="btn small" (click)="store.loadOverview(true)">Retry</button></div> }
      @else { <div class="empty">No overview yet.</div> }
    </div>`
})
export class OrgOverview {
  readonly store = inject(Store)
  groups(cards: RepoOverviewCard[]): { name: string; cards: RepoOverviewCard[] }[] {
    const g = this.store.orgGroup()
    const map = new Map<string, RepoOverviewCard[]>()
    for (const c of cards) { const name = c.repo.group ?? ''; if (g && name !== g) continue; if (!map.has(name)) map.set(name, []); map.get(name)!.push(c) }
    return [...map.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0]))).map(([name, cs]) => ({ name, cards: cs }))
  }
  shortRemote(r: string): string { return r.split('/').slice(1).join('/') }
  envBranch(c: RepoOverviewCard, envId: string): string { return c.environments?.find((e) => e.id === envId)?.branch ?? envId }
  iso(ms: number): string { return new Date(ms).toISOString() }
  when(ms: number): string { const d = new Date(ms); return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }
  countdown(h: number): string { return h < 1 ? 'now' : h < 48 ? `in ${h} h` : `in ${Math.round(h / 24)} d` }
  open(c: RepoOverviewCard): void { if (c.error) return; this.store.openRepo(c.repo); this.store.perspective.set('standard') }
  showPartly(): void { this.store.readyWarnOnly.set(true); this.store.orgTab.set('ready') }
  showReady(envId: string): void { this.store.readyWarnOnly.set(false); this.store.orgTab.set('ready'); this.store.readyTab.set(envId) }
}
