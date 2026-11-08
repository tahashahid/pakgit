/**
 * Releases (phase 3 of docs/ORGANIZATIONS.md): one branch name across the repositories of an
 * organization, pre-flight gates, a record per release with per-repository state (merged items,
 * paused on a conflict, pull request, landed in the environment), Resume / Finish / Notes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { dirname, join } from 'path'
import * as git from './git'
import * as orgs from './organizations'
import * as release from './release'
import { buildIndex } from './workindex'
import type { HostingProvider } from './hosting/provider'
import type { TrackerProvider } from './tracker/provider'
import type { CreateReleaseRequest, EnvConfig, Environment, FinishReleaseResult, GateCheck, GateConfig, GateId, GateMode, GateResult, Organization, PromoteInput, PromoteResult, ReleaseItemRef, ReleaseRecord, ReleaseRepo, ReleaseSelection, WorkIndex, WorkItem, WorkPart } from '@shared/types'

const readJson = <T>(file: string, d: T): T => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return d } }
const writeJson = (file: string, v: unknown): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(v, null, 2)) }
const file = (orgId: string): string => join(orgs.orgDirectory(orgId), 'releases.json')

export interface ReleaseDeps { tracker: TrackerProvider; hosting: HostingProvider }

// ---------- records ----------

export function listReleases(orgId: string): ReleaseRecord[] {
  return readJson<ReleaseRecord[]>(file(orgId), []).sort((a, b) => Number(a.status !== 'in-progress') - Number(b.status !== 'in-progress') || b.createdAt - a.createdAt)
}
function save(orgId: string, list: ReleaseRecord[]): void { writeJson(file(orgId), list) }
export function getRelease(orgId: string, id: string): ReleaseRecord {
  const r = listReleases(orgId).find((x) => x.id === id)
  if (!r) throw new Error(`Unknown release ${id}`)
  return r
}
function put(orgId: string, rec: ReleaseRecord): ReleaseRecord {
  const list = listReleases(orgId)
  const i = list.findIndex((x) => x.id === rec.id)
  if (i >= 0) list[i] = rec; else list.unshift(rec)
  save(orgId, list)
  return rec
}

// ---------- gates ----------

export const GATE_LABELS: Record<GateId, string> = {
  'tracker-state': 'Tracker state', 'partly-promoted': 'Not partly promoted across repositories', 'dev-based': 'Not cut from dev/stage',
  frozen: 'Environment not frozen', 'previous-env': 'Already in the previous environment'
}
/** Defaults: the last environment blocks on tracker state (Ready To Deploy) and partly promoted; everything else warns, except freezes and skipped environments, which block. */
export function defaultGates(isLast: boolean): GateConfig[] {
  return [
    { id: 'tracker-state', mode: isLast ? 'block' : 'warn', states: isLast ? ['Ready To Deploy'] : [] },
    { id: 'partly-promoted', mode: isLast ? 'block' : 'warn' },
    { id: 'dev-based', mode: 'warn' },
    { id: 'frozen', mode: 'block' },
    { id: 'previous-env', mode: 'block' }
  ]
}
export function gatesFor(env: Environment | undefined, isLast: boolean): GateConfig[] {
  const custom = new Map((env?.gates ?? []).map((g) => [g.id, g]))
  return defaultGates(isLast).map((g) => ({ ...g, ...(custom.get(g.id) ?? {}) }))
}

/** Ready for the environment: in the previous environment of that repository (or anywhere, for its first) and not in it or any later one. */
export function readyFor(p: Pick<WorkPart, 'envIds' | 'inEnv'>, envId: string): boolean {
  const i = p.envIds.indexOf(envId); if (i < 0) return false
  if (p.envIds.slice(i).some((id) => p.inEnv[id])) return false
  return i === 0 ? true : p.inEnv[p.envIds[i - 1]]
}

export interface GateContext { org: Organization; envId: string; selection: ReleaseSelection[]; index: WorkIndex; envs: Map<string, EnvConfig>; tracker: TrackerProvider; now?: number }

