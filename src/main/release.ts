import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import * as git from './git'
import { tracker } from './tracker'
import type { BranchTarget, Commit, EnvConfig, Environment, PrepareOptions, PromoteResult, PullRequestInfo, ReleaseAnalysis, ReleaseBranchRef, ReleaseItem } from '@shared/types'

// ---------- pull requests on the hosting provider ----------

/** How PR pages are opened; replaced in tests. Default: the system browser (set by the main process). */
let prOpener: (url: string) => Promise<void> = async () => undefined
export function setPrOpener(fn: (url: string) => Promise<void>): void { prOpener = fn }

export function parseRemote(url: string): { provider: PullRequestInfo['provider']; host: string; path: string } {
  let m = /^(?:https?:\/\/|git@|ssh:\/\/git@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m) return { provider: 'unknown', host: '', path: '' }
  const host = m[1], path = m[2]
  const provider = /github\.com$/.test(host) ? 'github' : /gitlab/.test(host) ? 'gitlab' : /bitbucket/.test(host) ? 'bitbucket' : 'unknown'
  return { provider, host, path }
}

export function pullRequestUrl(remoteUrl: string, head: string, base: string, title: string, body: string): PullRequestInfo {
  const { provider, host, path } = parseRemote(remoteUrl)
  const q = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  let url = ''
  if (provider === 'github') url = `https://${host}/${path}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?${q({ expand: '1', title, body })}`
  else if (provider === 'gitlab') url = `https://${host}/${path}/-/merge_requests/new?${q({ 'merge_request[source_branch]': head, 'merge_request[target_branch]': base, 'merge_request[title]': title, 'merge_request[description]': body })}`
  else if (provider === 'bitbucket') url = `https://${host}/${path}/pull-requests/new?${q({ source: head, dest: base, title })}`
  return { url, head, base, title, provider }
}

export async function openPullRequest(repo: string, head: string, base: string, title: string, body: string): Promise<PullRequestInfo> {
  const cfg = await releaseConfig(repo)
  const remotes = await git.refs(repo)
  const remote = remotes.remotes.find((r) => r.name === cfg.remote)
  if (!remote) throw new Error(`Remote "${cfg.remote}" not found`)
  const pr = pullRequestUrl(remote.pushUrl || remote.fetchUrl, head, base, title, body)
  if (!pr.url) throw new Error(`Cannot build a pull-request link for ${remote.fetchUrl}; open it on your hosting provider: ${head} → ${base}`)
  await prOpener(pr.url)
  return pr
}

// ---------- per-repository environment configuration ----------

let configDir = ''
/** Directory holding release-config.json (the Electron userData folder; a temp dir in tests). */
export function setReleaseConfigDir(dir: string): void { configDir = dir }
const cfgFile = () => join(configDir || process.cwd(), 'release-config.json')
function loadAll(): Record<string, EnvConfig> { try { return JSON.parse(readFileSync(cfgFile(), 'utf8')) } catch { return {} } }

const DEV = ['dev', 'develop', 'development'], STAGE = ['stage', 'staging', 'uat', 'qa'], PROD = ['main', 'master', 'prod', 'production']

/** Detect a sensible default pipeline from the branches that exist. */
export async function detectConfig(repo: string): Promise<EnvConfig> {
  const refs = await git.refs(repo)
  const names = new Set(refs.branches.map((b) => b.name))
  const remote = refs.remotes.find((r) => r.name === 'origin')?.name ?? refs.remotes[0]?.name ?? 'origin'
  const envs: Environment[] = []
  const dev = DEV.find((c) => names.has(c)); if (dev) envs.push({ id: 'dev', name: 'Development', branch: dev, strategy: 'feature-pr', trackerState: 'QA' })
  const stage = STAGE.find((c) => names.has(c)); if (stage) envs.push({ id: 'stage', name: 'Staging', branch: stage, strategy: 'release-branch', trackerState: 'UAT' })
  const prod = PROD.find((c) => names.has(c)) ?? 'main'
  envs.push({ id: 'prod', name: 'Production', branch: prod, strategy: 'release-branch', trackerState: 'Done' })
  return { remote, environments: envs, baseEnv: 'prod', releasePrefix: 'release/', backMerge: true, issuePrefixes: [], excludePrefixes: ['release/', 'sync/', 'dependabot/'] }
}
function withDefaults(c: EnvConfig): EnvConfig {
  return { ...c, issuePrefixes: c.issuePrefixes ?? [], excludePrefixes: c.excludePrefixes ?? ['release/', 'sync/', 'dependabot/'] }
}

