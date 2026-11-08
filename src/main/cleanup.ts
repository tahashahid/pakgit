/** Clean up merged branches (phase 4): remote branches already contained in the last environment, per repository. */
import { existsSync } from 'fs'
import * as git from './git'
import * as orgs from './organizations'
import * as release from './release'
import { sortedRepos } from './workindex'
import type { CleanupResult, MergedBranch } from '@shared/types'

export async function mergedBranches(orgId: string): Promise<MergedBranch[]> {
  const out: MergedBranch[] = []
  for (const r of sortedRepos(orgId)) {
    if (!existsSync(r.path)) continue
    try {
      const cfg = await release.releaseConfig(r.path)
      const last = cfg.environments[cfg.environments.length - 1]
      const lastRef = await release.resolveEnvRef(r.path, cfg, last.branch)
      if (!lastRef) continue
      const envNames = new Set(cfg.environments.map((e) => e.branch))
      const res = await git.run(['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)', `--merged=${lastRef}`, `refs/remotes/${cfg.remote}`], { cwd: r.path, allowFail: true })
      if (res.code !== 0) continue
      const locals = new Set((await git.run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: r.path, allowFail: true })).stdout.split('\n').filter(Boolean))
      for (const line of res.stdout.split('\n')) {
        if (!line) continue
        const [ref, sha, date] = line.split('\0')
        if (!ref.startsWith(cfg.remote + '/') || ref.endsWith('/HEAD')) continue
        const name = ref.slice(cfg.remote.length + 1)
        if (envNames.has(name)) continue
        const kind: MergedBranch['kind'] = name.startsWith(cfg.releasePrefix) ? 'release' : name.startsWith('sync/') ? 'sync' : cfg.excludePrefixes.some((p) => name.startsWith(p)) ? 'other' : 'work'
        out.push({ repo: r.path, repoName: r.name, name, ref, sha, date, kind, local: locals.has(name) })
      }
    } catch { /* unreadable repository */ }
  }
  return out.sort((a, b) => a.repoName.localeCompare(b.repoName) || (a.date < b.date ? -1 : 1))
}

/** Delete the branches on the remote (and locally when they are not checked out). */
export async function deleteBranches(orgId: string, list: { repo: string; name: string }[]): Promise<CleanupResult> {
  const res: CleanupResult = { deleted: [], failed: [] }
  const repos = new Map(orgs.orgRepos(orgId).map((r) => [r.path, r]))
  for (const b of list) {
    if (!repos.has(b.repo)) { res.failed.push({ ...b, error: 'Repository is not in this organization' }); continue }
    try {
      const cfg = await release.releaseConfig(b.repo)
      if (cfg.environments.some((e) => e.branch === b.name)) throw new Error('Environment branches are never deleted')
      const r = await git.run(['push', cfg.remote, '--delete', b.name], { cwd: b.repo, allowFail: true })
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim())
      const current = (await git.run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: b.repo, allowFail: true })).stdout.trim()
      if (current !== b.name) await git.run(['branch', '-D', b.name], { cwd: b.repo, allowFail: true })
      res.deleted.push(b)
    } catch (e) { res.failed.push({ ...b, error: e instanceof Error ? e.message : String(e) }) }
  }
  return res
}
