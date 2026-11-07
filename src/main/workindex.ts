/**
 * The work-item index: the release analysis of every repository in an organization, merged by
 * issue key so one issue shows its parts across repositories (phase 2 of docs/ORGANIZATIONS.md).
 */
import { existsSync } from 'fs'
import { userInfo } from 'os'
import * as git from './git'
import * as orgs from './organizations'
import * as release from './release'
import type { TrackerProvider } from './tracker/provider'
import type { IndexBranch, IndexRepo, ReleaseAnalysis, ReleaseItem, RepoEntry, StartWorkRequest, StartWorkResult, WorkIndex, WorkItem, WorkPart } from '@shared/types'

export interface IndexOptions { refresh?: boolean; tracker?: TrackerProvider }

/**
 * Issue-key prefixes seen with at least two different numbers across the organization's branches.
 * One repository alone may hold a single CYB4 branch; the organization knows CYB4 is a team key.
 */
const prefixHints = new Map<string, { at: number; prefixes: string[] }>()
export async function prefixHint(orgId: string, tracker?: TrackerProvider): Promise<string[]> {
  const cached = prefixHints.get(orgId)
  if (cached && Date.now() - cached.at < 30_000) return cached.prefixes
  const seen = new Map<string, Set<string>>()
  await Promise.all(orgs.orgRepos(orgId).filter((r) => existsSync(r.path)).map(async (r) => {
    try { for (const [pre, nums] of await release.branchKeyPrefixes(r.path, tracker?.keyPattern)) { if (!seen.has(pre)) seen.set(pre, new Set()); for (const n of nums) seen.get(pre)!.add(n) } } catch { /* unreadable repository */ }
  }))
  const prefixes = [...seen].filter(([, nums]) => nums.size >= 2).map(([pre]) => pre).sort()
  prefixHints.set(orgId, { at: Date.now(), prefixes })
  return prefixes
}
export function forgetPrefixHint(orgId?: string): void { if (orgId) prefixHints.delete(orgId); else prefixHints.clear() }
export interface BuiltIndex { index: WorkIndex; analyses: Map<string, ReleaseAnalysis> }

/** The most stable environment (last in pipeline order) that contains the work. */
export function highestEnv(envIds: string[], inEnv: Record<string, boolean>): string | null {
  let h: string | null = null
  for (const id of envIds) if (inEnv[id]) h = id
  return h
}
/** Comparable level of a part: 0 = on the last environment, -1 = one before it, …; -Infinity = nowhere. */
export function levelOf(p: Pick<WorkPart, 'envIds' | 'highest'>): number {
  if (!p.highest) return -Infinity
  return p.envIds.indexOf(p.highest) - (p.envIds.length - 1)
}

export function partOf(repo: RepoEntry, a: ReleaseAnalysis, it: ReleaseItem): WorkPart {
  const envIds = a.config.environments.map((e) => e.id)
  return {
    repo: repo.path, repoName: repo.name, group: repo.group ?? null, itemId: it.id, issueKey: it.issueKey, name: it.name,
    branch: it.branches[0]?.name ?? null, ref: it.branches[0]?.ref ?? null, branchCount: it.branches.length,
    envIds, inEnv: it.inEnv, highest: highestEnv(envIds, it.inEnv), archived: it.archived, basedOnEnv: it.basedOnEnv,
    needsCherryPick: it.needsCherryPick, own: it.commitsAheadOfProd, lastActivity: it.lastActivity, overrides: it.overrides,
    commits: it.commits.map((c) => c.sha), linkedBy: it.linkedFrom?.length ? 'manual' : it.branches.length ? 'branch' : 'commits'
  }
}

/** Merge per-repository analyses by issue key. Pure, exported for tests. */
export function mergeItems(repos: RepoEntry[], analyses: Map<string, ReleaseAnalysis>): WorkItem[] {
  const items = new Map<string, WorkItem>()
  for (const r of repos) {
    const a = analyses.get(r.path); if (!a) continue
    for (const it of a.items) {
      const id = it.issueKey ?? `${r.path}::${it.id}`
      let w = items.get(id)
      if (!w) { w = { id, issueKey: it.issueKey, name: it.name, issue: it.issue, parts: [], partlyPromoted: false, lastActivity: '' }; items.set(id, w) }
      if (!w.issue && it.issue) w.issue = it.issue
      w.parts.push(partOf(r, a, it))
      if (it.lastActivity > w.lastActivity) w.lastActivity = it.lastActivity
    }
  }
  for (const w of items.values()) {
    const live = w.parts.filter((p) => !p.archived)
    w.partlyPromoted = live.length > 1 && new Set(live.map(levelOf)).size > 1
    w.parts.sort((a, b) => a.repoName.localeCompare(b.repoName))
  }
  return [...items.values()].sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1))
}

