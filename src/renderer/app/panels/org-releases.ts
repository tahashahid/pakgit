import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { LS, Store } from '../store.service'
import { Icon } from '../ui/icon'
import { TimeAgoPipe } from '../ui/time-ago'
import type { ProbeResult, PullRequestStatus, ReleaseRecord, ReleaseRepo } from '@shared/types'

/** Releases tab: the named cross-repository releases with their per-repository state. */
@Component({
  selector: 'pg-org-releases',
  imports: [Icon, TimeAgoPipe],
  template: `
    <div class="org-pane">
      <div class="panel-header" style="gap:8px">
        <span class="panel-title">Releases</span>
        <span class="muted" style="font-size:12px">{{ store.inProgressReleases() }} in progress</span>
        <span style="flex:1"></span>
        <label class="muted" style="font-size:12px;display:inline-flex;gap:4px;align-items:center"><input type="checkbox" [checked]="showDone()" (change)="showDone.set($any($event.target).checked)" />Show finished and dropped</label>
        <button class="btn small" (click)="refreshAll()" [disabled]="busy() || store.releasesLoading()" title="Re-read pull-request state and whether each branch landed"><pg-icon name="refresh" [size]="14" /></button>
      </div>
      <div class="releases-list">
        @for (r of visible(); track r.id) {
          <div class="release-card" [class.focus]="store.releaseFocus() === r.id" [class.done]="r.status !== 'in-progress'">
            <div class="release-head">
              <span class="mono release-name">{{ r.name }}</span>
              <span class="muted">→ {{ r.envBranch }} · created {{ iso(r.createdAt) | timeAgo }}{{ r.createdBy ? ' by ' + r.createdBy : '' }} · {{ r.items.length }} item(s) · {{ r.repos.length }} {{ r.repos.length === 1 ? 'repository' : 'repositories' }}</span>
              <span class="status-pill" [class]="'status-pill ' + statusClass(r)">{{ statusText(r) }}</span>
              <span style="flex:1"></span>
              @if (r.status === 'in-progress') {
                <button class="btn small" (click)="refresh(r)" [disabled]="busy()" title="Re-read pull-request state and whether each branch landed"><pg-icon name="refresh" [size]="14" /></button>
                <button class="btn small primary" [disabled]="!ready(r) || busy()" (click)="finish(r)" [title]="ready(r) ? 'Back-merge ' + r.envBranch + ' into the earlier environments in every repository and move the Linear states' : 'Enabled once every repository landed in ' + r.envBranch">Finish…</button>
                <button class="btn small" [disabled]="busy()" (click)="drop(r)" title="Keep the branches, stop tracking this release">Drop…</button>
              }
              <button class="btn small" (click)="notes(r)" title="Release notes to copy">Notes</button>
              @if (r.status !== 'reverted' && r.status !== 'dropped' && anyLanded(r)) { <button class="btn small danger" [disabled]="busy()" (click)="revert(r)" title="Create a revert branch and pull request in every repository where the release landed">Revert…</button> }
            </div>
            @if (r.overridden.length) { <div class="warn" style="font-size:12px">⚠ Created with overridden checks: {{ r.overridden.join(', ') }}</div> }
            <table class="release-repos">
              <tbody>
                @for (rr of r.repos; track rr.path; let i = $index) {
                  <tr [class.dropped]="rr.dropped">
                    <td class="muted" style="width:24px">{{ i + 1 }}.</td>
                    <td style="width:200px"><b>{{ rr.name }}</b></td>
                    <td>
                      @if (rr.dropped) { <span class="muted">dropped: {{ rr.dropped }}</span> }
                      @else if (rr.error) {
                        <span style="color:var(--danger)">{{ rr.error }}</span>
                        @if (r.status === 'in-progress') { <button class="btn small" [disabled]="busy()" (click)="resume(r, rr, false)">Retry</button><button class="btn small ghost" [disabled]="busy()" (click)="dropRepo(r, rr)">Drop repository…</button> }
                      }
                      @else if (rr.paused) {
                        <span style="color:var(--warning)">⚠ paused: conflict in {{ rr.paused.conflict }}</span>
                        @if (r.status === 'in-progress') {
                          <button class="btn small primary" [disabled]="busy()" (click)="resume(r, rr, false)" title="After the merge is resolved and committed in the repository">Resume</button>
                          @if (rr.paused.remaining.length) { <button class="btn small" [disabled]="busy()" (click)="resume(r, rr, true)">Finish without the remaining {{ rr.paused.remaining.length }}</button> }
                          <button class="btn small ghost" (click)="openRepo(rr)">Open repository</button>
                          <button class="btn small ghost" [disabled]="busy()" (click)="dropRepo(r, rr)">Drop repository…</button>
                        }
                      }
                      @else {
                        @if (rr.pr) {
                          <a href="#" (click)="$event.preventDefault(); open(rr.pr!.url)">PR #{{ rr.pr.number }}</a>
                          <span class="status-pill" [class]="'status-pill ' + prClass(rr.pr)">{{ rr.pr.state }}{{ rr.pr.draft && rr.pr.state === 'open' ? ' (draft)' : '' }}</span>
                          @if (rr.pr.state === 'open') { <span class="muted">checks {{ rr.pr.checks }} · review {{ reviewText(rr.pr) }}{{ rr.pr.mergeable === 'conflicting' ? ' · ⚠ conflicts with ' + rr.base : '' }}</span> }
                        }
                        @else if (rr.prUrl) { <a href="#" (click)="$event.preventDefault(); open(rr.prUrl!)">pull-request page</a> }
                        @else if (!r.options.openPr) { <span class="muted">no pull request requested</span> }
                        @else { <span class="muted">no pull request yet</span> }
                        <span class="muted"> · {{ rr.onEnv ? 'on ' + rr.base + ' ✓' : 'not yet on ' + rr.base }}</span>
                        @if (rr.revert) { <span class="status-pill canceled" [title]="rr.revert.commits.join(', ')">reverted on {{ rr.revert.branch }}</span>@if (rr.revert.pr) { <a href="#" (click)="$event.preventDefault(); open(rr.revert!.pr!.url)">PR #{{ rr.revert.pr.number }}</a> } @else if (rr.revert.prUrl) { <a href="#" (click)="$event.preventDefault(); open(rr.revert!.prUrl!)">pull-request page</a> } }
                      }
                    </td>
                    <td class="muted" style="width:170px;text-align:right">{{ rr.merged.length }} merged{{ rr.skipped.length ? ', ' + rr.skipped.length + ' already there' : '' }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <div class="release-items">
              @for (it of r.items; track it.id) { <span class="ref-pill issue" [class.link]="!!it.url" [title]="it.title ?? ''" (click)="it.url && open(it.url)">{{ it.issueKey ?? it.id }}</span>@if (it.title) { <span class="muted release-item-title">{{ it.title }}</span> } }
            </div>
            @if (deployedFor(r); as dep) { <div class="muted" style="font-size:12px">Deployed: {{ dep }}</div> }
          </div>
        } @empty { <div class="empty">{{ store.releasesLoading() ? 'Loading…' : 'No releases yet. Tick items in Ready and choose Promote selected…' }}</div> }
      </div>
      @if (notesText() !== null) {
        <div class="modal-backdrop" (mousedown)="notesText.set(null)">
          <div class="modal wide" (mousedown)="$event.stopPropagation()">
            <h2>Release notes</h2>
            <textarea class="mono" rows="18" readonly [value]="notesText()" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg1);color:var(--fg1);font-size:12px"></textarea>
            <div class="modal-actions"><button class="btn" (click)="notesText.set(null)">Close</button><button class="btn primary" (click)="copyNotes()">Copy</button></div>
          </div>
        </div>
      }
    </div>`
})
export class OrgReleases {
  readonly store = inject(Store)
  readonly showDone = signal<boolean>(LS.get('releases.showDone', false))
  readonly busy = signal(false)
  readonly notesText = signal<string | null>(null)
  readonly visible = computed(() => this.store.releases().filter((r) => this.showDone() || r.status === 'in-progress'))
  constructor() {
    effect(() => LS.set('releases.showDone', this.showDone()))
    effect(() => { if (this.store.orgTab() === 'releases' && this.store.workspace() && untracked(() => !this.store.releasesLoading())) void this.store.loadReleases() })
    effect(() => { const f = this.store.releaseFocus(); if (f) setTimeout(() => this.store.releaseFocus.set(null), 4000) })
  }
  iso(ms: number): string { return new Date(ms).toISOString() }
  open(url: string): void { window.open(url) }
  ready(r: ReleaseRecord): boolean { const act = r.repos.filter((x) => !x.dropped); return r.status === 'in-progress' && act.length > 0 && act.every((x) => (x.onEnv || x.pr?.state === 'merged') && !x.paused && !x.error) }
  statusText(r: ReleaseRecord): string {
    if (r.status !== 'in-progress') return r.status
    const act = r.repos.filter((x) => !x.dropped)
    const landed = act.filter((x) => x.onEnv || x.pr?.state === 'merged').length
    if (act.some((x) => x.paused)) return 'paused'
    if (act.some((x) => x.error)) return 'needs attention'
    return landed === act.length ? 'ready to finish' : `${landed}/${act.length} landed`
  }
  statusClass(r: ReleaseRecord): string { const t = this.statusText(r); return t === 'finished' || t === 'ready to finish' ? 'completed' : t === 'dropped' || t === 'reverted' ? 'canceled' : t === 'paused' || t === 'needs attention' ? 'unknown' : 'started' }
  anyLanded(r: ReleaseRecord): boolean { return r.repos.some((x) => !x.dropped && !x.revert && (x.onEnv || x.pr?.state === 'merged')) }
  async revert(r: ReleaseRecord): Promise<void> {
    const v = await this.store.prompt({ title: `Revert ${r.name}`, danger: true, okLabel: 'Revert', message: `For every repository where the release landed in ${r.envBranch}: creates revert/… from ${r.envBranch} with the landing commit reverted, pushes it and opens a pull request into ${r.envBranch}. Nothing is force-pushed; ${r.envBranch} changes only when the pull requests are merged.`, fields: [
      { key: 'push', label: 'Push the revert branches', type: 'checkbox', value: 'true' }, { key: 'pr', label: 'Open the pull requests', type: 'checkbox', value: 'true' }] })
    if (!v) return
    await this.act('Revert', async () => {
      const res = await this.store.api.orgRevertRelease(this.store.activeOrgId(), r.id, { push: !!v.push, openPr: !!v.push && !!v.pr })
      for (const x of res.repos) { const name = r.repos.find((y) => y.path === x.repo)?.name ?? x.repo; this.store.toast(x.error ? 'error' : 'success', `${name}: ${x.error ?? (x.branch + (x.pr ? ' · PR #' + x.pr.number : x.prUrl ? ' · pull-request page opened' : ''))}`) }
      await this.store.afterRelease()
    })
  }
  prClass(pr: PullRequestStatus): string { return pr.state === 'merged' ? 'completed' : pr.state === 'closed' ? 'canceled' : pr.checks === 'failure' || pr.reviewDecision === 'changes-requested' ? 'unknown' : 'started' }
  reviewText(pr: PullRequestStatus): string { return pr.reviewDecision === 'approved' ? 'approved' : pr.reviewDecision === 'changes-requested' ? 'changes requested' : pr.reviewDecision === 'review-required' ? 'pending' : 'none' }
  deployedFor(r: ReleaseRecord): string | null {
    const cards = this.store.overview()?.repos ?? []
    const parts: string[] = []
    for (const rr of r.repos) { const d: ProbeResult | undefined = cards.find((c) => c.repo.path === rr.path)?.deployed?.find((x) => x.envId === r.envId); if (d) parts.push(`${rr.name} ${rr.base} ${d.status === 'same' ? '= branch ✓' : d.status === 'behind' ? d.behind + ' commits behind ⚠' : d.status === 'ahead' ? 'ahead of the branch' : 'unknown'}`) }
    return parts.length ? parts.join(' · ') : null
  }
  openRepo(rr: ReleaseRepo): void { const entry = this.store.repos().find((x) => x.path === rr.path); if (entry) { this.store.openRepo(entry); this.store.perspective.set('standard') } }
  private async act(label: string, fn: () => Promise<void>): Promise<void> {
    this.busy.set(true)
    try { await fn() } catch (e) { this.store.toast('error', `${label}: ${e instanceof Error ? e.message : String(e)}`) } finally { this.busy.set(false) }
  }
  refreshAll(): Promise<void> { return this.act('Refresh', async () => { for (const r of this.store.releases().filter((x) => x.status === 'in-progress')) await this.store.api.orgRefreshRelease(this.store.activeOrgId(), r.id); await this.store.loadReleases(); void this.store.refreshHosting() }) }
  refresh(r: ReleaseRecord): Promise<void> { return this.act('Refresh', async () => { await this.store.api.orgRefreshRelease(this.store.activeOrgId(), r.id); await this.store.loadReleases() }) }
  resume(r: ReleaseRecord, rr: ReleaseRepo, skipRemaining: boolean): Promise<void> {
    return this.act('Resume', async () => {
      const rec = await this.store.api.orgResumeRelease(this.store.activeOrgId(), r.id, rr.path, { skipRemaining })
      const next = rec.repos.find((x) => x.path === rr.path)
      if (next?.paused) this.store.toast('error', `${rr.name}: conflict in ${next.paused.conflict}. Resolve it in the Files panel of the repository, commit the merge, then Resume again.`)
      else if (next?.error) this.store.toast('error', `${rr.name}: ${next.error}`)
      else this.store.toast('success', `${rr.name}: ${next?.merged.length ?? 0} item(s) merged${next?.pr ? ', PR #' + next.pr.number + ' opened' : next?.prUrl ? ', pull-request page opened' : ''}`)
      await this.store.afterRelease()
    })
  }
  async dropRepo(r: ReleaseRecord, rr: ReleaseRepo): Promise<void> {
    const v = await this.store.prompt({ title: `Drop ${rr.name} from ${r.name}`, okLabel: 'Drop', message: 'The repository leaves this release; its branch is kept.', fields: [{ key: 'reason', label: 'Reason', placeholder: 'e.g. not this week' }] })
    if (!v) return
    await this.act('Drop repository', async () => { await this.store.api.orgDropReleaseRepo(this.store.activeOrgId(), r.id, rr.path, String(v.reason ?? '')); await this.store.loadReleases() })
  }
  async finish(r: ReleaseRecord): Promise<void> {
    const trackerOk = !!this.store.trackerStatus()?.configured
    const v = await this.store.prompt({ title: `Finish ${r.name}`, okLabel: 'Finish', message: `Every repository landed in ${r.envBranch}. Finishing back-merges ${r.envBranch} into the earlier environments of each repository (pull requests, or direct merges for direct-merge environments) and moves the Linear issues to the state configured for ${r.envName || r.envBranch}.`, fields: [
      { key: 'push', label: 'Push what the back-merge creates', type: 'checkbox', value: String(LS.get('release.push', true)) },
      { key: 'tracker', label: 'Update Linear states', type: 'checkbox', value: String(trackerOk && LS.get('release.updateTracker', true)) }
    ] })
    if (!v) return
    await this.act('Finish', async () => {
      const res = await this.store.api.orgFinishRelease(this.store.activeOrgId(), r.id, { push: !!v.push, updateTracker: !!v.tracker })
      for (const x of res.results) { const name = r.repos.find((y) => y.path === x.repo)?.name ?? x.repo; this.store.toast(x.result.conflict ? 'error' : 'info', `${name}: ${x.result.message}`) }
      this.store.toast('success', `${r.name} finished`)
      await this.store.afterRelease()
    })
  }
  async drop(r: ReleaseRecord): Promise<void> {
    const v = await this.store.prompt({ title: `Drop ${r.name}`, danger: true, okLabel: 'Drop', message: 'Stops tracking this release. Branches and pull requests are left as they are.', fields: [{ key: 'reason', label: 'Reason', placeholder: 'optional' }] })
    if (!v) return
    await this.act('Drop release', async () => { await this.store.api.orgDropRelease(this.store.activeOrgId(), r.id, String(v.reason ?? '')); await this.store.loadReleases() })
  }
  notes(r: ReleaseRecord): Promise<void> { return this.act('Notes', async () => { this.notesText.set(await this.store.api.orgReleaseNotes(this.store.activeOrgId(), r.id)) }) }
  copyNotes(): void { const t = this.notesText(); if (t) { void navigator.clipboard.writeText(t); this.store.toast('info', 'Release notes copied') } }
}
