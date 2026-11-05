import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import * as git from './git'
import { tracker } from './tracker'
import type { Commit, EnvConfig, PromoteResult, ReleaseAnalysis, ReleaseBranchRef, ReleaseItem } from '@shared/types'

// ---------- per-repository environment configuration ----------

let configDir = ''
/** Directory holding release-config.json (the Electron userData folder; a temp dir in tests). */
export function setReleaseConfigDir(dir: string): void { configDir = dir }
const cfgFile = () => join(configDir || process.cwd(), 'release-config.json')
function loadAll(): Record<string, EnvConfig> { try { return JSON.parse(readFileSync(cfgFile(), 'utf8')) } catch { return {} } }

const DEV = ['dev', 'develop', 'development'], STAGE = ['stage', 'staging', 'uat'], PROD = ['main', 'master', 'prod', 'production']

export async function releaseConfig(repo: string): Promise<EnvConfig> {
  const saved = loadAll()[repo]
  if (saved) return saved
  const refs = await git.refs(repo)
  const names = new Set(refs.branches.map((b) => b.name))
  const pick = (cands: string[]) => cands.find((c) => names.has(c)) ?? cands[0]
  const remote = refs.remotes.find((r) => r.name === 'origin')?.name ?? refs.remotes[0]?.name ?? 'origin'
  return { remote, dev: pick(DEV), stage: pick(STAGE), prod: pick(PROD), releasePrefix: 'release/' }
}
export function saveReleaseConfig(repo: string, cfg: EnvConfig): EnvConfig {
  const all = loadAll(); all[repo] = cfg
  mkdirSync(dirname(cfgFile()), { recursive: true }); writeFileSync(cfgFile(), JSON.stringify(all, null, 2))
  return cfg
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
  const [dev, stage, prod] = await Promise.all([envRef(repo, cfg, cfg.dev), envRef(repo, cfg, cfg.stage), envRef(repo, cfg, cfg.prod)])
  const t = tracker()
  const keyRe = new RegExp(t.keyPattern.source, 'gi')

  // all branches with sha + date
  const { stdout } = await run(repo, ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)', 'refs/heads', 'refs/remotes'])
  const envNames = new Set([cfg.dev, cfg.stage, cfg.prod])
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
    // backups like dev-as-on-23rd-oct, dev_backup, main-demo
    if ([...envNames].some((e) => name === e || name.startsWith(e + '-') || name.startsWith(e + '_'))) continue
    all.push(entry)
  }
  // prefer the remote ref when a branch exists both locally and remotely
  const byName = new Map<string, ReleaseBranchRef>()
  for (const b of all) { const cur = byName.get(b.name); if (!cur || (!cur.remote && b.remote)) byName.set(b.name, b) }

  const [inDev, inStage, inProd] = await Promise.all([mergedInto(repo, dev), mergedInto(repo, stage), mergedInto(repo, prod)])

  // group branches into items by issue key, else by normalised name (strip -dev/-stage/-main variants)
  const items = new Map<string, ReleaseItem>()
  const itemFor = (id: string, issueKey: string | null, name: string): ReleaseItem => {
    let it = items.get(id)
    if (!it) { it = { id, issueKey, name, branches: [], inDev: false, inStage: false, inProd: false, commitsAheadOfProd: null, basedOnEnv: false, needsCherryPick: false, commits: [], lastActivity: '' }; items.set(id, it) }
    return it
  }
  for (const b of byName.values()) {
    const base = b.name.replace(ENV_SUFFIX, '')
    const key = base.match(keyRe)?.[0]
    const issueKey = key ? t.normalizeKey(key) : null
    const it = itemFor(issueKey ?? base.toLowerCase(), issueKey, base)
    it.branches.push(b)
    it.inDev ||= inDev.has(b.ref); it.inStage ||= inStage.has(b.ref); it.inProd ||= inProd.has(b.ref)
    if (b.date > it.lastActivity) it.lastActivity = b.date
  }

  // issue-key prefixes seen in branch names: commit-message keys with other prefixes are noise (e.g. "EAST-1")
  const knownPrefixes = new Set([...items.values()].map((it) => it.issueKey?.split('-')[0]).filter((x): x is string => !!x))

  // commit-based pass: work on dev/stage that is not on prod, grouped by issue key (covers deleted branches)
  const envLog = async (ref: string | null): Promise<Commit[]> => {
    if (!ref || !prod) return []
    const r = await run(repo, ['log', '--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D%x01', `${prod}..${ref}`, '-n', '2000'], true)
    if (r.code !== 0) return []
    return r.stdout.split('\x01').filter((c) => c.trim()).map((chunk) => {
      const [sha, shortSha, parents, author, email, date, subject, body, refs] = chunk.replace(/^\n/, '').split('\0')
      return { sha, shortSha, parents: parents ? parents.split(' ') : [], author, email, date, subject, body: (body ?? '').trim(), refs: refs ? refs.split(', ').filter(Boolean) : [] }
    })
  }
  const [devCommits, stageCommits] = await Promise.all([envLog(dev), envLog(stage)])
  const stageShas = new Set(stageCommits.map((c) => c.sha))
  const seen = new Set<string>()
  for (const c of [...stageCommits, ...devCommits]) {
    if (seen.has(c.sha)) continue; seen.add(c.sha)
    const key = `${c.subject}\n${c.body}`.match(keyRe)?.[0]
    if (!key) continue
    const k = t.normalizeKey(key)
    if (knownPrefixes.size && !knownPrefixes.has(k.split('-')[0]) && !items.has(k)) continue
    const it = itemFor(k, k, k)
    it.commits.push(c)
    if (stageShas.has(c.sha)) it.inStage = true
    it.inDev = it.inDev || devCommits.some((d) => d.sha === c.sha)
    if (c.date > it.lastActivity) it.lastActivity = c.date
  }
  for (const it of items.values()) {
    if (!it.branches.length) it.needsCherryPick = true
    it.commits.sort((a, b) => (a.date < b.date ? -1 : 1))
    it.branches.sort((a, b) => (a.date > b.date ? -1 : 1))
  }

  // per-branch own-commit counts for unreleased items; pick a branch cut from prod over a -dev copy when promoting
  const unreleased = [...items.values()].filter((it) => !it.inProd && it.branches.length).slice(0, 150)
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
  return { config: cfg, refs: { dev, stage, prod }, items: list, releaseBranches: releaseBranches.sort((a, b) => (a.date > b.date ? -1 : 1)), currentBranch: head.code === 0 ? head.stdout.trim() : null, rerere }
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