/** Upgrade a config saved by an earlier version (fixed dev/stage/prod fields). */
function migrate(raw: Record<string, unknown>): EnvConfig | null {
  if (Array.isArray(raw['environments'])) return withDefaults(raw as unknown as EnvConfig)
  if (typeof raw['prod'] === 'string') {
    const envs: Environment[] = []
    if (raw['dev']) envs.push({ id: 'dev', name: 'Development', branch: String(raw['dev']), strategy: 'feature-pr', trackerState: 'QA' })
    if (raw['stage']) envs.push({ id: 'stage', name: 'Staging', branch: String(raw['stage']), strategy: 'release-branch', trackerState: 'UAT' })
    envs.push({ id: 'prod', name: 'Production', branch: String(raw['prod']), strategy: 'release-branch', trackerState: 'Done' })
    return withDefaults({ remote: String(raw['remote'] ?? 'origin'), environments: envs, baseEnv: 'prod', releasePrefix: String(raw['releasePrefix'] ?? 'release/'), backMerge: true } as EnvConfig)
  }
  return null
}

export async function releaseConfig(repo: string): Promise<EnvConfig> {
  const saved = loadAll()[repo]
  const migrated = saved ? migrate(saved as unknown as Record<string, unknown>) : null
  if (migrated && migrated.environments.length) return migrated
  return detectConfig(repo)
}
export function saveReleaseConfig(repo: string, cfg: EnvConfig): EnvConfig {
  if (!cfg.environments.length) throw new Error('At least one environment is required')
  const ids = new Set<string>()
  for (const e of cfg.environments) {
    e.id = (e.id || e.name || e.branch).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (!e.branch.trim()) throw new Error(`Environment "${e.name}" has no branch`)
    if (ids.has(e.id)) throw new Error(`Duplicate environment id "${e.id}"`); ids.add(e.id)
  }
  if (!ids.has(cfg.baseEnv)) cfg.baseEnv = cfg.environments[cfg.environments.length - 1].id
  cfg = withDefaults(cfg)
  cfg.issuePrefixes = cfg.issuePrefixes.map((p) => p.trim().toUpperCase()).filter(Boolean)
  cfg.excludePrefixes = cfg.excludePrefixes.map((p) => p.trim()).filter(Boolean)
  const all = loadAll(); all[repo] = cfg
  mkdirSync(dirname(cfgFile()), { recursive: true }); writeFileSync(cfgFile(), JSON.stringify(all, null, 2))
  return cfg
}
const envById = (cfg: EnvConfig, id: string): Environment => { const e = cfg.environments.find((x) => x.id === id); if (!e) throw new Error(`Unknown environment "${id}"`); return e }
const lastEnv = (cfg: EnvConfig): Environment => cfg.environments[cfg.environments.length - 1]
const baseBranch = (cfg: EnvConfig): string => envById(cfg, cfg.baseEnv).branch

// ---------- archive and manual environment overrides (per repository) ----------

const archiveFile = () => join(configDir || process.cwd(), 'release-archive.json')
const overridesFile = () => join(configDir || process.cwd(), 'release-overrides.json')
const readJson = <T>(file: string, d: T): T => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return d } }
const writeJson = (file: string, v: unknown): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(v, null, 2)) }
export function setArchived(repo: string, ids: string[], archived: boolean): void {
  const all = readJson<Record<string, string[]>>(archiveFile(), {})
  const set = new Set(all[repo] ?? [])
  for (const id of ids) archived ? set.add(id) : set.delete(id)
  all[repo] = [...set]; writeJson(archiveFile(), all)
}
export function setOverrides(repo: string, id: string, overrides: Record<string, boolean> | null): void {
  const all = readJson<Record<string, Record<string, Record<string, boolean>>>>(overridesFile(), {})
  all[repo] = all[repo] ?? {}
  if (overrides && Object.keys(overrides).length) all[repo][id] = overrides; else delete all[repo][id]
  writeJson(overridesFile(), all)
}

