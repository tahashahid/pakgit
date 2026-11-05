import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type {
  BranchInfo, Commit, CommitDetails, CommitFile, FileArea, FileEntry, GitLogLine,
  RemoteInfo, RepoStatus, Refs, StashInfo, TagInfo
} from '@shared/types'

export type LogSink = (line: GitLogLine) => void

let logSink: LogSink | null = null
let logId = 0
const logHistory: GitLogLine[] = []
export function setLogSink(sink: LogSink): void { logSink = sink }
export function getLogHistory(): GitLogLine[] { return logHistory }

export class GitError extends Error {
  constructor(message: string, public readonly code: number, public readonly stderr: string) {
    super(message)
  }
}

export interface RunOptions {
  cwd: string
  input?: string
  /** do not throw on non-zero exit */
  allowFail?: boolean
  env?: Record<string, string>
}

const baseEnv: Record<string, string> = {
  ...process.env as Record<string, string>,
  GIT_TERMINAL_PROMPT: '0',
  LC_ALL: 'C',
  GIT_OPTIONAL_LOCKS: '0'
}

export function gitExecutable(): string {
  if (process.env.PAKGIT_GIT) return process.env.PAKGIT_GIT
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
      join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Git', 'cmd', 'git.exe')
    ]
    for (const c of candidates) if (existsSync(c)) return c
  }
  return 'git'
}

export function run(args: string[], opts: RunOptions): Promise<{ stdout: string; stderr: string; code: number }> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(gitExecutable(), args, {
      cwd: opts.cwd,
      env: { ...baseEnv, ...(opts.env ?? {}) },
      windowsHide: true
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
    child.on('error', (e) => reject(new GitError(`Failed to start git: ${e.message}`, -1, '')))
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      const line: GitLogLine = {
        id: ++logId, ts: started, cwd: opts.cwd, command: `git ${args.join(' ')}`,
        stdout: stdout.length > 4000 ? stdout.slice(0, 4000) + '\n…' : stdout,
        stderr, code: code ?? -1, durationMs: Date.now() - started
      }
      logHistory.push(line)
      if (logHistory.length > 500) logHistory.shift()
      logSink?.(line)
      if (code !== 0 && !opts.allowFail) {
        reject(new GitError((stderr || stdout).trim() || `git ${args[0]} failed (${code})`, code ?? -1, stderr))
      } else resolve({ stdout, stderr, code: code ?? -1 })
    })
  })
}

const git = (cwd: string, ...args: string[]) => run(args, { cwd })

export async function version(): Promise<string> {
  const { stdout } = await run(['--version'], { cwd: process.cwd() })
  return stdout.trim()
}

export async function isRepo(path: string): Promise<boolean> {
  const r = await run(['rev-parse', '--is-inside-work-tree'], { cwd: path, allowFail: true })
  return r.code === 0 && r.stdout.trim() === 'true'
}

export async function topLevel(path: string): Promise<string> {
  const { stdout } = await git(path, 'rev-parse', '--show-toplevel')
  return stdout.trim()
}

export async function gitDir(path: string): Promise<string> {
  const { stdout } = await git(path, 'rev-parse', '--absolute-git-dir')
  return stdout.trim()
}

// ---------- status ----------

function areaOf(x: string, y: string): FileArea[] {
  if (x === '?' && y === '?') return ['untracked']
  const conflict = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
  if (conflict) return ['conflicted']
  const areas: FileArea[] = []
  if (x !== ' ' && x !== '.') areas.push('staged')
  if (y !== ' ' && y !== '.') areas.push('unstaged')
  return areas
}

