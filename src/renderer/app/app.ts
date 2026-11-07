import { Component, inject } from '@angular/core'
import { Store } from './store.service'
import { Actions } from './actions.service'
import { Toolbar } from './panels/toolbar'
import { Repositories } from './panels/repositories'
import { Branches } from './panels/branches'
import { Files } from './panels/files'
import { Changes } from './panels/changes'
import { Commit } from './panels/commit'
import { Log, CommitDetails } from './panels/log'
import { Output } from './panels/output'
import { RebaseDialog } from './panels/rebase-dialog'
import { SettingsDialog } from './panels/settings-dialog'
import { Release } from './panels/release'
import { OrganizationView } from './panels/organization'
import { OrgConfigDialog } from './panels/org-config-dialog'
import { NewOrgDialog } from './panels/new-org-dialog'
import { Split } from './ui/split'
import { Dialog } from './ui/dialog'
import { Toasts } from './ui/toasts'
import { ContextMenu } from './ui/context-menu'

@Component({
  selector: 'pg-app',
  imports: [Toolbar, Repositories, Branches, Files, Changes, Commit, Log, CommitDetails, Output, RebaseDialog, SettingsDialog, Release, OrganizationView, OrgConfigDialog, NewOrgDialog, Split, Dialog, Toasts, ContextMenu],
  template: `
    <div class="app">
      <pg-toolbar />
      @if (!store.repo() && store.perspective() !== 'organization') {
        <div class="welcome">
          <img src="logo.svg" alt="" width="96" height="96" style="border-radius:22px" />
          <h1>PakGit</h1>
          <p>A cross-platform Git client. Open an existing repository, clone one, or initialize a new one.</p>
          <div class="actions">
            <button class="btn primary" (click)="a.openRepo()">Open Repository…</button>
            <button class="btn" (click)="a.clone()">Clone…</button>
            <button class="btn" (click)="a.init()">Initialize…</button>
          </div>
          <div style="width:320px;margin-top:20px;display:flex"><pg-repositories /></div>
        </div>
      } @else {
        <div class="main" style="padding:6px;gap:6px">
          <pg-split dir="h" [initial]="260" storageKey="root" [min]="160">
            <pg-split first dir="v" [initial]="220" storageKey="left" [min]="80">
              <pg-repositories first />
              <pg-branches second />
            </pg-split>
            <ng-container second>
              @if (!store.repo() && store.perspective() === 'organization') { <pg-organization /> }
              @else { @switch (store.perspective()) {
                @case ('log') {
                  <pg-split dir="h" [initial]="700" storageKey="log-main" [min]="300">
                    <pg-log first />
                    <pg-split second dir="v" [initial]="300" storageKey="log-right" [min]="120">
                      <pg-commit-details first />
                      <pg-changes second />
                    </pg-split>
                  </pg-split>
                }
                @case ('release') { <pg-release /> }
                @case ('organization') { <pg-organization /> }
                @case ('worktree') {
                  <pg-split dir="h" [initial]="420" storageKey="wt-main" [min]="200">
                    <pg-split first dir="v" [initial]="520" storageKey="wt-left" [min]="120">
                      <pg-files first />
                      <pg-commit second />
                    </pg-split>
                    <pg-changes second />
                  </pg-split>
                }
                @default {
                  <pg-split dir="v" [initial]="380" storageKey="std-top" [min]="160">
                    <pg-split first dir="h" [initial]="380" storageKey="std-top-h" [min]="200">
                      <pg-files first />
                      <pg-changes second />
                    </pg-split>
                    <pg-split second dir="h" [initial]="700" storageKey="std-bottom-h" [min]="300">
                      <pg-split first dir="v" [initial]="260" storageKey="std-log" [min]="100">
                        <pg-log first />
                        <pg-commit-details second />
                      </pg-split>
                      <pg-split second dir="v" [initial]="220" storageKey="std-commit" [min]="120">
                        <pg-commit first />
                        <pg-output second />
                      </pg-split>
                    </pg-split>
                  </pg-split>
                }
              } }
            </ng-container>
          </pg-split>
        </div>
        <div class="statusbar">
          <span>{{ store.repo()?.path ?? store.org()?.name ?? '' }}</span>
          @if (store.status(); as st) { <span>{{ st.files.length }} changed · ↑{{ st.ahead }} ↓{{ st.behind }}</span> }
          @if (store.error()) { <span style="color:var(--danger)">{{ store.error() }}</span> }
          <span style="flex:1"></span>
          @if (store.busy()) { <span class="busy"><span class="spinner"></span>{{ store.busy() }}…</span> }
          <span>{{ store.gitVersion() }}</span>
        </div>
      }
      <pg-dialog />
      <pg-rebase-dialog />
      <pg-settings-dialog />
      <pg-org-config-dialog />
      <pg-new-org-dialog />
      <pg-context-menu />
      <pg-toasts />
    </div>`
})
export class App {
  readonly store = inject(Store)
  readonly a = inject(Actions).a
  constructor() {
    const a = this.a, s = this.store
    const map: Record<string, () => unknown> = {
      'repo:open': a.openRepo, 'repo:clone': a.clone, 'repo:init': a.init, 'repo:refresh': () => s.refresh(),
      'repo:terminal': a.terminal, 'remote:fetch': a.fetch, 'remote:pull': a.pull, 'remote:push': a.push,
      'local:commit': a.focusCommit, 'local:stage-all': a.stageAll, 'local:stash': a.stash,
      'local:empty-commit': a.emptyCommit, 'repo:apply-patch': a.applyPatch, 'repo:clean': a.clean,
      'view:standard': () => s.perspective.set('standard'), 'view:log': () => s.perspective.set('log'), 'view:worktree': () => s.perspective.set('worktree'),
      'view:release': () => s.perspective.set('release'),
      'view:organization': () => s.perspective.set('organization'),
      'org:switch': () => s.perspective.set('organization'),
      'view:theme': () => s.toggleTheme(), 'view:settings': () => s.showSettings.set(true)
    }
    window.pakgitMenu.on((action) => void map[action]?.())
  }
}
