import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core'
import { Store } from '../store.service'
import { Panel } from '../ui/panel'

@Component({
  selector: 'pg-output',
  imports: [Panel],
  template: `
    <pg-panel title="Output">
      <ng-container actions><button class="btn small ghost" (click)="expanded.set(null)">Collapse</button></ng-container>
      <div class="output" #scroller style="height:100%;overflow:auto">
        @for (l of store.output().slice(-200); track l.id) {
          <div class="line" [class.fail]="l.code !== 0" (click)="expanded.set(expanded() === l.id ? null : l.id)">
            <span class="cmd">{{ l.command }}</span><span class="ms">{{ l.durationMs }} ms{{ l.code !== 0 ? ' · exit ' + l.code : '' }}</span>
            @if ((expanded() === l.id || l.code !== 0) && (l.stderr || l.stdout)) { <pre>{{ l.stderr || l.stdout }}</pre> }
          </div>
        }
      </div>
    </pg-panel>`
})
export class Output {
  readonly store = inject(Store)
  readonly expanded = signal<number | null>(null)
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller')
  constructor() {
    effect(() => { this.store.output().length; const el = this.scroller()?.nativeElement; if (el) setTimeout(() => el.scrollTo({ top: el.scrollHeight })) })
  }
}
