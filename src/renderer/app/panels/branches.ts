import { Component, computed, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import { Actions } from '../actions.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'
import { ContextMenuService } from '../ui/context-menu'
import type { BranchInfo, RemoteInfo, StashInfo, SubmoduleInfo, TagInfo, WorktreeInfo } from '@shared/types'

@Component({
  selector: 'pg-branches',
  imports: [Icon, Panel],
  template: `
    <pg-panel title="Branches">
      <ng-container actions>
        <button class="btn small" title="Add branch" (click)="a.addBranch()"><pg-icon name="plus" [size]="14" /></button>
        <button class="btn small" title="Fetch all" (click)="a.fetch()"><pg-icon name="fetch" [size]="14" /></button>
      </ng-container>
      <input class="filter-input" placeholder="Filter branches, tags…" [value]="filter()" (input)="filter.set($any($event.target).value)" />

      <div class="group-header" (click)="toggle('local')"><span>{{ open('local') ? '▾' : '▸' }}</span>Local Branches<span class="count">{{ local().length }}</span></div>
      @if (open('local')) {
        <ul class="list">
          @for (b of local(); track b.fullName) {
            <li class="row" [class.selected]="b.current" (dblclick)="a.checkout(b)" (contextmenu)="branchMenu($event, b)">
              <pg-icon name="branch" [size]="13" /><span class="grow" [style.fontWeight]="b.current ? 600 : 400">{{ b.name }}</span>
              @if (b.upstream) { <span class="muted" style="font-size:11px">{{ b.ahead ? '↑' + b.ahead + ' ' : '' }}{{ b.behind ? '↓' + b.behind : '' }}</span> }
            </li>
          } @empty { <li class="row muted">—</li> }
        </ul>
      }

      @for (r of remotes(); track r.name) {
        <div class="group-header" (click)="toggle('remote:' + r.name)"><span>{{ open('remote:' + r.name, remotes().length === 1) ? '▾' : '▸' }}</span>Remote: {{ r.name }}<span class="count">{{ remoteBranches(r.name).length }}</span></div>
        @if (open('remote:' + r.name, remotes().length === 1)) {
          <ul class="list">
            @for (b of remoteBranches(r.name); track b.fullName) {
              <li class="row" [title]="r.fetchUrl" (dblclick)="a.checkout(b)" (contextmenu)="branchMenu($event, b)"><span class="tree-indent"></span><pg-icon name="branch" [size]="13" /><span class="grow">{{ b.name }}</span></li>
            }
            <li class="row muted" style="font-size:11px" (contextmenu)="remoteMenu($event, r)"><span class="tree-indent"></span>{{ r.fetchUrl }}</li>
          </ul>
        }
      } @empty { <div class="group-header" (click)="a.addRemote()">+ Add remote repository…</div> }

      <div class="group-header" (click)="toggle('tags')"><span>{{ open('tags', tags().length <= 20) ? '▾' : '▸' }}</span>Tags<span class="count">{{ tags().length }}</span></div>
      @if (open('tags', tags().length <= 20)) {
        <ul class="list">
          @for (t of tags(); track t.name) {
            <li class="row" (dblclick)="a.checkoutTag(t)" (contextmenu)="tagMenu($event, t)"><pg-icon name="tag" [size]="13" /><span class="grow">{{ t.name }}</span><span class="mono muted">{{ t.sha.slice(0, 7) }}</span></li>
          }
        </ul>
      }

      <div class="group-header" (click)="toggle('stashes')"><span>{{ open('stashes') ? '▾' : '▸' }}</span>Stashes<span class="count">{{ stashes().length }}</span></div>
      @if (open('stashes')) {
        <ul class="list">
          @for (st of stashes(); track st.ref) {
            <li class="row" [class.selected]="store.selectedStash()?.ref === st.ref" (click)="store.selectStash(st)" (dblclick)="a.stashApply(st, false)" (contextmenu)="stashMenu($event, st)">
              <pg-icon name="stash" [size]="13" /><span class="grow">{{ st.message }}</span><span class="muted">{{ st.ref }}</span>
            </li>
          } @empty { <li class="row muted">No stash available</li> }
        </ul>
      }

      @if (store.submodules().length) {
        <div class="group-header" (click)="toggle('sub')"><span>{{ open('sub') ? '▾' : '▸' }}</span>Submodules<span class="count">{{ store.submodules().length }}</span></div>
        @if (open('sub')) {
          <ul class="list">
            @for (sm of store.submodules(); track sm.path) {
              <li class="row" [title]="sm.sha + ' ' + sm.ref" (dblclick)="sm.state !== 'uninitialized' && a.openPath(sm.path)" (contextmenu)="subMenu($event, sm)">
                <pg-icon name="submodule" [size]="13" /><span class="grow">{{ sm.path }}</span><span class="sub-state">{{ sm.state }}</span>
              </li>
            }
          </ul>
        }
      }

      <div class="group-header" (click)="toggle('wt')"><span>{{ open('wt', store.worktrees().length > 1) ? '▾' : '▸' }}</span>Worktrees<span class="count">{{ store.worktrees().length }}</span></div>
      @if (open('wt', store.worktrees().length > 1)) {
        <ul class="list">
          @for (wt of store.worktrees(); track wt.path) {
            <li class="row" [title]="wt.path" (dblclick)="!wt.main && a.openPath(wt.path)" (contextmenu)="wtMenu($event, wt)">
              <pg-icon name="worktree" [size]="13" /><span class="grow">{{ wt.branch ?? wt.sha.slice(0, 7) }}</span><span class="muted" style="font-size:11px">{{ wt.main ? 'main' : wt.path.split('/').pop() }}</span>
            </li>
          }
          <li class="row muted" style="cursor:pointer" (click)="a.worktreeAdd()">+ Add worktree…</li>
        </ul>
      }
      @if (store.status()?.state; as state) { @if (state !== 'clean') { <div class="group-header">State: {{ state }}</div> } }
    </pg-panel>`
})
export class Branches {
  readonly store = inject(Store)
  readonly a = inject(Actions).a
  private readonly cm = inject(ContextMenuService)
  readonly filter = signal('')
  private readonly openState = signal<Record<string, boolean>>({})
  private readonly f = (n: string) => !this.filter() || n.toLowerCase().includes(this.filter().toLowerCase())
  readonly local = computed(() => (this.store.refs()?.branches ?? []).filter((b) => !b.remote && this.f(b.name)))
  readonly remotes = computed(() => this.store.refs()?.remotes ?? [])
  readonly tags = computed(() => (this.store.refs()?.tags ?? []).filter((t) => this.f(t.name)))
  readonly stashes = computed(() => this.store.refs()?.stashes ?? [])
  remoteBranches(remote: string): BranchInfo[] { return (this.store.refs()?.branches ?? []).filter((b) => b.remote === remote && this.f(b.name)) }
  open(k: string, def = true): boolean { return this.openState()[k] ?? def }
  toggle(k: string): void { const cur = this.open(k, k.startsWith('remote:') ? this.remotes().length === 1 : k === 'tags' ? this.tags().length <= 20 : k === 'wt' ? this.store.worktrees().length > 1 : true); this.openState.update((s) => ({ ...s, [k]: !cur })) }

  branchMenu(e: MouseEvent, b: BranchInfo): void {
    const a = this.a
    this.cm.open(e, [
      { label: b.remote ? 'Check Out (track)' : 'Check Out', onClick: () => void a.checkout(b), disabled: b.current },
      { label: 'Merge into current', onClick: () => void a.merge(b.fullName), disabled: b.current },
      { label: 'Rebase current onto', onClick: () => void a.rebase(b.fullName), disabled: b.current },
      { label: 'Add Branch from here…', onClick: () => void a.addBranch(b.fullName) },
      { separator: true, label: '' },
      ...(b.remote ? [] : [
        { label: 'Push…', onClick: () => void a.pushBranch(b) },
        { label: 'Track Remote Branch…', onClick: () => void a.setUpstream(b) },
        { label: 'Rename…', onClick: () => void a.renameBranch(b) }
      ]),
      { label: 'Copy name', onClick: () => a.copy(b.fullName) },
      { separator: true, label: '' },
      { label: 'Delete…', danger: true, onClick: () => void a.deleteBranch(b), disabled: b.current }
    ])
  }
  remoteMenu(e: MouseEvent, r: RemoteInfo): void {
    this.cm.open(e, [
      { label: 'Fetch', onClick: () => void this.a.fetch(r.name) },
      { label: 'Copy URL', onClick: () => this.a.copy(r.fetchUrl) },
      { label: 'Delete remote…', danger: true, onClick: () => void this.a.removeRemote(r.name) }
    ])
  }
  tagMenu(e: MouseEvent, t: TagInfo): void {
    this.cm.open(e, [
      { label: 'Check Out Tag', onClick: () => void this.a.checkoutTag(t) },
      { label: 'Copy name', onClick: () => this.a.copy(t.name) },
      { label: 'Delete…', danger: true, onClick: () => void this.a.deleteTag(t) }
    ])
  }
  stashMenu(e: MouseEvent, st: StashInfo): void {
    this.cm.open(e, [
      { label: 'Apply Stash', onClick: () => void this.a.stashApply(st, false) },
      { label: 'Apply & Drop (pop)', onClick: () => void this.a.stashApply(st, true) },
      { label: 'Drop…', danger: true, onClick: () => void this.a.stashDrop(st) }
    ])
  }
  subMenu(e: MouseEvent, sm: SubmoduleInfo): void {
    this.cm.open(e, [
      { label: 'Open Submodule', onClick: () => this.a.openPath(sm.path), disabled: sm.state === 'uninitialized' },
      { label: sm.state === 'uninitialized' ? 'Initialize' : 'Update', onClick: () => void this.a.submoduleUpdate([sm.path]) },
      { label: 'Update all submodules', onClick: () => void this.a.submoduleUpdate() }
    ])
  }
  wtMenu(e: MouseEvent, wt: WorktreeInfo): void {
    this.cm.open(e, [
      { label: 'Open Worktree', onClick: () => this.a.openPath(wt.path), disabled: wt.main },
      { label: 'Copy path', onClick: () => this.a.copy(wt.path) },
      { label: 'Remove…', danger: true, onClick: () => void this.a.worktreeRemove(wt.path), disabled: wt.main }
    ])
  }
}
