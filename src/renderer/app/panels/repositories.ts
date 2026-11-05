import { Component, inject } from '@angular/core'
import { Store } from '../store.service'
import { Actions } from '../actions.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'
import { ContextMenuService } from '../ui/context-menu'
import type { RepoEntry } from '@shared/types'

@Component({
  selector: 'pg-repositories',
  imports: [Icon, Panel],
  template: `
    <pg-panel title="Repositories">
      <ng-container actions><button class="btn small" title="Open repository" (click)="a.openRepo()"><pg-icon name="plus" [size]="14" /></button></ng-container>
      @if (store.repos().length === 0) { <div class="empty">No repositories yet.<br />Open, clone or initialize one.</div> }
      <ul class="list">
        @for (r of store.repos(); track r.path) {
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
  menu(e: MouseEvent, r: RepoEntry): void {
    this.cm.open(e, [
      { label: 'Open', onClick: () => this.store.openRepo(r) },
      { label: 'Open in Terminal', onClick: () => void this.store.api.openTerminal(r.path) },
      { label: 'Reveal in File Manager', onClick: () => void this.store.api.revealInFinder(r.path) },
      { separator: true, label: '' },
      { label: 'Remove from list', danger: true, onClick: () => void this.store.removeRepo(r.path) }
    ])
  }
}
