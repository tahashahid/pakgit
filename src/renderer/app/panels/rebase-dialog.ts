import { Component, computed, effect, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import type { RebaseTodoEntry } from '@shared/types'

const ACTIONS: RebaseTodoEntry['action'][] = ['pick', 'reword', 'squash', 'fixup', 'drop']
const HELP: Record<RebaseTodoEntry['action'], string> = { pick: 'keep as is', reword: 'keep, change message', squash: 'merge into previous, keep messages', fixup: 'merge into previous, discard message', drop: 'remove commit' }

@Component({
  selector: 'pg-rebase-dialog',
  template: `
    @if (store.rebase(); as rb) {
      <div class="modal-backdrop" (mousedown)="store.rebase.set(null)">
        <div class="modal wide" (mousedown)="$event.stopPropagation()">
          <h2>Rebase Interactive</h2>
          <p class="modal-message">Oldest commit first. Reorder with the arrows, pick an action per commit. Squash and fixup fold a commit into the one above it.</p>
          <div class="rebase-list">
            @for (t of todo(); track t.sha; let i = $index) {
              <div class="rebase-row" [class]="'rebase-row ' + t.action">
                <button class="btn small" (click)="move(i, -1)" [disabled]="i === 0" title="Move up">↑</button>
                <button class="btn small" (click)="move(i, 1)" [disabled]="i === todo().length - 1" title="Move down">↓</button>
                <select [value]="t.action" (change)="setAction(i, $any($event.target).value)" [title]="help[t.action]">@for (a of actions; track a) { <option [value]="a">{{ a }}</option> }</select>
                <span class="mono muted">{{ t.sha.slice(0, 7) }}</span>
                @if (t.action === 'reword') { <input [value]="rewords()[t.sha] ?? t.subject" (input)="setReword(t.sha, $any($event.target).value)" /> }
                @else { <span class="subject" [title]="t.subject">{{ t.subject }}</span> }
              </div>
            }
          </div>
          @if (firstIsSquash()) { <p class="modal-message" style="color:var(--danger)">The first commit cannot be squashed or fixed up: there is nothing above it.</p> }
          <div class="modal-actions">
            <button class="btn" (click)="store.rebase.set(null)">Cancel</button>
            <button class="btn primary" [disabled]="firstIsSquash() || allDropped()" (click)="submit(rb.base)">Rebase</button>
          </div>
        </div>
      </div>
    }`
})
export class RebaseDialog {
  readonly store = inject(Store)
  readonly actions = ACTIONS
  readonly help = HELP
  readonly todo = signal<RebaseTodoEntry[]>([])
  readonly rewords = signal<Record<string, string>>({})
  readonly firstIsSquash = computed(() => { const t = this.todo(); return t.length > 0 && (t[0].action === 'squash' || t[0].action === 'fixup') })
  readonly allDropped = computed(() => this.todo().every((t) => t.action === 'drop'))
  constructor() { effect(() => { const rb = this.store.rebase(); this.todo.set(rb?.todo ?? []); this.rewords.set({}) }) }
  move(i: number, d: -1 | 1): void { const j = i + d; const next = [...this.todo()]; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; this.todo.set(next) }
  setAction(i: number, action: RebaseTodoEntry['action']): void { this.todo.update((t) => t.map((x, k) => (k === i ? { ...x, action } : x))) }
  setReword(sha: string, v: string): void { this.rewords.update((r) => ({ ...r, [sha]: v })) }
  submit(base: string): void {
    const r = this.store.repo(); if (!r) return
    const todo = this.todo(), rewords = this.rewords()
    this.store.rebase.set(null)
    void this.store.run('Interactive rebase', () => this.store.api.rebaseInteractive(r.path, base, todo, rewords), { success: 'Rebase finished' })
  }
}
