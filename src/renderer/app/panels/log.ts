import { Component, computed, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import { Actions } from '../actions.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'
import { ContextMenuService } from '../ui/context-menu'
import { TimeAgoPipe } from '../ui/time-ago'
import { layoutGraph, LANE_COLORS, type GraphRow } from '../../lib/graph'
import type { Commit, CommitFile } from '@shared/types'

const ROW = 24, LANE_W = 14

@Component({
  selector: 'pg-log',
  imports: [Icon, Panel, TimeAgoPipe],
  template: `
    <pg-panel [title]="store.logPath() ? 'File Log' : 'Log'">
      <ng-container actions>
        <button class="btn small" [class.active]="!store.logAll()" title="Show only the current branch" (click)="store.logAll.set(false)" [disabled]="!!store.logPath()">Current</button>
        <button class="btn small" [class.active]="store.logAll()" title="Show all branches" (click)="store.logAll.set(true)" [disabled]="!!store.logPath()">All</button>
        <button class="btn small" title="Fetch" (click)="a.fetch()"><pg-icon name="fetch" [size]="14" /></button>
      </ng-container>
      <input class="filter-input" placeholder="Filter commits (subject, author, sha)…" [value]="filter()" (input)="filter.set($any($event.target).value)" />
      @if (store.logPath(); as p) { <div class="log-chip"><pg-icon name="file" [size]="12" />History of {{ p }} (follows renames)<button title="Back to full log" (click)="store.setLogPath(null)">✕</button></div> }
      @if (!store.commits().length) { <div class="empty">No commits yet.</div> }
      <div class="log">
        <table>
          <colgroup><col [style.width.px]="gw()" /><col /><col style="width:140px" /><col style="width:90px" /><col style="width:70px" /></colgroup>
          <thead><tr><th></th><th>Message</th><th>Author</th><th>Date</th><th>SHA</th></tr></thead>
          <tbody>
            @for (r of rows(); track r.commit.sha) {
              <tr [class.selected]="store.selectedCommit()?.sha === r.commit.sha" (click)="store.selectCommit(r.commit.sha)" (contextmenu)="menu($event, r.commit)">
                <td class="graph">
                  <svg [attr.width]="gw()" [attr.height]="ROW">
                    @for (e of r.edges; track $index) {
                      @if (e.from === e.to) { <line [attr.x1]="x(e.from)" [attr.y1]="e.from === r.lane ? ROW / 2 : 0" [attr.x2]="x(e.from)" [attr.y2]="ROW" [attr.stroke]="colors[e.color]" stroke-width="2" /> }
                      @else { <path [attr.d]="curve(e.from, e.to)" [attr.stroke]="colors[e.color]" stroke-width="2" fill="none" /> }
                    }
                    <line [attr.x1]="x(r.lane)" y1="0" [attr.x2]="x(r.lane)" [attr.y2]="ROW / 2" [attr.stroke]="colors[r.color]" stroke-width="2" [attr.opacity]="r.fresh ? 0 : 1" />
                    <circle [attr.cx]="x(r.lane)" [attr.cy]="ROW / 2" [attr.r]="r.commit.sha === headSha() ? 5 : 3.5" [attr.fill]="r.commit.sha === headSha() ? 'var(--bg2)' : colors[r.color]" [attr.stroke]="colors[r.color]" stroke-width="2" />
                  </svg>
                </td>
                <td [title]="r.commit.subject">
                  @for (ref of r.commit.refs; track ref) { <span class="ref-pill" [class]="'ref-pill ' + refClass(ref)">{{ ref.replace('tag: ', '') }}</span> }{{ r.commit.subject }}
                </td>
                <td [title]="r.commit.email">{{ r.commit.author }}</td>
                <td [title]="r.commit.date">{{ r.commit.date | timeAgo }}</td>
                <td class="mono muted">{{ r.commit.shortSha }}</td>
              </tr>
            }
          </tbody>
        </table>
        @if (store.commits().length >= store.effectiveLogLimit()) { <div class="load-more"><button class="btn small" (click)="store.loadMore()">Load more commits…</button></div> }
      </div>
    </pg-panel>`
})
export class Log {
  readonly store = inject(Store)
  readonly a = inject(Actions).a
  private readonly cm = inject(ContextMenuService)
  readonly ROW = ROW
  readonly colors = LANE_COLORS
  readonly filter = signal('')
  readonly filtered = computed(() => {
    const q = this.filter().toLowerCase()
    return q ? this.store.commits().filter((c) => [c.subject, c.author, c.sha, c.refs.join(' ')].join(' ').toLowerCase().includes(q)) : this.store.commits()
  })
  readonly rows = computed<GraphRow[]>(() => layoutGraph(this.filtered()))
  readonly gw = computed(() => Math.min(Math.max(1, ...this.rows().map((r) => Math.max(r.lanes.length, ...r.edges.map((e) => Math.max(e.from, e.to) + 1)))), 12) * LANE_W + 8)
  readonly headSha = computed(() => this.store.commits().find((c) => c.refs.includes('HEAD'))?.sha)
  x(lane: number): number { return lane * LANE_W + LANE_W / 2 + 4 }
  curve(from: number, to: number): string { const x1 = this.x(from), x2 = this.x(to); return `M${x1},${ROW / 2} C${x1},${ROW} ${x2},${ROW / 2} ${x2},${ROW}` }
  refClass(r: string): string { return r === 'HEAD' ? 'head' : r.startsWith('tag: ') ? 'tag' : r.includes('/') ? 'remote' : r.startsWith('refs/stash') ? 'stash' : '' }
  menu(e: MouseEvent, c: Commit): void {
    const a = this.a; const branch = this.store.status()?.branch ?? 'HEAD'
    this.cm.open(e, [
      { label: 'Check Out Commit…', onClick: () => void a.checkoutCommit(c) },
      { label: 'Rebase Interactive from here…', onClick: () => void a.rebaseInteractive(c) },
      { label: 'Add Branch from here…', onClick: () => void a.addBranch(c.sha) },
      { label: 'Add Tag…', onClick: () => void a.addTag(c) },
      { separator: true, label: '' },
      { label: 'Cherry Pick', onClick: () => void a.cherryPick(c), disabled: c.sha === this.headSha() },
      { label: 'Revert', onClick: () => void a.revert(c) },
      { label: 'Merge into current…', onClick: () => void a.merge(c.sha) },
      { label: 'Rebase current onto…', onClick: () => void a.rebase(c.sha) },
      { label: `Reset ${branch} to here…`, danger: true, onClick: () => void a.reset(c) },
      { separator: true, label: '' },
      { label: 'Create Patch…', onClick: () => void a.createPatch(c) },
      { label: 'Copy SHA', onClick: () => a.copy(c.sha) },
      { label: 'Copy subject', onClick: () => a.copy(c.subject) }
    ])
  }
}

@Component({
  selector: 'pg-commit-details',
  imports: [Panel],
  template: `
    <pg-panel title="Commit Details">
      @if (store.selectedCommit(); as c) {
        <div class="commit-details">
          <h3>{{ c.subject }}</h3>
          <div class="meta">
            <span>Author</span><span>{{ c.author }} &lt;{{ c.email }}&gt;</span>
            <span>Date</span><span>{{ date(c.date) }}</span>
            <span>SHA</span><span class="mono" style="cursor:pointer" (click)="a.copy(c.sha)" title="Copy">{{ c.sha }}</span>
            <span>Parents</span><span class="mono">{{ parents(c.parents) }}</span>
          </div>
          @if (c.body) { <pre>{{ c.body }}</pre> }
          <div class="group-header">Files<span class="count">{{ c.files.length }}</span></div>
          <ul class="list">
            @for (f of c.files; track f.path) {
              <li class="row" [class.selected]="store.selectedCommitFile() === f.path" (click)="store.selectCommitFile(f.path)" (contextmenu)="menu($event, f, c.sha)">
                <span class="status-chip" [class]="'status-chip st-' + f.status">{{ f.status }}</span>
                <span class="grow">{{ f.path }}</span>
                <span class="muted" style="font-size:11px"><span style="color:var(--add-fg)">+{{ f.additions }}</span> <span style="color:var(--del-fg)">−{{ f.deletions }}</span></span>
              </li>
            }
          </ul>
        </div>
      } @else { <div class="empty">Select a commit.</div> }
    </pg-panel>`
})
export class CommitDetails {
  readonly store = inject(Store)
  readonly a = inject(Actions).a
  private readonly cm = inject(ContextMenuService)
  date(iso: string): string { return new Date(iso).toLocaleString() }
  parents(p: string[]): string { return p.map((x) => x.slice(0, 7)).join(', ') || '—' }
  menu(e: MouseEvent, f: CommitFile, sha: string): void {
    this.cm.open(e, [
      { label: 'Show File Log', onClick: () => this.a.fileLog(f) },
      { label: 'Blame at this revision', onClick: () => void this.a.blame(f, sha) },
      { label: 'Copy path', onClick: () => this.a.copy(f.path) }
    ])
  }
}