export async function status(repo: string): Promise<RepoStatus> {
  const { stdout } = await git(repo, 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all')
  const parts = stdout.split('\0')
  const result: RepoStatus = {
    branch: null, upstream: null, ahead: 0, behind: 0, detached: false, state: 'clean', files: []
  }
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]
    if (!line) continue
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      result.detached = head === '(detached)'
      result.branch = result.detached ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      result.upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) { result.ahead = +m[1]; result.behind = +m[2] }
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const fields = line.split(' ')
      const xy = fields[1]
      const x = xy[0], y = xy[1]
      let path: string
      let oldPath: string | undefined
      if (line.startsWith('2 ')) {
        // rename: "2 XY sub mH mI mW hH hI Xscore path\0origPath"
        path = fields.slice(9).join(' ')
        oldPath = parts[++i]
      } else if (line.startsWith('u ')) {
        path = fields.slice(10).join(' ')
      } else {
        path = fields.slice(8).join(' ')
      }
      for (const area of areaOf(x, y)) result.files.push({ path, oldPath, index: x, worktree: y, area })
    } else if (line.startsWith('? ')) {
      result.files.push({ path: line.slice(2), index: '?', worktree: '?', area: 'untracked' })
    }
  }
  const dir = await gitDir(repo)
  if (existsSync(join(dir, 'MERGE_HEAD'))) result.state = 'merging'
  else if (existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply'))) result.state = 'rebasing'
  else if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) result.state = 'cherry-picking'
  else if (existsSync(join(dir, 'REVERT_HEAD'))) result.state = 'reverting'
  else if (existsSync(join(dir, 'BISECT_LOG'))) result.state = 'bisecting'
  result.files.sort((a, b) => a.path.localeCompare(b.path))
  return result
}

// ---------- refs ----------

export async function refs(repo: string): Promise<Refs> {
  const fmt = '%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)'
  const { stdout } = await git(repo, 'for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes', 'refs/tags')
  const branches: BranchInfo[] = []
  const tags: TagInfo[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const [refname, short, sha, head, upstream, track] = line.split('\0')
    if (refname.startsWith('refs/tags/')) { tags.push({ name: short, sha }); continue }
    if (refname.endsWith('/HEAD')) continue
    const isRemote = refname.startsWith('refs/remotes/')
    const remote = isRemote ? short.split('/')[0] : null
    const ahead = +(/ahead (\d+)/.exec(track ?? '')?.[1] ?? 0)
    const behind = +(/behind (\d+)/.exec(track ?? '')?.[1] ?? 0)
    branches.push({
      name: isRemote ? short.slice(remote!.length + 1) : short,
      fullName: short, current: head === '*', remote, upstream: upstream || null, sha, ahead, behind
    })
  }
  const stashOut = await run(['stash', 'list', '--format=%gd%x00%gs%x00%ci'], { cwd: repo, allowFail: true })
  const stashes: StashInfo[] = []
  stashOut.stdout.split('\n').filter(Boolean).forEach((l, i) => {
    const [ref, message, date] = l.split('\0')
    stashes.push({ index: i, ref, message, date })
  })
  const remoteOut = await git(repo, 'remote', '-v')
  const remoteMap = new Map<string, RemoteInfo>()
  for (const l of remoteOut.stdout.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(l)
    if (!m) continue
    const r = remoteMap.get(m[1]) ?? { name: m[1], fetchUrl: '', pushUrl: '' }
    if (m[3] === 'fetch') r.fetchUrl = m[2]; else r.pushUrl = m[2]
    remoteMap.set(m[1], r)
  }
  return { branches, tags, stashes, remotes: [...remoteMap.values()] }
}

// ---------- log ----------

const LOG_FORMAT = '%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D%x01'

function parseLog(stdout: string): Commit[] {
  return stdout.split('\x01').filter((c) => c.trim()).map((chunk) => {
    const [sha, shortSha, parents, author, email, date, subject, body, refs] = chunk.replace(/^\n/, '').split('\0')
    return {
      sha, shortSha, parents: parents ? parents.split(' ') : [], author, email, date, subject,
      body: (body ?? '').trim(),
      refs: refs ? refs.split(', ').map((r) => r.replace('HEAD -> ', '')).filter(Boolean) : []
    }
  })
}

export async function log(repo: string, opts: { limit?: number; all?: boolean; skip?: number; path?: string } = {}): Promise<Commit[]> {
  const args = ['log', `--format=${LOG_FORMAT}`, `-n${opts.limit ?? 500}`, '--date-order']
  if (opts.skip) args.push(`--skip=${opts.skip}`)
  if (opts.all !== false) args.push('--all')
  if (opts.path) args.push('--', opts.path)
  const r = await run(args, { cwd: repo, allowFail: true })
  if (r.code !== 0) return [] // empty repository
  return parseLog(r.stdout)
}

