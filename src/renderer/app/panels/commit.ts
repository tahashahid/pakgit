import { Component, computed, effect, inject, signal } from '@angular/core'
import { LS, Store } from '../store.service'
import { Actions } from '../actions.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'

@Component({
  selector: 'pg-commit',
  imports: [Icon, Panel],
  template: `
    <pg-panel title="Commit">
      <ng-container actions><button class="btn small" title="Undo last commit" (click)="a.undoLastCommit()" [disabled]="!store.commits().length"><pg-icon name="undo" [size]="14" /></button></ng-container>
      @if (state(); as state) {
        <div class="state-banner">
          {{ state === 'merging' ? 'Merge in progress' : state === 'rebasing' ? 'Rebase in progress' : state + ' in progress' }}
          <span style="flex:1"></span>
          @if (state === 'rebasing') {
            <button class="btn small primary" (click)="a.rebaseAction('continue')">Continue</button>
            <button class="btn small" (click)="a.rebaseAction('skip')">Skip</button>
            <button class="btn small danger" (click)="a.rebaseAction('abort')">Abort</button>
          } @else if (state === 'merging') {
            <button class="btn small primary" (click)="a.mergeAction('continue')">Continue</button>
            <button class="btn small danger" (click)="a.mergeAction('abort')">Abort</button>
          }
        </div>
      }
      <div class="commit-form" [style.height]="state() ? 'calc(100% - 34px)' : null">
        <div class="subject-wrap">
          <input class="subject" placeholder="Commit message (subject)" [value]="subject()" (input)="subject.set($any($event.target).value)" (keydown)="onKey($event)" />
          @if (recent().length) { <button class="btn small ghost" title="Recent commit messages" (click)="showRecent.set(!showRecent())">▾</button> }
          @if (showRecent()) {
            <ul class="list recent-msgs" (mouseleave)="showRecent.set(false)">
              @for (m of recent(); track m) { <li class="row" (click)="useRecent(m)">{{ m.split('\\n')[0] }}</li> }
            </ul>
          }
        </div>
        <textarea placeholder="Description (optional)" [value]="body()" (input)="body.set($any($event.target).value)" (keydown)="onKey($event)"></textarea>
        <div class="commit-footer">
          <label><input type="checkbox" [checked]="amend()" (change)="amend.set($any($event.target).checked)" />Amend</label>
          <label title="Commit all tracked changes (git commit -a)"><input type="checkbox" [checked]="all()" (change)="all.set($any($event.target).checked)" />All changes</label>
          <label title="Bypass commit hooks"><input type="checkbox" [checked]="noVerify()" (change)="noVerify.set($any($event.target).checked)" />No verify</label>
          <label><input type="checkbox" [checked]="signoff()" (change)="signoff.set($any($event.target).checked)" />Sign-off</label>
          <span style="flex:1"></span>
          <span class="muted">{{ staged() }} staged</span>
          <button class="btn primary" [disabled]="!canCommit()" (click)="commit(false)" title="Cmd/Ctrl+Enter">Commit</button>
          <button class="btn" [disabled]="!canCommit()" (click)="commit(true)">Commit & Push</button>
        </div>
      </div>
    </pg-panel>`
})
export class Commit {
  readonly store = inject(Store)
  readonly a = inject(Actions).a
  readonly subject = signal('')
  readonly body = signal('')
  readonly amend = signal(false)
  readonly all = signal(false)
  readonly noVerify = signal(false)
  readonly signoff = signal(false)
  readonly showRecent = signal(false)
  readonly recent = signal<string[]>(LS.get<string[]>('recentMessages', []))
  readonly state = computed(() => { const s = this.store.status()?.state; return s && s !== 'clean' ? s : null })
  readonly staged = computed(() => this.store.status()?.files.filter((f) => f.area === 'staged').length ?? 0)
  readonly changed = computed(() => this.store.status()?.files.filter((f) => f.area !== 'staged').length ?? 0)
  readonly canCommit = computed(() => !!this.store.repo() && this.subject().trim().length > 0 && (this.staged() > 0 || (this.all() && this.changed() > 0) || this.amend()))
  constructor() {
    effect(() => { this.store.repo(); this.subject.set(''); this.body.set(''); this.amend.set(false) })
    effect(() => { const c = this.store.commits()[0]; if (this.amend() && c && !this.subject()) { this.subject.set(c.subject); this.body.set(c.body) } })
  }
  onKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && this.canCommit()) void this.commit(false)
    if (e.key === 'Escape') this.showRecent.set(false)
  }
  useRecent(m: string): void { const [sub, ...rest] = m.split('\n'); this.subject.set(sub); this.body.set(rest.join('\n').trim()); this.showRecent.set(false) }
  async commit(push: boolean): Promise<void> {
    const r = this.store.repo(); if (!r) return
    const message = this.body().trim() ? `${this.subject().trim()}\n\n${this.body().trim()}` : this.subject().trim()
    if (push && !this.store.status()?.upstream) this.store.toast('info', 'No upstream yet: the push will use the Push dialog defaults')
    const res = await this.store.run(push ? 'Commit & Push' : 'Commit', () => this.store.api.commit(r.path, { message, amend: this.amend(), all: this.all(), noVerify: this.noVerify(), signoff: this.signoff(), push }), { success: push ? 'Committed and pushed' : 'Committed' })
    if (res !== undefined) {
      const next = [message, ...this.recent().filter((m) => m !== message)].slice(0, 15)
      this.recent.set(next); LS.set('recentMessages', next)
      this.subject.set(''); this.body.set(''); this.amend.set(false)
    }
  }
}