// ---------- analysis ----------

const ENV_SUFFIX = /-(dev|develop|stage|staging|main|prod|production)$/i
const run = (repo: string, args: string[], allowFail = false) => git.run(args, { cwd: repo, allowFail })

/** Resolve an environment branch to the ref to analyse: remote-tracking ref when present, else local. */
async function envRef(repo: string, cfg: EnvConfig, name: string): Promise<string | null> {
  for (const candidate of [`${cfg.remote}/${name}`, name]) {
    const r = await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${candidate}`], true)
    if (r.code === 0) return candidate
    const l = await run(repo, ['rev-parse', '--verify', '-q', `refs/heads/${candidate}`], true)
    if (l.code === 0) return candidate
  }
  return null
}

async function mergedInto(repo: string, ref: string | null): Promise<Set<string>> {
  if (!ref) return new Set()
  const { stdout } = await run(repo, ['for-each-ref', '--format=%(refname:short)', `--merged=${ref}`, 'refs/heads', 'refs/remotes'])
  return new Set(stdout.split('\n').filter(Boolean))
}

export async function analyze(repo: string): Promise<ReleaseAnalysis> {
  const cfg = await releaseConfig(repo)
  const refs: Record<string, string | null> = {}
  const resolved = await Promise.all(cfg.environments.map((e) => envRef(repo, cfg, e.branch)))
  cfg.environments.forEach((e, i) => { refs[e.id] = resolved[i] }) // config order, deterministic
  const last = lastEnv(cfg)
  const prod = refs[last.id]
  const t = tracker()
  const keyRe = new RegExp(t.keyPattern.source, 'gi')

  // all branches with sha + date
  const { stdout } = await run(repo, ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)', 'refs/heads', 'refs/remotes'])
  const envNames = new Set(cfg.environments.map((e) => e.branch))
  const all: ReleaseBranchRef[] = []
  const releaseBranches: ReleaseBranchRef[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const [ref, sha, date] = line.split('\0')
    if (ref.endsWith('/HEAD')) continue
    const isRemote = ref.startsWith(cfg.remote + '/')
    const name = isRemote ? ref.slice(cfg.remote.length + 1) : ref
    const entry: ReleaseBranchRef = { ref, name, remote: isRemote ? cfg.remote : null, sha, date }
    if (envNames.has(name)) continue
    if (name.startsWith(cfg.releasePrefix)) { releaseBranches.push(entry); continue }
    if (cfg.excludePrefixes.some((p) => name.startsWith(p))) continue
    // backups like dev-as-on-23rd-oct, dev_backup, main-demo
    if ([...envNames].some((e) => name === e || name.startsWith(e + '-') || name.startsWith(e + '_'))) continue
    all.push(entry)
  }
  // prefer the remote ref when a branch exists both locally and remotely
  const byName = new Map<string, ReleaseBranchRef>()
  for (const b of all) { const cur = byName.get(b.name); if (!cur || (!cur.remote && b.remote)) byName.set(b.name, b) }

  const merged: Record<string, Set<string>> = {}
  await Promise.all(cfg.environments.map(async (e) => { merged[e.id] = await mergedInto(repo, refs[e.id]) }))
  const emptyEnv = (): Record<string, boolean> => Object.fromEntries(cfg.environments.map((e) => [e.id, false]))

  // which key prefixes count as issues: configured, else the tracker's team keys, else prefixes seen with 2+ numbers in branch names
  let prefixes = new Set(cfg.issuePrefixes)
  if (!prefixes.size) prefixes = new Set(await t.keyPrefixes().catch(() => []))
  if (!prefixes.size) {
    const seen = new Map<string, Set<string>>()
    for (const b of byName.values()) { const k = b.name.match(keyRe)?.[0]?.toUpperCase(); if (k) { const [pre, num] = k.split('-'); if (!seen.has(pre)) seen.set(pre, new Set()); seen.get(pre)!.add(num) } }
    for (const [pre, nums] of seen) if (nums.size >= 2) prefixes.add(pre)
  }
  const keyOf = (text: string): string | null => {
    for (const m of text.matchAll(keyRe)) { const k = t.normalizeKey(m[0]); if (prefixes.has(k.split('-')[0])) return k }
    return null
  }
  const archived = new Set(readJson<Record<string, string[]>>(archiveFile(), {})[repo] ?? [])
  const overrides = readJson<Record<string, Record<string, Record<string, boolean>>>>(overridesFile(), {})[repo] ?? {}

  // group branches into items by issue key, else by normalised name (strip -dev/-stage/-main variants)
  const items = new Map<string, ReleaseItem>()
  const itemFor = (id: string, issueKey: string | null, name: string): ReleaseItem => {
    let it = items.get(id)
    if (!it) { it = { id, issueKey, name, branches: [], inEnv: emptyEnv(), commitsAheadOfProd: null, basedOnEnv: false, needsCherryPick: false, commits: [], lastActivity: '', archived: archived.has(id), overrides: overrides[id] ?? {} }; items.set(id, it) }
    return it
  }
  for (const b of byName.values()) {
    const base = b.name.replace(ENV_SUFFIX, '')
    const issueKey = keyOf(base)
    const it = itemFor(issueKey ?? base.toLowerCase(), issueKey, base)
    it.branches.push(b)
    for (const e of cfg.environments) it.inEnv[e.id] ||= merged[e.id].has(b.ref)
    if (b.date > it.lastActivity) it.lastActivity = b.date
  }


  // commit-based pass: work on dev/stage that is not on prod, grouped by issue key (covers deleted branches)
  const envLog = async (ref: string | null): Promise<Commit[]> => {
    if (!ref || !prod) return []
    const r = await run(repo, ['log', '--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D%x01', `${prod}..${ref}`, '-n', '2000'], true)
    if (r.code !== 0) return []
    return r.stdout.split('\x01').filter((c) => c.trim()).map((chunk) => {
      const [sha, shortSha, parents, author, email, date, subject, body, refsStr] = chunk.replace(/^\n/, '').split('\0')
      return { sha, shortSha, parents: parents ? parents.split(' ') : [], author, email, date, subject, body: (body ?? '').trim(), refs: refsStr ? refsStr.split(', ').filter(Boolean) : [] }
    })
  }
  const earlier = cfg.environments.slice(0, -1)
  const logs: Record<string, Commit[]> = {}
  await Promise.all(earlier.map(async (e) => { logs[e.id] = await envLog(refs[e.id]) }))
  const shaSets: Record<string, Set<string>> = Object.fromEntries(earlier.map((e) => [e.id, new Set(logs[e.id].map((c) => c.sha))]))
  const seen = new Set<string>()
  // walk from the most stable earlier environment down so an item's commits are listed once
  for (const e of [...earlier].reverse()) {
    for (const c of logs[e.id]) {
      if (seen.has(c.sha)) continue; seen.add(c.sha)
      const k = keyOf(`${c.subject}\n${c.body}`)
      if (!k) continue
      const it = itemFor(k, k, k)
      it.commits.push(c)
      for (const e2 of earlier) if (shaSets[e2.id].has(c.sha)) it.inEnv[e2.id] = true
      if (c.date > it.lastActivity) it.lastActivity = c.date
    }
  }
  for (const it of items.values()) {
    for (const [envId, v] of Object.entries(it.overrides)) if (envId in it.inEnv) it.inEnv[envId] = v
    if (!it.branches.length) it.needsCherryPick = true
    it.commits.sort((a, b) => (a.date < b.date ? -1 : 1))
    it.branches.sort((a, b) => (a.date > b.date ? -1 : 1))
  }

  // per-branch own-commit counts for unreleased items; pick a branch cut from prod over a -dev copy when promoting
  const unreleased = [...items.values()].filter((it) => !it.inEnv[last.id] && it.branches.length).slice(0, 150)
  await Promise.all(unreleased.map(async (it) => {
    if (!prod) return
    await Promise.all(it.branches.map(async (b) => {
      // A branch cut from dev drags dev's PR merge commits along its first-parent line: that is how we detect it.
      const [own, merges] = await Promise.all([
        run(repo, ['rev-list', '--count', '--first-parent', '--no-merges', `${prod}..${b.ref}`], true),
        run(repo, ['rev-list', '--count', '--first-parent', '--merges', `${prod}..${b.ref}`], true)
      ])
      b.own = own.code === 0 ? +own.stdout.trim() : undefined
      b.basedOnEnv = merges.code === 0 && +merges.stdout.trim() > 0
    }))
    it.branches.sort((a, b) => Number(a.basedOnEnv ?? false) - Number(b.basedOnEnv ?? false) || (a.date > b.date ? -1 : 1))
    it.commitsAheadOfProd = it.branches[0].own ?? null
    it.basedOnEnv = it.branches.every((b) => b.basedOnEnv)
  }))

  // tracker enrichment (best effort)
  const keys = [...items.values()].map((it) => it.issueKey).filter((k): k is string => !!k)
  if (keys.length && t.isConfigured()) {
    try { const issues = await t.getIssues(keys); for (const i of issues) { const it = items.get(i.key); if (it) it.issue = i } } catch { /* shown via trackerStatus */ }
  }

  const head = await run(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], true)
  const rerere = (await run(repo, ['config', '--get', 'rerere.enabled'], true)).stdout.trim() === 'true'
  const list = [...items.values()].sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1))
  return { config: cfg, refs, items: list, releaseBranches: releaseBranches.sort((a, b) => (a.date > b.date ? -1 : 1)), currentBranch: head.code === 0 ? head.stdout.trim() : null, rerere }
}

// ---------- operations ----------

export async function enableRerere(repo: string): Promise<void> { await run(repo, ['config', 'rerere.enabled', 'true']) }

async function checkoutEnv(repo: string, cfg: EnvConfig, name: string): Promise<void> {
  const st = await git.status(repo)
  if (st.files.some((f) => f.area !== 'untracked')) throw new Error('Working tree has uncommitted changes. Commit or stash them first.')
  const local = (await run(repo, ['rev-parse', '--verify', '-q', `refs/heads/${name}`], true)).code === 0
  if (local) await run(repo, ['checkout', name])
  else await run(repo, ['checkout', '-b', name, '--track', `${cfg.remote}/${name}`])
  const hasRemote = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${name}`], true)).code === 0
  if (hasRemote) await run(repo, ['merge', '--ff-only', `${cfg.remote}/${name}`])
}

