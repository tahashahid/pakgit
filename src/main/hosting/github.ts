/**
 * GitHub through the `gh` CLI when it is installed (its own login, or a token passed as GH_TOKEN),
 * else through the REST API with a personal access token. Only github.com remotes are served.
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, join } from 'path'
import * as git from '../git'
import type { HostingStatus, PullRequestStatus } from '@shared/types'
import type { CreatePrRequest, HostingProvider } from './provider'

export interface GitHubOptions { token?: string; ghPath?: string }

const CANDIDATES = process.platform === 'win32'
  ? [join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe'), join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'GitHub CLI', 'gh.exe')]
  : ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', '/home/linuxbrew/.linuxbrew/bin/gh', '/snap/bin/gh']

/** Locate the gh executable: configured path, PAKGIT_GH, PATH, then the usual install locations. */
export function findGh(configured?: string): string | null {
  if (configured?.trim()) return configured.trim()
  if (process.env.PAKGIT_GH) return process.env.PAKGIT_GH
  const exe = process.platform === 'win32' ? 'gh.exe' : 'gh'
  for (const d of (process.env.PATH ?? '').split(delimiter)) if (d && existsSync(join(d, exe))) return join(d, exe)
  for (const c of CANDIDATES) if (c && existsSync(c)) return c
  return null
}

/** owner/name of a github.com remote URL, else null. */
export function githubSlug(url: string | null | undefined): string | null {
  if (!url) return null
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? m[1] : null
}

interface GhPr { number: number; url: string; state: string; title: string; isDraft?: boolean; headRefName: string; baseRefName: string; headRefOid?: string; mergeable?: string; reviewDecision?: string | null; statusCheckRollup?: { __typename?: string; status?: string; conclusion?: string | null; state?: string }[] | null; mergedAt?: string | null; updatedAt?: string }
interface RestPr { number: number; html_url: string; state: string; title: string; draft?: boolean; head: { ref: string; sha: string }; base: { ref: string }; mergeable?: boolean | null; merged_at?: string | null; updated_at?: string; requested_reviewers?: unknown[] }

const LIST_FIELDS = 'number,url,state,title,isDraft,headRefName,baseRefName,headRefOid,mergedAt,updatedAt'
const VIEW_FIELDS = LIST_FIELDS + ',mergeable,reviewDecision,statusCheckRollup'

export function checksOf(rollup: GhPr['statusCheckRollup']): PullRequestStatus['checks'] {
  if (!rollup || !rollup.length) return 'none'
  let pending = false
  for (const c of rollup) {
    const conclusion = (c.conclusion ?? '').toUpperCase(); const state = (c.state ?? '').toUpperCase(); const status = (c.status ?? '').toUpperCase()
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion) || ['FAILURE', 'ERROR'].includes(state)) return 'failure'
    if ((status && status !== 'COMPLETED') || state === 'PENDING' || state === 'EXPECTED') pending = true
  }
  return pending ? 'pending' : 'success'
}
const reviewOf = (d: string | null | undefined): PullRequestStatus['reviewDecision'] => d === 'APPROVED' ? 'approved' : d === 'CHANGES_REQUESTED' ? 'changes-requested' : d === 'REVIEW_REQUIRED' ? 'review-required' : 'none'
const stateOf = (s: string, mergedAt?: string | null): PullRequestStatus['state'] => (s.toUpperCase() === 'MERGED' || mergedAt ? 'merged' : s.toUpperCase() === 'OPEN' ? 'open' : 'closed')

function fromGh(p: GhPr): PullRequestStatus {
  return {
    number: p.number, url: p.url, state: stateOf(p.state, p.mergedAt), title: p.title, draft: !!p.isDraft, head: p.headRefName, base: p.baseRefName, headSha: p.headRefOid,
    mergeable: p.mergeable === 'MERGEABLE' ? 'mergeable' : p.mergeable === 'CONFLICTING' ? 'conflicting' : p.mergeable ? 'unknown' : undefined,
    reviewDecision: reviewOf(p.reviewDecision), checks: checksOf(p.statusCheckRollup), mergedAt: p.mergedAt ?? null, updatedAt: p.updatedAt
  }
}

export class GitHubProvider implements HostingProvider {
  readonly id = 'github' as const
  private opts: GitHubOptions = {}
  private slugCache = new Map<string, string | null>()
  private listCache = new Map<string, { at: number; prs: PullRequestStatus[] }>()
  private statusCache: { at: number; status: HostingStatus } | null = null

  configure(opts: GitHubOptions): void { this.opts = { ...opts }; this.statusCache = null; this.listCache.clear() }
  private mode(): 'gh' | 'token' | 'none' { if (findGh(this.opts.ghPath)) return 'gh'; return this.opts.token?.trim() ? 'token' : 'none' }

