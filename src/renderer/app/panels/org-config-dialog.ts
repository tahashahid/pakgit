import { Component, computed, effect, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import { PipelineEditor } from '../ui/pipeline-editor'
import type { EnvConfig, OrgTrackerStatus, Organization, TrackerConfig } from '@shared/types'

type Section = 'general' | 'repositories' | 'pipeline' | 'conventions' | 'integrations' | 'sharing'
const COLORS = ['#0B6B3A', '#2563eb', '#7c3aed', '#db2777', '#d97706', '#0891b2', '#dc2626', '#4b5563']

@Component({
  selector: 'pg-org-config-dialog',
  imports: [PipelineEditor],
  template: `
    @if (store.showOrgConfig() && draft(); as o) {
      <div class="modal-backdrop" (mousedown)="close()">
        <div class="modal xwide" (mousedown)="$event.stopPropagation()">
          <h2><span class="org-dot" [style.background]="o.color" style="display:inline-block;margin-right:8px"></span>{{ o.name }}</h2>
          <div class="cfg-body">
            <nav class="section-nav">
              @for (s of sections; track s.id) { <button [class.active]="section() === s.id" (click)="section.set(s.id)">{{ s.label }}</button> }
            </nav>
            <div class="cfg-content">
              @switch (section()) {
                @case ('general') {
                  <div class="settings-grid">
                    <label class="field"><span>Name</span><input [value]="o.name" [disabled]="o.id === 'personal'" (input)="set({ name: $any($event.target).value })" /></label>
                    <div class="field"><span>Colour</span><div class="swatches">@for (c of colors; track c) { <span class="swatch" [class.active]="o.color === c" [style.background]="c" (click)="set({ color: c })"></span> }</div></div>
                  </div>
                  <label class="field"><span>How we work</span><textarea rows="8" [value]="o.howWeWork" placeholder="The team's process, shown in the Release view help. Markdown-ish text is fine." (input)="set({ howWeWork: $any($event.target).value })"></textarea></label>
                }
                @case ('repositories') {
                  <p class="modal-message">Repositories of this organization. A repository belongs to one organization; moving it keeps its own settings.</p>
                  <div class="repo-table">
                    <span class="head">Name</span><span class="head">Remote</span><span class="head">Group</span><span class="head">Organization</span><span></span>
                    @for (r of store.repos(); track r.path) {
                      <span [title]="r.path">{{ r.name }}</span>
                      <span class="mono muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis">{{ r.remote ?? 'no remote' }}</span>
                      <select (change)="setGroup(r.path, $any($event.target).value)"><option value="" [selected]="!r.group">—</option>@for (g of o.groups; track g) { <option [value]="g" [selected]="r.group === g">{{ g }}</option> }</select>
                      <select (change)="moveRepo(r.path, $any($event.target).value)">@for (x of store.workspace()?.organizations ?? []; track x.id) { <option [value]="x.id" [selected]="x.id === o.id">{{ x.name }}</option> }</select>
                      <button type="button" class="btn small danger" title="Remove from the list" (click)="removeRepo(r.path)">✕</button>
                    }
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <button type="button" class="btn small" (click)="store.addRepo()">+ Open repository…</button>
                    <input [value]="newGroup()" placeholder="New group name" (input)="newGroup.set($any($event.target).value)" style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--fg1)" />
                    <button type="button" class="btn small" (click)="addGroup()" [disabled]="!newGroup().trim()">Add group</button>
                    @for (g of o.groups; track g) { <span class="chip">{{ g }} <button type="button" class="btn small ghost" style="padding:0 4px" (click)="removeGroup(g)" title="Delete group">✕</button></span> }
                  </div>
                  @if (missing().length) {
                    <div class="group-header">Not on this machine<span class="count">{{ missing().length }}</span></div>
                    @for (m of missing(); track m.remote) { <div class="row"><span class="grow mono" style="font-size:11.5px">{{ m.remote }}</span><button type="button" class="btn small" (click)="clone(m)">Clone…</button></div> }
                  }
                }
                @case ('pipeline') {
                  <label class="field field-check"><input type="checkbox" [checked]="!!o.pipeline" (change)="togglePipeline($any($event.target).checked)" /><span>Share one pipeline template with every repository of this organization</span></label>
                  @if (o.pipeline) {
                    <pg-pipeline-editor [value]="o.pipeline" [detectLabel]="store.repo() ? 'Detect from ' + store.repo()!.name : ''" (valueChange)="set({ pipeline: $event })" (detect)="detectPipeline()" />
                    <small class="hint">Each repository inherits this and may override branch names, promotion strategies or leave environments out (repository ▸ Release ▸ Configure).</small>
                  } @else { <small class="hint">Without a template every repository detects or defines its own pipeline.</small> }
                }
                @case ('conventions') {
                  <div class="settings-grid">
                    <label class="field"><span>Branch name for "Start work"</span><input class="mono" [value]="o.conventions.branchPattern" (input)="setConv({ branchPattern: $any($event.target).value })" /><small class="hint">Tokens: {{ '{' }}user{{ '}' }}, {{ '{' }}key{{ '}' }}, {{ '{' }}slug{{ '}' }}. Linear's own branch name is used when it provides one.</small></label>
                    <label class="field"><span>Release branch name</span><input class="mono" [value]="o.conventions.releasePattern" (input)="setConv({ releasePattern: $any($event.target).value })" /><small class="hint">Tokens: {{ '{' }}env{{ '}' }}, {{ '{' }}week{{ '}' }}, {{ '{' }}date{{ '}' }}, {{ '{' }}name{{ '}' }}. Example: release/release-{{ '{' }}week{{ '}' }}</small></label>
                  </div>
                }
                @case ('integrations') {
                  <h3 style="margin:0;font-size:13px">Issue tracker</h3>
                  <div class="settings-grid">
                    <label class="field"><span>Provider</span>
                      <select (change)="setTracker({ provider: $any($event.target).value })"><option value="none" [selected]="o.tracker.provider === 'none'">None</option><option value="linear" [selected]="o.tracker.provider === 'linear'">Linear</option></select>
                      <small class="hint">One tracker per organization; secrets and sign-ins are yours only and are never exported.</small></label>
                    @if (o.tracker.provider === 'linear') {
                      <label class="field"><span>Authentication</span>
                        <select (change)="setTracker({ authMethod: $any($event.target).value })"><option value="oauth" [selected]="o.tracker.authMethod === 'oauth'">Sign in with Linear (browser)</option><option value="apiKey" [selected]="o.tracker.authMethod === 'apiKey'">Personal API key</option></select></label>
                      @if (o.tracker.authMethod === 'apiKey') {
                        <label class="field"><span>Linear personal API key</span><input type="password" [value]="apiKey()" placeholder="lin_api_… (leave empty to keep the stored key)" (input)="apiKey.set($any($event.target).value)" /><small class="hint">Linear ▸ Settings ▸ Security &amp; access. {{ ts()?.hasApiKey ? 'A key is stored.' : 'No key stored yet.' }}</small></label>
                      } @else {
                        <label class="field"><span>OAuth client ID</span><input [value]="o.tracker.linearClientId" placeholder="from your Linear OAuth application" (input)="setTracker({ linearClientId: $any($event.target).value })" /><small class="hint">Created once per workspace in Linear ▸ Settings ▸ API ▸ OAuth applications. Callback URL <code>{{ redirect() }}</code>.</small></label>
                        <div class="field"><span>Connection</span>
                          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                            @if (ts()?.signedIn) { <span class="chip ok">Signed in{{ ts()?.account ? ' as ' + ts()!.account : '' }}</span><button type="button" class="btn small" (click)="logout()" [disabled]="busy()">Sign out</button> }
                            @else { <button type="button" class="btn small primary" (click)="login()" [disabled]="busy() || !o.tracker.linearClientId.trim()">{{ busy() ? 'Waiting for the browser…' : 'Sign in with Linear…' }}</button> }
                            @if (ts()?.error) { <span class="chip bad" [title]="ts()!.error">{{ ts()!.error }}</span> }
                          </div>
                          <small class="hint">Saves the settings first, then opens your browser.</small></div>
                      }
                      <label class="field"><span>State when starting work on an issue</span><input [value]="o.tracker.stateOnStart" placeholder="In Progress" (input)="setTracker({ stateOnStart: $any($event.target).value })" /><small class="hint">States on arrival in each environment are part of the pipeline.</small></label>
                    }
                  </div>
                  <h3 style="margin:6px 0 0;font-size:13px">Hosting, notifications, CI</h3>
                  <small class="hint">Pull-request links already work from the remote URL (GitHub, GitLab, Bitbucket). PR state, Slack and CI integrations come in later phases.</small>
                }
                @case ('sharing') {
                  <p class="modal-message">Export writes one file with this organization's repositories (by remote URL), groups, pipeline, conventions and tracker configuration, and no secrets or local paths. A teammate imports it and gets the same setup, with Clone buttons for repositories they do not have.</p>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button type="button" class="btn" (click)="exportOrg()">Export organization…</button>
                    <button type="button" class="btn" (click)="importOrg()">Import organization…</button>
                    <span style="flex:1"></span>
                    @if (o.id !== 'personal') { <button type="button" class="btn danger" (click)="deleteOrg()">Delete organization…</button> }
                  </div>
                  <small class="hint">Deleting moves its repositories back to Personal and forgets its integrations; repository settings stay.</small>
                }
              }
            </div>
          </div>
          @if (error()) { <p class="modal-message" style="color:var(--danger)">{{ error() }}</p> }
          <div class="modal-actions">
            <button type="button" class="btn" (click)="close()">Cancel</button>
            <button type="button" class="btn primary" (click)="save()" [disabled]="busy()">Save</button>
          </div>
        </div>
      </div>
    }`
})
export class OrgConfigDialog {
  readonly store = inject(Store)
  readonly sections: { id: Section; label: string }[] = [
    { id: 'general', label: 'General' }, { id: 'repositories', label: 'Repositories & groups' }, { id: 'pipeline', label: 'Pipeline' },
    { id: 'conventions', label: 'Conventions' }, { id: 'integrations', label: 'Integrations' }, { id: 'sharing', label: 'Sharing' }
  ]
  readonly colors = COLORS
  readonly section = signal<Section>('general')
  readonly draft = signal<Organization | null>(null)
  readonly ts = signal<OrgTrackerStatus | null>(null)
  readonly apiKey = signal('')
  readonly newGroup = signal('')
  readonly busy = signal(false)
  readonly error = signal('')
  readonly redirect = signal('')
  readonly missing = signal<{ remote: string; name: string; group: string | null }[]>([])
  constructor() {
    effect(() => {
      const s = this.store.showOrgConfig()
      if (!s) { this.draft.set(null); return }
      const o = this.store.org(); if (!o) return
      this.draft.set(structuredClone(o)); this.section.set((s as Section) in { general: 1, repositories: 1, pipeline: 1, conventions: 1, integrations: 1, sharing: 1 } ? (s as Section) : 'general')
      this.error.set(''); this.apiKey.set('')
      void this.refreshTracker(o.id)
    })
    this.store.api.trackerRedirectUrl().then((u) => this.redirect.set(u)).catch(() => undefined)
  }
  private async refreshTracker(id: string): Promise<void> { try { this.ts.set(await this.store.api.orgTrackerStatus(id)) } catch { this.ts.set(null) } }
  set(patch: Partial<Organization>): void { this.draft.update((d) => (d ? { ...d, ...patch } : d)) }
  setConv(patch: Partial<Organization['conventions']>): void { this.draft.update((d) => (d ? { ...d, conventions: { ...d.conventions, ...patch } } : d)) }
  setTracker(patch: Partial<TrackerConfig>): void { this.draft.update((d) => (d ? { ...d, tracker: { ...d.tracker, ...patch } } : d)) }
  close(): void { this.store.showOrgConfig.set(null) }
  async persist(): Promise<Organization | null> {
    const d = this.draft(); if (!d) return null
    const { id, createdAt, ...patch } = d
    const saved = await this.store.api.orgUpdate(id, patch)
    if (this.apiKey().trim()) { await this.store.api.orgTrackerSetSecrets(id, { linearApiKey: this.apiKey().trim() }); this.apiKey.set('') }
    this.store.org.set(saved)
    return saved
  }
  async save(): Promise<void> {
    this.busy.set(true); this.error.set('')
    try { await this.persist(); await this.store.reloadOrg(); await this.store.refreshTracker(); this.store.release.set(null); this.store.overview.set(null); this.store.toast('success', 'Organization saved'); this.close() }
    catch (e) { this.error.set(e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  // repositories & groups act immediately (they are not part of the draft)
  async setGroup(path: string, group: string): Promise<void> { await this.store.api.setRepoGroup(path, group || null); await this.store.reloadRepos() }
  async moveRepo(path: string, orgId: string): Promise<void> {
    if (orgId === this.draft()?.id) return
    await this.store.api.orgMoveRepo(path, orgId); await this.store.reloadRepos()
    if (this.store.repo()?.path === path) { const first = this.store.repos()[0]; if (first) this.store.openRepo(first); else { this.store.repo.set(null); void this.store.refresh() } }
  }
  async removeRepo(path: string): Promise<void> { if (await this.store.prompt({ title: 'Remove from list', okLabel: 'Remove', message: `Remove ${path} from PakGit? The folder is not touched.` })) await this.store.removeRepo(path) }
  async addGroup(): Promise<void> { const g = this.newGroup().trim(); if (!g) return; await this.store.api.createGroup(g); this.newGroup.set(''); await this.store.reloadOrg(); this.draft.update((d) => (d && !d.groups.includes(g) ? { ...d, groups: [...d.groups, g] } : d)) }
  async removeGroup(g: string): Promise<void> { await this.store.api.deleteGroup(g); await this.store.reloadOrg(); this.draft.update((d) => (d ? { ...d, groups: d.groups.filter((x) => x !== g) } : d)) }
  async clone(m: { remote: string; name: string; group: string | null }): Promise<void> {
    const parent = await this.store.api.pickDirectory('Choose where to clone ' + m.name); if (!parent) return
    const url = `https://${m.remote}.git`
    const entry = await this.store.run('Clone', () => this.store.api.cloneRepo(url, `${parent}/${m.name}`), { success: `Cloned ${m.name}` })
    if (entry) { if (m.group) await this.store.api.setRepoGroup(entry.path, m.group); this.missing.update((l) => l.filter((x) => x.remote !== m.remote)); await this.store.reloadRepos() }
  }
  togglePipeline(on: boolean): void {
    if (!on) { this.set({ pipeline: null }); return }
    const r = this.store.repo()
    if (r) this.store.api.detectReleaseConfig(r.path).then((c) => this.set({ pipeline: c })).catch(() => this.set({ pipeline: this.emptyPipeline() }))
    else this.set({ pipeline: this.emptyPipeline() })
  }
  private emptyPipeline(): EnvConfig {
    return { remote: 'origin', releasePrefix: 'release/', backMerge: true, baseEnv: 'prod', issuePrefixes: [], excludePrefixes: ['release/', 'sync/', 'dependabot/'], environments: [
      { id: 'dev', name: 'Development', branch: 'dev', strategy: 'feature-pr', trackerState: 'QA' },
      { id: 'stage', name: 'Staging', branch: 'stage', strategy: 'release-branch', trackerState: 'UAT' },
      { id: 'prod', name: 'Production', branch: 'main', strategy: 'release-branch', trackerState: 'Done' }] }
  }
  async detectPipeline(): Promise<void> { const r = this.store.repo(); if (!r) return; this.set({ pipeline: await this.store.api.detectReleaseConfig(r.path) }) }
  async login(): Promise<void> {
    const d = this.draft(); if (!d) return
    this.busy.set(true); this.error.set('')
    try {
      await this.persist()
      const r = await this.store.api.orgTrackerLogin(d.id)
      if (!r.ok) this.error.set(r.error ?? 'Sign-in failed'); else this.store.toast('success', `Connected to Linear${r.account ? ' as ' + r.account : ''}`)
      await this.refreshTracker(d.id); await this.store.refreshTracker()
    } catch (e) { this.error.set(e instanceof Error ? e.message : String(e)) } finally { this.busy.set(false) }
  }
  async logout(): Promise<void> { const d = this.draft(); if (!d) return; this.busy.set(true); try { await this.store.api.orgTrackerLogout(d.id); await this.refreshTracker(d.id); await this.store.refreshTracker() } finally { this.busy.set(false) } }
  async exportOrg(): Promise<void> {
    const d = this.draft(); if (!d) return
    try { await this.persist(); const p = await this.store.api.orgExport(d.id); if (p) this.store.toast('success', `Exported to ${p}`) } catch (e) { this.error.set(e instanceof Error ? e.message : String(e)) }
  }
  async importOrg(): Promise<void> {
    try {
      const r = await this.store.api.orgImport(); if (!r) return
      await this.store.loadWorkspace(); await this.store.switchOrg(r.org.id)
      this.missing.set(r.missing); this.section.set('repositories')
      this.store.toast('success', `Imported ${r.org.name}: ${r.matched.length} repositories found here${r.missing.length ? `, ${r.missing.length} to clone` : ''}`)
    } catch (e) { this.error.set(e instanceof Error ? e.message : String(e)) }
  }
  async deleteOrg(): Promise<void> {
    const d = this.draft(); if (!d) return
    if (!(await this.store.prompt({ title: 'Delete organization', danger: true, okLabel: 'Delete', message: `Delete "${d.name}"? Its repositories move back to Personal; their settings are kept.` }))) return
    await this.store.api.orgDelete(d.id); this.close(); await this.store.loadWorkspace(); await this.store.switchOrg('personal')
  }
}
