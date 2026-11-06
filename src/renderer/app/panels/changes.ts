import { Component, computed, effect, inject, input, signal } from '@angular/core'
import { Store } from '../store.service'
import { Actions } from '../actions.service'
import { Icon } from '../ui/icon'
import { Panel } from '../ui/panel'
import { parseDiff, diffStats, splitHunks, toSideBySide, type DiffLine } from '../../lib/diff'
import type { FileEntry } from '@shared/types'

@Component({
  selector: 'pg-diff-rows',
  template: `
    <table><tbody>
      @for (l of lines(); track $index) {
        @if (!(ignoreWs() && (l.kind === 'add' || l.kind === 'del') && !l.text.trim())) {
          <tr [class]="l.kind"><td class="no">{{ l.oldNo ?? '' }}</td><td class="no">{{ l.newNo ?? '' }}</td><td class="sign">{{ l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' ' }}</td><td>{{ l.text }}</td></tr>
        }
      }
    </tbody></table>`
})
export class DiffRows { readonly lines = input.required<DiffLine[]>(); readonly ignoreWs = input(false) }

@Component({
  selector: 'pg-side-by-side',
  template: `
    <table class="sbs"><tbody>
      @for (r of rows(); track $index) {
        @if (r.kind === 'hunk' || r.kind === 'meta') { <tr [class]="r.kind"><td class="no"></td><td colspan="3">{{ r.left?.text }}</td></tr> }
        @else {
          <tr [class.ctx]="r.kind === 'ctx'">
            <td class="no">{{ r.left?.oldNo ?? '' }}</td><td [class.del]="r.kind === 'change' && r.left" [class.blank]="r.kind === 'change' && !r.left">{{ r.left?.text ?? '' }}</td>
            <td class="no">{{ r.right?.newNo ?? '' }}</td><td [class.add]="r.kind === 'change' && r.right" [class.blank]="r.kind === 'change' && !r.right">{{ r.right?.text ?? '' }}</td>
          </tr>
        }
      }
    </tbody></table>`
})
export class SideBySide { readonly lines = input.required<DiffLine[]>(); readonly rows = computed(() => toSideBySide(this.lines())) }

@Component({
  selector: 'pg-diff-view',
  imports: [DiffRows, SideBySide],
  template: `
    @if (!raw().trim()) { <div class="empty">No changes to show.</div> }
    @else if (hunkLabel() && files().length === 1 && hunks().hunks.length) {
      <div class="diff">
        <div class="diff-file-header"><span>{{ name(files()[0].header) }}</span><span class="muted">+{{ stats().add }} −{{ stats().del }}</span></div>
        @if (files()[0].binary) { <div class="empty">Binary file</div> }
        @for (hl of hunkLines(); track $index) {
          <div class="hunk">
            <div class="hunk-bar"><span class="muted">{{ hl[0].text }}</span><button class="btn small" (click)="applyHunk($index)">{{ hunkLabel() }}</button></div>
            @if (sideBySide()) { <pg-side-by-side [lines]="hl.slice(1)" /> } @else { <pg-diff-rows [lines]="hl.slice(1)" [ignoreWs]="ignoreWs()" /> }
          </div>
        }
      </div>
    } @else {
      <div class="diff">
        @for (f of files(); track $index) {
          @if (f.header) { <div class="diff-file-header"><span>{{ name(f.header) }}</span></div> }
          @if (f.binary) { <div class="empty">Binary file</div> } @else if (sideBySide()) { <pg-side-by-side [lines]="f.lines" /> } @else { <pg-diff-rows [lines]="f.lines" [ignoreWs]="ignoreWs()" /> }
        }
      </div>
    }`
})
export class DiffView {
  readonly raw = input.required<string>()
  readonly ignoreWs = input(false)
  readonly sideBySide = input(false)
  readonly hunkLabel = input<string | null>(null)
  readonly onHunk = input<(patch: string) => void>()
  readonly files = computed(() => parseDiff(this.raw()))
  readonly hunks = computed(() => splitHunks(this.raw()))
  readonly stats = computed(() => diffStats(this.raw()))
  readonly hunkLines = computed(() => {
    const out: DiffLine[][] = []; let cur: DiffLine[] | null = null
    for (const l of this.files()[0]?.lines ?? []) { if (l.kind === 'hunk') { cur = [l]; out.push(cur) } else if (cur) cur.push(l) }
    return out
  })
  name(header: string): string { return header.replace(/^diff --git a\/(.*) b\/.*$/, '$1') }
  applyHunk(i: number): void { this.onHunk()?.(this.hunks().header + '\n' + this.hunks().hunks[i] + '\n') }
}

