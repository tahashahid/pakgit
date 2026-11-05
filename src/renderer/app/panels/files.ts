import { Component, computed, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import { Actions } from '../actions.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'
import { ContextMenuService } from '../ui/context-menu'
import type { FileArea, FileEntry } from '@shared/types'

const AREA_TITLES: Record<FileArea, string> = { conflicted: 'Conflicts', staged: 'Staged Changes', unstaged: 'Changes', untracked: 'Untracked Files' }
const ORDER: FileArea[] = ['conflicted', 'staged', 'unstaged', 'untracked']

@Component({
  selector: 'pg-files',
  imports: [Icon, Panel],
  template: `
    <pg-panel title="Files">
      <ng-container actions>
        <button class="btn small" title="Stage all" [disabled]="!unstagedCount()" (click)="a.stageAll()"><pg-icon name="stage" [size]="14" /></button>
        <button class="btn small" title="Unstage all" [disabled]="!groups().staged.length" (click)="a.unstageAll()"><pg-icon name="unstage" [size]="14" /></button>
        <button class="btn small danger" title="Discard selected" [disabled]="!store.selectedFiles().length" (click)="a.discard(store.selectedFiles())"><pg-icon name="discard" [size]="14" /></button>
      </ng-container>
      <input class="filter-input" placeholder="Filter files…" [value]="filter()" (input)="filter.set($any($event.target).value)" />
      @if (!store.status()?.files?.length) { <div class="empty">Working tree is clean.</div> }
      @for (area of order; track area) {
        @if (groups()[area].length) {
          <div class="group-header" (click)="toggleGroup(area)"><span>{{ collapsed()[area] ? '▸' : '▾' }}</span>{{ titles[area] }}<span class="count">{{ groups()[area].length }}</span></div>
          @if (!collapsed()[area]) {
            <ul class="list">
              @for (f of groups()[area]; track f.area + f.path) {
                <li class="row" [class.selected]="isSel(f)" [title]="f.oldPath ? f.oldPath + ' → ' + f.path : f.path" (click)="click($event, f, groups()[area])" (dblclick)="toggle(f)" (contextmenu)="menu($event, f)">
                  <input type="checkbox" [checked]="f.area === 'staged'" (change)="toggle(f)" (click)="$event.stopPropagation()" [title]="f.area === 'staged' ? 'Unstage' : 'Stage'" />
                  <span class="status-chip" [class]="'status-chip st-' + code(f)">{{ code(f) }}</span>
                  <span class="grow">@if (f.path.includes('/')) { <span class="muted">{{ dir(f.path) }}</span>{{ base(f.path) }} } @else { {{ f.path }} }</span>
                </li>
              }
            </ul>
          }
        }
      }
    </pg-panel>`
})
export class Files {
  readonly store = inject(Store)
  readonly a = inject(Actions).a
  private readonly cm = inject(ContextMenuService)
  readonly order = ORDER
  readonly titles = AREA_TITLES
  readonly filter = signal('')
  readonly collapsed = signal<Record<string, boolean>>({})
  readonly groups = computed(() => {
    const g: Record<FileArea, FileEntry[]> = { conflicted: [], staged: [], unstaged: [], untracked: [] }
    const q = this.filter().toLowerCase()
    for (const f of this.store.status()?.files ?? []) if (!q || f.path.toLowerCase().includes(q)) g[f.area].push(f)
    return g
  })
  readonly unstagedCount = computed(() => { const g = this.groups(); return g.unstaged.length + g.untracked.length + g.conflicted.length })
  code(f: FileEntry): string { return f.area === 'untracked' ? '?' : f.area === 'conflicted' ? 'U' : f.area === 'staged' ? f.index : f.worktree }
  dir(p: string): string { return p.slice(0, p.lastIndexOf('/') + 1) }
  base(p: string): string { return p.slice(p.lastIndexOf('/') + 1) }
  isSel(f: FileEntry): boolean { return this.store.selectedFiles().some((s) => s.path === f.path && s.area === f.area) }
  toggleGroup(area: string): void { this.collapsed.update((c) => ({ ...c, [area]: !c[area] })) }
  click(e: MouseEvent, f: FileEntry, list: FileEntry[]): void {
    const sel = this.store.selectedFiles()
    if (e.shiftKey && sel.length) {
      const i = list.findIndex((x) => x.path === sel[sel.length - 1].path); const j = list.indexOf(f)
      if (i >= 0) { this.store.selectFiles(list.slice(Math.min(i, j), Math.max(i, j) + 1)); return }
    }
    if (e.metaKey || e.ctrlKey) this.store.selectFiles(this.isSel(f) ? sel.filter((s) => !(s.path === f.path && s.area === f.area)) : [...sel, f])
    else this.store.selectFiles([f])
  }
  private target(f: FileEntry): FileEntry[] { return this.isSel(f) ? this.store.selectedFiles() : [f] }
  toggle(f: FileEntry): void { void (f.area === 'staged' ? this.a.unstage(this.target(f)) : this.a.stage(this.target(f))) }
  menu(e: MouseEvent, f: FileEntry): void {
    const t = this.target(f); const a = this.a
    this.cm.open(e, [
      ...(f.area === 'conflicted' ? [
        { label: 'Take Ours (current branch)', onClick: () => void a.resolve(f, 'ours') },
        { label: 'Take Theirs (incoming)', onClick: () => void a.resolve(f, 'theirs') },
        { label: 'Mark Resolved', onClick: () => void a.markResolved(t) },
        { separator: true, label: '' }
      ] : [
        f.area === 'staged' ? { label: 'Unstage', onClick: () => void a.unstage(t) } : { label: 'Stage', onClick: () => void a.stage(t) },
        { label: 'Discard…', danger: true, onClick: () => void a.discard(t) },
        ...(f.area === 'untracked' ? [{ label: 'Move to Trash…', danger: true, onClick: () => void a.trash(t) }] : []),
        { separator: true, label: '' }
      ]),
      { label: 'Show File Log', onClick: () => a.fileLog(f), disabled: f.area === 'untracked' },
      { label: 'Blame', onClick: () => void a.blame(f), disabled: f.area === 'untracked' },
      { separator: true, label: '' },
      { label: 'Open in default editor', onClick: () => void a.openFile(f) },
      { label: 'Reveal in file manager', onClick: () => void a.reveal(f) },
      { label: 'Copy path', onClick: () => a.copy(f.path) },
      { separator: true, label: '' },
      { label: 'Ignore…', onClick: () => void a.ignore(f), disabled: f.area !== 'untracked' }
    ])
  }
}
