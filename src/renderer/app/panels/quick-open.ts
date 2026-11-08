import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core'
import { Store } from '../store.service'

interface Result { id: string; kind: 'repo' | 'issue' | 'branch' | 'release' | 'org'; label: string; sub: string; score: number; run: () => void }
interface Group { kind: Result['kind']; title: string; items: (Result & { index: number })[] }

/** Score a candidate against the query: prefix 3, substring 2, subsequence 1, else 0. */
export function match(text: string, q: string): number {
  const t = text.toLowerCase()
  if (!q) return 1
  if (t.startsWith(q)) return 3
  if (t.includes(q)) return 2
  let i = 0
  for (const ch of t) if (ch === q[i]) { i++; if (i === q.length) return 1 }
  return 0
}

/** Cmd/Ctrl+K: jump to a repository, a branch in any repository, an issue or a release. */
@Component({
  selector: 'pg-quick-open',
  template: `
    @if (store.showQuickOpen()) {
      <div class="modal-backdrop qo-backdrop" (mousedown)="close()">
        <div class="qo" (mousedown)="$event.stopPropagation()">
          <input #inp class="qo-input" placeholder="Jump to a repository, branch, issue or release…" [value]="q()" (input)="q.set($any($event.target).value); active.set(0)" (keydown)="key($event)" spellcheck="false" />
          @if (store.indexLoading() && !store.index()) { <div class="qo-hint"><span class="spinner"></span> Indexing branches and issues of {{ store.org()?.name }}…</div> }
          <div class="qo-list">
            @for (g of groups(); track g.kind) {
              <div class="qo-group">{{ g.title }}</div>
              @for (r of g.items; track r.id) {
                <div class="qo-row" [class.active]="r.index === active()" (mouseenter)="active.set(r.index)" (click)="run(r)"><span class="qo-label">{{ r.label }}</span><span class="qo-sub muted">{{ r.sub }}</span></div>
              }
            }
            @if (!flat().length) { <div class="empty">{{ q() ? 'Nothing matches.' : 'Type to search.' }}</div> }
          </div>
          <div class="qo-foot muted"><span>↑↓ move</span><span>↵ open</span><span>esc close</span><span style="flex:1"></span><span>{{ store.org()?.name }}</span></div>
        </div>
      </div>
    }`
})
export class QuickOpen {
  readonly store = inject(Store)
  readonly q = signal('')
  readonly active = signal(0)
  private readonly inp = viewChild<ElementRef<HTMLInputElement>>('inp')
  constructor() {
    effect(() => {
      if (!this.store.showQuickOpen()) return
      this.q.set(''); this.active.set(0)
      if (!this.store.index() && !this.store.indexLoading() && !this.store.indexError()) void this.store.loadIndex()
      setTimeout(() => this.inp()?.nativeElement.focus(), 20)
    })
  }
  readonly results = computed<Result[]>(() => {
    const q = this.q().trim().toLowerCase(); const s = this.store
    const out: Result[] = []
    for (const r of s.repos()) { const sc = Math.max(match(r.name, q), match(r.group ?? '', q) ? 1 : 0); if (sc) out.push({ id: 'repo:' + r.path, kind: 'repo', label: r.name, sub: r.group ?? r.path, score: sc + 0.5, run: () => { s.openRepo(r); s.perspective.set('standard') } }) }
    for (const o of s.workspace()?.organizations ?? []) if (o.id !== s.activeOrgId()) { const sc = match(o.name, q); if (sc && q) out.push({ id: 'org:' + o.id, kind: 'org', label: o.name, sub: `${o.repoCount} repositories · switch`, score: sc, run: () => void s.switchOrg(o.id) }) }
    const idx = s.index()
    if (idx) {
      for (const it of idx.items) if (it.issueKey) {
        const sc = Math.max(match(it.issueKey, q), match(it.issue?.title ?? '', q) ? 1 : 0)
        if (sc && q) out.push({ id: 'issue:' + it.issueKey, kind: 'issue', label: `${it.issueKey} ${it.issue?.title ?? ''}`.trim(), sub: it.parts.map((p) => `${p.repoName}${p.highest ? ': ' + p.highest : ''}`).join(' · '), score: sc, run: () => { s.workFocusKey.set(it.issueKey); s.orgTab.set('work'); s.perspective.set('organization') } })
      }
      const seen = new Set<string>()
      for (const b of idx.branches) {
        const k = `${b.repo}\n${b.name}`; if (seen.has(k)) continue; seen.add(k)
        const sc = match(b.name, q); if (!sc || !q) continue
        out.push({ id: 'branch:' + k, kind: b.kind === 'release' ? 'release' : 'branch', label: b.name, sub: `${b.repoName} · ${b.kind === 'env' ? 'environment' : b.kind === 'release' ? 'release branch' : 'branch'}`, score: sc, run: () => { const entry = s.repos().find((r) => r.path === b.repo); if (!entry) return; s.openRepo(entry); s.perspective.set('log'); if (b.sha) setTimeout(() => void s.selectCommit(b.sha), 300) } })
      }
    }
    if (q && /^[a-z][a-z0-9]{1,9}-\d+$/i.test(q) && !out.some((r) => r.kind === 'issue' && r.label.toLowerCase().startsWith(q))) {
      const key = q.toUpperCase()
      out.push({ id: 'issue:' + key, kind: 'issue', label: key, sub: 'look up in Work', score: 2, run: () => { s.workFocusKey.set(key); s.orgTab.set('work'); s.perspective.set('organization') } })
    }
    return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  })
  readonly groups = computed<Group[]>(() => {
    const limits: Record<Result['kind'], number> = { repo: 8, issue: 8, branch: 10, release: 6, org: 4 }
    const titles: Record<Result['kind'], string> = { repo: 'Repositories', issue: 'Issues', branch: 'Branches', release: 'Releases', org: 'Organizations' }
    const order: Result['kind'][] = ['repo', 'issue', 'branch', 'release', 'org']
    let i = 0
    const out: Group[] = []
    for (const kind of order) {
      const items = this.results().filter((r) => r.kind === kind).slice(0, limits[kind]).map((r) => ({ ...r, index: i++ }))
      if (items.length) out.push({ kind, title: titles[kind], items })
    }
    return out
  })
  readonly flat = computed(() => this.groups().flatMap((g) => g.items))
  key(e: KeyboardEvent): void {
    const n = this.flat().length
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set(n ? (this.active() + 1) % n : 0) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set(n ? (this.active() - 1 + n) % n : 0) }
    else if (e.key === 'Enter') { e.preventDefault(); const r = this.flat()[this.active()]; if (r) this.run(r) }
    else if (e.key === 'Escape') { e.preventDefault(); this.close() }
  }
  run(r: Result): void { this.close(); r.run() }
  close(): void { this.store.showQuickOpen.set(false) }
}
