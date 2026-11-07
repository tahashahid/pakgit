import { Component, input, output } from '@angular/core'
import type { EnvConfig, Environment } from '@shared/types'

/** Form for an EnvConfig (pipeline): environments table plus remote, prefix, base, back-merge, prefixes. */
@Component({
  selector: 'pg-pipeline-editor',
  template: `
    @if (value(); as c) {
      <div class="env-list">
        <div class="env-row head"><span></span><span>Name</span><span>Branch</span><span>Promotion</span><span>Tracker state on arrival</span><span></span></div>
        @for (e of c.environments; track $index; let i = $index) {
          <div class="env-row">
            <span class="env-move"><button type="button" class="btn small" (click)="move(i, -1)" [disabled]="i === 0" title="Move up">↑</button><button type="button" class="btn small" (click)="move(i, 1)" [disabled]="i === c.environments.length - 1" title="Move down">↓</button></span>
            <input [value]="e.name" placeholder="Staging" (input)="upd(i, { name: $any($event.target).value })" />
            <input class="mono" [value]="e.branch" placeholder="staging" (input)="upd(i, { branch: $any($event.target).value })" />
            <select (change)="upd(i, { strategy: $any($event.target).value })"><option value="feature-pr" [selected]="e.strategy === 'feature-pr'">feature PRs</option><option value="release-branch" [selected]="e.strategy === 'release-branch'">release branch + PR</option><option value="merge" [selected]="e.strategy === 'merge'">direct merge</option></select>
            <input [value]="e.trackerState" placeholder="e.g. UAT" (input)="upd(i, { trackerState: $any($event.target).value })" />
            <button type="button" class="btn small danger" (click)="remove(i)" [disabled]="c.environments.length === 1" title="Remove">✕</button>
          </div>
        }
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button type="button" class="btn small" (click)="add()">+ Add environment</button>
        <span style="flex:1"></span>
        @if (detectLabel()) { <button type="button" class="btn small ghost" (click)="detect.emit()">{{ detectLabel() }}</button> }
      </div>
      <div class="settings-grid">
        <label class="field"><span>Remote</span><input class="mono" [value]="c.remote" (input)="set({ remote: $any($event.target).value })" /></label>
        <label class="field"><span>Release branch prefix</span><input class="mono" [value]="c.releasePrefix" (input)="set({ releasePrefix: $any($event.target).value })" /></label>
        <label class="field"><span>New feature branches start from</span>
          <select (change)="set({ baseEnv: $any($event.target).value })">@for (e of c.environments; track e.id + $index) { <option [value]="e.id" [selected]="e.id === c.baseEnv">{{ e.name || e.branch }} ({{ e.branch }})</option> }</select></label>
        <label class="field field-check"><input type="checkbox" [checked]="c.backMerge" (change)="set({ backMerge: $any($event.target).checked })" /><span>After a release, merge it back into every earlier environment</span></label>
        <label class="field"><span>Issue key prefixes</span><input class="mono" [value]="c.issuePrefixes.join(', ')" placeholder="empty = from Linear teams" (input)="set({ issuePrefixes: split($any($event.target).value) })" /><small class="hint">Only these prefixes count as issues (e.g. CYB4, CYB2).</small></label>
        <label class="field"><span>Ignored branch prefixes</span><input class="mono" [value]="c.excludePrefixes.join(', ')" (input)="set({ excludePrefixes: split($any($event.target).value) })" /><small class="hint">Branches starting with these are never work items.</small></label>
      </div>
    }`
})
export class PipelineEditor {
  readonly value = input.required<EnvConfig | null>()
  readonly detectLabel = input<string>('')
  readonly valueChange = output<EnvConfig>()
  readonly detect = output<void>()
  private emit(next: EnvConfig): void { this.valueChange.emit(next) }
  set(patch: Partial<EnvConfig>): void { const c = this.value(); if (c) this.emit({ ...c, ...patch }) }
  split(v: string): string[] { return v.split(',').map((x) => x.trim()).filter(Boolean) }
  upd(i: number, patch: Partial<Environment>): void {
    const c = this.value(); if (!c) return
    const envs = c.environments.map((e, k) => (k === i ? { ...e, ...patch } : e))
    const e = envs[i]
    if (patch.name !== undefined || patch.branch !== undefined) e.id = (e.name || e.branch).toLowerCase().replace(/[^a-z0-9]+/g, '-') || `env-${i + 1}`
    this.emit({ ...c, environments: envs })
  }
  move(i: number, d: -1 | 1): void { const c = this.value(); if (!c) return; const envs = [...c.environments]; const j = i + d; if (j < 0 || j >= envs.length) return; [envs[i], envs[j]] = [envs[j], envs[i]]; this.emit({ ...c, environments: envs }) }
  add(): void { const c = this.value(); if (c) this.emit({ ...c, environments: [...c.environments, { id: `env-${c.environments.length + 1}`, name: '', branch: '', strategy: 'release-branch', trackerState: '' }] }) }
  remove(i: number): void { const c = this.value(); if (c) this.emit({ ...c, environments: c.environments.filter((_, k) => k !== i) }) }
}
