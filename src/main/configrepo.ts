/**
 * Configuration repository (phase 4): the organization file lives in a small git repository the
 * team shares. PakGit clones it, shows what changed since the last apply, applies it, and can
 * write the local configuration back and push. No server, full history, reviewable.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import * as git from './git'
import * as orgs from './organizations'
import type { ConfigChange, ConfigRepo, ConfigSyncState, ImportResult, OrgExport } from '@shared/types'

let baseDir = ''
export function setConfigRepoDir(d: string): void { baseDir = d }
const cloneDir = (orgId: string): string => join(baseDir || process.cwd(), 'config-repos', orgId)

async function defaultBranch(dir: string): Promise<string> {
  const r = await git.run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: dir, allowFail: true })
  if (r.code === 0) return r.stdout.trim().replace(/^origin\//, '')
  const cur = await git.run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, allowFail: true })
  return cur.code === 0 && cur.stdout.trim() && cur.stdout.trim() !== 'HEAD' ? cur.stdout.trim() : 'main'
}

/** Clone or update the organization's configuration repository; returns the clone directory and the branch. */
async function ensureClone(orgId: string, cfg: ConfigRepo): Promise<{ dir: string; branch: string }> {
  const dir = cloneDir(orgId)
  if (existsSync(join(dir, '.git'))) {
    const url = (await git.run(['remote', 'get-url', 'origin'], { cwd: dir, allowFail: true })).stdout.trim()
    if (url !== cfg.url.trim()) rmSync(dir, { recursive: true, force: true })
  }
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dirname(dir), { recursive: true })
    await git.run(['clone', '-q', ...(cfg.branch ? ['--branch', cfg.branch] : []), cfg.url.trim(), dir], { cwd: dirname(dir) })
  } else {
    await git.run(['fetch', '-q', 'origin'], { cwd: dir })
  }
  const branch = cfg.branch || (await defaultBranch(dir))
  const hasRemote = (await git.run(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`], { cwd: dir, allowFail: true })).code === 0
  if (hasRemote) {
    await git.run(['checkout', '-q', '-B', branch, `origin/${branch}`], { cwd: dir })
  } else {
    // empty repository or new branch: start it locally
    await git.run(['checkout', '-q', '-B', branch], { cwd: dir, allowFail: true })
  }
  return { dir, branch }
}

async function readRemoteFile(dir: string, file: string): Promise<{ data: OrgExport | null; commit: string | null }> {
  const p = join(dir, file)
  if (!existsSync(p)) return { data: null, commit: null }
  const data = JSON.parse(readFileSync(p, 'utf8')) as OrgExport
  const log = await git.run(['log', '-n', '1', '--format=%H', '--', file], { cwd: dir, allowFail: true })
  return { data, commit: log.code === 0 && log.stdout.trim() ? log.stdout.trim() : null }
}

// ---------- diff ----------

/** Flatten an export into path -> value strings, indexing array entries by id / remote / name where present. */
export function flatten(v: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (v === null || v === undefined) { out[prefix] = ''; return out }
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) { out[prefix] = v.map(String).join(', '); return out }
    v.forEach((x, i) => { const o = x as Record<string, unknown>; const key = String(o['id'] ?? o['remote'] ?? o['name'] ?? i); flatten(x, `${prefix}[${key}]`, out) })
    return out
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (!Object.keys(o).length) { out[prefix] = ''; return out }
    for (const [k, x] of Object.entries(o)) flatten(x, prefix ? `${prefix}.${k}` : k, out)
    return out
  }
  out[prefix] = String(v)
  return out
}
/** What applying `to` on top of `from` would change (both exports). Empty strings and missing paths are treated alike. */
export function diffExports(from: OrgExport, to: OrgExport): ConfigChange[] {
  const skip = (p: string): boolean => p === 'version' || p.startsWith('organization.configRepo.lastApplied')
  const a = flatten(from), b = flatten(to)
  const changes: ConfigChange[] = []
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip(k)) continue
    const x = a[k] ?? '', y = b[k] ?? ''
    if (x === y) continue
    changes.push({ path: k.replace(/^organization\./, ''), kind: !(k in a) || x === '' ? 'added' : !(k in b) || y === '' ? 'removed' : 'changed', from: x, to: y })
  }
  return changes.sort((p, q) => p.path.localeCompare(q.path))
}

// ---------- sync / apply / push ----------

const stateCache = new Map<string, ConfigSyncState>()

export async function sync(orgId: string, fresh = false): Promise<ConfigSyncState> {
  const org = orgs.getOrg(orgId)
  if (!org.configRepo?.url?.trim()) return { configured: false, remote: null, changed: false, changes: [], localChanges: [], fetchedAt: Date.now() }
  const cached = stateCache.get(orgId)
  if (!fresh && cached && Date.now() - cached.fetchedAt < 60_000) return cached
  let state: ConfigSyncState
  try {
    const { dir } = await ensureClone(orgId, org.configRepo)
    const { data, commit } = await readRemoteFile(dir, org.configRepo.file || defaultFile(org.name))
    const local = orgs.exportOrg(orgId)
    const changes = data ? diffExports(local, data) : []
    const localChanges = data ? diffExports(data, local) : diffExports({ version: 1, organization: { ...local.organization, name: '' } as OrgExport['organization'], repositories: [] }, local)
    state = { configured: true, remote: commit, changed: !!commit && commit !== org.configRepo.lastApplied && changes.length > 0, changes, localChanges, fetchedAt: Date.now() }
  } catch (e) { state = { configured: true, remote: null, changed: false, changes: [], localChanges: [], error: e instanceof Error ? e.message : String(e), fetchedAt: Date.now() } }
  stateCache.set(orgId, state)
  return state
}
export const defaultFile = (name: string): string => `${orgs.slugify(name)}.pakgit-org.json`

/** Apply the remote file to this organization and remember the commit. */
export async function apply(orgId: string): Promise<ImportResult> {
  const org = orgs.getOrg(orgId)
  if (!org.configRepo?.url?.trim()) throw new Error('No configuration repository is set')
  const { dir } = await ensureClone(orgId, org.configRepo)
  const file = org.configRepo.file || defaultFile(org.name)
  const { data, commit } = await readRemoteFile(dir, file)
  if (!data) throw new Error(`${file} does not exist in the configuration repository yet; push first`)
  const res = orgs.applyExportTo(orgId, data)
  const after = orgs.getOrg(orgId)
  orgs.saveOrg({ ...after, configRepo: { ...(after.configRepo ?? org.configRepo), url: org.configRepo.url, lastApplied: commit ?? '' } })
  stateCache.delete(orgId)
  return res
}

/** Write this organization's export into the configuration repository, commit and push. */
export async function push(orgId: string, message: string): Promise<ConfigSyncState> {
  const org = orgs.getOrg(orgId)
  if (!org.configRepo?.url?.trim()) throw new Error('No configuration repository is set')
  const { dir, branch } = await ensureClone(orgId, org.configRepo)
  const file = org.configRepo.file || defaultFile(org.name)
  const target = join(dir, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(orgs.exportOrg(orgId), null, 2) + '\n')
  await git.run(['add', '--', file], { cwd: dir })
  const staged = await git.run(['diff', '--cached', '--quiet'], { cwd: dir, allowFail: true })
  if (staged.code !== 0) {
    const name = (await git.run(['config', '--get', 'user.name'], { cwd: dir, allowFail: true })).stdout.trim()
    const env: Record<string, string> | undefined = name ? undefined : { GIT_AUTHOR_NAME: 'PakGit', GIT_COMMITTER_NAME: 'PakGit', GIT_AUTHOR_EMAIL: 'pakgit@localhost', GIT_COMMITTER_EMAIL: 'pakgit@localhost' }
    await git.run(['commit', '-q', '-m', message.trim() || `Update ${org.name} configuration`], { cwd: dir, env })
  }
  await git.run(['push', '-q', '-u', 'origin', `HEAD:${branch}`], { cwd: dir })
  const commit = (await git.run(['log', '-n', '1', '--format=%H', '--', file], { cwd: dir, allowFail: true })).stdout.trim()
  orgs.saveOrg({ ...orgs.getOrg(orgId), configRepo: { ...org.configRepo, lastApplied: commit } })
  stateCache.delete(orgId)
  return sync(orgId, true)
}
export function forgetSync(orgId?: string): void { if (orgId) stateCache.delete(orgId); else stateCache.clear() }
