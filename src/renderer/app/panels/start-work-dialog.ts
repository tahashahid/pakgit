import { Component, computed, effect, inject, input, output, signal } from '@angular/core'
import { LS, Store } from '../store.service'

export interface StartWorkIssue { key: string | null; title: string; branchName?: string }

/** "Start work…" from the Work tab: one branch name, created in several repositories of the organization. */
@Component({
  selector: 'pg-start-work-dialog',
  template: `
    <div class="modal-backdrop" (mousedown)="closed.emit()">
      <form class="modal wide" (mousedown)="$event.stopPropagation()" (submit)="$event.preventDefault(); submit()">
        <h2>Start work{{ issue().key ? ' on ' + issue().key : '' }}</h2>
        @if (issue().title) { <p class="modal-message">{{ issue().title }}</p> }
        <label class="field"><span>Branch name</span><input class="mono" [value]="branch()" (input)="branch.set($any($event.target).value)" placeholder="user/cyb4-123-short-title" data-first /><small class="hint">Created in each chosen repository from its base environment branch (fetched first) and checked out there. Convention: Configure ▸ Conventions.</small></label>
        <div class="group-header">Repositories<span class="count">{{ picked().size }} of {{ store.repos().length }}</span></div>
        <div class="rebase-list" style="max-height:40vh">
          @for (r of store.repos(); track r.path) {
            <label class="rebase-row" style="cursor:pointer">
              <input type="checkbox" [checked]="picked().has(r.path)" (change)="toggle(r.path, $any($event.target).checked)" />
              <span class="subject">{{ r.name }}</span>
              @if (r.group) { <span class="muted" style="font-size:11px">{{ r.group }}</span> }
              @if (existing()[r.path]; as b) { <span class="status-pill started" [title]="'This repository already has ' + b + ' for the issue'">has {{ b }}</span> }
            </label>
          }
        </div>
        @if (issue().key && trackerOk()) {
          <label class="field field-check"><input type="checkbox" [checked]="updateTracker()" (change)="updateTracker.set($any($event.target).checked)" /><span>Move {{ issue().key }} to "{{ store.org()?.tracker?.stateOnStart || 'In Progress' }}" in Linear</span></label>
        }
        @if (error()) { <p class="modal-message" style="color:var(--danger)">{{ error() }}</p> }
        <div class="modal-actions">
          <button type="button" class="btn" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn primary" [disabled]="!branch().trim() || !picked().size || busy()">{{ busy() ? 'Creating…' : 'Create ' + picked().size + ' branch(es)' }}</button>
        </div>
      </form>
    </div>`
})
export class StartWorkDialog {
  readonly issue = input.required<StartWorkIssue>()
  readonly closed = output<void>()
  readonly done = output<void>()
  readonly store = inject(Store)
  readonly branch = signal('')
  readonly picked = signal<Set<string>>(new Set())
  readonly updateTracker = signal<boolean>(LS.get('release.updateTracker', true))
  readonly busy = signal(false)
  readonly error = signal('')
  readonly trackerOk = computed(() => { const t = this.store.trackerStatus(); return !!t && t.configured && !t.error })
  /** repository path -> branch that already carries the issue there */
  readonly existing = computed<Record<string, string>>(() => {
    const key = this.issue().key; const idx = this.store.index(); if (!key || !idx) return {}
    const it = idx.items.find((i) => i.issueKey === key)
    return Object.fromEntries((it?.parts ?? []).filter((p) => p.branch).map((p) => [p.repo, p.branch!]))
  })
  constructor() {
    effect(() => {
      const i = this.issue()
      const cur = this.store.repo()?.path
      this.picked.set(new Set(cur && this.store.repos().some((r) => r.path === cur) ? [cur] : []))
      if (i.key) this.store.api.orgSuggestBranch(this.store.activeOrgId(), { key: i.key, title: i.title, branchName: i.branchName }).then((b) => this.branch.set(b)).catch(() => this.branch.set(i.branchName ?? ''))
      else this.branch.set(i.branchName ?? '')
    })
    effect(() => LS.set('release.updateTracker', this.updateTracker()))
  }
  toggle(path: string, on: boolean): void { const n = new Set(this.picked()); on ? n.add(path) : n.delete(path); this.picked.set(n) }
  async submit(): Promise<void> {
    const i = this.issue(); const repos = [...this.picked()]; if (!repos.length) return
    this.busy.set(true); this.error.set('')
    try {
      const res = await this.store.api.orgStartWork(this.store.activeOrgId(), { key: i.key, branch: this.branch().trim(), repos })
      const names = (paths: string[]) => paths.map((p) => this.store.repos().find((r) => r.path === p)?.name ?? p)
      if (res.created.length) this.store.toast('success', `Created ${this.branch().trim()} in ${names(res.created).join(', ')}`)
      for (const f of res.failed) this.store.toast('error', `${names([f.repo])[0]}: ${f.error}`)
      if (res.created.length && i.key && this.updateTracker() && this.trackerOk()) {
        const state = this.store.org()?.tracker.stateOnStart
        if (state) await this.store.api.trackerSetState(i.key, state).catch((e) => this.store.toast('error', `Linear: ${e instanceof Error ? e.message : String(e)}`))
      }
      if (res.created.length) { this.done.emit(); this.closed.emit() }
      else this.error.set('No branch was created.')
    } catch (e) { this.error.set(e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
}
