import { Component, computed, inject, input, output } from '@angular/core'
import { Store } from '../store.service'
import { ContextMenuService } from './context-menu'
import type { SavedView } from '@shared/types'

/** Saved filter sets of one tab as chips: click applies, right-click deletes; "Save view…" stores the current filters. */
@Component({
  selector: 'pg-views-bar',
  template: `
    <span class="chips views">
      @for (v of views(); track v.id) { <button type="button" class="chip" [class.active]="active() === v.id" [title]="describe(v)" (click)="apply.emit(v)" (contextmenu)="menu($event, v)">{{ v.name }}</button> }
      <button type="button" class="chip ghost" title="Save the current filters as a view of this organization" (click)="save.emit()">+ Save view…</button>
    </span>`
})
export class ViewsBar {
  readonly tab = input.required<'work' | 'ready'>()
  readonly active = input<string | null>(null)
  readonly apply = output<SavedView>()
  readonly save = output<void>()
  readonly store = inject(Store)
  private readonly cm = inject(ContextMenuService)
  readonly views = computed(() => (this.store.org()?.views ?? []).filter((v) => v.tab === this.tab()))
  describe(v: SavedView): string { return Object.entries(v.filters).filter(([, x]) => x !== '' && x !== false && x !== 0 && x !== 'anyone').map(([k, x]) => `${k}: ${x}`).join(' · ') || 'no filters' }
  menu(e: MouseEvent, v: SavedView): void {
    this.cm.open(e, [
      { label: 'Apply', onClick: () => this.apply.emit(v) },
      { label: 'Delete view', danger: true, onClick: () => void this.store.deleteView(v.id) }
    ])
  }
}