/** The environment definition used for names and gates: the template's, else the first involved repository's. */
export function envDefinition(org: Organization, envs: Map<string, EnvConfig>, envId: string): { env: Environment | undefined; isLast: boolean } {
  const list = org.pipeline?.environments ?? envs.values().next().value?.environments ?? []
  const env = list.find((e) => e.id === envId)
  return { env, isLast: !!env && list.indexOf(env) === list.length - 1 }
}

export function evaluateGates(ctx: GateContext): GateCheck {
  const { org, envId, selection, index, envs } = ctx
  const { env, isLast } = envDefinition(org, envs, envId)
  const envName = env?.name || envId
  const parts = new Map<string, { part: WorkPart; item: WorkItem }>()
  for (const it of index.items) for (const p of it.parts) parts.set(`${p.repo}::${p.itemId}`, { part: p, item: it })
  const picked = selection.map((s) => ({ sel: s, hit: parts.get(`${s.repo}::${s.itemId}`) ?? null }))
  const label = (s: ReleaseSelection, hit: { part: WorkPart; item: WorkItem } | null): string => `${s.issueKey ?? s.itemId} in ${hit?.part.repoName ?? s.repo}`
  const results: GateResult[] = []
  for (const g of gatesFor(env, isLast)) {
    if (g.mode === 'off') continue
    const r: GateResult = { id: g.id, label: GATE_LABELS[g.id], mode: g.mode, ok: true, message: '', details: [] }
    if (g.id === 'tracker-state') {
      const states = (g.states ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)
      if (!ctx.tracker.isConfigured()) r.message = 'No tracker connected; states are not checked'
      else if (!states.length) r.message = 'Any state is allowed'
      else {
        for (const { sel, hit } of picked) {
          const issue = hit?.item.issue
          if (!issue) r.details.push(`${label(sel, hit)}: no tracker issue`)
          else if (!states.includes(issue.status.toLowerCase())) r.details.push(`${label(sel, hit)}: ${issue.status}`)
        }
        r.ok = !r.details.length
        r.message = r.ok ? `Every item is in ${(g.states ?? []).join(' / ')}` : `${r.details.length} item(s) not in ${(g.states ?? []).join(' / ')}`
      }
    } else if (g.id === 'partly-promoted') {
      const seen = new Set<string>()
      for (const { hit } of picked) {
        if (!hit || !hit.item.partlyPromoted || seen.has(hit.item.id)) continue
        seen.add(hit.item.id)
        r.details.push(`${hit.item.issueKey ?? hit.item.name}: ${hit.item.parts.map((p) => `${p.repoName} ${p.highest ? 'on ' + p.highest : p.archived ? 'archived' : 'nowhere'}`).join(', ')}`)
      }
      r.ok = !r.details.length
      r.message = r.ok ? 'No issue sits on different environments across repositories' : `${r.details.length} issue(s) sit on different environments`
    } else if (g.id === 'dev-based') {
      for (const { sel, hit } of picked) if (hit?.part.basedOnEnv) r.details.push(`${label(sel, hit)}: ${hit.part.branch ?? ''} carries other unreleased work`)
      r.ok = !r.details.length
      r.message = r.ok ? 'No branch was cut from dev/stage' : `${r.details.length} branch(es) cut from dev/stage`
    } else if (g.id === 'frozen') {
      const f = orgs.activeFreezes(org, ctx.now)[envId]
      r.ok = !f
      r.message = f ? `${envName} is frozen: ${f.note || 'no note'}${f.until ? ` (until ${f.until})` : ''}` : `${envName} is not frozen`
      if (f) r.details.push(f.note || 'frozen')
    } else if (g.id === 'previous-env') {
      for (const { sel, hit } of picked) {
        if (!hit) { r.details.push(`${label(sel, hit)}: not in the index`); continue }
        const cfg = envs.get(sel.repo)
        const envIds = cfg?.environments.map((e) => e.id) ?? hit.part.envIds
        const i = envIds.indexOf(envId)
        if (i < 0) { r.details.push(`${label(sel, hit)}: the repository has no ${envName}`); continue }
        if (!readyFor({ envIds, inEnv: hit.part.inEnv }, envId)) r.details.push(`${label(sel, hit)}: ${envIds.slice(i).some((id) => hit.part.inEnv[id]) ? 'already in ' + envName : 'not yet in ' + (cfg?.environments[i - 1]?.branch ?? envIds[i - 1])}`)
      }
      r.ok = !r.details.length
      r.message = r.ok ? `Every item is waiting for ${envName}` : `${r.details.length} item(s) are not ready for ${envName}`
    }
    results.push(r)
  }
  const failing = (m: GateMode): GateId[] => results.filter((r) => !r.ok && r.mode === m).map((r) => r.id)
  return { results, blocked: failing('block'), warnings: failing('warn') }
}

