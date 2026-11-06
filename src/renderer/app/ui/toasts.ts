import { Component, inject } from '@angular/core'
import { Store } from '../store.service'

@Component({
  selector: 'pg-toasts',
  template: `<div class="toasts">@for (t of store.toasts(); track t.id) { <div class="toast" [class]="'toast ' + t.kind">{{ t.text }}</div> }</div>`
})
export class Toasts { readonly store = inject(Store) }
