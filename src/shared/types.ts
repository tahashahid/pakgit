export type FileArea = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface FileEntry {
  path: string
  oldPath?: string
  /** git porcelain status code for the index (X) and work tree (Y) */
  index: string
  worktree: string
  area: FileArea
}

export interface RepoStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
  state: 'clean' | 'merging' | 'rebasing' | 'cherry-picking' | 'reverting' | 'bisecting'
  files: FileEntry[]
}

export interface BranchInfo {
  name: string
  fullName: string
  current: boolean
  remote: string | null
  upstream: string | null
  sha: string
  ahead: number
  behind: number
}

export interface TagInfo {
  name: string
  sha: string
}

export interface StashInfo {
  index: number
  ref: string
  message: string
  date: string
}

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface Commit {
  sha: string
  shortSha: string
  parents: string[]
  author: string
  email: string
  date: string
  subject: string
  body: string
  refs: string[]
}

export interface CommitFile {
  path: string
  status: string
  additions: number
  deletions: number
}

export interface CommitDetails extends Commit {
  files: CommitFile[]
}

export interface Refs {
  branches: BranchInfo[]
  tags: TagInfo[]
  stashes: StashInfo[]
  remotes: RemoteInfo[]
}

export interface RepoEntry {
  path: string
  name: string
  lastOpened: number
}

export interface GitLogLine {
  id: number
  ts: number
  cwd: string
  command: string
  stdout: string
  stderr: string
  code: number
  durationMs: number
}

export interface DiffRequest {
  repo: string
  path: string
  area: FileArea
  oldPath?: string
}

export interface CommitOptions {
  message: string
  amend?: boolean
  all?: boolean
  noVerify?: boolean
  signoff?: boolean
  push?: boolean
}

export interface PakGitApi {
  listRepos(): Promise<RepoEntry[]>
  addRepo(path?: string): Promise<RepoEntry | null>
  removeRepo(path: string): Promise<void>
  cloneRepo(url: string, dest: string): Promise<RepoEntry>
  initRepo(path: string): Promise<RepoEntry>
  pickDirectory(title?: string): Promise<string | null>

  status(repo: string): Promise<RepoStatus>
  refs(repo: string): Promise<Refs>
  log(repo: string, opts?: { limit?: number; all?: boolean; skip?: number; path?: string }): Promise<Commit[]>
  commitDetails(repo: string, sha: string): Promise<CommitDetails>
  commitFileDiff(repo: string, sha: string, path: string): Promise<string>
  diff(req: DiffRequest): Promise<string>
  fileAtHead(repo: string, path: string): Promise<string>
  blame(repo: string, path: string): Promise<string>

  stage(repo: string, paths: string[]): Promise<void>
  unstage(repo: string, paths: string[]): Promise<void>
  discard(repo: string, files: { path: string; area: FileArea }[]): Promise<void>
  ignore(repo: string, pattern: string): Promise<void>
  commit(repo: string, opts: CommitOptions): Promise<void>
  undoLastCommit(repo: string): Promise<void>

  fetch(repo: string, remote?: string, prune?: boolean): Promise<void>
  pull(repo: string, mode: 'merge' | 'rebase' | 'ff-only'): Promise<void>
  push(repo: string, opts: { remote?: string; branch?: string; force?: boolean; setUpstream?: boolean; tags?: boolean }): Promise<void>

  checkout(repo: string, ref: string, opts?: { createBranch?: string; track?: boolean }): Promise<void>
  createBranch(repo: string, name: string, startPoint?: string, checkout?: boolean): Promise<void>
  deleteBranch(repo: string, name: string, force?: boolean, remote?: string): Promise<void>
  renameBranch(repo: string, oldName: string, newName: string): Promise<void>
  merge(repo: string, ref: string, opts?: { noFf?: boolean; squash?: boolean }): Promise<void>
  rebase(repo: string, ref: string): Promise<void>
  rebaseAction(repo: string, action: 'continue' | 'abort' | 'skip'): Promise<void>
  mergeAction(repo: string, action: 'continue' | 'abort'): Promise<void>
  cherryPick(repo: string, sha: string): Promise<void>
  revert(repo: string, sha: string): Promise<void>
  reset(repo: string, ref: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>
  createTag(repo: string, name: string, sha?: string, message?: string): Promise<void>
  deleteTag(repo: string, name: string): Promise<void>

  stashSave(repo: string, message?: string, includeUntracked?: boolean): Promise<void>
  stashApply(repo: string, index: number, pop?: boolean): Promise<void>
  stashDrop(repo: string, index: number): Promise<void>

  addRemote(repo: string, name: string, url: string): Promise<void>
  removeRemote(repo: string, name: string): Promise<void>

  openTerminal(repo: string): Promise<void>
  openInEditor(repo: string, path: string): Promise<void>
  revealInFinder(repo: string, path?: string): Promise<void>
  gitVersion(): Promise<string>

  onRepoChanged(cb: (repo: string) => void): () => void
  onGitLog(cb: (line: GitLogLine) => void): () => void
  getGitLog(): Promise<GitLogLine[]>
}
