import { Component, Injectable, inject, signal } from '@angular/core'

export interface MenuItem { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean; separator?: boolean }

@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  readonly state = signal<{ x: number; y: number; items: MenuItem[] } | null>(null)
  open(e: MouseEvent, items: MenuItem[]): void {
    e.preventDefault(); e.stopPropagation()
    this.state.set({ x: e.clientX, y: e.clientY, items })
  }
  close(): void { this.state.set(null) }
}

@Component({
  selector: 'pg-context-menu',
  template: `
    @if (menu.state(); as m) {
      <div class="context-menu" [style.left.px]="left(m.x)" [style.top.px]="top(m.y, m.items.length)" (mousedown)="$event.stopPropagation()">
        @for (it of m.items; track $index) {
          @if (it.separator) { <div class="context-sep"></div> }
          @else { <button class="context-item" [class.danger]="it.danger" [disabled]="it.disabled" (click)="it.onClick?.(); menu.close()">{{ it.label }}</button> }
        }
      </div>
    }`,
  host: { '(window:mousedown)': 'menu.close()', '(window:keydown)': 'menu.close()', '(window:blur)': 'menu.close()' }
})
export class ContextMenu {
  readonly menu = inject(ContextMenuService)
  left(x: number): number { return Math.min(x, window.innerWidth - 240) }
  top(y: number, n: number): number { return Math.min(y, window.innerHeight - n * 28 - 16) }
}
