/**
 * Deployed-version probes: read what an environment is running (HTTP JSON, HTTP text or a git tag),
 * resolve it to a commit and compare it with the environment branch. Read-only.
 */
import * as git from './git'
import type { EnvConfig, Probe, ProbeResult } from '@shared/types'

const cache = new Map<string, ProbeResult>()
const TTL = 60_000

function jsonPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined
    const idx = /^\[(\d+)\]$/.exec(part) ?? /^(\d+)$/.exec(part)
    cur = idx ? (cur as unknown[])[+idx[1]] : (cur as Record<string, unknown>)[part]
  }
  return cur
}
const globToRe = (g: string): RegExp => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'PakGit' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** The deployed value as the probe reports it (commit sha, tag, version string). */
export async function readProbe(repo: string, p: Probe): Promise<string> {
  if (p.type === 'http-json') {
    if (!p.url) throw new Error('No URL')
    const v = jsonPath(JSON.parse(await fetchText(p.url)), p.path ?? 'commit')
    if (v === undefined || v === null || v === '') throw new Error(`Field "${p.path ?? 'commit'}" not found`)
    return String(v).trim()
  }
  if (p.type === 'http-text') {
    if (!p.url) throw new Error('No URL')
    const text = await fetchText(p.url)
    if (!p.regex) return text.trim().split('\n')[0].trim()
    const m = new RegExp(p.regex, 'm').exec(text)
    if (!m) throw new Error('Pattern did not match')
    return (m[1] ?? m[0]).trim()
  }
  if (p.type === 'git-tag') {
    const re = globToRe(p.tagPattern ?? 'deployed/*')
    // the last --sort key is the primary one: creation date first, version-aware name for ties (tags made in the same second)
    const r = await git.run(['for-each-ref', '--sort=-v:refname', '--sort=-creatordate', '--format=%(refname:short)', 'refs/tags'], { cwd: repo, allowFail: true })
    const tag = r.stdout.split('\n').map((s) => s.trim()).find((t) => t && re.test(t))
    if (!tag) throw new Error(`No tag matches ${p.tagPattern ?? 'deployed/*'}`)
    return tag
  }
  throw new Error(`Unknown probe type ${(p as Probe).type}`)
}

/** Compare the deployed value with the environment branch of the repository. */
export async function probeEnv(repo: string, cfg: EnvConfig, envId: string, p: Probe, fresh = false): Promise<ProbeResult> {
  const key = `${repo}\n${envId}\n${JSON.stringify(p)}`
  const cached = cache.get(key)
  if (!fresh && cached && Date.now() - cached.at < TTL) return cached
  const env = cfg.environments.find((e) => e.id === envId)
  const res: ProbeResult = { envId, status: 'unknown', at: Date.now() }
  try {
    if (!env) throw new Error('Unknown environment')
    const value = await readProbe(repo, p)
    res.deployed = value
    const rev = await git.run(['rev-parse', '--verify', '-q', `${value}^{commit}`], { cwd: repo, allowFail: true })
    if (rev.code !== 0) throw new Error(`${value} is not a commit in this clone (fetch, or check the probe)`)
    const sha = rev.stdout.trim()
    let envRef: string | null = null
    for (const c of [`refs/remotes/${cfg.remote}/${env.branch}`, `refs/heads/${env.branch}`]) if ((await git.run(['rev-parse', '--verify', '-q', c], { cwd: repo, allowFail: true })).code === 0) { envRef = c; break }
    if (!envRef) throw new Error(`Branch ${env.branch} not found`)
    const behind = +(await git.run(['rev-list', '--count', `${sha}..${envRef}`], { cwd: repo, allowFail: true })).stdout.trim() || 0
    const ahead = +(await git.run(['rev-list', '--count', `${envRef}..${sha}`], { cwd: repo, allowFail: true })).stdout.trim() || 0
    res.behind = behind; res.ahead = ahead
    res.status = behind === 0 && ahead === 0 ? 'same' : behind > 0 ? 'behind' : 'ahead'
  } catch (e) { res.error = e instanceof Error ? e.message : String(e) }
  cache.set(key, res)
  return res
}

export async function probeRepo(repo: string, cfg: EnvConfig, probes: Record<string, Probe> | undefined, fresh = false): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  for (const e of cfg.environments) { const p = probes?.[e.id]; if (p) out.push(await probeEnv(repo, cfg, e.id, p, fresh)) }
  return out
}
export function forgetProbes(): void { cache.clear() }