/** Gate check for the renderer: builds the index and the per-repository configs. */
export async function checkGates(orgId: string, envId: string, selection: ReleaseSelection[], deps: Pick<ReleaseDeps, 'tracker'>): Promise<GateCheck> {
  const org = orgs.getOrg(orgId)
  const envs = new Map<string, EnvConfig>()
  for (const repo of new Set(selection.map((s) => s.repo))) envs.set(repo, await release.releaseConfig(repo))
  const { index } = await buildIndex(orgId, { tracker: deps.tracker })
  return evaluateGates({ org, envId, selection, index, envs, tracker: deps.tracker })
}

// ---------- create / resume / drop ----------

function prBody(org: Organization, rec: ReleaseRecord, rr: ReleaseRepo): string {
  const items = rec.items.filter((it) => rr.merged.includes(it.id) || rr.skipped.includes(it.id) || it.repos.includes(rr.path))
  const lines = items.map((it) => `- ${it.issueKey ?? it.id}${it.title ? ' ' + it.title : ''}${it.url ? ` (${it.url})` : ''}`).join('\n') || '- (no items)'
  const template = org.hosting.prTemplate?.trim()
  if (template) return template.replace(/\{name\}/g, rec.name).replace(/\{env\}/g, rec.envBranch).replace(/\{items\}/g, lines).replace(/\{repo\}/g, rr.name)
  return `Release ${rec.name} → ${rr.base}\n\nItems:\n${lines}\n\nCreated by PakGit.`
}

async function openPullRequest(org: Organization, rec: ReleaseRecord, rr: ReleaseRepo, env: Environment, cfg: EnvConfig, deps: ReleaseDeps, updateTracker: boolean): Promise<void> {
  if (!rec.options.push || !rec.options.openPr || rr.pr || rr.prUrl) return
  const title = `Release ${rec.name.replace(cfg.releasePrefix, '')} → ${env.branch}`
  const body = prBody(org, rec, rr)
  try {
    if (await deps.hosting.supports(rr.path)) {
      rr.pr = await deps.hosting.createPullRequest(rr.path, { head: rr.branch, base: env.branch, title, body, draft: rec.options.draft, reviewers: org.hosting.reviewers, labels: org.hosting.labels })
      rr.prUrl = rr.pr.url
    } else {
      const info = await release.openPullRequest(rr.path, rr.branch, env.branch, title, body)
      rr.prUrl = info.url
    }
  } catch (e) { rr.error = `Pull request: ${e instanceof Error ? e.message : String(e)}`; return }
  // tracker events (best effort): state on PR opened, attach the PR to the issue
  const keys = rec.items.filter((it) => it.issueKey && (rr.merged.includes(it.id) || rr.skipped.includes(it.id))).map((it) => it.issueKey!)
  if (deps.tracker.isConfigured()) {
    for (const key of keys) {
      if (updateTracker && env.trackerStateOnPr) await deps.tracker.setState(key, env.trackerStateOnPr).catch(() => undefined)
      if (org.hosting.attachPrsToIssues && rr.pr && deps.tracker.attachPullRequest) await deps.tracker.attachPullRequest(key, rr.pr.url, title).catch(() => undefined)
    }
  }
}

const newId = (): string => randomBytes(4).toString('hex')

