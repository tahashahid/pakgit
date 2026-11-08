import { Component, computed, effect, inject, input, output, signal } from '@angular/core'
import { LS, Store, type ReleaseDraft } from '../store.service'
import { releaseName } from './promote-dialog'
import type { GateCheck, ReleaseRecord } from '@shared/types'

/** Ready ▸ Promote selected…: one release across repositories, with the pre-flight checks shown before anything is created. */
@Component({
  selector: 'pg-release-dialog',
  template: `
    <div class="modal-backdrop" (mousedown)="closed.emit()">
      <form class="modal xwide" (mousedown)="$event.stopPropagation()" (submit)="$event.preventDefault(); submit()">
        <h2>Release {{ selection().length }} item(s) in {{ byRepo().length }} {{ byRepo().length === 1 ? 'repository' : 'repositories' }}</h2>
        <p class="modal-message">One branch name in every repository involved, merged repository by repository in deploy order, one pull request per repository, and a release record to follow in the Releases tab. A conflict pauses only that repository.</p>
        <div class="settings-grid">
          <label class="field"><span>Target environment</span>
            <select (change)="envId.set($any($event.target).value)">@for (e of envs(); track e.id) { <option [value]="e.id" [selected]="e.id === envId()">{{ e.name || e.id }} ({{ e.branch }})</option> }</select></label>
          <label class="field"><span>Release branch name</span><input class="mono" [value]="name()" (input)="name.set($any($event.target).value)" data-first /><small class="hint">From the convention; must not exist yet in any repository involved.</small></label>
          <label class="field field-check"><input type="checkbox" [checked]="push()" (change)="push.set($any($event.target).checked)" /><span>Push the branches</span></label>
          <label class="field field-check"><input type="checkbox" [checked]="openPr()" [disabled]="!push()" (change)="openPr.set($any($event.target).checked)" /><span>Open the pull requests{{ hostingOk() ? ' on GitHub' : ' (pull-request pages in the browser)' }}</span></label>
          <label class="field field-check"><input type="checkbox" [checked]="draft()" [disabled]="!push() || !openPr() || !hostingOk()" (change)="draft.set($any($event.target).checked)" /><span>Open them as drafts</span></label>
          <label class="field field-check"><input type="checkbox" [checked]="updateTracker()" [disabled]="!trackerOk()" (change)="updateTracker.set($any($event.target).checked)" /><span>Update Linear when a pull request opens{{ stateOnPr() ? ' (→ ' + stateOnPr() + ')' : ' (no state configured)' }}</span></label>
        </div>
        <div class="group-header">Pre-flight checks @if (checking()) { <span class="spinner" style="margin-left:6px"></span> }</div>
        <div class="gate-list">
          @for (g of gates()?.results ?? []; track g.id) {
            <div class="gate" [class.ok]="g.ok" [class.warn]="!g.ok && g.mode === 'warn'" [class.block]="!g.ok && g.mode === 'block'">
              <span class="gate-icon">{{ g.ok ? '✓' : g.mode === 'block' ? '✖' : '⚠' }}</span>
              <span class="gate-label">{{ g.label }}</span>
              <span class="muted gate-msg">{{ g.message }}</span>
              @if (!g.ok && g.details.length) { <details class="gate-details"><summary>{{ g.details.length }} detail(s)</summary><ul>@for (d of g.details; track d) { <li>{{ d }}</li> }</ul></details> }
            </div>
          } @empty { <div class="muted">{{ checking() ? 'Running the checks…' : gateError() || 'Choose an environment to run the checks.' }}</div> }
        </div>
        @if (blocked().length) {
          <div class="state-banner" style="flex-direction:column;align-items:stretch;gap:6px;border:1px solid var(--border);border-radius:var(--radius)">
            <span>{{ blocked().length }} check(s) block this release. To go ahead anyway, type the target branch name; the override is recorded on the release.</span>
            <input class="mono" [value]="confirm()" (input)="confirm.set($any($event.target).value)" [placeholder]="'type ' + envBranch() + ' to override'" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--fg1)" />
          </div>
        }
        <div class="group-header">Repositories in deploy order<span class="count">Configure ▸ Repositories sets the order</span></div>
        <div class="rebase-list" style="max-height:24vh">
          @for (r of byRepo(); track r.repo) {
            <div class="rebase-row"><span class="mono muted" style="font-size:11px;width:18px">{{ $index + 1 }}.</span><span class="subject"><b>{{ r.name }}</b><span class="muted" style="margin-left:8px">{{ r.keys }}</span></span><span class="muted" style="font-size:11px">{{ r.n }} item(s)</span></div>
          }
        </div>
        @if (error()) { <p class="modal-message" style="color:var(--danger)">{{ error() }}</p> }
        <div class="modal-actions">
          <button type="button" class="btn" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn primary" [disabled]="!canSubmit()">{{ busy() ? 'Creating…' : 'Create release' }}</button>
        </div>
      </form>
    </div>`
})
export class ReleaseDialog {
  readonly selection = input.required<ReleaseDraft>()
  readonly initialEnv = input<string>('')
  readonly closed = output<void>()
  readonly created = output<ReleaseRecord>()
  readonly store = inject(Store)
  readonly envId = signal('')
  readonly name = signal('')
  readonly push = signal<boolean>(LS.get('release.push', true))
  readonly openPr = signal(true)
  readonly draft = signal<boolean>(false)
  readonly updateTracker = signal<boolean>(LS.get('release.updateTracker', true))
  readonly gates = signal<GateCheck | null>(null)
  readonly checking = signal(false)
  readonly gateError = signal('')
  readonly confirm = signal('')
  readonly busy = signal(false)
  readonly error = signal('')
  readonly envs = computed(() => this.store.index()?.environments ?? [])
  readonly env = computed(() => this.envs().find((e) => e.id === this.envId()) ?? null)
  readonly envBranch = computed(() => this.env()?.branch ?? '')
  readonly hostingOk = computed(() => !!this.store.hostingStatus()?.available)
  readonly trackerOk = computed(() => { const t = this.store.trackerStatus(); return !!t && t.configured && !t.error })
  readonly stateOnPr = computed(() => this.store.org()?.pipeline?.environments.find((e) => e.id === this.envId())?.trackerStateOnPr ?? '')
  readonly blocked = computed(() => this.gates()?.blocked ?? [])
  readonly byRepo = computed(() => {
    const order = this.store.index()?.repos.map((r) => r.path) ?? []
    const deploy = this.store.org()?.deployOrder ?? []
    const idOf = (path: string): string => this.store.repos().find((r) => r.path === path)?.remote ?? path
    const m = new Map<string, { repo: string; name: string; keys: string; n: number }>()
    for (const s of this.selection()) { const cur = m.get(s.repo) ?? { repo: s.repo, name: s.repoName, keys: '', n: 0 }; cur.n++; cur.keys += (cur.keys ? ', ' : '') + (s.issueKey ?? s.itemId); m.set(s.repo, cur) }
    const rank = (p: string): number => { const i = deploy.indexOf(idOf(p)); return i < 0 ? 1000 + order.indexOf(p) : i }
    return [...m.values()].sort((a, b) => rank(a.repo) - rank(b.repo) || a.name.localeCompare(b.name))
  })
  readonly canSubmit = computed(() => !!this.envId() && !!this.name().trim() && !!this.gates() && !this.checking() && !this.busy() && (!this.blocked().length || this.confirm().trim() === this.envBranch()))
  constructor() {
    effect(() => { const envs = this.envs(); const init = this.initialEnv(); if (!this.envId() && envs.length) this.envId.set(envs.some((e) => e.id === init) ? init : envs[Math.min(1, envs.length - 1)].id) })
    effect(() => { const e = this.env(); if (e) this.name.set(releaseName(this.store.org()?.conventions.releasePattern ?? 'release/{env}-{week}', e.branch)) })
    effect(() => { const id = this.envId(); const sel = this.selection(); if (id) void this.check(id, sel) })
    effect(() => { this.draft.set(!!this.store.org()?.hosting.draft) })
    effect(() => LS.set('release.push', this.push()))
    effect(() => LS.set('release.updateTracker', this.updateTracker()))
    void this.store.refreshHosting()
  }
  private async check(envId: string, sel: ReleaseDraft): Promise<void> {
    this.checking.set(true); this.gateError.set(''); this.confirm.set('')
    try { const g = await this.store.api.orgEvaluateGates(this.store.activeOrgId(), envId, sel.map(({ repoName: _n, ...s }) => s)); if (this.envId() === envId) this.gates.set(g) }
    catch (e) { this.gates.set(null); this.gateError.set(e instanceof Error ? e.message : String(e)) } finally { this.checking.set(false) }
  }
  async submit(): Promise<void> {
    if (!this.canSubmit()) return
    this.busy.set(true); this.error.set('')
    try {
      const rec = await this.store.api.orgCreateRelease(this.store.activeOrgId(), {
        envId: this.envId(), name: this.name().trim(), selection: this.selection().map(({ repoName: _n, ...s }) => s),
        options: { push: this.push(), openPr: this.push() && this.openPr(), draft: this.draft(), updateTracker: this.updateTracker() }, overrides: this.blocked()
      })
      this.created.emit(rec)
    } catch (e) { this.error.set(e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
}
