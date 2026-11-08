import { Component, computed, effect, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import { TimeAgoPipe } from '../ui/time-ago'
import type { MergedBranch } from '@shared/types'

/** Clean up merged branches: remote branches already contained in the last environment, grouped by repository, multi-select delete. */
@Component({
  selector: 'pg-cleanup-dialog',
  imports: [TimeAgoPipe],
  template: `
    @if (store.showCleanup()) {
      <div class="modal-backdrop" (mousedown)="close()">
        <div class="modal xwide" (mousedown)="$event.stopPropagation()">
          <h2>Clean up merged branches</h2>
          <p class="modal-message">Remote branches whose work is already in the last environment of their repository. Deleting removes them from the remote (and locally when not checked out); environment branches are never listed. Release and sync branches are included because their content is merged.</p>
          <div class="filter-bar" style="border:1px solid var(--border);border-radius:var(--radius)">
            <input class="filter-input" placeholder="Filter…" [value]="text()" (input)="text.set($any($event.target).value)" />
            <label><input type="checkbox" [checked]="kinds().has('work')" (change)="toggleKind('work', $any($event.target).checked)" />feature branches</label>
            <label><input type="checkbox" [checked]="kinds().has('release')" (change)="toggleKind('release', $any($event.target).checked)" />release branches</label>
            <label><input type="checkbox" [checked]="kinds().has('sync')" (change)="toggleKind('sync', $any($event.target).checked)" />sync branches</label>
            <label><input type="checkbox" [checked]="kinds().has('other')" (change)="toggleKind('other', $any($event.target).checked)" />other</label>
          </div>
          @if (loading()) { <div class="empty"><span class="spinner"></span> Looking for merged branches in {{ store.repos().length }} repositories…</div> }
          @else {
            <div class="rebase-list" style="max-height:48vh">
              @for (g of groups(); track g.repo) {
                <div class="group-header" style="padding-left:4px"><input type="checkbox" [checked]="allIn(g)" (change)="toggleRepo(g, $any($event.target).checked)" style="margin-right:6px" />{{ g.name }}<span class="count">{{ g.list.length }} merged</span></div>
                @for (b of g.list; track b.ref) {
                  <label class="rebase-row" style="cursor:pointer"><input type="checkbox" [checked]="picked().has(key(b))" (change)="toggle(b, $any($event.target).checked)" /><span class="subject mono" style="font-size:12px">{{ b.name }}</span><span class="status-pill">{{ b.kind }}</span>@if (b.local) { <span class="muted" style="font-size:11px">also local</span> }<span class="muted" style="font-size:11px">{{ b.date | timeAgo }}</span></label>
                }
              } @empty { <div class="empty">{{ all().length ? 'Nothing matches the filter.' : 'No merged branches found.' }}</div> }
            </div>
          }
          <div class="modal-actions">
            <span class="muted" style="margin-right:auto;align-self:center">{{ picked().size }} of {{ visible().length }} selected</span>
            <button type="button" class="btn" (click)="close()">Close</button>
            <button type="button" class="btn" [disabled]="loading()" (click)="load()">Refresh</button>
            <button type="button" class="btn danger" [disabled]="!picked().size || busy()" (click)="remove()">{{ busy() ? 'Deleting…' : 'Delete ' + picked().size + ' branch(es)…' }}</button>
          </div>
        </div>
      </div>
    }`
})
export class CleanupDialog {
  readonly store = inject(Store)
  readonly all = signal<MergedBranch[]>([])
  readonly loading = signal(false)
  readonly busy = signal(false)
  readonly text = signal('')
  readonly kinds = signal<Set<MergedBranch['kind']>>(new Set(['work', 'release', 'sync']))
  readonly picked = signal<Set<string>>(new Set())
  readonly visible = computed(() => { const q = this.text().toLowerCase(); return this.all().filter((b) => this.kinds().has(b.kind) && (!q || b.name.toLowerCase().includes(q) || b.repoName.toLowerCase().includes(q))) })
  readonly groups = computed(() => {
    const m = new Map<string, { repo: string; name: string; list: MergedBranch[] }>()
    for (const b of this.visible()) { if (!m.has(b.repo)) m.set(b.repo, { repo: b.repo, name: b.repoName, list: [] }); m.get(b.repo)!.list.push(b) }
    return [...m.values()]
  })
  constructor() { effect(() => { if (this.store.showCleanup()) void this.load() }) }
  key(b: MergedBranch): string { return `${b.repo}\n${b.name}` }
  close(): void { this.store.showCleanup.set(false) }
  async load(): Promise<void> {
    this.loading.set(true); this.picked.set(new Set())
    try { this.all.set(await this.store.api.orgMergedBranches(this.store.activeOrgId())) } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.loading.set(false) }
  }
  toggleKind(k: MergedBranch['kind'], on: boolean): void { const n = new Set(this.kinds()); on ? n.add(k) : n.delete(k); this.kinds.set(n) }
  toggle(b: MergedBranch, on: boolean): void { const n = new Set(this.picked()); on ? n.add(this.key(b)) : n.delete(this.key(b)); this.picked.set(n) }
  allIn(g: { list: MergedBranch[] }): boolean { return g.list.length > 0 && g.list.every((b) => this.picked().has(this.key(b))) }
  toggleRepo(g: { list: MergedBranch[] }, on: boolean): void { const n = new Set(this.picked()); for (const b of g.list) on ? n.add(this.key(b)) : n.delete(this.key(b)); this.picked.set(n) }
  async remove(): Promise<void> {
    const list = this.all().filter((b) => this.picked().has(this.key(b)))
    const ok = await this.store.prompt({ title: `Delete ${list.length} branch(es)`, danger: true, okLabel: 'Delete', message: `Deletes these branches on the remote and locally:\n${list.slice(0, 12).map((b) => `• ${b.repoName}: ${b.name}`).join('\n')}${list.length > 12 ? `\n… and ${list.length - 12} more` : ''}\n\nThis cannot be undone from PakGit (the commits stay reachable from the environment branches).` })
    if (!ok) return
    this.busy.set(true)
    try {
      const r = await this.store.api.orgDeleteBranches(this.store.activeOrgId(), list.map((b) => ({ repo: b.repo, name: b.name })))
      this.store.toast(r.failed.length ? 'error' : 'success', `Deleted ${r.deleted.length} branch(es)${r.failed.length ? `; ${r.failed.length} failed: ${r.failed.slice(0, 3).map((f) => f.name + ' (' + f.error + ')').join(', ')}` : ''}`)
      await this.load(); void this.store.loadIndex(); void this.store.loadOverview()
    } catch (e) { this.store.toast('error', e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
}