export async function createRelease(orgId: string, req: CreateReleaseRequest, deps: ReleaseDeps): Promise<ReleaseRecord> {
  const org = orgs.getOrg(orgId)
  const name = req.name.trim()
  if (!name) throw new Error('Release branch name is empty')
  if (/\s/.test(name) || name.endsWith('/') || name.includes('..')) throw new Error(`"${name}" is not a valid branch name`)
  if (!req.selection.length) throw new Error('Nothing selected')
  if (listReleases(orgId).some((r) => r.name === name && r.status === 'in-progress')) throw new Error(`A release named ${name} is already in progress`)
  const all = orgs.orgRepos(orgId)
  const repos = orgs.deployOrdered(org, all).filter((r) => req.selection.some((s) => s.repo === r.path))
  const unknown = req.selection.find((s) => !repos.some((r) => r.path === s.repo))
  if (unknown) throw new Error(`Repository ${unknown.repo} is not in ${org.name}`)
  const envs = new Map<string, EnvConfig>()
  for (const r of repos) envs.set(r.path, await release.releaseConfig(r.path))
  for (const r of repos) if (!envs.get(r.path)!.environments.some((e) => e.id === req.envId)) throw new Error(`${r.name} has no environment "${req.envId}" (repository ▸ Release ▸ Configure)`)
  const { index } = await buildIndex(orgId, { tracker: deps.tracker })
  const check = evaluateGates({ org, envId: req.envId, selection: req.selection, index, envs, tracker: deps.tracker })
  const stillBlocked = check.blocked.filter((id) => !req.overrides.includes(id))
  if (stillBlocked.length) throw new Error('Blocked by pre-flight checks: ' + stillBlocked.map((id) => check.results.find((r) => r.id === id)?.message ?? id).join('; '))
  const clashes: string[] = []
  for (const r of repos) if (await release.branchExists(r.path, envs.get(r.path)!.remote, name)) clashes.push(r.name)
  if (clashes.length) throw new Error(`Branch ${name} already exists in ${clashes.join(', ')}; choose another name`)
  const { env } = envDefinition(org, envs, req.envId)
  const firstEnv = envs.get(repos[0].path)!.environments.find((e) => e.id === req.envId)!
  // items by id with the repositories they touch and tracker details from the index
  const items = new Map<string, ReleaseItemRef>()
  for (const s of req.selection) {
    const id = s.issueKey ?? s.itemId
    const it = items.get(id) ?? { id, issueKey: s.issueKey, title: s.title, repos: [] }
    const wi = index.items.find((x) => (s.issueKey ? x.issueKey === s.issueKey : x.parts.some((p) => p.repo === s.repo && p.itemId === s.itemId)))
    if (wi?.issue) { it.title = wi.issue.title; it.url = wi.issue.url }
    if (!it.repos.includes(s.repo)) it.repos.push(s.repo)
    items.set(id, it)
  }
  const rec: ReleaseRecord = {
    id: newId(), name, envId: req.envId, envName: env?.name || firstEnv.name || req.envId, envBranch: firstEnv.branch, createdAt: Date.now(),
    createdBy: await release.gitUserName(repos[0].path), items: [...items.values()], repos: [], gates: check.results, overridden: req.overrides.filter((id) => check.blocked.includes(id)),
    status: 'in-progress', finishedAt: null, notes: '', options: { push: req.options.push, openPr: req.options.openPr, draft: req.options.draft }
  }
  put(orgId, rec)
  for (const r of repos) {
    const cfg = envs.get(r.path)!
    const envOf = cfg.environments.find((e) => e.id === req.envId)!
    const sel = req.selection.filter((s) => s.repo === r.path)
    const inputs: PromoteInput[] = sel.map((s) => ({ id: s.issueKey ?? s.itemId, ref: s.ref, commits: s.commits }))
    const rr: ReleaseRepo = { path: r.path, remote: r.remote ?? null, name: r.name, branch: name, base: envOf.branch, items: inputs.map((i) => i.id), inputs, merged: [], skipped: [], paused: null, dropped: null, pr: null, prUrl: null, onEnv: false, error: null }
    try {
      const res = await release.prepareBranch(r.path, req.envId, { name, existing: false }, inputs, { push: req.options.push, openPr: false })
      rr.merged = res.merged; rr.skipped = res.skipped
      if (res.conflict) rr.paused = { conflict: res.conflict, remaining: res.remaining ?? [] }
      else await openPullRequest(org, rec, rr, envOf, cfg, deps, req.options.updateTracker)
    } catch (e) { rr.error = e instanceof Error ? e.message : String(e) }
    rec.repos.push(rr)
    put(orgId, rec)
  }
  return rec
}

