import { Component, effect, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import type { Settings } from '@shared/types'

@Component({
  selector: 'pg-settings-dialog',
  template: `
    @if (store.showSettings() && s(); as s) {
      <div class="modal-backdrop" (mousedown)="store.showSettings.set(false)">
        <form class="modal wide" (mousedown)="$event.stopPropagation()" (submit)="$event.preventDefault(); save()">
          <h2>Settings</h2>
          <div class="settings-grid">
            <label class="field"><span>Git executable (empty = auto-detect)</span><input [value]="s.gitPath" placeholder="git" (input)="upd({ gitPath: $any($event.target).value })" /></label>
            <label class="field"><span>Default pull strategy</span>
              <select [value]="s.pullMode" (change)="upd({ pullMode: $any($event.target).value })"><option value="merge">merge</option><option value="rebase">rebase</option><option value="ff-only">fast-forward only</option></select></label>
            <label class="field"><span>Background fetch every (minutes, 0 = off)</span><input type="number" min="0" [value]="s.autoFetchMinutes" (input)="upd({ autoFetchMinutes: num($event, 0) })" /></label>
            <label class="field"><span>Commits to load in Log</span><input type="number" min="50" step="50" [value]="s.logLimit" (input)="upd({ logLimit: num($event, 400, 50) })" /></label>
            <label class="field field-check"><input type="checkbox" [checked]="s.confirmDiscard" (change)="upd({ confirmDiscard: $any($event.target).checked })" /><span>Confirm before discarding changes</span></label>
            <label class="field field-check"><input type="checkbox" [checked]="store.theme() === 'dark'" (change)="store.toggleTheme()" /><span>Dark theme</span></label>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" (click)="store.showSettings.set(false)">Cancel</button>
            <button type="submit" class="btn primary">Save</button>
          </div>
        </form>
      </div>
    }`
})
export class SettingsDialog {
  readonly store = inject(Store)
  readonly s = signal<Settings | null>(null)
  constructor() { effect(() => { this.store.showSettings(); this.s.set(this.store.settings()) }) }
  upd(patch: Partial<Settings>): void { this.s.update((s) => (s ? { ...s, ...patch } : s)) }
  num(e: Event, def: number, min = 0): number { const v = +(e.target as HTMLInputElement).value; return Math.max(min, v || def) }
  save(): void { const s = this.s(); if (s) void this.store.saveSettings(s); this.store.showSettings.set(false) }
}
