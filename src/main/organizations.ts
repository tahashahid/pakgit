/**
 * Organizations: the container for repositories, groups, a shared pipeline template, conventions
 * and tracker configuration. Pure file-based module (no Electron, no git) so it is testable.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Conventions, EnvConfig, ImportResult, OrgExport, Organization, OrganizationSummary, OwnerProposal, RepoEntry, RepoPipelineOverride, TrackerConfig, WorkspaceState } from '@shared/types'

export const PERSONAL = 'personal'
const VERSION = 1

let dir = ''
export function setOrgDir(d: string): void { dir = d }
const root = () => dir || process.cwd()
const workspaceFile = () => join(root(), 'workspace.json')
const orgDir = (id: string) => join(root(), 'orgs', id)
const orgFile = (id: string) => join(orgDir(id), 'org.json')
const reposFile = (id: string) => join(orgDir(id), 'repositories.json')

const readJson = <T>(file: string, d: T): T => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return d } }
const writeJson = (file: string, v: unknown): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(v, null, 2)) }

export const defaultConventions = (): Conventions => ({ branchPattern: '{user}/{key}-{slug}', releasePattern: 'release/{env}-{week}' })
export const defaultTracker = (): TrackerConfig => ({ provider: 'none', authMethod: 'oauth', linearClientId: '', stateOnStart: 'In Progress' })
const COLORS = ['#0B6B3A', '#2563eb', '#7c3aed', '#db2777', '#d97706', '#0891b2', '#dc2626', '#4b5563']

export function slugify(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'org' }

// ---------- remote identity ----------

/** github.com/project-cybernut/admin-portal-v2 (lower-case host and path, no protocol, no .git, no credentials) */
export function normalizeRemote(url: string | null | undefined): string | null {
  if (!url) return null
  let u = url.trim()
  const scp = /^(?:[^@]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(u) // git@host:owner/repo.git
  if (scp && !/^[a-z]+:\/\//i.test(u)) u = `ssh://${scp[1]}/${scp[2]}`
  const m = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(u)
  if (!m) return null
  return `${m[1].toLowerCase()}/${m[2].replace(/^\/+/, '').toLowerCase()}`
}
export function parseIdentity(identity: string | null | undefined): { host: string; owner: string; name: string } | null {
  if (!identity) return null
  const parts = identity.split('/')
  if (parts.length < 3) return null
  return { host: parts[0], owner: parts.slice(1, -1).join('/'), name: parts[parts.length - 1] }
}

// ---------- workspace ----------

function emptyPersonal(): Organization {
  return { id: PERSONAL, name: 'Personal', color: COLORS[0], groups: [], pipeline: null, conventions: defaultConventions(), tracker: defaultTracker(), howWeWork: '', createdAt: Date.now() }
}

/** One-time migration from the flat layout (repositories.json + groups.json at the root) into the Personal organization. Idempotent. */
export function ensureMigrated(legacyTracker?: TrackerConfig | null): { migrated: boolean } {
  if (existsSync(workspaceFile())) { if (!existsSync(orgFile(PERSONAL))) writeJson(orgFile(PERSONAL), emptyPersonal()); return { migrated: false } }
  const personal = emptyPersonal()
  const legacyRepos = readJson<RepoEntry[]>(join(root(), 'repositories.json'), [])
  const legacyGroups = readJson<string[]>(join(root(), 'groups.json'), [])
  personal.groups = legacyGroups
  if (legacyTracker) personal.tracker = { ...defaultTracker(), ...legacyTracker }
  writeJson(orgFile(PERSONAL), personal)
  writeJson(reposFile(PERSONAL), legacyRepos.map((r) => ({ ...r, group: r.group ?? null })))
  for (const f of ['repositories.json', 'groups.json']) { const p = join(root(), f); if (existsSync(p)) renameSync(p, p + '.migrated') }
  writeJson(workspaceFile(), { version: VERSION, active: PERSONAL })
  return { migrated: true }
}

interface WorkspaceFile { version: number; active: string }
function readWorkspace(): WorkspaceFile { return readJson<WorkspaceFile>(workspaceFile(), { version: VERSION, active: PERSONAL }) }

export function listOrgs(): OrganizationSummary[] {
  const base = join(root(), 'orgs')
  const ids = existsSync(base) ? require('fs').readdirSync(base).filter((n: string) => existsSync(orgFile(n))) : []
  const list = ids.map((id: string) => { const o = getOrg(id); return { id: o.id, name: o.name, color: o.color, repoCount: orgRepos(id).length } })
  return list.sort((a: OrganizationSummary, b: OrganizationSummary) => (a.id === PERSONAL ? -1 : b.id === PERSONAL ? 1 : a.name.localeCompare(b.name)))
}
export function workspace(): WorkspaceState {
  const w = readWorkspace()
  const organizations = listOrgs()
  const active = organizations.some((o) => o.id === w.active) ? w.active : PERSONAL
  return { version: w.version, active, organizations }
}
export function activeOrgId(): string { return workspace().active }
export function setActive(id: string): WorkspaceState {
  getOrg(id)
  writeJson(workspaceFile(), { ...readWorkspace(), active: id })
  return workspace()
}

export function getOrg(id: string): Organization {
  const o = readJson<Organization | null>(orgFile(id), null)
  if (!o) { if (id === PERSONAL) { const p = emptyPersonal(); writeJson(orgFile(PERSONAL), p); return p } throw new Error(`Unknown organization "${id}"`) }
  return { ...emptyPersonal(), ...o, conventions: { ...defaultConventions(), ...(o.conventions ?? {}) }, tracker: { ...defaultTracker(), ...(o.tracker ?? {}) }, groups: o.groups ?? [] }
}
export function saveOrg(org: Organization): Organization { writeJson(orgFile(org.id), org); return org }

export function createOrg(input: { name: string; color?: string; pipeline?: EnvConfig | null; conventions?: Partial<Conventions>; tracker?: Partial<TrackerConfig>; howWeWork?: string; groups?: string[] }): Organization {
  const name = input.name.trim()
  if (!name) throw new Error('Organization name is empty')
  let id = slugify(name); if (id === PERSONAL) id = 'personal-org'
  let n = 2; const base = id
  while (existsSync(orgFile(id))) id = `${base}-${n++}`
  const used = new Set(listOrgs().map((o) => o.color))
  const org: Organization = {
    id, name, color: input.color ?? (COLORS.find((c) => !used.has(c)) ?? COLORS[1]), groups: input.groups ?? [],
    pipeline: input.pipeline ?? null, conventions: { ...defaultConventions(), ...(input.conventions ?? {}) },
    tracker: { ...defaultTracker(), ...(input.tracker ?? {}) }, howWeWork: input.howWeWork ?? '', createdAt: Date.now()
  }
  saveOrg(org); writeJson(reposFile(id), [])
  return org
}
export function updateOrg(id: string, patch: Partial<Omit<Organization, 'id' | 'createdAt'>>): Organization {
  const org = getOrg(id)
  const next: Organization = { ...org, ...patch, id: org.id, createdAt: org.createdAt }
  if (!next.name.trim()) throw new Error('Organization name is empty')
  if (id === PERSONAL) next.name = 'Personal'
  // groups removed from the organization are cleared on its repositories
  const removed = org.groups.filter((g) => !next.groups.includes(g))
  if (removed.length) saveOrgRepos(id, orgRepos(id).map((r) => (r.group && removed.includes(r.group) ? { ...r, group: null } : r)))
  return saveOrg(next)
}
export function deleteOrg(id: string): WorkspaceState {
  if (id === PERSONAL) throw new Error('Personal cannot be deleted')
  const repos = orgRepos(id)
  for (const r of repos) moveRepo(r.path, PERSONAL)
  rmSync(orgDir(id), { recursive: true, force: true })
  if (readWorkspace().active === id) setActive(PERSONAL)
  return workspace()
}

// ---------- repositories ----------

export function orgRepos(id: string): RepoEntry[] { return readJson<RepoEntry[]>(reposFile(id), []).map((r) => ({ ...r, org: id })) }
export function saveOrgRepos(id: string, list: RepoEntry[]): void { writeJson(reposFile(id), list.map(({ org: _o, ...r }) => r)) }
export function allRepos(): RepoEntry[] { return listOrgs().flatMap((o) => orgRepos(o.id)) }
export function findRepo(path: string): RepoEntry | undefined { return allRepos().find((r) => r.path === path) }
export function findRepoByRemote(remote: string): RepoEntry | undefined { return allRepos().find((r) => r.remote && r.remote === remote) }
export function orgOfRepo(path: string): string { return findRepo(path)?.org ?? activeOrgId() }

/** Add or update a repository in an organization; a path exists once in the workspace. */
export function upsertRepo(entry: Omit<RepoEntry, 'org'>, orgId: string): RepoEntry {
  const existing = findRepo(entry.path)
  const target = orgId || existing?.org || activeOrgId()
  if (existing && existing.org !== target) saveOrgRepos(existing.org!, orgRepos(existing.org!).filter((r) => r.path !== entry.path))
  const list = orgRepos(target).filter((r) => r.path !== entry.path)
  const merged: RepoEntry = { ...(existing ?? {}), ...entry, group: entry.group ?? (existing?.org === target ? existing?.group ?? null : null) }
  if (merged.group && !getOrg(target).groups.includes(merged.group)) merged.group = null
  delete merged.org
  list.unshift(merged)
  saveOrgRepos(target, list)
  return { ...merged, org: target }
}
export function removeRepo(path: string): void {
  const r = findRepo(path); if (!r) return
  saveOrgRepos(r.org!, orgRepos(r.org!).filter((x) => x.path !== path))
}
export function moveRepo(path: string, orgId: string): RepoEntry {
  const r = findRepo(path); if (!r) throw new Error(`Repository ${path} is not in the workspace`)
  getOrg(orgId)
  const { org: _o, ...plain } = r
  return upsertRepo({ ...plain, group: null }, orgId)
}
export function setRepoRemote(path: string, remote: string | null): void {
  const r = findRepo(path); if (!r) return
  saveOrgRepos(r.org!, orgRepos(r.org!).map((x) => (x.path === path ? { ...x, remote } : x)))
}

// ---------- groups ----------

export function groups(id: string): string[] { return getOrg(id).groups }
export function createGroup(id: string, name: string): string[] {
  const n = name.trim(); if (!n) throw new Error('Group name is empty')
  const org = getOrg(id); if (!org.groups.includes(n)) saveOrg({ ...org, groups: [...org.groups, n] })
  return getOrg(id).groups
}
export function renameGroup(id: string, oldName: string, newName: string): void {
  const n = newName.trim(); if (!n) throw new Error('Group name is empty')
  const org = getOrg(id)
  saveOrg({ ...org, groups: org.groups.map((g) => (g === oldName ? n : g)).filter((g, i, a) => a.indexOf(g) === i) })
  saveOrgRepos(id, orgRepos(id).map((r) => (r.group === oldName ? { ...r, group: n } : r)))
}
export function deleteGroup(id: string, name: string): void {
  const org = getOrg(id)
  saveOrg({ ...org, groups: org.groups.filter((g) => g !== name) })
  saveOrgRepos(id, orgRepos(id).map((r) => (r.group === name ? { ...r, group: null } : r)))
}
export function setRepoGroup(path: string, group: string | null): void {
  const r = findRepo(path); if (!r) return
  if (group) createGroup(r.org!, group)
  saveOrgRepos(r.org!, orgRepos(r.org!).map((x) => (x.path === path ? { ...x, group } : x)))
}

// ---------- proposals (first-run wizard) ----------

/** Repositories of one organization grouped by hosting owner, for proposing new organizations. */
export function proposals(fromOrg = PERSONAL): OwnerProposal[] {
  const byOwner = new Map<string, OwnerProposal>()
  for (const r of orgRepos(fromOrg)) {
    const id = parseIdentity(r.remote); if (!id) continue
    const key = `${id.host}/${id.owner}`
    if (!byOwner.has(key)) byOwner.set(key, { host: id.host, owner: id.owner, repos: [] })
    byOwner.get(key)!.repos.push(r)
  }
  return [...byOwner.values()].sort((a, b) => b.repos.length - a.repos.length)
}

// ---------- export / import ----------

export function exportOrg(id: string): OrgExport {
  const o = getOrg(id)
  return {
    version: 1,
    organization: { name: o.name, color: o.color, groups: o.groups, pipeline: o.pipeline, conventions: o.conventions, tracker: o.tracker, howWeWork: o.howWeWork },
    repositories: orgRepos(id).filter((r) => r.remote).map((r) => ({ remote: r.remote!, name: r.name, group: r.group ?? null }))
  }
}

/** Create (or update, when an organization of the same name exists) from an export; attaches repositories already in the workspace by remote. */
export function importOrg(data: OrgExport): ImportResult {
  if (!data || data.version !== 1 || !data.organization?.name) throw new Error('Not a PakGit organization file')
  const existing = listOrgs().find((o) => o.name.toLowerCase() === data.organization.name.toLowerCase() && o.id !== PERSONAL)
  const org = existing
    ? updateOrg(existing.id, { ...data.organization, tracker: { ...getOrg(existing.id).tracker, ...data.organization.tracker } })
    : createOrg({ ...data.organization })
  const matched: RepoEntry[] = []
  const missing: ImportResult['missing'] = []
  for (const r of data.repositories) {
    const found = findRepoByRemote(r.remote)
    if (found) { const moved = found.org === org.id ? found : moveRepo(found.path, org.id); if (r.group) { createGroup(org.id, r.group); setRepoGroup(found.path, r.group) } matched.push({ ...moved, group: r.group }) }
    else missing.push(r)
  }
  return { org: { id: org.id, name: org.name, color: org.color, repoCount: orgRepos(org.id).length }, matched, missing }
}

// ---------- pipeline inheritance ----------

/** Apply a repository's override to the organization template. */
export function applyOverride(template: EnvConfig, o: RepoPipelineOverride | null | undefined): EnvConfig {
  if (!o || o.mode === 'custom') return template
  const disabled = new Set(o.disabled ?? [])
  const environments = template.environments.filter((e) => !disabled.has(e.id)).map((e) => ({
    ...e, branch: o.branchMap?.[e.id]?.trim() || e.branch, strategy: o.strategyMap?.[e.id] ?? e.strategy
  }))
  if (!environments.length) throw new Error('All environments are disabled for this repository')
  const baseEnv = environments.some((e) => e.id === template.baseEnv) ? template.baseEnv : environments[environments.length - 1].id
  return { ...template, environments, baseEnv }
}
