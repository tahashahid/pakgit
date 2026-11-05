import { Component, ElementRef, inject, input, signal } from '@angular/core'

@Component({
  selector: 'pg-split',
  template: `
    <div class="split-a" [style.width.px]="dir() === 'h' ? size() : null" [style.height.px]="dir() === 'v' ? size() : null"><ng-content select="[first]" /></div>
    <div class="split-handle" [class.split-handle-h]="dir() === 'h'" [class.split-handle-v]="dir() === 'v'" (mousedown)="onDown($event)"></div>
    <div class="split-b"><ng-content select="[second]" /></div>`,
  host: { class: 'split', '[class.split-h]': "dir() === 'h'", '[class.split-v]': "dir() === 'v'" }
})
export class Split {
  readonly dir = input.required<'h' | 'v'>()
  readonly initial = input.required<number>()
  readonly min = input(120)
  readonly storageKey = input<string>()
  readonly size = signal(0)
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef)

  ngOnInit(): void {
    const k = this.storageKey()
    const saved = k ? localStorage.getItem('split:' + k) : null
    this.size.set(saved ? +saved : this.initial())
  }
  onDown(e: MouseEvent): void {
    e.preventDefault()
    const dir = this.dir(), min = this.min()
    const start = dir === 'h' ? e.clientX : e.clientY
    const startSize = this.size()
    const move = (ev: MouseEvent) => {
      const total = dir === 'h' ? this.el.nativeElement.clientWidth : this.el.nativeElement.clientHeight
      this.size.set(Math.min(total - min, Math.max(min, startSize + ((dir === 'h' ? ev.clientX : ev.clientY) - start))))
    }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      const k = this.storageKey(); if (k) localStorage.setItem('split:' + k, String(this.size()))
    }
    document.body.style.cursor = dir === 'h' ? 'col-resize' : 'row-resize'
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
}