/** Continue a paused repository once the conflicting merge was committed; skipRemaining pushes and opens the pull request without the rest. */
export async function resumeRelease(orgId: string, releaseId: string, repoPath: string, opts: { skipRemaining: boolean; updateTracker?: boolean }, deps: ReleaseDeps): Promise<ReleaseRecord> {
  const org = orgs.getOrg(orgId)
  const rec = getRelease(orgId, releaseId)
  const rr = rec.repos.find((x) => x.path === repoPath)
  if (!rr) throw new Error('Repository is not part of this release')
  if (!rr.paused && !rr.error) throw new Error(`${rr.name} is not paused`)
  const cfg = await release.releaseConfig(rr.path)
  const env = cfg.environments.find((e) => e.id === rec.envId)
  if (!env) throw new Error(`${rr.name} has no environment "${rec.envId}"`)
  const remaining = rr.paused ? (opts.skipRemaining ? [] : rr.paused.remaining) : (rr.inputs ?? []).filter((i) => !rr.merged.includes(i.id) && !rr.skipped.includes(i.id))
  const conflict = rr.paused?.conflict ?? null
  rr.error = null
  try {
    const exists = await release.branchExists(rr.path, cfg.remote, rr.branch)
    const res = await release.prepareBranch(rr.path, rec.envId, { name: rr.branch, existing: exists }, remaining.filter((i) => i.ref || i.commits.length), { push: rec.options.push, openPr: false })
    if (conflict && !rr.merged.includes(conflict)) rr.merged.push(conflict)
    for (const id of res.merged) if (!rr.merged.includes(id)) rr.merged.push(id)
    for (const id of res.skipped) if (!rr.skipped.includes(id) && !rr.merged.includes(id)) rr.skipped.push(id)
    if (res.conflict) rr.paused = { conflict: res.conflict, remaining: res.remaining ?? [] }
    else { rr.paused = null; await openPullRequest(org, rec, rr, env, cfg, deps, opts.updateTracker ?? true) }
  } catch (e) { rr.error = e instanceof Error ? e.message : String(e) }
  return put(orgId, rec)
}

export function dropRepo(orgId: string, releaseId: string, repoPath: string, reason: string): ReleaseRecord {
  const rec = getRelease(orgId, releaseId)
  const rr = rec.repos.find((x) => x.path === repoPath)
  if (!rr) throw new Error('Repository is not part of this release')
  rr.dropped = reason.trim() || 'dropped'; rr.paused = null
  return put(orgId, rec)
}

export function dropRelease(orgId: string, releaseId: string, reason: string): ReleaseRecord {
  const rec = getRelease(orgId, releaseId)
  rec.status = 'dropped'; rec.finishedAt = Date.now()
  if (reason.trim()) rec.notes = (rec.notes ? rec.notes + '\n' : '') + `Dropped: ${reason.trim()}`
  return put(orgId, rec)
}

// ---------- refresh / finish ----------

/** Active repositories: not dropped. */
const active = (rec: ReleaseRecord): ReleaseRepo[] => rec.repos.filter((r) => !r.dropped)
export const landed = (rr: ReleaseRepo): boolean => rr.onEnv || rr.pr?.state === 'merged'
export const readyToFinish = (rec: ReleaseRecord): boolean => rec.status === 'in-progress' && active(rec).length > 0 && active(rec).every((rr) => landed(rr) && !rr.paused)

/** Re-read pull-request state and whether each release branch is contained in its environment branch. */
export async function refreshRelease(orgId: string, releaseId: string, deps: Pick<ReleaseDeps, 'hosting'>): Promise<ReleaseRecord> {
  const rec = getRelease(orgId, releaseId)
  for (const rr of active(rec)) {
    try {
      if (rr.pr || (await deps.hosting.supports(rr.path))) {
        const pr = await deps.hosting.pullRequest(rr.path, rr.pr?.number ?? rr.branch)
        if (pr) { rr.pr = pr; rr.prUrl = pr.url }
      }
    } catch { /* hosting unavailable: keep the last known state */ }
    try {
      const cfg = await release.releaseConfig(rr.path)
      const env = cfg.environments.find((e) => e.id === rec.envId)
      const envRef = env ? await release.resolveEnvRef(rr.path, cfg, env.branch) : null
      const branch = await release.branchRef(rr.path, cfg.remote, rr.branch)
      rr.onEnv = !!(envRef && branch && (await git.run(['merge-base', '--is-ancestor', branch, envRef], { cwd: rr.path, allowFail: true })).code === 0)
    } catch { /* unreadable repository: keep the last value */ }
  }
  return put(orgId, rec)
}