export interface PromoteInput { id: string; ref: string | null; commits: string[] }

/** Merge each item (feature branch, or cherry-pick its commits) into the current branch; stop at the first conflict. */
async function applyItems(repo: string, items: PromoteInput[], target: string): Promise<PromoteResult> {
  const res: PromoteResult = { merged: [], conflict: null, skipped: [], message: '' }
  for (const it of items) {
    if (it.ref) {
      const already = (await run(repo, ['merge-base', '--is-ancestor', it.ref, 'HEAD'], true)).code === 0
      if (already) { res.skipped.push(it.id); continue }
      const r = await git.run(['merge', '--no-ff', '--no-edit', '-m', `Merge ${it.ref.replace(/^[^/]+\//, '')} into ${target} (${it.id})`, it.ref], { cwd: repo, allowFail: true, env: { GIT_EDITOR: 'true' } })
      if (r.code !== 0) { res.conflict = it.id; res.message = r.stderr || r.stdout; return res }
    } else if (it.commits.length) {
      for (const sha of it.commits) {
        const isMerge = (await run(repo, ['rev-list', '--parents', '-n', '1', sha])).stdout.trim().split(' ').length > 2
        const r = await git.run(['cherry-pick', ...(isMerge ? ['-m', '1'] : []), '-x', sha], { cwd: repo, allowFail: true, env: { GIT_EDITOR: 'true' } })
        if (r.code !== 0) {
          if (/nothing to commit|empty/i.test(r.stdout + r.stderr)) { await run(repo, ['cherry-pick', '--skip'], true); continue }
          res.conflict = it.id; res.message = r.stderr || r.stdout; return res
        }
      }
    }
    res.merged.push(it.id)
  }
  return res
}

