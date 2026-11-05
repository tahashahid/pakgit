import { Component, computed, effect, inject, signal } from '@angular/core'
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
            <label class="field"><span>Git executable</span><input [value]="s.gitPath" placeholder="git" (input)="upd({ gitPath: $any($event.target).value })" /><small class="hint">Leave empty to auto-detect.</small></label>
            <label class="field"><span>Default pull strategy</span>
              <select (change)="upd({ pullMode: $any($event.target).value })"><option value="merge" [selected]="s.pullMode === 'merge'">merge</option><option value="rebase" [selected]="s.pullMode === 'rebase'">rebase</option><option value="ff-only" [selected]="s.pullMode === 'ff-only'">fast-forward only</option></select><small class="hint">Used when you pull from the toolbar.</small></label>
            <label class="field"><span>Background fetch (minutes)</span><input type="number" min="0" [value]="s.autoFetchMinutes" (input)="upd({ autoFetchMinutes: num($event, 0) })" /><small class="hint">0 turns it off.</small></label>
            <label class="field"><span>Commits to load in Log</span><input type="number" min="50" step="50" [value]="s.logLimit" (input)="upd({ logLimit: num($event, 400, 50) })" /><small class="hint">More can be loaded on demand.</small></label>
            <label class="field field-check"><input type="checkbox" [checked]="s.confirmDiscard" (change)="upd({ confirmDiscard: $any($event.target).checked })" /><span>Confirm before discarding changes</span></label>
            <label class="field field-check"><input type="checkbox" [checked]="store.theme() === 'dark'" (change)="store.toggleTheme()" /><span>Dark theme</span></label>
          </div>
          <h3 style="margin:8px 0 0;font-size:13px">Issue tracker</h3>
          <div class="settings-grid">
            <label class="field"><span>Provider</span>
              <select (change)="updT({ provider: $any($event.target).value })"><option value="none" [selected]="s.tracker.provider === 'none'">None</option><option value="linear" [selected]="s.tracker.provider === 'linear'">Linear</option></select><small class="hint">Shows issue titles and statuses in the Release view.</small></label>
            @if (s.tracker.provider === 'linear') {
              <label class="field"><span>Authentication</span>
                <select (change)="updT({ authMethod: $any($event.target).value })"><option value="oauth" [selected]="s.tracker.authMethod === 'oauth'">Sign in with Linear (browser)</option><option value="apiKey" [selected]="s.tracker.authMethod === 'apiKey'">Personal API key</option></select>
                <small class="hint">Sign-in uses OAuth with PKCE; tokens are stored encrypted and refreshed automatically.</small></label>
              @if (s.tracker.authMethod === 'apiKey') {
                <label class="field"><span>Linear personal API key</span><input type="password" [value]="s.tracker.linearApiKey" placeholder="lin_api_…" (input)="updT({ linearApiKey: $any($event.target).value })" /><small class="hint">Linear ▸ Settings ▸ Security &amp; access ▸ Personal API keys. Sent only to api.linear.app.</small></label>
              } @else {
                <label class="field"><span>OAuth client ID</span><input [value]="s.tracker.linearClientId" placeholder="from your Linear OAuth application" (input)="updT({ linearClientId: $any($event.target).value })" />
                  <small class="hint">Created once per workspace in Linear ▸ Settings ▸ API ▸ OAuth applications. Callback URL: <code>{{ redirect() }}</code>. Share the client ID with your team; it is not secret.</small></label>
                <div class="field"><span>Connection</span>
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    @if (signedIn()) {
                      <span class="chip ok">Signed in{{ store.trackerStatus()?.account ? ' as ' + store.trackerStatus()!.account : '' }}</span>
                      <button type="button" class="btn small" (click)="logout()" [disabled]="busy()">Sign out</button>
                    } @else {
                      <button type="button" class="btn small primary" (click)="login()" [disabled]="busy() || !s.tracker.linearClientId.trim()">{{ busy() ? 'Waiting for the browser…' : 'Sign in with Linear…' }}</button>
                    }
                    @if (loginError()) { <span class="chip bad" [title]="loginError()">{{ loginError() }}</span> }
                  </div>
                  <small class="hint">Save the client ID first if you just typed it. Your browser opens; approve PakGit, then come back here.</small></div>
              }
              <label class="field"><span>State when starting work on an issue</span><input [value]="s.tracker.stateOnStart" placeholder="In Progress" (input)="updT({ stateOnStart: $any($event.target).value })" /><small class="hint">Per-environment states are set in Release ▸ Configure.</small></label>
            }
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
  readonly busy = signal(false)
  readonly loginError = signal('')
  readonly redirect = signal('')
  readonly signedIn = computed(() => !!this.s()?.tracker.linearAccessToken)
  constructor() {
    effect(() => { this.store.showSettings(); this.s.set(this.store.settings()); this.loginError.set('') })
    this.store.api.trackerRedirectUrl().then((u) => this.redirect.set(u)).catch(() => undefined)
  }
  async login(): Promise<void> {
    const s = this.s(); if (!s) return
    this.busy.set(true); this.loginError.set('')
    try {
      // persist the client id / method first so the main process uses them
      await this.store.saveSettings({ ...s, tracker: { ...s.tracker, authMethod: 'oauth' } }, true)
      const r = await this.store.api.trackerLogin()
      if (!r.ok) this.loginError.set(r.error ?? 'Sign-in failed')
      else this.store.toast('success', `Connected to Linear${r.account ? ' as ' + r.account : ''}`)
      this.s.set(await this.store.api.getSettings()); this.store.settings.set(this.s())
      await this.store.refreshTracker()
    } catch (e) { this.loginError.set(e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async logout(): Promise<void> {
    this.busy.set(true)
    try { await this.store.api.trackerLogout(); this.s.set(await this.store.api.getSettings()); this.store.settings.set(this.s()); await this.store.refreshTracker() }
    finally { this.busy.set(false) }
  }
  upd(patch: Partial<Settings>): void { this.s.update((s) => (s ? { ...s, ...patch } : s)) }
  updT(patch: Partial<Settings['tracker']>): void { this.s.update((s) => (s ? { ...s, tracker: { ...s.tracker, ...patch } } : s)) }
  num(e: Event, def: number, min = 0): number { const v = +(e.target as HTMLInputElement).value; return Math.max(min, v || def) }
  save(): void { const s = this.s(); if (s) void this.store.saveSettings(s).then(() => this.store.refreshTracker()); this.store.showSettings.set(false) }
}
