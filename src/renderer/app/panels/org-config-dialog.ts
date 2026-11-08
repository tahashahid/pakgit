import { Component, computed, effect, inject, signal } from '@angular/core'
import { Store } from '../store.service'
import { PipelineEditor } from '../ui/pipeline-editor'
import type { EnvConfig, Environment, GateConfig, GateId, GateMode, HostingConfig, HostingStatus, OrgTrackerStatus, Organization, RepoEntry, TrackerConfig } from '@shared/types'

type Section = 'general' | 'repositories' | 'pipeline' | 'gates' | 'conventions' | 'integrations' | 'sharing'
const GATES: { id: GateId; label: string; hint: string }[] = [
  { id: 'tracker-state', label: 'Tracker state', hint: 'every item is in one of the allowed Linear states' },
  { id: 'partly-promoted', label: 'Not partly promoted', hint: 'no issue sits on different environments across repositories' },
  { id: 'dev-based', label: 'Not cut from dev/stage', hint: 'no branch carries other unreleased work' },
  { id: 'frozen', label: 'Environment not frozen', hint: 'the freeze below is not active' },
  { id: 'previous-env', label: 'Already in the previous environment', hint: 'every item is waiting for this environment' }
]
/** Defaults mirror the engine: the last environment blocks on tracker state (Ready To Deploy) and partly promoted. */
function defaultGate(id: GateId, isLast: boolean): GateConfig {
  if (id === 'tracker-state') return { id, mode: isLast ? 'block' : 'warn', states: isLast ? ['Ready To Deploy'] : [] }
  if (id === 'partly-promoted') return { id, mode: isLast ? 'block' : 'warn' }
  if (id === 'dev-based') return { id, mode: 'warn' }
  return { id, mode: 'block' }
}
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
                  <div class="group-header" style="padding-left:0">Deploy order<span class="count">releases list and merge repositories in this order</span></div>
                  <div class="rebase-list" style="max-height:30vh">
                    @for (r of ordered(); track r.path; let i = $index) {
                      <div class="rebase-row"><span class="mono muted" style="font-size:11px;width:18px">{{ i + 1 }}.</span><span class="subject">{{ r.name }}@if (r.group) { <span class="muted"> · {{ r.group }}</span> }</span>
                        <button type="button" class="btn small" (click)="moveOrder(i, -1)" [disabled]="i === 0" title="Earlier">↑</button><button type="button" class="btn small" (click)="moveOrder(i, 1)" [disabled]="i === ordered().length - 1" title="Later">↓</button></div>
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
                @case ('gates') {
                  @if (o.pipeline; as p) {
                    <p class="modal-message">Pre-flight checks run before a release is created from the Ready tab. Blocking checks can be overridden by typing the branch name; the override is recorded on the release. A freeze blocks promotions into an environment until it is lifted (or its date passes).</p>
                    @for (e of p.environments; track e.id + $index; let i = $index; let last = $last) {
                      <div class="gate-env">
                        <div class="gate-env-title"><b>{{ e.name || e.branch }}</b><span class="mono muted" style="margin-left:8px">{{ e.branch }}</span>@if (last) { <span class="muted"> · last environment</span> }</div>
                        <div class="gate-grid">
                          @for (g of gateDefs; track g.id) {
                            <span [title]="g.hint">{{ g.label }}</span>
                            <select (change)="setGate(i, g.id, { mode: $any($event.target).value })"><option value="off" [selected]="gate(e, g.id, last).mode === 'off'">off</option><option value="warn" [selected]="gate(e, g.id, last).mode === 'warn'">warn</option><option value="block" [selected]="gate(e, g.id, last).mode === 'block'">block</option></select>
                            @if (g.id === 'tracker-state') { <input [value]="(gate(e, g.id, last).states ?? []).join(', ')" placeholder="allowed states, e.g. Ready To Deploy (empty = any)" (input)="setGate(i, g.id, { states: split($any($event.target).value) })" /> } @else { <span class="muted" style="font-size:11px">{{ g.hint }}</span> }
                          }
                          <span title="Set on the Linear issues when a pull request into this environment opens">Linear state when the PR opens</span>
                          <span></span>
                          <input [value]="e.trackerStateOnPr ?? ''" placeholder="e.g. In Review (empty = no change)" (input)="setEnv(i, { trackerStateOnPr: $any($event.target).value })" />
                          <span title="Promotions into this environment are blocked while frozen">Freeze</span>
                          <input type="date" [value]="o.freezes[e.id]?.until ?? ''" (change)="setFreeze(e.id, { until: $any($event.target).value || null })" title="Lifts automatically after this day; empty = until lifted by hand" />
                          <input [value]="o.freezes[e.id]?.note ?? ''" placeholder="empty = not frozen; e.g. UAT until Friday" (input)="setFreeze(e.id, { note: $any($event.target).value })" />
                        </div>
                      </div>
                    }
                  } @else { <p class="modal-message">Gates and freezes are part of the pipeline template. Set one under Pipeline; until then the defaults apply (the last environment blocks on tracker state "Ready To Deploy" and on partly promoted issues, everything else warns).</p> }
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
                  <h3 style="margin:6px 0 0;font-size:13px">Hosting (pull requests)</h3>
                  <div class="settings-grid">
                    <label class="field"><span>Provider</span>
                      <select (change)="setHosting({ provider: $any($event.target).value })"><option value="auto" [selected]="o.hosting.provider === 'auto'">Automatic (GitHub when available)</option><option value="github" [selected]="o.hosting.provider === 'github'">GitHub</option><option value="none" [selected]="o.hosting.provider === 'none'">None (pull-request links only)</option></select>
                      <small class="hint">GitHub through the gh CLI when it is installed and signed in, else through a personal access token. GitLab and Bitbucket get links from the remote URL.</small></label>
                    <div class="field"><span>Connection</span>
                      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                        @if (hs()?.available) { <span class="chip ok">GitHub ✓{{ hs()!.account ? ' ' + hs()!.account : '' }} via {{ hs()!.via === 'gh' ? 'gh' : 'token' }}</span> }
                        @else if (o.hosting.provider !== 'none') { <span class="chip bad" [title]="hs()?.error ?? ''">{{ hs()?.error ?? 'not connected' }}</span> }
                        <button type="button" class="btn small ghost" (click)="refreshHosting()">Check</button>
                      </div>
                      <small class="hint">The gh path can be set in Settings when it is not found.</small></div>
                    <label class="field"><span>Personal access token (optional)</span><input type="password" [value]="ghToken()" placeholder="ghp_… (leave empty to keep the stored one, or to use gh)" (input)="ghToken.set($any($event.target).value)" /><small class="hint">Needs the repo scope. Stored encrypted, yours only, never exported.</small></label>
                    <label class="field"><span>Reviewers for release pull requests</span><input [value]="o.hosting.reviewers.join(', ')" placeholder="github logins, comma-separated" (input)="setHosting({ reviewers: split($any($event.target).value) })" /></label>
                    <label class="field"><span>Labels</span><input [value]="o.hosting.labels.join(', ')" placeholder="e.g. release" (input)="setHosting({ labels: split($any($event.target).value) })" /></label>
                    <label class="field field-check"><input type="checkbox" [checked]="o.hosting.draft" (change)="setHosting({ draft: $any($event.target).checked })" /><span>Open release pull requests as drafts</span></label>
                    <label class="field field-check"><input type="checkbox" [checked]="o.hosting.attachPrsToIssues" (change)="setHosting({ attachPrsToIssues: $any($event.target).checked })" /><span>Attach pull requests to the Linear issues</span></label>
                    <label class="field" style="grid-column:1/-1"><span>Pull request body template</span><textarea rows="4" [value]="o.hosting.prTemplate" placeholder="empty = the default (items with their Linear links). Tokens: {{ '{' }}name{{ '}' }} {{ '{' }}env{{ '}' }} {{ '{' }}items{{ '}' }} {{ '{' }}repo{{ '}' }}" (input)="setHosting({ prTemplate: $any($event.target).value })"></textarea></label>
                  </div>
                  <small class="hint">Slack notifications and CI beyond pull-request checks come in a later phase.</small>
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
    { id: 'general', label: 'General' }, { id: 'repositories', label: 'Repositories & groups' }, { id: 'pipeline', label: 'Pipeline' }, { id: 'gates', label: 'Gates & freeze' },
    { id: 'conventions', label: 'Conventions' }, { id: 'integrations', label: 'Integrations' }, { id: 'sharing', label: 'Sharing' }
  ]
  readonly gateDefs = GATES
  readonly hs = signal<HostingStatus | null>(null)
  readonly ghToken = signal('')
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
      this.draft.set(structuredClone(o)); this.section.set((s as Section) in { general: 1, repositories: 1, pipeline: 1, gates: 1, conventions: 1, integrations: 1, sharing: 1 } ? (s as Section) : 'general')
      this.error.set(''); this.apiKey.set(''); this.ghToken.set('')
      void this.refreshTracker(o.id); void this.refreshHosting()
    })
    this.store.api.trackerRedirectUrl().then((u) => this.redirect.set(u)).catch(() => undefined)
  }
  private async refreshTracker(id: string): Promise<void> { try { this.ts.set(await this.store.api.orgTrackerStatus(id)) } catch { this.ts.set(null) } }
  set(patch: Partial<Organization>): void { this.draft.update((d) => (d ? { ...d, ...patch } : d)) }
  setHosting(patch: Partial<HostingConfig>): void { this.draft.update((d) => (d ? { ...d, hosting: { ...d.hosting, ...patch } } : d)) }
  split(v: string): string[] { return v.split(',').map((x) => x.trim()).filter(Boolean) }
  async refreshHosting(): Promise<void> { try { this.hs.set(await this.store.api.orgHostingStatus(this.store.activeOrgId())) } catch { this.hs.set(null) } }
  // ---- gates & freeze (part of the pipeline template and the organization)
  gate(e: Environment, id: GateId, isLast: boolean): GateConfig { return e.gates?.find((g) => g.id === id) ?? defaultGate(id, isLast) }
  setGate(i: number, id: GateId, patch: Partial<GateConfig>): void {
    this.draft.update((d) => {
      if (!d?.pipeline) return d
      const envs = d.pipeline.environments.map((e, k) => {
        if (k !== i) return e
        const isLast = k === d.pipeline!.environments.length - 1
        const gates = GATES.map((g) => e.gates?.find((x) => x.id === g.id) ?? defaultGate(g.id, isLast)).map((g) => (g.id === id ? { ...g, ...patch } : g))
        return { ...e, gates }
      })
      return { ...d, pipeline: { ...d.pipeline, environments: envs } }
    })
  }
  setEnv(i: number, patch: Partial<Environment>): void { this.draft.update((d) => (d?.pipeline ? { ...d, pipeline: { ...d.pipeline, environments: d.pipeline.environments.map((e, k) => (k === i ? { ...e, ...patch } : e)) } } : d)) }
  setFreeze(envId: string, patch: { note?: string; until?: string | null }): void {
    this.draft.update((d) => { if (!d) return d; const cur = d.freezes[envId] ?? { note: '', until: null }; const next = { ...cur, ...patch }; const freezes = { ...d.freezes }; if (next.note.trim() || next.until) freezes[envId] = next; else delete freezes[envId]; return { ...d, freezes } })
  }
  // ---- deploy order (identity = remote, else path)
  readonly ordered = computed<RepoEntry[]>(() => {
    const d = this.draft(); const repos = this.store.repos(); if (!d) return repos
    const key = (r: RepoEntry): string => r.remote ?? r.path
    const rank = new Map(d.deployOrder.map((k, i) => [k, i]))
    return [...repos].sort((a, b) => (rank.get(key(a)) ?? 1e9) - (rank.get(key(b)) ?? 1e9) || Number(!a.group) - Number(!b.group) || (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name))
  })
  moveOrder(i: number, dir: -1 | 1): void {
    const list = [...this.ordered()]; const j = i + dir; if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    this.set({ deployOrder: list.map((r) => r.remote ?? r.path) })
  }
  setConv(patch: Partial<Organization['conventions']>): void { this.draft.update((d) => (d ? { ...d, conventions: { ...d.conventions, ...patch } } : d)) }
  setTracker(patch: Partial<TrackerConfig>): void { this.draft.update((d) => (d ? { ...d, tracker: { ...d.tracker, ...patch } } : d)) }
  close(): void { this.store.showOrgConfig.set(null) }
  async persist(): Promise<Organization | null> {
    const d = this.draft(); if (!d) return null
    const { id, createdAt, ...patch } = d
    const saved = await this.store.api.orgUpdate(id, patch)
    if (this.apiKey().trim()) { await this.store.api.orgTrackerSetSecrets(id, { linearApiKey: this.apiKey().trim() }); this.apiKey.set('') }
    if (this.ghToken().trim()) { await this.store.api.orgHostingSetToken(id, this.ghToken().trim()); this.ghToken.set('') }
    this.store.org.set(saved)
    return saved
  }
  async save(): Promise<void> {
    this.busy.set(true); this.error.set('')
    try { await this.persist(); await this.store.reloadOrg(); await this.store.refreshTracker(); this.store.hostingStatus.set(null); void this.store.refreshHosting(); this.store.release.set(null); this.store.overview.set(null); this.store.index.set(null); this.store.toast('success', 'Organization saved'); this.close() }
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