export async function promote(repo: string, envId: string, items: PromoteInput[], push: boolean): Promise<PromoteResult> {
  const cfg = await releaseConfig(repo)
  const env = envById(cfg, envId)
  await checkoutEnv(repo, cfg, env.branch)
  const res = await applyItems(repo, items, env.branch)
  if (!res.conflict && push && res.merged.length) await run(repo, ['push', cfg.remote, env.branch])
  res.message ||= res.merged.length ? `Merged ${res.merged.length} item(s) into ${env.branch}${push ? ' and pushed' : ''}` : 'Nothing to merge'
  return res
}

/** Cut a release branch from the target environment, merge the picked items into it, push and open a pull request. */
export async function startRelease(repo: string, envId: string, name: string, items: PromoteInput[], push: boolean): Promise<PromoteResult> {
  const cfg = await releaseConfig(repo)
  const env = envById(cfg, envId)
  const branch = name.startsWith(cfg.releasePrefix) ? name : cfg.releasePrefix + name
  const st = await git.status(repo)
  if (st.files.some((f) => f.area !== 'untracked')) throw new Error('Working tree has uncommitted changes. Commit or stash them first.')
  const base = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${env.branch}`], true)).code === 0 ? `${cfg.remote}/${env.branch}` : env.branch
  await run(repo, ['checkout', '-b', branch, base])
  const res = await applyItems(repo, items, branch)
  res.branch = branch
  if (res.conflict) return res
  if (push) {
    await run(repo, ['push', '-u', cfg.remote, branch])
    const title = `Release ${branch.replace(cfg.releasePrefix, '')} → ${env.branch}`
    const body = `Items:\n${res.merged.map((m) => `- ${m}`).join('\n')}\n\nCreated by PakGit from ${base}.`
    try { const pr = await openPullRequest(repo, branch, env.branch, title, body); res.prUrls = [pr.url] } catch (e) { res.message = e instanceof Error ? e.message : String(e) }
  }
  res.message ||= `Created ${branch} from ${base} with ${res.merged.length} item(s)${push ? ', pushed and opened the pull request' : ''}`
  return res
}

/**
 * Merge the items into one branch: a new one cut from the environment, or an existing branch
 * (checked out and fast-forwarded to its remote). Stops at the first conflict and reports the
 * remaining items so the promotion can be continued after the merge is committed.
 */
export async function prepareBranch(repo: string, envId: string, target: BranchTarget, items: PromoteInput[], options: PrepareOptions): Promise<PromoteResult & { remaining?: PromoteInput[] }> {
  const cfg = await releaseConfig(repo)
  const env = envById(cfg, envId)
  const st = await git.status(repo)
  if (st.files.some((f) => f.area !== 'untracked')) throw new Error('Working tree has uncommitted changes. Commit or stash them first.')
  if (st.state !== 'clean') throw new Error(`A ${st.state} is in progress. Finish or abort it first.`)
  const branch = target.name.trim()
  if (!branch) throw new Error('Branch name is empty')
  const localExists = (await run(repo, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], true)).code === 0
  const remoteExists = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${branch}`], true)).code === 0
  if (target.existing) {
    if (!localExists && !remoteExists) throw new Error(`Branch "${branch}" does not exist`)
    if (localExists) await run(repo, ['checkout', branch]); else await run(repo, ['checkout', '-b', branch, '--track', `${cfg.remote}/${branch}`])
    if (localExists && remoteExists) await run(repo, ['merge', '--ff-only', `${cfg.remote}/${branch}`], true)
  } else {
    if (localExists || remoteExists) throw new Error(`Branch "${branch}" already exists; choose "existing branch" to add to it`)
    const base = remoteExists ? '' : (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${env.branch}`], true)).code === 0 ? `${cfg.remote}/${env.branch}` : env.branch
    await run(repo, ['checkout', '-b', branch, base])
  }
  const res: PromoteResult & { remaining?: PromoteInput[] } = { ...(await applyItems(repo, items, branch)), branch }
  if (res.conflict) {
    const idx = items.findIndex((i) => i.id === res.conflict)
    res.remaining = items.slice(idx + 1)
    res.message = `Conflict while merging ${res.conflict} into ${branch}. Resolve it in the Files panel and commit the merge; then continue with the remaining ${res.remaining.length} item(s).`
    return res
  }
  if (options.push) await run(repo, ['push', '-u', cfg.remote, branch])
  if (options.push && options.openPr) {
    const title = branch.startsWith(cfg.releasePrefix) ? `Release ${branch.replace(cfg.releasePrefix, '')} → ${env.branch}` : `${branch} → ${env.branch}`
    const body = `Items:\n${[...res.merged, ...res.skipped].map((m) => `- ${m}`).join('\n')}\n\nCreated by PakGit.`
    try { const pr = await openPullRequest(repo, branch, env.branch, title, body); res.prUrls = [pr.url] } catch (e) { res.message = e instanceof Error ? e.message : String(e) }
  }
  res.message ||= `${target.existing ? 'Updated' : 'Created'} ${branch} with ${res.merged.length} item(s)${res.skipped.length ? ` (${res.skipped.length} already included)` : ''}${options.push ? ', pushed' : ''}${options.push && options.openPr ? ' and opened the pull request' : ''}`
  return res
}

/** One pull request per feature branch into the environment (branches must already be on the remote). */
export async function openFeaturePRs(repo: string, envId: string, items: PromoteInput[]): Promise<PromoteResult> {
  const cfg = await releaseConfig(repo)
  const env = envById(cfg, envId)
  const res: PromoteResult = { merged: [], conflict: null, skipped: [], message: '', prUrls: [] }
  for (const it of items) {
    if (!it.ref) { res.skipped.push(it.id); continue }
    const head = it.ref.startsWith(cfg.remote + '/') ? it.ref.slice(cfg.remote.length + 1) : it.ref
    const onRemote = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${head}`], true)).code === 0
    if (!onRemote) await run(repo, ['push', '-u', cfg.remote, head])
    const pr = await openPullRequest(repo, head, env.branch, `${it.id}: ${head.split('/').pop()} → ${env.branch}`, `Pull request for ${it.id} into ${env.branch}, created by PakGit.`)
    res.prUrls!.push(pr.url); res.merged.push(it.id)
  }
  res.message = res.merged.length ? `Opened ${res.merged.length} pull request(s) into ${env.branch}${res.skipped.length ? `; skipped ${res.skipped.length} item(s) without a branch` : ''}` : 'Nothing to open'
  return res
}

