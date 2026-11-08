import { Component, computed, effect, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import type { OwnerProposal, RepoEntry } from '@shared/types'

/** "New organization": name it, pick the repositories (proposed from a shared hosting owner), optionally move the Linear connection. */
@Component({
  selector: 'pg-new-org-dialog',
  template: `
    @if (store.showNewOrg()) {
      <div class="modal-backdrop" (mousedown)="store.showNewOrg.set(false)">
        <form class="modal wide" (mousedown)="$event.stopPropagation()" (submit)="$event.preventDefault(); create()">
          <h2>New organization</h2>
          <p class="modal-message">An organization owns repositories, one pipeline template, conventions and the issue tracker they share. Repositories you tick move out of {{ store.org()?.name ?? 'Personal' }}.</p>
          <div class="settings-grid">
            <label class="field"><span>Name</span><input [value]="name()" placeholder="CyberNut" (input)="name.set($any($event.target).value)" /></label>
            @if (proposals().length) {
              <label class="field"><span>Start from a hosting owner</span>
                <select (change)="pick($any($event.target).value)">
                  <option value="" [selected]="!picked()">— none —</option>
                  @for (p of proposals(); track p.host + p.owner) { <option [value]="p.host + '/' + p.owner" [selected]="picked() === p.host + '/' + p.owner">{{ p.owner }} on {{ p.host }} ({{ p.repos.length }})</option> }
                </select>
                <small class="hint">Repositories whose remote shares an owner, detected from their URLs.</small></label>
            }
          </div>
          <div class="group-header">Repositories to move<span class="count">{{ selected().size }}</span></div>
          <ul class="list rebase-list" style="max-height:40vh">
            @for (r of store.repos(); track r.path) {
              <li class="row"><input type="checkbox" [checked]="selected().has(r.path)" (change)="toggle(r.path, $any($event.target).checked)" /><span class="grow">{{ r.name }}</span><span class="mono muted" style="font-size:11px">{{ r.remote ?? 'no remote' }}</span></li>
            } @empty { <li class="row muted">No repositories in {{ store.org()?.name }} to move; you can add some later.</li> }
          </ul>
          @if (trackerConfigured()) {
            <label class="field field-check"><input type="checkbox" [checked]="moveTracker()" (change)="moveTracker.set($any($event.target).checked)" /><span>Move the {{ store.org()?.tracker?.provider }} connection from {{ store.org()?.name }} to the new organization</span></label>
          }
          @if (error()) { <p class="modal-message" style="color:var(--danger)">{{ error() }}</p> }
          <div class="modal-actions">
            <button type="button" class="btn" (click)="store.showNewOrg.set(false)">Cancel</button>
            <button type="submit" class="btn primary" [disabled]="!name().trim() || busy()">Create organization</button>
          </div>
        </form>
      </div>
    }`
})
export class NewOrgDialog {
  readonly store = inject(Store)
  readonly name = signal('')
  readonly proposals = signal<OwnerProposal[]>([])
  readonly picked = signal('')
  readonly selected = signal<Set<string>>(new Set())
  readonly moveTracker = signal(true)
  readonly busy = signal(false)
  readonly error = signal('')
  readonly trackerConfigured = computed(() => (this.store.org()?.tracker.provider ?? 'none') !== 'none')
  constructor() {
    effect(() => {
      if (!this.store.showNewOrg()) return
      this.name.set(''); this.picked.set(''); this.selected.set(new Set()); this.error.set(''); this.moveTracker.set(true)
      this.store.api.orgProposals().then((p) => { this.proposals.set(p); if (p[0]) this.pick(`${p[0].host}/${p[0].owner}`) }).catch(() => this.proposals.set([]))
    })
  }
  pick(key: string): void {
    this.picked.set(key)
    const p = this.proposals().find((x) => `${x.host}/${x.owner}` === key)
    if (!p) { this.selected.set(new Set()); return }
    this.selected.set(new Set(p.repos.map((r: RepoEntry) => r.path)))
    if (!this.name().trim()) this.name.set(p.owner.split('/').pop()!.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
  }
  toggle(path: string, on: boolean): void { const n = new Set(this.selected()); on ? n.add(path) : n.delete(path); this.selected.set(n) }
  async create(): Promise<void> {
    this.busy.set(true); this.error.set('')
    try {
      const from = this.store.activeOrgId()
      const o = await this.store.api.orgCreate({ name: this.name().trim(), repoPaths: [...this.selected()], moveTrackerFrom: this.trackerConfigured() && this.moveTracker() ? from : null })
      this.store.showNewOrg.set(false)
      await this.store.loadWorkspace(); await this.store.switchOrg(o.id)
      this.store.toast('success', `Created ${o.name} with ${this.selected().size} repositories`)
      this.store.perspective.set('organization')
    } catch (e) { this.error.set(e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
}
