import { Component, computed, inject } from '@angular/core'
import { Store } from '../store.service'
import { Actions } from '../actions.service'
import { Icon } from '../ui/icon'

@Component({
  selector: 'pg-toolbar',
  imports: [Icon],
  template: `
    <div class="toolbar" [class.mac]="mac">
      <img src="logo.svg" alt="PakGit" width="22" height="22" style="border-radius:5px;margin:0 6px 0 2px" />
      <div class="tool-group">
        <button class="btn" title="Open repository (Cmd/Ctrl+O)" (click)="a.openRepo()"><pg-icon name="folder" /><span class="lbl">Open</span></button>
        <button class="btn" title="Clone repository" (click)="a.clone()"><pg-icon name="clone" /><span class="lbl">Clone</span></button>
      </div>
      <div class="tool-group">
        <button class="btn" title="Pull" [disabled]="disabled()" (click)="a.pull()"><pg-icon name="pull" /><span class="lbl">Pull</span></button>
        <button class="btn" title="Push" [disabled]="disabled()" (click)="a.push()"><pg-icon name="push" /><span class="lbl">Push</span> @if (store.status()?.ahead) { <span class="badge">↑{{ store.status()!.ahead }}</span> }</button>
        <button class="btn" title="Fetch" [disabled]="disabled()" (click)="a.fetch()"><pg-icon name="fetch" /><span class="lbl">Fetch</span> @if (store.status()?.behind) { <span class="badge">↓{{ store.status()!.behind }}</span> }</button>
      </div>
      <div class="tool-group">
        <button class="btn" title="Commit (Cmd/Ctrl+K)" [disabled]="disabled()" (click)="a.focusCommit()"><pg-icon name="commit" /><span class="lbl">Commit</span></button>
        <button class="btn" title="Stash changes" [disabled]="disabled()" (click)="a.stash()"><pg-icon name="stash" /><span class="lbl">Stash</span></button>
        <button class="btn" title="Add branch" [disabled]="disabled()" (click)="a.addBranch()"><pg-icon name="branch" /><span class="lbl">Branch</span></button>
        <button class="btn" title="Merge" [disabled]="disabled()" (click)="a.merge()"><pg-icon name="merge" /><span class="lbl">Merge</span></button>
        <button class="btn" title="Rebase" [disabled]="disabled()" (click)="a.rebase()"><pg-icon name="rebase" /><span class="lbl">Rebase</span></button>
      </div>
      <div class="tool-group">
        <button class="btn" title="Refresh (F5)" [disabled]="!store.repo()" (click)="store.refresh()"><pg-icon name="refresh" /></button>
        <button class="btn" title="Open terminal" [disabled]="!store.repo()" (click)="a.terminal()"><pg-icon name="terminal" /></button>
      </div>
      <div class="spacer"></div>
      @if (store.repo(); as repo) {
        <span class="repo-name" [title]="repo.path">
          <span>{{ repo.name }}</span>
          @if (store.status(); as st) {
            <span class="branch-pill"><pg-icon name="branch" [size]="12" />{{ st.detached ? 'detached HEAD' : (st.branch ?? '(no branch)') }}@if (st.upstream) { <span class="badge">→ {{ st.upstream }}</span> }</span>
          }
        </span>
      }
      <div class="tool-group">
        <button class="btn small" [class.active]="store.perspective() === 'standard'" title="Standard window (Cmd/Ctrl+1)" (click)="store.perspective.set('standard')">Standard</button>
        <button class="btn small" [class.active]="store.perspective() === 'log'" title="Log window (Cmd/Ctrl+2)" (click)="store.perspective.set('log')">Log</button>
        <button class="btn small" [class.active]="store.perspective() === 'worktree'" title="Working tree window (Cmd/Ctrl+3)" (click)="store.perspective.set('worktree')">Working Tree</button>
      </div>
      <button class="btn small ghost" title="Toggle theme" (click)="store.toggleTheme()"><pg-icon [name]="store.theme() === 'dark' ? 'sun' : 'moon'" /></button>
      <button class="btn small ghost" title="Settings (Cmd/Ctrl+,)" (click)="store.showSettings.set(true)"><pg-icon name="gear" /></button>
    </div>`
})
export class Toolbar {
  readonly store = inject(Store)
  readonly a = inject(Actions).a
  readonly mac = window.pakgitMenu.platform === 'darwin'
  readonly disabled = computed(() => !this.store.repo() || !!this.store.busy())
}
