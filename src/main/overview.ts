import { existsSync, statSync } from 'fs'
import { join } from 'path'
import * as git from './git'
import * as release from './release'
import * as orgs from './organizations'
import type { OrgOverview, RepoEntry, RepoOverviewCard } from '@shared/types'

/** Ready for environment i: in environment i-1 (or anything for the first) and not in i or later. */
function readyFor(it: { inEnv: Record<string, boolean>; archived: boolean }, envIds: string[], i: number): boolean {
  if (it.archived) return false
  if (envIds.slice(i).some((id) => it.inEnv[id])) return false
  return i === 0 ? true : it.inEnv[envIds[i - 1]]
}

async function card(repo: RepoEntry): Promise<RepoOverviewCard> {
  const c: RepoOverviewCard = { repo }
  if (!existsSync(repo.path)) { c.error = 'Folder not found'; return c }
  try {
    const st = await git.status(repo.path)
    c.branch = st.branch; c.detached = st.detached; c.changed = st.files.length; c.ahead = st.ahead; c.behind = st.behind; c.state = st.state
    try { const fh = join(await git.gitDir(repo.path), 'FETCH_HEAD'); c.lastFetch = existsSync(fh) ? statSync(fh).mtimeMs : null } catch { c.lastFetch = null }
    const a = await release.analyze(repo.path)
    const envIds = a.config.environments.map((e) => e.id)
    c.environments = a.config.environments.map((e, i) => ({ id: e.id, name: e.name, branch: e.branch, ready: a.items.filter((it) => readyFor(it, envIds, i)).length, missing: !a.refs[e.id] }))
    const last = envIds[envIds.length - 1]
    c.unreleased = a.items.filter((it) => !it.archived && !it.inEnv[last]).length
    c.devBased = a.items.filter((it) => !it.archived && !it.inEnv[last] && it.basedOnEnv).length
    // drift: commits on the last environment that the first one does not have
    const first = a.refs[envIds[0]], lastRef = a.refs[last]
    if (first && lastRef && envIds.length > 1) {
      const r = await git.run(['rev-list', '--count', `${first}..${lastRef}`], { cwd: repo.path, allowFail: true })
      const n = r.code === 0 ? +r.stdout.trim() : 0
      c.drift = n > 0 ? { from: a.config.environments[envIds.length - 1].branch, to: a.config.environments[0].branch, commits: n } : null
    } else c.drift = null
    // release branches not merged into the last environment
    c.staleReleaseBranches = []
    if (lastRef) for (const b of a.releaseBranches.slice(0, 20)) {
      const merged = (await git.run(['merge-base', '--is-ancestor', b.ref, lastRef], { cwd: repo.path, allowFail: true })).code === 0
      if (!merged) c.staleReleaseBranches.push(b.name)
    }
  } catch (e) { c.error = e instanceof Error ? e.message : String(e) }
  return c
}

export async function overview(orgId: string): Promise<OrgOverview> {
  const org = orgs.getOrg(orgId)
  const repos = orgs.orgRepos(orgId)
  const cards = await Promise.all(repos.map((r) => card(r)))
  // totals by environment id, matched by position for repositories with custom pipelines of the same length
  const ready = new Map<string, { id: string; name: string; count: number }>()
  for (const c of cards) for (const e of c.environments ?? []) {
    const cur = ready.get(e.id) ?? { id: e.id, name: e.name, count: 0 }
    cur.count += e.ready; ready.set(e.id, cur)
  }
  const warnings = cards.reduce((n, c) => n + (c.error ? 1 : 0) + (c.drift ? 1 : 0) + ((c.devBased ?? 0) > 0 ? 1 : 0) + ((c.staleReleaseBranches?.length ?? 0) > 0 ? 1 : 0) + ((c.environments ?? []).some((e) => e.missing) ? 1 : 0), 0)
  return {
    org: { id: org.id, name: org.name, color: org.color, repoCount: repos.length },
    repos: cards, totals: { ready: [...ready.values()], unreleased: cards.reduce((n, c) => n + (c.unreleased ?? 0), 0), warnings }, generatedAt: Date.now()
  }
}
