import { Component, computed, effect, inject, input, output, signal } from '@angular/core'
import { Store } from '../store.service'
import type { BranchTarget, Environment, PrepareOptions, ReleaseItem } from '@shared/types'

export interface PromoteRequest { env: Environment; target: BranchTarget; options: PrepareOptions }

/** "Promote selected…": choose the target environment and the branch that will carry the items. */
@Component({
  selector: 'pg-promote-dialog',
  template: `
    <div class="modal-backdrop" (mousedown)="closed.emit()">
      <form class="modal wide" (mousedown)="$event.stopPropagation()" (submit)="$event.preventDefault(); submit()">
        <h2>Promote {{ items().length }} item(s)</h2>
        <p class="modal-message">The items are merged one by one into a single branch. If a merge conflicts, PakGit stops on that branch; resolve it in the Files panel, commit, and continue from the banner in the Release view.</p>
        <div class="settings-grid">
          <label class="field"><span>Target environment</span>
            <select (change)="envId.set($any($event.target).value)">@for (e of envs(); track e.id) { <option [value]="e.id" [selected]="e.id === envId()">{{ e.name || e.branch }} ({{ e.branch }})</option> }</select>
            <small class="hint">The pull request will target this environment's branch.</small></label>
          <label class="field"><span>Branch</span>
            <select (change)="mode.set($any($event.target).value)"><option value="new" [selected]="mode() === 'new'">New branch from {{ env()?.branch }}</option><option value="existing" [selected]="mode() === 'existing'">Existing branch</option></select></label>
          @if (mode() === 'new') {
            <label class="field"><span>New branch name</span><input class="mono" [value]="name()" (input)="name.set($any($event.target).value)" placeholder="release/stage-2026-W46" /><small class="hint">Cut from {{ cfgRemote() }}/{{ env()?.branch }}.</small></label>
          } @else {
            <label class="field"><span>Existing branch</span>
              <input class="mono" list="pg-branches" [value]="name()" (input)="name.set($any($event.target).value)" placeholder="type to search…" />
              <datalist id="pg-branches">@for (b of branchNames(); track b) { <option [value]="b"></option> }</datalist>
              <small class="hint">Checked out and fast-forwarded to its remote before merging.</small></label>
          }
          <label class="field field-check"><input type="checkbox" [checked]="push()" (change)="push.set($any($event.target).checked)" /><span>Push the branch</span></label>
          <label class="field field-check"><input type="checkbox" [checked]="openPr()" [disabled]="!push()" (change)="openPr.set($any($event.target).checked)" /><span>Open the pull request into {{ env()?.branch }}</span></label>
        </div>
        <div class="rebase-list" style="max-height:30vh">
          @for (it of items(); track it.id) { <div class="rebase-row"><span class="mono muted">{{ it.issueKey ?? '' }}</span><span class="subject">{{ it.issue?.title ?? it.name }}</span><span class="mono muted" style="font-size:11px">{{ it.branches[0]?.name ?? 'cherry-pick' }}</span></div> }
        </div>
        @if (error()) { <p class="modal-message" style="color:var(--danger)">{{ error() }}</p> }
        <div class="modal-actions">
          <button type="button" class="btn" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn primary" [disabled]="!name().trim()">{{ mode() === 'new' ? 'Create branch and merge' : 'Merge into branch' }}</button>
        </div>
      </form>
    </div>`
})
export class PromoteDialog {
  readonly items = input.required<ReleaseItem[]>()
  readonly envs = input.required<Environment[]>()
  readonly initialEnv = input.required<string>()
  readonly branchNames = input.required<string[]>()
  readonly releasePrefix = input('release/')
  readonly cfgRemote = input('origin')
  readonly closed = output<void>()
  readonly submitted = output<PromoteRequest>()
  readonly store = inject(Store)
  readonly envId = signal('')
  readonly mode = signal<'new' | 'existing'>('new')
  readonly name = signal('')
  readonly push = signal(true)
  readonly openPr = signal(true)
  readonly error = signal('')
  readonly env = computed(() => this.envs().find((e) => e.id === this.envId()) ?? null)
  constructor() {
    effect(() => { this.envId.set(this.initialEnv()) })
    effect(() => { const e = this.env(); if (e && this.mode() === 'new' && (!this.name() || this.name().startsWith(this.releasePrefix()))) this.name.set(`${this.releasePrefix()}${e.branch}-${isoWeek()}`) })
  }
  submit(): void {
    const e = this.env(); if (!e) return
    this.submitted.emit({ env: e, target: { name: this.name().trim(), existing: this.mode() === 'existing' }, options: { push: this.push(), openPr: this.push() && this.openPr() } })
  }
}

export function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return `${date.getUTCFullYear()}-W${String(Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`
}
