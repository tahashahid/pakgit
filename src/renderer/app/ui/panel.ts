import { Component, input } from '@angular/core'

@Component({
  selector: 'pg-panel',
  template: `
    <section class="panel">
      <header class="panel-header"><span class="panel-title">{{ title() }}</span><span class="panel-actions"><ng-content select="[actions]" /></span></header>
      <div class="panel-body"><ng-content /></div>
    </section>`,
  styles: [':host { display: flex; flex: 1; min-width: 0; min-height: 0; }']
})
export class Panel {
  readonly title = input.required<string>()
}
