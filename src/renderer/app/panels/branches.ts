import { Component, ElementRef, computed, effect, inject, signal } from '@angular/core'
import { NgTemplateOutlet } from '@angular/common'
import { LS } from '../store.service'
import { buildTree, ancestorsOf, type TreeNode } from '../../lib/tree'
import { Store } from '../store.service'
import { Actions } from '../actions.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'
import { ContextMenuService } from '../ui/context-menu'
import type { BranchInfo, RemoteInfo, StashInfo, SubmoduleInfo, TagInfo, WorktreeInfo } from '@shared/types'

@Component({
  selector: 'pg-branches',
  imports: [Icon, Panel, NgTemplateOutlet],
  template: `
    <!-- recursive folder tree for branches and tags -->
    <ng-template #tree let-nodes let-depth="depth" let-kind="kind" let-remote="remote">
      @for (n of nodes; track n.path) {
        <li class="row folder" [style.paddingLeft.px]="8 + depth * 14" (click)="toggleFolder(kind, remote, n.path)" (contextmenu)="folderMenu($event, kind, remote, n)">
          <span class="caret">{{ isOpen(kind, remote, n.path) ? '▾' : '▸' }}</span><pg-icon [name]="isOpen(kind, remote, n.path) ? 'folder-open' : 'folder'" [size]="13" /><span class="grow">{{ n.name }}/</span><span class="muted count-chip">{{ n.count }}</span>
        </li>
        @if (isOpen(kind, remote, n.path)) {
          <ng-container *ngTemplateOutlet="tree; context: { $implicit: n.children, depth: depth + 1, kind, remote }" />
          @for (leaf of itemsOf(nodes, n.path); track leaf.label) {
            <ng-container *ngTemplateOutlet="leafTpl; context: { $implicit: leaf, depth: depth + 1, kind }" />
          }
        }
      }
    </ng-template>
    <ng-template #leafTpl let-leaf let-depth="depth" let-kind="kind">
      @if (kind === 'tag') {
        <li class="row" [style.paddingLeft.px]="8 + depth * 14" (dblclick)="a.checkoutTag(leaf.item)" (contextmenu)="tagMenu($event, leaf.item)"><pg-icon name="tag" [size]="13" /><span class="grow">{{ leaf.label }}</span><span class="mono muted">{{ leaf.item.sha.slice(0, 7) }}</span></li>
      } @else {
        <li class="row" [style.paddingLeft.px]="8 + depth * 14" [class.selected]="leaf.item.current" [title]="leaf.item.fullName" (dblclick)="a.checkout(leaf.item)" (contextmenu)="branchMenu($event, leaf.item)">
          <pg-icon name="branch" [size]="13" /><span class="grow" [style.fontWeight]="leaf.item.current ? 600 : 400">{{ leaf.label }}</span>
          @if (leaf.item.upstream) { <span class="muted" style="font-size:11px">{{ leaf.item.ahead ? '↑' + leaf.item.ahead + ' ' : '' }}{{ leaf.item.behind ? '↓' + leaf.item.behind : '' }}</span> }
        </li>
      }
    </ng-template>

    <pg-panel title="Branches">
      <ng-container actions>
        <button class="btn small" title="Add branch" (click)="a.addBranch()"><pg-icon name="plus" [size]="14" /></button>
        <button class="btn small" title="Fetch all" (click)="a.fetch()"><pg-icon name="fetch" [size]="14" /></button>
      </ng-container>
      @if (store.status(); as st) {
        <div class="current-branch" (click)="revealCurrent()" title="Current branch (click to reveal in the tree)" (contextmenu)="currentMenu($event)">
          <pg-icon name="branch" [size]="14" />
          <span class="grow">
            <b>{{ st.detached ? 'detached HEAD' : (st.branch ?? '(no branch)') }}</b>
            @if (st.upstream) { <span class="upstream">→ {{ st.upstream }}{{ st.ahead ? ' ↑' + st.ahead : '' }}{{ st.behind ? ' ↓' + st.behind : '' }}</span> }
          </span>
        </div>
      }
      <input class="filter-input" placeholder="Filter branches, tags…" [value]="filter()" (input)="filter.set($any($event.target).value)" />

      <div class="group-header" (click)="toggle('local')"><span>{{ open('local') ? '▾' : '▸' }}</span>Local Branches<span class="count">{{ local().length }}</span></div>
      @if (open('local')) {
        <ul class="list">
          <ng-container *ngTemplateOutlet="tree; context: { $implicit: localTree().children, depth: 0, kind: 'local', remote: '' }" />
          @for (leaf of localTree().items; track leaf.label) { <ng-container *ngTemplateOutlet="leafTpl; context: { $implicit: leaf, depth: 0, kind: 'local' }" /> }
          @if (!localTree().count) { <li class="row muted">—</li> }
        </ul>
      }

      @for (r of remotes(); track r.name) {
        <div class="group-header" (click)="toggle('remote:' + r.name)"><span>{{ open('remote:' + r.name, remotes().length === 1) ? '▾' : '▸' }}</span>Remote: {{ r.name }}<span class="count">{{ remoteBranches(r.name).length }}</span></div>
        @if (open('remote:' + r.name, remotes().length === 1)) {
          <ul class="list">
            <ng-container *ngTemplateOutlet="tree; context: { $implicit: remoteTree(r.name).children, depth: 1, kind: 'remote', remote: r.name }" />
            @for (leaf of remoteTree(r.name).items; track leaf.label) { <ng-container *ngTemplateOutlet="leafTpl; context: { $implicit: leaf, depth: 1, kind: 'remote' }" /> }
            <li class="row muted" style="font-size:11px" (contextmenu)="remoteMenu($event, r)"><span class="tree-indent"></span>{{ r.fetchUrl }}</li>
          </ul>
        }
      } @empty { <div class="group-header" (click)="a.addRemote()">+ Add remote repository…</div> }

      <div class="group-header" (click)="toggle('tags')"><span>{{ open('tags', tags().length <= 20) ? '▾' : '▸' }}</span>Tags<span class="count">{{ tags().length }}</span></div>
      @if (open('tags', tags().length <= 20)) {
        <ul class="list">
          <ng-container *ngTemplateOutlet="tree; context: { $implicit: tagTree().children, depth: 0, kind: 'tag', remote: '' }" />
          @for (leaf of tagTree().items; track leaf.label) { <ng-container *ngTemplateOutlet="leafTpl; context: { $implicit: leaf, depth: 0, kind: 'tag' }" /> }
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

  // --- folder trees (names grouped by "/" prefix) ---
  readonly localTree = computed(() => buildTree(this.local(), (b) => b.name))
  readonly tagTree = computed(() => buildTree(this.tags(), (t) => t.name))
  private readonly remoteTrees = computed(() => { const m = new Map<string, TreeNode<BranchInfo>>(); for (const r of this.remotes()) m.set(r.name, buildTree(this.remoteBranches(r.name), (b) => b.name)); return m })
  remoteTree(remote: string): TreeNode<BranchInfo> { return this.remoteTrees().get(remote) ?? buildTree([], () => '') }
  /** expanded folder keys ("kind:remote:path"), persisted per repository */
  private readonly expanded = signal<Set<string>>(new Set())
  private key(kind: string, remote: string, path: string): string { return `${kind}:${remote}:${path}` }
  isOpen(kind: string, remote: string, path: string): boolean {
    if (this.filter()) return true // searching: show everything that matches
    return this.expanded().has(this.key(kind, remote, path))
  }
  toggleFolder(kind: string, remote: string, path: string): void {
    const k = this.key(kind, remote, path); const next = new Set(this.expanded())
    next.has(k) ? next.delete(k) : next.add(k)
    this.expanded.set(next)
    const repo = this.store.repo(); if (repo) LS.set('branchTree:' + repo.path, [...next])
  }
  itemsOf(nodes: TreeNode<BranchInfo | TagInfo>[], path: string): { label: string; item: BranchInfo | TagInfo }[] { return nodes.find((n) => n.path === path)?.items ?? [] }
  folderMenu(e: MouseEvent, kind: string, remote: string, n: TreeNode<BranchInfo | TagInfo>): void {
    const open = this.isOpen(kind, remote, n.path)
    const all = (node: TreeNode<BranchInfo | TagInfo>): string[] => [this.key(kind, remote, node.path), ...node.children.flatMap(all)]
    this.cm.open(e, [
      { label: open ? 'Collapse' : 'Expand', onClick: () => this.toggleFolder(kind, remote, n.path) },
      { label: 'Expand all below', onClick: () => { const next = new Set(this.expanded()); for (const k of all(n)) next.add(k); this.expanded.set(next) } },
      { label: 'Collapse all below', onClick: () => { const next = new Set(this.expanded()); for (const k of all(n)) next.delete(k); this.expanded.set(next) } },
      { label: 'Copy prefix', onClick: () => this.a.copy(n.path + '/') }
    ])
  }
  /** Expand the folders of the current branch and scroll it into view. */
  revealCurrent(): void {
    const cur = this.store.refs()?.branches.find((b) => b.current); if (!cur) return
    this.filter.set('')
    this.openState.update((o) => ({ ...o, local: true }))
    const next = new Set(this.expanded()); for (const p of ancestorsOf(cur.name)) next.add(this.key('local', '', p)); this.expanded.set(next)
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.row.selected')?.scrollIntoView({ block: 'center' }), 50)
  }
  currentMenu(e: MouseEvent): void {
    const cur = this.store.refs()?.branches.find((b) => b.current); if (!cur) return
    this.branchMenu(e, cur)
  }
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
  constructor() {
    // restore expansion per repository and always reveal the current branch's folders
    effect(() => {
      const repo = this.store.repo(); const refs = this.store.refs()
      const saved = repo ? LS.get<string[]>('branchTree:' + repo.path, []) : []
      const next = new Set(saved)
      const cur = refs?.branches.find((b) => b.current)
      if (cur) for (const p of ancestorsOf(cur.name)) next.add(this.key('local', '', p))
      this.expanded.set(next)
    })
  }
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