  // ---- transport
  private runGh(args: string[], cwd?: string, input?: string): Promise<string> {
    const bin = findGh(this.opts.ghPath)
    if (!bin) return Promise.reject(new Error('GitHub CLI (gh) not found'))
    const env: Record<string, string> = { ...(process.env as Record<string, string>), GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_PAGER: 'cat' }
    if (this.opts.token?.trim()) env['GH_TOKEN'] = this.opts.token.trim()
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd: cwd && existsSync(cwd) ? cwd : undefined, env, windowsHide: true })
      const out: Buffer[] = [], err: Buffer[] = []
      child.stdout.on('data', (d) => out.push(d)); child.stderr.on('data', (d) => err.push(d))
      child.on('error', (e) => reject(new Error(`Failed to start gh: ${e.message}`)))
      const timer = setTimeout(() => { child.kill(); reject(new Error('gh timed out')) }, 60_000)
      child.on('close', (code) => {
        clearTimeout(timer)
        const stdout = Buffer.concat(out).toString('utf8'), stderr = Buffer.concat(err).toString('utf8')
        if (code === 0) resolve(stdout); else reject(new Error((stderr || stdout).trim() || `gh ${args[0]} failed (${code})`))
      })
      child.stdin.end(input ?? '')
    })
  }
  private async rest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const token = this.opts.token?.trim(); if (!token) throw new Error('No GitHub token configured')
    const res = await fetch(`https://api.github.com${path}`, {
      method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'PakGit', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) }
    })
    if (!res.ok) { let msg = `${res.status}`; try { msg = ((await res.json()) as { message?: string }).message ?? msg } catch { /* keep status */ } throw new Error(`GitHub API: ${msg}`) }
    return (res.status === 204 ? ({} as T) : ((await res.json()) as T))
  }

  // ---- repository identity
  private async slug(repo: string): Promise<string | null> {
    if (this.slugCache.has(repo)) return this.slugCache.get(repo)!
    let s: string | null = null
    try {
      const refs = await git.refs(repo)
      const origin = refs.remotes.find((r) => r.name === 'origin') ?? refs.remotes[0]
      s = githubSlug(origin?.pushUrl || origin?.fetchUrl)
    } catch { s = null }
    this.slugCache.set(repo, s)
    return s
  }
  forgetRepo(repo: string): void { this.slugCache.delete(repo); this.listCache.delete(repo) }

  async status(repo?: string): Promise<HostingStatus> {
    const mode = this.mode()
    if (mode === 'none') return { provider: 'github', available: false, error: 'Install the GitHub CLI and run "gh auth login", or add a personal access token' }
    if (repo && !(await this.slug(repo))) return { provider: 'github', available: false, error: 'The remote is not on github.com' }
    if (this.statusCache && Date.now() - this.statusCache.at < 5 * 60_000) return this.statusCache.status
    let status: HostingStatus
    try {
      const login = mode === 'gh' ? (await this.runGh(['api', 'user', '--jq', '.login'])).trim() : (await this.rest<{ login: string }>('/user')).login
      status = { provider: 'github', available: true, account: login, via: mode }
    } catch (e) { status = { provider: 'github', available: false, via: mode, error: e instanceof Error ? e.message : String(e) } }
    this.statusCache = { at: Date.now(), status }
    return status
  }
  async supports(repo: string): Promise<boolean> { return !!(await this.slug(repo)) && (await this.status()).available }

  async listPullRequests(repo: string, fresh = false): Promise<PullRequestStatus[]> {
    const slug = await this.slug(repo); if (!slug) return []
    const cached = this.listCache.get(repo)
    if (!fresh && cached && Date.now() - cached.at < 2 * 60_000) return cached.prs
    let prs: PullRequestStatus[]
    if (this.mode() === 'gh') {
      const out = await this.runGh(['pr', 'list', '--repo', slug, '--state', 'all', '--limit', '300', '--json', LIST_FIELDS], repo)
      prs = (JSON.parse(out) as GhPr[]).map(fromGh)
    } else {
      prs = []
      for (let page = 1; page <= 3; page++) {
        const list = await this.rest<RestPr[]>(`/repos/${slug}/pulls?state=all&per_page=100&sort=updated&direction=desc&page=${page}`)
        prs.push(...list.map((p) => this.fromRest(p)))
        if (list.length < 100) break
      }
    }
    this.listCache.set(repo, { at: Date.now(), prs })
    return prs
  }
  private fromRest(p: RestPr, extra: Partial<PullRequestStatus> = {}): PullRequestStatus {
    return {
      number: p.number, url: p.html_url, state: stateOf(p.state, p.merged_at), title: p.title, draft: !!p.draft, head: p.head.ref, base: p.base.ref, headSha: p.head.sha,
      mergeable: p.mergeable === true ? 'mergeable' : p.mergeable === false ? 'conflicting' : undefined, reviewDecision: 'none', checks: 'none', mergedAt: p.merged_at ?? null, updatedAt: p.updated_at, ...extra
    }
  }

  async pullRequest(repo: string, ref: number | string): Promise<PullRequestStatus | null> {
    const slug = await this.slug(repo); if (!slug) return null
    if (this.mode() === 'gh') {
      try { return fromGh(JSON.parse(await this.runGh(['pr', 'view', String(ref), '--repo', slug, '--json', VIEW_FIELDS], repo)) as GhPr) }
      catch (e) { if (/no pull requests found|could not find|not found/i.test(e instanceof Error ? e.message : String(e))) return null; throw e }
    }
    let pr: RestPr | undefined
    if (typeof ref === 'number') { try { pr = await this.rest<RestPr>(`/repos/${slug}/pulls/${ref}`) } catch (e) { if (/404|not found/i.test(String(e))) return null; throw e } }
    else { const owner = slug.split('/')[0]; pr = (await this.rest<RestPr[]>(`/repos/${slug}/pulls?state=all&head=${encodeURIComponent(owner + ':' + ref)}&per_page=1`))[0] }
    if (!pr) return null
    // reviews: latest review per user decides
    const reviews = await this.rest<{ user: { login: string }; state: string; submitted_at: string }[]>(`/repos/${slug}/pulls/${pr.number}/reviews?per_page=100`).catch(() => [])
    const latest = new Map<string, string>()
    for (const r of reviews.sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1))) if (r.state !== 'COMMENTED') latest.set(r.user.login, r.state)
    const states = [...latest.values()]
    const reviewDecision: PullRequestStatus['reviewDecision'] = states.includes('CHANGES_REQUESTED') ? 'changes-requested' : states.includes('APPROVED') ? 'approved' : (pr.requested_reviewers?.length ? 'review-required' : 'none')
    // checks: check runs + legacy statuses on the head commit
    let checks: PullRequestStatus['checks'] = 'none'
    try {
      const runs = await this.rest<{ check_runs: { status: string; conclusion: string | null }[] }>(`/repos/${slug}/commits/${pr.head.sha}/check-runs?per_page=100`)
      const st = await this.rest<{ statuses: { state: string }[] }>(`/repos/${slug}/commits/${pr.head.sha}/status`)
      checks = checksOf([...runs.check_runs.map((r) => ({ status: r.status, conclusion: r.conclusion })), ...st.statuses.map((s) => ({ state: s.state }))])
    } catch { /* checks stay unknown */ }
    return this.fromRest(pr, { reviewDecision, checks })
  }

  async createPullRequest(repo: string, req: CreatePrRequest): Promise<PullRequestStatus> {
    const slug = await this.slug(repo); if (!slug) throw new Error('The remote is not on github.com')
    this.listCache.delete(repo)
    if (this.mode() === 'gh') {
      const args = ['pr', 'create', '--repo', slug, '--head', req.head, '--base', req.base, '--title', req.title, '--body-file', '-']
      if (req.draft) args.push('--draft')
      for (const r of req.reviewers ?? []) if (r.trim()) args.push('--reviewer', r.trim())
      for (const l of req.labels ?? []) if (l.trim()) args.push('--label', l.trim())
      const out = (await this.runGh(args, repo, req.body)).trim()
      const m = /\/pull\/(\d+)/.exec(out)
      const pr = m ? await this.pullRequest(repo, +m[1]) : null
      return pr ?? { number: m ? +m[1] : 0, url: out.split('\n').pop() ?? '', state: 'open', title: req.title, draft: !!req.draft, head: req.head, base: req.base, reviewDecision: 'none', checks: 'none' }
    }
    const created = await this.rest<RestPr>(`/repos/${slug}/pulls`, { method: 'POST', body: { title: req.title, head: req.head, base: req.base, body: req.body, draft: !!req.draft } })
    const reviewers = (req.reviewers ?? []).map((r) => r.trim()).filter(Boolean)
    if (reviewers.length) await this.rest(`/repos/${slug}/pulls/${created.number}/requested_reviewers`, { method: 'POST', body: { reviewers } }).catch(() => undefined)
    const labels = (req.labels ?? []).map((l) => l.trim()).filter(Boolean)
    if (labels.length) await this.rest(`/repos/${slug}/issues/${created.number}/labels`, { method: 'POST', body: { labels } }).catch(() => undefined)
    return this.fromRest(created)
  }
}