export async function commitDetails(repo: string, sha: string): Promise<CommitDetails> {
  const head = await git(repo, 'log', '-1', `--format=${LOG_FORMAT}`, sha)
  const commit = parseLog(head.stdout)[0]
  const stat = await git(repo, 'show', '--numstat', '--format=', '-M', sha)
  const names = await git(repo, 'show', '--name-status', '--format=', '-M', sha)
  const statusByPath = new Map<string, string>()
  for (const l of names.stdout.split('\n')) {
    const f = l.split('\t')
    if (f.length < 2) continue
    statusByPath.set(f[f.length - 1], f[0][0])
  }
  const files: CommitFile[] = []
  for (const l of stat.stdout.split('\n')) {
    const f = l.split('\t')
    if (f.length < 3) continue
    const path = f[2].includes('=>') ? f[2].replace(/^.*\{?(.*) => (.*)\}?.*$/, (_m, _a, b) => b) : f[2]
    files.push({ path: f[2], status: statusByPath.get(path) ?? statusByPath.get(f[2]) ?? 'M', additions: +f[0] || 0, deletions: +f[1] || 0 })
  }
  return { ...commit, files }
}

export async function commitFileDiff(repo: string, sha: string, path: string): Promise<string> {
  const { stdout } = await run(['show', '--format=', '-M', '--patch', sha, '--', path], { cwd: repo })
  return stdout
}

// ---------- diff ----------

export async function diff(repo: string, path: string, area: FileArea, oldPath?: string): Promise<string> {
  const pathArgs = oldPath ? ['--', oldPath, path] : ['--', path]
  if (area === 'untracked') {
    const r = await run(['diff', '--no-index', '--', (process.platform === 'win32' ? 'NUL' : '/dev/null'), path], { cwd: repo, allowFail: true })
    return r.stdout
  }
  if (area === 'staged') return (await git(repo, 'diff', '--cached', '-M', ...pathArgs)).stdout
  return (await git(repo, 'diff', '-M', ...pathArgs)).stdout
}

export async function fileAtHead(repo: string, path: string): Promise<string> {
  const r = await run(['show', `HEAD:${path}`], { cwd: repo, allowFail: true })
  return r.stdout
}

export async function blame(repo: string, path: string): Promise<string> {
  return (await git(repo, 'blame', '--date=short', '--', path)).stdout
}

// ---------- working tree ----------

export async function stage(repo: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await git(repo, 'add', '-A', '--', ...paths)
}
export async function unstage(repo: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  const hasHead = (await run(['rev-parse', '--verify', 'HEAD'], { cwd: repo, allowFail: true })).code === 0
  if (hasHead) await git(repo, 'reset', '-q', 'HEAD', '--', ...paths)
  else await git(repo, 'rm', '--cached', '-r', '-q', '--', ...paths)
}
export async function discard(repo: string, files: { path: string; area: FileArea }[]): Promise<void> {
  const untracked = files.filter((f) => f.area === 'untracked').map((f) => f.path)
  const tracked = files.filter((f) => f.area !== 'untracked').map((f) => f.path)
  if (tracked.length) {
    await git(repo, 'reset', '-q', '--', ...tracked).catch(() => undefined)
    await git(repo, 'checkout', '--', ...tracked)
  }
  if (untracked.length) await git(repo, 'clean', '-f', '-d', '--', ...untracked)
}
export async function ignore(repo: string, pattern: string): Promise<void> {
  const { appendFileSync, readFileSync } = await import('fs')
  const file = join(repo, '.gitignore')
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const nl = existing.length && !existing.endsWith('\n') ? '\n' : ''
  appendFileSync(file, `${nl}${pattern}\n`)
}

export async function commit(repo: string, o: { message: string; amend?: boolean; all?: boolean; noVerify?: boolean; signoff?: boolean }): Promise<void> {
  const args = ['commit', '-F', '-']
  if (o.amend) args.push('--amend')
  if (o.all) args.push('-a')
  if (o.noVerify) args.push('--no-verify')
  if (o.signoff) args.push('--signoff')
  await run(args, { cwd: repo, input: o.message })
}
export async function undoLastCommit(repo: string): Promise<void> {
  await git(repo, 'reset', '--soft', 'HEAD~1')
}

// ---------- remotes ----------