/** Merge the release branch into the environment, tag, then back-merge into the earlier environments. */
export async function finishRelease(repo: string, envId: string, releaseBranch: string, tag: string | null, push: boolean): Promise<PromoteResult> {
  const cfg = await releaseConfig(repo)
  const env = envById(cfg, envId)
  await checkoutEnv(repo, cfg, env.branch)
  const r = await git.run(['merge', '--no-ff', '--no-edit', releaseBranch], { cwd: repo, allowFail: true, env: { GIT_EDITOR: 'true' } })
  if (r.code !== 0) return { merged: [], conflict: releaseBranch, skipped: [], message: r.stderr || r.stdout }
  if (tag) await run(repo, ['tag', '-a', tag, '-m', `Release ${tag}`])
  if (push) await run(repo, ['push', cfg.remote, env.branch, ...(tag ? [tag] : [])])
  const res = cfg.backMerge ? await backMerge(repo, cfg, env, push) : { merged: [], conflict: null, skipped: [], message: '' }
  res.merged.unshift(releaseBranch)
  const earlier = cfg.environments.slice(0, cfg.environments.indexOf(env)).map((e) => e.branch)
  res.message = res.conflict ? res.message : `Released ${releaseBranch} into ${env.branch}${tag ? ` (tag ${tag})` : ''}${earlier.length && cfg.backMerge ? `, back-merged into ${earlier.join(', ')}` : ''}${push ? ', pushed' : ''}`
  return res
}