/** Once every repository landed: back-merge the environment into the earlier ones and move tracker states. */
export async function finishRelease(orgId: string, releaseId: string, opts: { push: boolean; updateTracker: boolean }, deps: ReleaseDeps): Promise<FinishReleaseResult> {
  const rec = await refreshRelease(orgId, releaseId, deps)
  if (rec.status !== 'in-progress') throw new Error(`Release ${rec.name} is ${rec.status}`)
  const waiting = active(rec).filter((rr) => !landed(rr) || rr.paused)
  if (waiting.length) throw new Error(`Not landed yet in ${waiting.map((r) => r.name).join(', ')}: merge the pull request(s) first (or drop the repository from the release)`)
  const results: FinishReleaseResult['results'] = []
  for (const rr of active(rec)) {
    try {
      const cfg = await release.releaseConfig(rr.path)
      results.push({ repo: rr.path, result: cfg.backMerge ? await release.syncFrom(rr.path, rec.envId, opts.push) : { merged: [], conflict: null, skipped: [], message: 'Back-merge is off for this repository' } })
    } catch (e) { results.push({ repo: rr.path, result: { merged: [], conflict: null, skipped: [], message: e instanceof Error ? e.message : String(e) } }) }
  }
  if (opts.updateTracker && deps.tracker.isConfigured()) {
    const org = orgs.getOrg(orgId)
    const envs = new Map<string, EnvConfig>(); for (const rr of active(rec)) envs.set(rr.path, await release.releaseConfig(rr.path))
    const { env } = envDefinition(org, envs, rec.envId)
    const state = env?.trackerState || envs.values().next().value?.environments.find((e) => e.id === rec.envId)?.trackerState
    if (state) for (const it of rec.items) if (it.issueKey && it.repos.some((p) => active(rec).some((rr) => rr.path === p))) await deps.tracker.setState(it.issueKey, state).catch(() => undefined)
  }
  rec.status = 'finished'; rec.finishedAt = Date.now()
  put(orgId, rec)
  return { release: rec, results }
}

// ---------- notes ----------

export function releaseNotes(orgId: string, releaseId: string): string {
  const rec = getRelease(orgId, releaseId)
  const when = new Date(rec.createdAt).toISOString().slice(0, 10)
  const lines: string[] = [`# ${rec.name} → ${rec.envBranch} (${when})`, '']
  for (const rr of rec.repos) {
    const items = rec.items.filter((it) => rr.merged.includes(it.id) || rr.skipped.includes(it.id) || (!rr.merged.length && rr.items.includes(it.id)))
    lines.push(`## ${rr.name}${rr.dropped ? ` (dropped: ${rr.dropped})` : ''}`)
    if (rr.pr) lines.push(`Pull request: ${rr.pr.url} (${rr.pr.state})`); else if (rr.prUrl) lines.push(`Pull request: ${rr.prUrl}`)
    if (rr.paused) lines.push(`Paused: conflict in ${rr.paused.conflict}`)
    for (const it of items) lines.push(`- ${it.issueKey ?? it.id}${it.title ? ': ' + it.title : ''}${it.url ? ` (${it.url})` : ''}`)
    if (!items.length) lines.push('- (no items)')
    lines.push('')
  }
  if (rec.notes) lines.push(rec.notes, '')
  lines.push(`Created by ${rec.createdBy || 'PakGit'}${rec.status === 'finished' && rec.finishedAt ? `, finished ${new Date(rec.finishedAt).toISOString().slice(0, 10)}` : ''}.`)
  return lines.join('\n')
}
