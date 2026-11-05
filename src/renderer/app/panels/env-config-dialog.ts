import { Component, effect, inject, input, output, signal } from '@angular/core'
import { Store } from '../store.service'
import type { EnvConfig, Environment } from '@shared/types'

/** Editor for the delivery pipeline: ordered environments with branch, strategy and tracker state. */
@Component({
  selector: 'pg-env-config-dialog',
  template: `
    @if (cfg(); as c) {
      <div class="modal-backdrop" (mousedown)="closed.emit()">
        <form class="modal wide" (mousedown)="$event.stopPropagation()" (submit)="$event.preventDefault(); save()">
          <h2>Environments</h2>
          <p class="modal-message">Order them from least stable (first) to production (last). Work is promoted one step at a time: an item is "ready" for an environment when it is in the previous one. <b>merge</b> merges feature branches straight into the environment branch; <b>release branch</b> collects the picked items in a release branch first, which you finish into the environment later.</p>
          <div class="env-list">
            <div class="env-row head"><span></span><span>Name</span><span>Branch</span><span>Promotion</span><span>Tracker state on arrival</span><span></span></div>
            @for (e of c.environments; track $index; let i = $index) {
              <div class="env-row">
                <span class="env-move"><button type="button" class="btn small" (click)="move(i, -1)" [disabled]="i === 0" title="Move up">↑</button><button type="button" class="btn small" (click)="move(i, 1)" [disabled]="i === c.environments.length - 1" title="Move down">↓</button></span>
                <input [value]="e.name" placeholder="Staging" (input)="upd(i, { name: $any($event.target).value })" />
                <input class="mono" [value]="e.branch" placeholder="staging" (input)="upd(i, { branch: $any($event.target).value })" />
                <select (change)="upd(i, { strategy: $any($event.target).value })"><option value="merge" [selected]="e.strategy === 'merge'">merge</option><option value="release-branch" [selected]="e.strategy === 'release-branch'">release branch</option></select>
                <input [value]="e.trackerState" placeholder="e.g. UAT" (input)="upd(i, { trackerState: $any($event.target).value })" />
                <button type="button" class="btn small danger" (click)="remove(i)" [disabled]="c.environments.length === 1" title="Remove">✕</button>
              </div>
            }
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button type="button" class="btn small" (click)="add()">+ Add environment</button>
            <span style="flex:1"></span>
            <button type="button" class="btn small ghost" (click)="detect()">Detect from branches</button>
          </div>
          <div class="settings-grid">
            <label class="field"><span>Remote</span><input class="mono" [value]="c.remote" (input)="set({ remote: $any($event.target).value })" /></label>
            <label class="field"><span>Release branch prefix</span><input class="mono" [value]="c.releasePrefix" (input)="set({ releasePrefix: $any($event.target).value })" /></label>
            <label class="field"><span>New feature branches start from</span>
              <select (change)="set({ baseEnv: $any($event.target).value })">@for (e of c.environments; track e.id + $index) { <option [value]="e.id" [selected]="e.id === c.baseEnv">{{ e.name || e.branch }} ({{ e.branch }})</option> }</select></label>
            <label class="field field-check"><input type="checkbox" [checked]="c.backMerge" (change)="set({ backMerge: $any($event.target).checked })" /><span>After a release, merge it back into every earlier environment</span></label>
          </div>
          @if (error()) { <p class="modal-message" style="color:var(--danger)">{{ error() }}</p> }
          <div class="modal-actions">
            <button type="button" class="btn" (click)="closed.emit()">Cancel</button>
            <button type="submit" class="btn primary">Save</button>
          </div>
        </form>
      </div>
    }`
})
export class EnvConfigDialog {
  readonly initial = input.required<EnvConfig | null>()
  readonly closed = output<void>()
  readonly saved = output<EnvConfig>()
  readonly store = inject(Store)
  readonly cfg = signal<EnvConfig | null>(null)
  readonly error = signal('')
  constructor() { effect(() => { const c = this.initial(); this.cfg.set(c ? structuredClone(c) : null); this.error.set('') }) }
  set(patch: Partial<EnvConfig>): void { this.cfg.update((c) => (c ? { ...c, ...patch } : c)) }
  upd(i: number, patch: Partial<Environment>): void {
    this.cfg.update((c) => {
      if (!c) return c
      const envs = c.environments.map((e, k) => (k === i ? { ...e, ...patch } : e))
      const e = envs[i]
      if (patch.name !== undefined || patch.branch !== undefined) e.id = (e.name || e.branch).toLowerCase().replace(/[^a-z0-9]+/g, '-') || `env-${i + 1}`
      return { ...c, environments: envs }
    })
  }
  move(i: number, d: -1 | 1): void { this.cfg.update((c) => { if (!c) return c; const envs = [...c.environments]; const j = i + d; if (j < 0 || j >= envs.length) return c; [envs[i], envs[j]] = [envs[j], envs[i]]; return { ...c, environments: envs } }) }
  add(): void { this.cfg.update((c) => (c ? { ...c, environments: [...c.environments, { id: `env-${c.environments.length + 1}`, name: '', branch: '', strategy: 'merge', trackerState: '' }] } : c)) }
  remove(i: number): void { this.cfg.update((c) => (c ? { ...c, environments: c.environments.filter((_, k) => k !== i) } : c)) }
  async detect(): Promise<void> { const r = this.store.repo(); if (!r) return; this.cfg.set(await this.store.api.detectReleaseConfig(r.path)) }
  async save(): Promise<void> {
    const r = this.store.repo(); const c = this.cfg(); if (!r || !c) return
    try { this.saved.emit(await this.store.api.saveReleaseConfig(r.path, c)) } catch (e) { this.error.set(e instanceof Error ? e.message : String(e)) }
  }
}