/**
 * Propagate `from` into each environment before it, most stable first (prod -> stage -> dev).
 * Environments with the direct-merge strategy are merged and pushed; the others get a sync branch and a pull request.
 */
async function backMerge(repo: string, cfg: EnvConfig, from: Environment, push: boolean): Promise<PromoteResult> {
  const res: PromoteResult = { merged: [], conflict: null, skipped: [], message: '', prUrls: [] }
  const idx = cfg.environments.indexOf(from)
  let source = from.branch
  const day = new Date().toISOString().slice(0, 10)
  for (let i = idx - 1; i >= 0; i--) {
    const target = cfg.environments[i]
    const to = target.branch
    const exists = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${to}`], true)).code === 0 || (await run(repo, ['rev-parse', '--verify', '-q', `refs/heads/${to}`], true)).code === 0
    if (!exists) { res.skipped.push(to); continue }
    const srcRef = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${source}`], true)).code === 0 ? `${cfg.remote}/${source}` : source
    const toRef = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${to}`], true)).code === 0 ? `${cfg.remote}/${to}` : to
    if ((await run(repo, ['merge-base', '--is-ancestor', srcRef, toRef], true)).code === 0) { res.skipped.push(`${source} → ${to} (up to date)`); source = to; continue }
    if (target.strategy === 'merge') {
      await checkoutEnv(repo, cfg, to)
      const r = await git.run(['merge', '--no-ff', '--no-edit', '-m', `Merge ${source} into ${to}`, srcRef], { cwd: repo, allowFail: true, env: { GIT_EDITOR: 'true' } })
      if (r.code !== 0) { res.conflict = `${source} → ${to}`; res.message = r.stderr || r.stdout; return res }
      if (push) await run(repo, ['push', cfg.remote, to])
      res.merged.push(`${source} → ${to}`)
    } else {
      const sync = `sync/${source}-into-${to}-${day}`
      const st = await git.status(repo)
      if (st.files.some((f) => f.area !== 'untracked')) throw new Error('Working tree has uncommitted changes. Commit or stash them first.')
      await run(repo, ['branch', '-D', sync], true)
      await run(repo, ['checkout', '-b', sync, toRef])
      const r = await git.run(['merge', '--no-ff', '--no-edit', '-m', `Merge ${source} into ${to}`, srcRef], { cwd: repo, allowFail: true, env: { GIT_EDITOR: 'true' } })
      if (r.code !== 0) { res.conflict = `${source} → ${to}`; res.branch = sync; res.message = `${r.stderr || r.stdout}\nResolve on ${sync}, then push it and open a pull request into ${to}.`; return res }
      if (push) {
        await run(repo, ['push', '-u', '-f', cfg.remote, sync])
        try { const pr = await openPullRequest(repo, sync, to, `Sync ${source} into ${to}`, `Back-merge of ${source} into ${to} after a release, created by PakGit.`); res.prUrls!.push(pr.url) } catch (e) { res.message += (e instanceof Error ? e.message : String(e)) + '\n' }
      }
      res.merged.push(`${source} → ${to} (PR from ${sync})`)
    }
    // the next step must carry what we just merged: with direct merges `to` already has it,
    // with a PR the target is still behind, so keep merging from the same source
    if (target.strategy === 'merge') source = to
  }
  return res
}

export async function syncEnvironments(repo: string, push: boolean): Promise<PromoteResult> {
  const cfg = await releaseConfig(repo)
  const res = await backMerge(repo, cfg, lastEnv(cfg), push)
  res.message ||= res.merged.length ? `Synced: ${res.merged.join(', ')}${push ? ' (pushed)' : ''}` : `Nothing to sync${res.skipped.length ? ` (${res.skipped.join(', ')})` : ''}`
  return res
}

export async function startIssue(repo: string, branchName: string): Promise<void> {
  const cfg = await releaseConfig(repo)
  await run(repo, ['fetch', cfg.remote], true)
  const baseName = baseBranch(cfg)
  const base = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${baseName}`], true)).code === 0 ? `${cfg.remote}/${baseName}` : baseName
  await run(repo, ['checkout', '-b', branchName, base])
}