/** The organization's repositories in display order: grouped ones first (by group), then ungrouped, each by name. */
export function sortedRepos(orgId: string): RepoEntry[] {
  return orgs.orgRepos(orgId).sort((a, b) => Number(!a.group) - Number(!b.group) || (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name))
}

export async function buildIndex(orgId: string, opts: IndexOptions = {}): Promise<BuiltIndex> {
  const org = orgs.getOrg(orgId)
  const repos = sortedRepos(orgId)
  const analyses = new Map<string, ReleaseAnalysis>()
  if (opts.refresh) forgetPrefixHint(orgId)
  const prefixes = await prefixHint(orgId, opts.tracker)
  const indexRepos: IndexRepo[] = await Promise.all(repos.map(async (r) => {
    const ir: IndexRepo = { path: r.path, name: r.name, group: r.group ?? null, remote: r.remote ?? null, environments: [] }
    if (!existsSync(r.path)) { ir.error = 'Folder not found'; return ir }
    try {
      const a = await release.analyze(r.path, { cache: !opts.refresh, tracker: opts.tracker, prefixes })
      analyses.set(r.path, a)
      ir.environments = a.config.environments.map((e) => ({ id: e.id, name: e.name, branch: e.branch }))
      ir.fromCache = a.fromCache
    } catch (e) { ir.error = e instanceof Error ? e.message : String(e) }
    return ir
  }))
  // environment union in pipeline order: the template's first, then anything else in order of appearance
  const environments: { id: string; name: string; branch: string }[] = []
  const add = (e: { id: string; name: string; branch: string }): void => { if (!environments.some((x) => x.id === e.id)) environments.push({ id: e.id, name: e.name, branch: e.branch }) }
  for (const e of org.pipeline?.environments ?? []) add(e)
  for (const ir of indexRepos) for (const e of ir.environments) add(e)
  const items = mergeItems(repos, analyses)
  const branches: IndexBranch[] = []
  for (const r of repos) {
    const a = analyses.get(r.path); if (!a) continue
    for (const e of a.config.environments) if (a.refs[e.id]) branches.push({ repo: r.path, repoName: r.name, name: e.branch, ref: a.refs[e.id]!, sha: null, kind: 'env' })
    for (const b of a.releaseBranches) branches.push({ repo: r.path, repoName: r.name, name: b.name, ref: b.ref, sha: b.sha, kind: 'release' })
    for (const it of a.items) for (const b of it.branches) branches.push({ repo: r.path, repoName: r.name, name: b.name, ref: b.ref, sha: b.sha, kind: 'work' })
  }
  const index: WorkIndex = {
    org: { id: org.id, name: org.name, color: org.color, repoCount: repos.length },
    repos: indexRepos, environments, items, branches, generatedAt: Date.now()
  }
  return { index, analyses }
}
export async function index(orgId: string, opts: IndexOptions = {}): Promise<WorkIndex> { return (await buildIndex(orgId, opts)).index }

/** Create the issue branch (from each repository's base environment) in several repositories; one failure does not stop the others. */
export async function startWork(orgId: string, req: StartWorkRequest): Promise<StartWorkResult> {
  const repos = orgs.orgRepos(orgId)
  const branch = req.branch.trim()
  if (!branch) throw new Error('Branch name is empty')
  if (!req.repos.length) throw new Error('Choose at least one repository')
  const res: StartWorkResult = { created: [], failed: [] }
  for (const path of req.repos) {
    if (!repos.some((x) => x.path === path)) { res.failed.push({ repo: path, error: 'Not in this organization' }); continue }
    try { await release.startIssue(path, branch); res.created.push(path) }
    catch (e) { res.failed.push({ repo: path, error: e instanceof Error ? e.message : String(e) }) }
  }
  return res
}

async function gitUser(repo?: string): Promise<string> {
  let name = ''
  try { const r = await git.run(['config', '--get', 'user.name'], { cwd: repo ?? process.cwd(), allowFail: true }); if (r.code === 0) name = r.stdout.trim() } catch { /* no git */ }
  let user = 'me'
  try { user = userInfo().username } catch { /* ignore */ }
  const first = (name.split(/\s+/)[0] || user).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return first || 'me'
}

/** Branch name for an issue: the tracker's suggestion with the default convention, else the pattern with {user}, {key}, {slug}. */
export async function suggestBranch(orgId: string, issue: { key: string; title: string; branchName?: string }): Promise<string> {
  const org = orgs.getOrg(orgId)
  const pattern = org.conventions.branchPattern?.trim() || orgs.defaultConventions().branchPattern
  if (issue.branchName && pattern === orgs.defaultConventions().branchPattern) return issue.branchName
  const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const user = pattern.includes('{user}') ? await gitUser(orgs.orgRepos(orgId)[0]?.path) : ''
  return pattern.replace(/\{user\}/g, user).replace(/\{key\}/g, issue.key.toLowerCase()).replace(/\{slug\}/g, slug).replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, '').replace(/-+$/g, '')
}
