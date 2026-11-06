import { Component, computed, inject, signal } from '@angular/core'
import { LS, Store } from '../store.service'
import { Actions } from '../actions.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'
import { ContextMenuService, type MenuItem } from '../ui/context-menu'
import type { RepoEntry } from '@shared/types'

@Component({
  selector: 'pg-repositories',
  imports: [Icon, Panel],
  template: `
    <pg-panel title="Repositories">
      <ng-container actions>
        <button class="btn small" title="New group" (click)="a.createGroup()"><pg-icon name="folder-plus" [size]="14" /></button>
        <button class="btn small" title="Open repository" (click)="a.openRepo()"><pg-icon name="plus" [size]="14" /></button>
      </ng-container>
      @if (store.repos().length === 0 && store.groups().length === 0) { <div class="empty">No repositories yet.<br />Open, clone or initialize one.</div> }
      @for (g of grouped(); track g.name) {
        <div class="group-header repo-group" (click)="toggle(g.name)" (contextmenu)="groupMenu($event, g.name)">
          <span>{{ collapsed().has(g.name) ? '▸' : '▾' }}</span>{{ g.name }}<span class="count">{{ g.repos.length }}</span>
        </div>
        @if (!collapsed().has(g.name)) {
          <ul class="list">
            @for (r of g.repos; track r.path) {
              <li class="row" [class.selected]="store.repo()?.path === r.path" [title]="r.path" (click)="store.openRepo(r)" (contextmenu)="menu($event, r)">
                <span class="tree-indent"></span><pg-icon name="folder" [size]="14" /><span class="grow">{{ r.name }}</span>
              </li>
            } @empty { <li class="row muted"><span class="tree-indent"></span>Empty group</li> }
          </ul>
        }
      }
      <ul class="list">
        @for (r of ungrouped(); track r.path) {
          <li class="row" [class.selected]="store.repo()?.path === r.path" [title]="r.path" (click)="store.openRepo(r)" (contextmenu)="menu($event, r)">
            <pg-icon name="folder" [size]="14" /><span class="grow">{{ r.name }}</span>
          </li>
        }
      </ul>
    </pg-panel>`
})
export class Repositories {
  readonly store = inject(Store)
  readonly a = inject(Actions).a
  private readonly cm = inject(ContextMenuService)
  readonly collapsed = signal<Set<string>>(new Set(LS.get<string[]>('repoGroupsCollapsed', [])))
  readonly grouped = computed(() => {
    const groups = this.store.groups()
    const known = new Set(groups)
    // groups referenced by repositories but missing from the list are shown too
    for (const r of this.store.repos()) if (r.group && !known.has(r.group)) { known.add(r.group); groups.push(r.group) }
    return [...known].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, repos: this.store.repos().filter((r) => r.group === name) }))
  })
  readonly ungrouped = computed(() => this.store.repos().filter((r) => !r.group))
  toggle(name: string): void {
    const next = new Set(this.collapsed()); next.has(name) ? next.delete(name) : next.add(name)
    this.collapsed.set(next); LS.set('repoGroupsCollapsed', [...next])
  }
  menu(e: MouseEvent, r: RepoEntry): void {
    const groups = this.store.groups()
    const move: MenuItem[] = groups.filter((g) => g !== r.group).map((g) => ({ label: `Move to "${g}"`, onClick: () => void this.a.moveRepoToGroup(r.path, g) }))
    this.cm.open(e, [
      { label: 'Open', onClick: () => this.store.openRepo(r) },
      { label: 'Open in Terminal', onClick: () => void this.store.api.openTerminal(r.path) },
      { label: 'Reveal in File Manager', onClick: () => void this.store.api.revealInFinder(r.path) },
      { separator: true, label: '' },
      ...move,
      { label: 'Move to new group…', onClick: async () => { const g = await this.a.createGroup(); if (g) await this.a.moveRepoToGroup(r.path, g) } },
      ...(r.group ? [{ label: 'Remove from group', onClick: () => void this.a.moveRepoToGroup(r.path, null) }] : []),
      { separator: true, label: '' },
      { label: 'Remove from list', danger: true, onClick: () => void this.store.removeRepo(r.path) }
    ])
  }
  groupMenu(e: MouseEvent, name: string): void {
    this.cm.open(e, [
      { label: 'Open repository into this group…', onClick: () => void this.a.openRepo(name) },
      { label: 'Rename…', onClick: () => void this.a.renameGroup(name) },
      { separator: true, label: '' },
      { label: 'Delete group', danger: true, onClick: () => void this.a.deleteGroup(name) }
    ])
  }
}
