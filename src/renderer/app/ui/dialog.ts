import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Store } from '../store.service'

@Component({
  selector: 'pg-dialog',
  imports: [FormsModule],
  template: `
    @if (store.dialog(); as d) {
      <div class="modal-backdrop" (mousedown)="d.resolve(null)">
        <form class="modal" (mousedown)="$event.stopPropagation()" (submit)="$event.preventDefault(); d.resolve(values())" (keydown)="onKey($event)">
          <h2>{{ d.spec.title }}</h2>
          @if (d.spec.message) { <p class="modal-message">{{ d.spec.message }}</p> }
          @for (f of d.spec.fields ?? []; track f.key) {
            <label class="field" [class.field-check]="f.type === 'checkbox'">
              @switch (f.type) {
                @case ('checkbox') { <input type="checkbox" [checked]="!!values()[f.key]" (change)="set(f.key, $any($event.target).checked)" /><span>{{ f.label }}</span> }
                @case ('textarea') { <span>{{ f.label }}</span><textarea rows="4" [value]="str(f.key)" [placeholder]="f.placeholder ?? ''" (input)="set(f.key, $any($event.target).value)" [attr.data-first]="$first ? '' : null"></textarea> }
                @case ('select') { <span>{{ f.label }}</span><select [value]="str(f.key)" (change)="set(f.key, $any($event.target).value)" [attr.data-first]="$first ? '' : null">@for (o of f.options ?? []; track o) { <option [value]="o">{{ o }}</option> }</select> }
                @default { <span>{{ f.label }}</span><input [value]="str(f.key)" [placeholder]="f.placeholder ?? ''" (input)="set(f.key, $any($event.target).value)" [attr.data-first]="$first ? '' : null" /> }
              }
            </label>
          }
          <div class="modal-actions">
            <button type="button" class="btn" (click)="d.resolve(null)">Cancel</button>
            <button type="submit" class="btn" [class.danger]="d.spec.danger" [class.primary]="!d.spec.danger">{{ d.spec.okLabel ?? 'OK' }}</button>
          </div>
        </form>
      </div>
    }`
})
export class Dialog {
  readonly store = inject(Store)
  readonly values = signal<Record<string, string | boolean>>({})
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
  constructor() {
    effect(() => {
      const d = this.store.dialog()
      if (!d) return
      const v: Record<string, string | boolean> = {}
      for (const f of d.spec.fields ?? []) v[f.key] = f.type === 'checkbox' ? f.value === 'true' : (f.value ?? (f.type === 'select' ? f.options?.[0] ?? '' : ''))
      this.values.set(v)
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('[data-first]')?.focus(), 30)
    })
  }
  str(k: string): string { return String(this.values()[k] ?? '') }
  set(k: string, v: string | boolean): void { this.values.update((x) => ({ ...x, [k]: v })) }
  onKey(e: KeyboardEvent): void {
    const d = this.store.dialog(); if (!d) return
    if (e.key === 'Escape') d.resolve(null)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) d.resolve(this.values())
  }
}
