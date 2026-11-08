import { Component, computed, effect, inject, input, output, signal } from '@angular/core'
import { Store } from '../store.service'
import { PipelineEditor } from '../ui/pipeline-editor'
import type { EnvConfig, Environment, Probe, RepoPipeline, RepoPipelineOverride } from '@shared/types'

/** Per-repository pipeline: inherit the organization template (with branch / strategy / subset overrides) or a custom pipeline. */
@Component({
  selector: 'pg-env-config-dialog',
  imports: [PipelineEditor],
  template: `
    <div class="modal-backdrop" (mousedown)="closed.emit()">
      <form class="modal wide" (mousedown)="$event.stopPropagation()" (submit)="$event.preventDefault(); save()">
        <h2>Pipeline for {{ store.repo()?.name }}</h2>
        @if (!loaded()) { <div class="empty">Loading…</div> }
        @else {
          @if (template(); as t) {
            <div class="seg">
              <button type="button" class="btn small" [class.active]="mode() === 'org'" (click)="mode.set('org')">Use the {{ store.org()?.name }} pipeline</button>
              <button type="button" class="btn small" [class.active]="mode() === 'custom'" (click)="switchToCustom()">Custom for this repository</button>
            </div>
            @if (mode() === 'org') {
              <p class="modal-message">Inherited from the organization. Override a branch name, a promotion strategy, or untick an environment this repository does not have. Everything left empty stays inherited.</p>
              <div class="env-list">
                <div class="env-row head inherit"><span>Use</span><span>Environment</span><span>Branch</span><span>Promotion</span><span>Tracker state</span></div>
                @for (e of t.environments; track e.id) {
                  <div class="env-row inherit" [class.muted]="disabled().has(e.id)">
                    <input type="checkbox" [checked]="!disabled().has(e.id)" (change)="toggle(e.id, $any($event.target).checked)" title="This repository has this environment" />
                    <span>{{ e.name || e.branch }}</span>
                    <input class="mono" [value]="branchMap()[e.id] ?? ''" [placeholder]="e.branch + ' (inherited)'" (input)="setBranch(e.id, $any($event.target).value)" [disabled]="disabled().has(e.id)" />
                    <select (change)="setStrategy(e.id, $any($event.target).value)" [disabled]="disabled().has(e.id)">
                      <option value="" [selected]="!strategyMap()[e.id]">{{ label(e.strategy) }} (inherited)</option>
                      <option value="feature-pr" [selected]="strategyMap()[e.id] === 'feature-pr'">feature PRs</option><option value="release-branch" [selected]="strategyMap()[e.id] === 'release-branch'">release branch + PR</option><option value="merge" [selected]="strategyMap()[e.id] === 'merge'">direct merge</option>
                    </select>
                    <span class="muted">{{ e.trackerState || '—' }}</span>
                  </div>
                }
              </div>
              <small class="hint">Remote {{ t.remote }}, release prefix {{ t.releasePrefix }}, base {{ t.baseEnv }}: change these in the organization settings.</small>
            } @else {
              <pg-pipeline-editor [value]="custom()" detectLabel="Detect from branches" (valueChange)="custom.set($event)" (detect)="detect()" />
            }
          } @else {
            <p class="modal-message">{{ store.org()?.name }} has no pipeline template, so this repository defines its own. To share one pipeline across repositories, set a template in the organization settings.</p>
            <pg-pipeline-editor [value]="custom()" detectLabel="Detect from branches" (valueChange)="custom.set($event)" (detect)="detect()" />
          }
        }
        @if (loaded() && probeEnvs().length) {
          <div class="group-header" style="padding-left:0">Deployed version (optional)<span class="count">how PakGit reads what each environment is running</span></div>
          <div class="env-list">
            @for (e of probeEnvs(); track e.id) {
              <div class="probe-row">
                <span>{{ e.name || e.branch }} <span class="mono muted">{{ e.branch }}</span></span>
                <select (change)="setProbe(e.id, { type: $any($event.target).value || null })">
                  <option value="" [selected]="!probes()[e.id]">not read</option><option value="http-json" [selected]="probes()[e.id]?.type === 'http-json'">HTTP JSON field</option><option value="http-text" [selected]="probes()[e.id]?.type === 'http-text'">HTTP text + pattern</option><option value="git-tag" [selected]="probes()[e.id]?.type === 'git-tag'">git tag pattern</option>
                </select>
                @if (probes()[e.id]; as p) {
                  @if (p.type === 'git-tag') { <input class="mono" [value]="p.tagPattern ?? ''" placeholder="tag glob, e.g. deployed/stage-*" (input)="setProbe(e.id, { tagPattern: $any($event.target).value })" /> }
                  @else { <input class="mono" [value]="p.url ?? ''" placeholder="https://stage.example.com/version" (input)="setProbe(e.id, { url: $any($event.target).value })" /> }
                  @if (p.type === 'http-json') { <input class="mono" [value]="p.path ?? ''" placeholder="field path, e.g. commit or build.sha" (input)="setProbe(e.id, { path: $any($event.target).value })" /> }
                  @else if (p.type === 'http-text') { <input class="mono" [value]="p.regex ?? ''" placeholder="pattern with one group, e.g. commit: ([0-9a-f]+)" (input)="setProbe(e.id, { regex: $any($event.target).value })" /> }
                  @else { <span class="muted" style="font-size:11px">newest matching tag = deployed commit</span> }
                } @else { <span></span><span class="muted" style="font-size:11px">the value must be a commit, tag or branch known to this clone</span> }
              </div>
            }
          </div>
        }
        @if (error()) { <p class="modal-message" style="color:var(--danger)">{{ error() }}</p> }
        <div class="modal-actions">
          <button type="button" class="btn" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn primary" [disabled]="!loaded()">Save</button>
        </div>
      </form>
    </div>`
})
export class EnvConfigDialog {
  readonly initial = input<EnvConfig | null>(null)
  readonly closed = output<void>()
  readonly saved = output<EnvConfig>()
  readonly store = inject(Store)
  readonly loaded = signal(false)
  readonly template = signal<EnvConfig | null>(null)
  readonly mode = signal<'org' | 'custom'>('org')
  readonly branchMap = signal<Record<string, string>>({})
  readonly strategyMap = signal<Record<string, Environment['strategy']>>({})
  readonly disabled = signal<Set<string>>(new Set())
  readonly custom = signal<EnvConfig | null>(null)
  readonly probes = signal<Record<string, Probe>>({})
  readonly error = signal('')
  readonly resolved = computed(() => this.custom())
  /** environments the probes can be set for: the resolved pipeline of the chosen mode */
  readonly probeEnvs = computed<Environment[]>(() => {
    const t = this.template()
    if (t && this.mode() === 'org') return t.environments.filter((e) => !this.disabled().has(e.id)).map((e) => ({ ...e, branch: this.branchMap()[e.id]?.trim() || e.branch }))
    return this.custom()?.environments ?? []
  })
  setProbe(envId: string, patch: Partial<Probe> & { type?: Probe['type'] | null }): void {
    this.probes.update((m) => {
      const n = { ...m }
      if (patch.type === null) { delete n[envId]; return n }
      n[envId] = { ...(n[envId] ?? { type: patch.type ?? 'git-tag' }), ...patch } as Probe
      return n
    })
  }
  constructor() { effect(() => { const r = this.store.repo(); if (r) void this.load(r.path) }) }
  private async load(repo: string): Promise<void> {
    try {
      const p: RepoPipeline = await this.store.api.repoPipeline(repo)
      this.template.set(p.template)
      this.mode.set(p.template && p.override.mode !== 'custom' ? 'org' : 'custom')
      this.branchMap.set({ ...(p.override.branchMap ?? {}) }); this.strategyMap.set({ ...(p.override.strategyMap ?? {}) }); this.disabled.set(new Set(p.override.disabled ?? [])); this.probes.set({ ...(p.override.probes ?? {}) })
      this.custom.set(structuredClone(p.override.mode === 'custom' && p.override.custom ? p.override.custom : p.resolved))
      this.loaded.set(true)
    } catch (e) { this.error.set(e instanceof Error ? e.message : String(e)); this.loaded.set(true) }
  }
  label(s: Environment['strategy']): string { return s === 'feature-pr' ? 'feature PRs' : s === 'release-branch' ? 'release branch + PR' : 'direct merge' }
  toggle(id: string, on: boolean): void { const n = new Set(this.disabled()); on ? n.delete(id) : n.add(id); this.disabled.set(n) }
  setBranch(id: string, v: string): void { this.branchMap.update((m) => ({ ...m, [id]: v })) }
  setStrategy(id: string, v: string): void { this.strategyMap.update((m) => { const n = { ...m }; if (v) n[id] = v as Environment['strategy']; else delete n[id]; return n }) }
  switchToCustom(): void { this.mode.set('custom') }
  async detect(): Promise<void> { const r = this.store.repo(); if (!r) return; this.custom.set(await this.store.api.detectReleaseConfig(r.path)) }
  async save(): Promise<void> {
    const r = this.store.repo(); if (!r) return
    const override: RepoPipelineOverride = this.template() && this.mode() === 'org'
      ? { mode: 'org', branchMap: this.branchMap(), strategyMap: this.strategyMap(), disabled: [...this.disabled()], probes: this.probes() }
      : { mode: 'custom', custom: this.custom() ?? undefined, probes: this.probes() }
    try { this.saved.emit(await this.store.api.saveRepoPipeline(r.path, override)) } catch (e) { this.error.set(e instanceof Error ? e.message : String(e)) }
  }
}
