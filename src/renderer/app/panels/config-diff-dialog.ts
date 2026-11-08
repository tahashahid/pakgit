import { Component, computed, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import type { ConfigChange } from '@shared/types'

/** What the shared configuration file would change here (apply), or what pushing would change there. */
@Component({
  selector: 'pg-config-diff-dialog',
  template: `
    @if (store.showConfigDiff() && store.configSync(); as st) {
      <div class="modal-backdrop" (mousedown)="close()">
        <div class="modal wide" (mousedown)="$event.stopPropagation()">
          <h2>Shared configuration</h2>
          @if (st.error) { <p class="modal-message" style="color:var(--danger)">{{ st.error }}</p> }
          <div class="seg">
            <button type="button" class="btn small" [class.active]="side() === 'remote'" (click)="side.set('remote')">From the repository <span class="badge">{{ st.changes.length }}</span></button>
            <button type="button" class="btn small" [class.active]="side() === 'local'" (click)="side.set('local')">Your local changes <span class="badge">{{ st.localChanges.length }}</span></button>
          </div>
          <p class="modal-message">{{ side() === 'remote' ? 'Applying replaces the organization settings here with the file in the configuration repository. Repositories not cloned on this machine are listed for cloning. Your sign-ins and tokens are not touched.' : 'Pushing writes your organization settings into the configuration repository for the whole team.' }}</p>
          <div class="rebase-list" style="max-height:48vh">
            @for (c of list(); track c.path) {
              <div class="rebase-row diff-row" [class.added]="c.kind === 'added'" [class.removed]="c.kind === 'removed'">
                <span class="mono diff-path">{{ c.path }}</span>
                <span class="subject diff-vals">@if (c.kind !== 'added') { <span class="diff-from">{{ c.from || '—' }}</span> }@if (c.kind === 'changed') { <span class="muted"> → </span> }@if (c.kind !== 'removed') { <span class="diff-to">{{ c.to || '—' }}</span> }</span>
              </div>
            } @empty { <div class="empty">{{ side() === 'remote' ? 'Nothing to apply: this organization matches the repository.' : 'Nothing to push: the repository matches this organization.' }}</div> }
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" (click)="close()">Close</button>
            @if (side() === 'remote') { <button type="button" class="btn primary" [disabled]="!st.changes.length || busy()" (click)="apply()">{{ busy() ? 'Applying…' : 'Apply' }}</button> }
            @else { <button type="button" class="btn primary" [disabled]="!st.localChanges.length || busy()" (click)="push()">{{ busy() ? 'Pushing…' : 'Push…' }}</button> }
          </div>
        </div>
      </div>
    }`
})
export class ConfigDiffDialog {
  readonly store = inject(Store)
  readonly side = signal<'remote' | 'local'>('remote')
  readonly busy = signal(false)
  readonly list = computed<ConfigChange[]>(() => { const st = this.store.configSync(); return st ? (this.side() === 'remote' ? st.changes : st.localChanges) : [] })
  close(): void { this.store.showConfigDiff.set(false) }
  async apply(): Promise<void> {
    this.busy.set(true)
    try {
      const r = await this.store.api.orgConfigApply(this.store.activeOrgId())
      await this.store.reloadOrg(); await this.store.refreshTracker(); this.store.hostingStatus.set(null); this.store.index.set(null); this.store.overview.set(null)
      this.store.toast('success', `Applied: ${r.matched.length} repositories matched${r.missing.length ? `, ${r.missing.length} to clone (Configure ▸ Repositories)` : ''}`)
      await this.store.loadConfigSync(true); this.close()
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async push(): Promise<void> {
    const v = await this.store.prompt({ title: 'Push configuration', okLabel: 'Push', fields: [{ key: 'message', label: 'Commit message', value: `Update ${this.store.org()?.name ?? 'organization'} configuration` }] })
    if (!v) return
    this.busy.set(true)
    try { this.store.configSync.set(await this.store.api.orgConfigPush(this.store.activeOrgId(), String(v.message ?? ''))); this.store.toast('success', 'Configuration pushed'); this.close() }
    catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
}