export async function promote(repo: string, env: 'dev' | 'stage', items: PromoteInput[], push: boolean): Promise<PromoteResult> {
  const cfg = await releaseConfig(repo)
  const target = cfg[env]
  await checkoutEnv(repo, cfg, target)
  const res = await applyItems(repo, items, target)
  if (!res.conflict && push && res.merged.length) await run(repo, ['push', cfg.remote, target])
  res.message ||= res.merged.length ? `Merged ${res.merged.length} item(s) into ${target}${push ? ' and pushed' : ''}` : 'Nothing to merge'
  return res
}

export async function startRelease(repo: string, name: string, items: PromoteInput[], push: boolean): Promise<PromoteResult> {
  const cfg = await releaseConfig(repo)
  const branch = name.startsWith(cfg.releasePrefix) ? name : cfg.releasePrefix + name
  const st = await git.status(repo)
  if (st.files.some((f) => f.area !== 'untracked')) throw new Error('Working tree has uncommitted changes. Commit or stash them first.')
  const base = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${cfg.prod}`], true)).code === 0 ? `${cfg.remote}/${cfg.prod}` : cfg.prod
  await run(repo, ['checkout', '-b', branch, base])
  const res = await applyItems(repo, items, branch)
  if (!res.conflict && push) await run(repo, ['push', '-u', cfg.remote, branch])
  res.message ||= `Created ${branch} from ${base} with ${res.merged.length} item(s)${push ? ' and pushed' : ''}`
  return res
}

/** Merge the release branch into prod, tag, then back-merge prod -> stage -> dev. */
export async function finishRelease(repo: string, releaseBranch: string, tag: string | null, push: boolean): Promise<PromoteResult> {
  const cfg = await releaseConfig(repo)
  await checkoutEnv(repo, cfg, cfg.prod)
  const r = await git.run(['merge', '--no-ff', '--no-edit', releaseBranch], { cwd: repo, allowFail: true, env: { GIT_EDITOR: 'true' } })
  if (r.code !== 0) return { merged: [], conflict: releaseBranch, skipped: [], message: r.stderr || r.stdout }
  if (tag) await run(repo, ['tag', '-a', tag, '-m', `Release ${tag}`])
  const res = await backMerge(repo, cfg, push)
  if (push && !res.conflict) await run(repo, ['push', cfg.remote, cfg.prod, ...(tag ? [tag] : [])])
  res.merged.unshift(releaseBranch)
  res.message = res.conflict ? res.message : `Released ${releaseBranch} into ${cfg.prod}${tag ? ` (tag ${tag})` : ''}, back-merged into ${cfg.stage} and ${cfg.dev}${push ? ', pushed' : ''}`
  return res
}

async function backMerge(repo: string, cfg: EnvConfig, push: boolean): Promise<PromoteResult> {
  const res: PromoteResult = { merged: [], conflict: null, skipped: [], message: '' }
  const chain: [string, string][] = [[cfg.prod, cfg.stage], [cfg.stage, cfg.dev]]
  for (const [from, to] of chain) {
    const exists = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${to}`], true)).code === 0 || (await run(repo, ['rev-parse', '--verify', '-q', `refs/heads/${to}`], true)).code === 0
    if (!exists) { res.skipped.push(to); continue }
    await checkoutEnv(repo, cfg, to)
    const r = await git.run(['merge', '--no-ff', '--no-edit', '-m', `Merge ${from} into ${to}`, from], { cwd: repo, allowFail: true, env: { GIT_EDITOR: 'true' } })
    if (r.code !== 0) { res.conflict = `${from} → ${to}`; res.message = r.stderr || r.stdout; return res }
    res.merged.push(`${from} → ${to}`)
    if (push) await run(repo, ['push', cfg.remote, to])
  }
  return res
}

export async function syncEnvironments(repo: string, push: boolean): Promise<PromoteResult> {
  const cfg = await releaseConfig(repo)
  const res = await backMerge(repo, cfg, push)
  res.message ||= res.merged.length ? `Synced: ${res.merged.join(', ')}${push ? ' (pushed)' : ''}` : 'Nothing to sync'
  return res
}

export async function startIssue(repo: string, branchName: string): Promise<void> {
  const cfg = await releaseConfig(repo)
  await run(repo, ['fetch', cfg.remote], true)
  const base = (await run(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${cfg.prod}`], true)).code === 0 ? `${cfg.remote}/${cfg.prod}` : cfg.prod
  await run(repo, ['checkout', '-b', branchName, base])
}