@Component({
  selector: 'pg-conflict-view',
  template: `
    <div class="conflict">
      <div class="state-banner">
        Conflict in {{ file().path }}
        <span style="flex:1"></span>
        <button class="btn small" (click)="a.resolve(file(), 'ours')" title="Keep the version from the current branch">Take Ours</button>
        <button class="btn small" (click)="a.resolve(file(), 'theirs')" title="Keep the version being merged in">Take Theirs</button>
        <button class="btn small" (click)="a.openFile(file())">Edit…</button>
        <button class="btn small primary" (click)="a.markResolved([file()])" title="Stage the file as resolved after editing">Mark Resolved</button>
      </div>
      <div class="diff"><table><tbody>
        @for (l of lines(); track $index) {
          <tr [class]="marker(l)"><td class="no">{{ $index + 1 }}</td><td>{{ l }}</td></tr>
        }
      </tbody></table></div>
    </div>`
})
export class ConflictView {
  readonly file = input.required<FileEntry>()
  readonly a = inject(Actions).a
  private readonly store = inject(Store)
  readonly text = signal('')
  readonly lines = computed(() => this.text().split('\n'))
  constructor() {
    effect(() => { const r = this.store.repo(); const f = this.file(); this.store.status(); if (r) this.store.api.conflictFile(r.path, f.path).then((t) => this.text.set(t)).catch(() => this.text.set('')) })
  }
  marker(l: string): string {
    const m = l.startsWith('<<<<<<<') ? 'ours' : l.startsWith('>>>>>>>') ? 'theirs' : l.startsWith('=======') ? 'sep' : l.startsWith('|||||||') ? 'base' : ''
    return m ? `marker ${m}` : ''
  }
}

@Component({
  selector: 'pg-blame-view',
  imports: [Icon],
  template: `
    @if (store.blame(); as b) {
      <div class="diff blame">
        <div class="diff-file-header"><span>Blame: {{ b.path }}</span><span style="flex:1"></span><button class="btn small" (click)="store.blame.set(null)"><pg-icon name="x" [size]="12" />Close</button></div>
        <table><tbody>
          @for (l of b.lines; track l.line; let i = $index) {
            <tr [class.blame-first]="first(b.lines, i)" [title]="l.sha + '\\n' + l.summary" (dblclick)="store.perspective.set('log'); store.selectCommit(l.sha)">
              <td class="blame-meta">@if (first(b.lines, i)) { <span class="mono">{{ l.sha.slice(0, 7) }}</span> {{ l.author }} <span class="muted">{{ l.date }}</span> }</td>
              <td class="no">{{ l.line }}</td><td>{{ l.text }}</td>
            </tr>
          }
        </tbody></table>
      </div>
    }`
})
export class BlameView {
  readonly store = inject(Store)
  first(lines: { sha: string }[], i: number): boolean { return i === 0 || lines[i].sha !== lines[i - 1].sha }
}

@Component({
  selector: 'pg-changes',
  imports: [Panel, DiffView, ConflictView, BlameView],
  template: `
    <pg-panel [title]="title()">
      <ng-container actions>
        <button class="btn small" [class.active]="sbs()" title="Side-by-side" (click)="sbs.set(!sbs())">⫿</button>
        <button class="btn small" [class.active]="ignoreWs()" title="Hide whitespace-only lines" (click)="ignoreWs.set(!ignoreWs())">⎵</button>
      </ng-container>
      @if (store.blame()) { <pg-blame-view /> }
      @else if (file()?.area === 'conflicted') { <pg-conflict-view [file]="file()!" /> }
      @else if (store.selectedFiles().length > 1) { <div class="empty">{{ store.selectedFiles().length }} files selected.</div> }
      @else if (!file() && !store.selectedCommitFile() && !store.selectedStash()) { <div class="empty">Select a file, commit file or stash to see changes.</div> }
      @else { <pg-diff-view [raw]="store.diff()" [ignoreWs]="ignoreWs()" [sideBySide]="sbs()" [hunkLabel]="hunkLabel()" [onHunk]="applyHunk" /> }
    </pg-panel>`
})
export class Changes {
  readonly store = inject(Store)
  readonly ignoreWs = signal(false)
  readonly sbs = signal(false)
  readonly file = this.store.singleFile
  readonly title = computed(() => {
    const f = this.file(); const st = this.store.selectedStash(); const cf = this.store.selectedCommitFile()
    return this.store.blame() ? 'Blame' : st ? `Stash: ${st.message}` : cf ? `Changes: ${cf} @ ${this.store.selectedCommit()?.shortSha}` : f ? `Changes: ${f.path}` : 'Changes'
  })
  readonly hunkLabel = computed(() => { const f = this.file(); return f && (f.area === 'unstaged' || f.area === 'staged') ? (f.area === 'staged' ? 'Unstage hunk' : 'Stage hunk') : null })
  readonly applyHunk = (patch: string): void => {
    const f = this.file(); const r = this.store.repo(); if (!f || !r) return
    void this.store.run(f.area === 'staged' ? 'Unstage hunk' : 'Stage hunk', () => this.store.api.applyPatch(r.path, patch, { cached: true, reverse: f.area === 'staged' }))
  }
}