export async function fetch(repo: string, remote?: string, prune = true): Promise<void> {
  const args = ['fetch', '--tags']
  if (prune) args.push('--prune')
  if (remote) args.push(remote); else args.push('--all')
  await git(repo, ...args)
}
export async function pull(repo: string, mode: 'merge' | 'rebase' | 'ff-only'): Promise<void> {
  const flag = mode === 'rebase' ? '--rebase' : mode === 'ff-only' ? '--ff-only' : '--no-rebase'
  await git(repo, 'pull', flag)
}
export async function push(repo: string, o: { remote?: string; branch?: string; force?: boolean; setUpstream?: boolean; tags?: boolean }): Promise<void> {
  const args = ['push']
  if (o.force) args.push('--force-with-lease')
  if (o.setUpstream) args.push('--set-upstream')
  if (o.tags) args.push('--tags')
  if (o.remote) args.push(o.remote)
  if (o.branch) args.push(o.branch)
  await git(repo, ...args)
}
export async function addRemote(repo: string, name: string, url: string): Promise<void> { await git(repo, 'remote', 'add', name, url) }
export async function removeRemote(repo: string, name: string): Promise<void> { await git(repo, 'remote', 'remove', name) }

// ---------- branches / history ----------

export async function checkout(repo: string, ref: string, o: { createBranch?: string; track?: boolean } = {}): Promise<void> {
  if (o.createBranch) {
    const args = ['checkout', '-b', o.createBranch]
    if (o.track) args.push('--track')
    args.push(ref)
    await git(repo, ...args)
  } else await git(repo, 'checkout', ref)
}
export async function createBranch(repo: string, name: string, startPoint?: string, doCheckout?: boolean): Promise<void> {
  if (doCheckout) await git(repo, 'checkout', '-b', name, ...(startPoint ? [startPoint] : []))
  else await git(repo, 'branch', name, ...(startPoint ? [startPoint] : []))
}
export async function deleteBranch(repo: string, name: string, force?: boolean, remote?: string): Promise<void> {
  if (remote) await git(repo, 'push', remote, '--delete', name)
  else await git(repo, 'branch', force ? '-D' : '-d', name)
}
export async function renameBranch(repo: string, oldName: string, newName: string): Promise<void> { await git(repo, 'branch', '-m', oldName, newName) }
export async function merge(repo: string, ref: string, o: { noFf?: boolean; squash?: boolean } = {}): Promise<void> {
  const args = ['merge']
  if (o.noFf) args.push('--no-ff')
  if (o.squash) args.push('--squash')
  args.push(ref)
  await git(repo, ...args)
}
export async function rebase(repo: string, ref: string): Promise<void> { await git(repo, 'rebase', ref) }
export async function rebaseAction(repo: string, action: 'continue' | 'abort' | 'skip'): Promise<void> {
  await run(['rebase', `--${action}`], { cwd: repo, env: { GIT_EDITOR: 'true' } })
}
export async function mergeAction(repo: string, action: 'continue' | 'abort'): Promise<void> {
  await run(['merge', `--${action}`], { cwd: repo, env: { GIT_EDITOR: 'true' } })
}
export async function cherryPick(repo: string, sha: string): Promise<void> { await git(repo, 'cherry-pick', sha) }
export async function revert(repo: string, sha: string): Promise<void> { await run(['revert', '--no-edit', sha], { cwd: repo }) }
export async function reset(repo: string, ref: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> { await git(repo, 'reset', `--${mode}`, ref) }
export async function createTag(repo: string, name: string, sha?: string, message?: string): Promise<void> {
  const args = ['tag']
  if (message) args.push('-a', name, '-m', message); else args.push(name)
  if (sha) args.push(sha)
  await git(repo, ...args)
}
export async function deleteTag(repo: string, name: string): Promise<void> { await git(repo, 'tag', '-d', name) }

// ---------- stash ----------

export async function stashSave(repo: string, message?: string, includeUntracked?: boolean): Promise<void> {
  const args = ['stash', 'push']
  if (includeUntracked) args.push('--include-untracked')
  if (message) args.push('-m', message)
  await git(repo, ...args)
}
export async function stashApply(repo: string, index: number, pop?: boolean): Promise<void> {
  await git(repo, 'stash', pop ? 'pop' : 'apply', `stash@{${index}}`)
}
export async function stashDrop(repo: string, index: number): Promise<void> { await git(repo, 'stash', 'drop', `stash@{${index}}`) }

// ---------- repositories ----------

export async function clone(url: string, dest: string): Promise<void> {
  await run(['clone', '--progress', url, dest], { cwd: process.cwd() })
}
export async function init(path: string): Promise<void> {
  await run(['init', '-b', 'main', path], { cwd: process.cwd() })
}
