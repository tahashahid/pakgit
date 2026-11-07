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
  /** optional repository group (see listGroups) */
  group?: string | null
  /** normalised remote identity, e.g. github.com/project-cybernut/admin-portal-v2; null when the repository has no remote */
  remote?: string | null
  /** organization id the repository belongs to (filled by the main process) */
  org?: string
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

export interface RebaseTodoEntry { action: 'pick' | 'squash' | 'fixup' | 'drop' | 'reword'; sha: string; subject: string }
export interface BlameLine { sha: string; author: string; date: string; line: number; text: string; summary: string }
export interface Settings {
  gitPath: string
  pullMode: 'merge' | 'rebase' | 'ff-only'
  autoFetchMinutes: number
  logLimit: number
  confirmDiscard: boolean
}

// ---------- organizations ----------

/** Shareable part of a tracker connection (no secrets). */
export interface TrackerConfig {
  provider: TrackerId
  authMethod: 'oauth' | 'apiKey'
  linearClientId: string
  stateOnStart: string
}
/** Per-person part of a tracker connection, stored encrypted and never exported. */
export interface TrackerAuth {
  linearApiKey: string
  linearClientSecret: string
  linearAccessToken: string
  linearRefreshToken: string
  linearTokenExpiry: number
}
export interface Conventions {
  /** branch name for "Start work": {user}, {key}, {slug} */
  branchPattern: string
  /** release branch name: {env}, {week}, {date}, {name}, {seq} */
  releasePattern: string
}
export interface Organization {
  id: string
  name: string
  color: string
  groups: string[]
  /** pipeline template inherited by the organization's repositories; null = each repository detects its own */
  pipeline: EnvConfig | null
  conventions: Conventions
  tracker: TrackerConfig
  howWeWork: string
  createdAt: number
}
export interface OrganizationSummary { id: string; name: string; color: string; repoCount: number }
export interface WorkspaceState { version: number; active: string; organizations: OrganizationSummary[] }
/** repositories sharing a hosting owner, proposed as an organization */
export interface OwnerProposal { host: string; owner: string; repos: RepoEntry[] }
export interface OrgExport {
  version: 1
  organization: Omit<Organization, 'id' | 'createdAt'>
  repositories: { remote: string; name: string; group: string | null }[]
}
export interface ImportResult { org: OrganizationSummary; matched: RepoEntry[]; missing: { remote: string; name: string; group: string | null }[] }
/** how a repository relates to its organization's pipeline template */
export interface RepoPipelineOverride {
  mode: 'org' | 'custom'
  branchMap?: Record<string, string>
  disabled?: string[]
  strategyMap?: Record<string, Environment['strategy']>
  custom?: EnvConfig
}
export interface RepoPipeline { override: RepoPipelineOverride; template: EnvConfig | null; resolved: EnvConfig }
export interface RepoOverviewCard {
  repo: RepoEntry
  error?: string
  branch?: string | null
  detached?: boolean
  changed?: number
  ahead?: number
  behind?: number
  state?: string
  lastFetch?: number | null
  environments?: { id: string; name: string; branch: string; ready: number; missing: boolean }[]
  drift?: { from: string; to: string; commits: number } | null
  devBased?: number
  staleReleaseBranches?: string[]
  unreleased?: number
}
export interface OrgOverview {
  org: OrganizationSummary
  repos: RepoOverviewCard[]
  totals: { ready: { id: string; name: string; count: number }[]; unreleased: number; warnings: number }
  generatedAt: number
}
export interface OrgTrackerStatus extends TrackerStatus { hasApiKey: boolean; signedIn: boolean }

export interface OrganizationApi {
  workspace(): Promise<WorkspaceState>
  orgGet(id: string): Promise<Organization>
  orgSetActive(id: string): Promise<WorkspaceState>
  orgCreate(input: { name: string; color?: string; repoPaths?: string[]; moveTrackerFrom?: string | null }): Promise<Organization>
  orgUpdate(id: string, patch: Partial<Omit<Organization, 'id' | 'createdAt'>>): Promise<Organization>
  orgDelete(id: string): Promise<WorkspaceState>
  orgMoveRepo(path: string, orgId: string): Promise<void>
  orgProposals(): Promise<OwnerProposal[]>
  /** writes the organization file through a save dialog; returns the path or null */
  orgExport(id: string): Promise<string | null>
  /** reads an organization file through an open dialog */
  orgImport(): Promise<ImportResult | null>
  orgOverview(id: string): Promise<OrgOverview>
  orgTrackerStatus(id: string): Promise<OrgTrackerStatus>
  orgTrackerSetSecrets(id: string, secrets: { linearApiKey?: string; linearClientSecret?: string }): Promise<void>
  orgTrackerLogin(id: string): Promise<OAuthResult>
  orgTrackerLogout(id: string): Promise<void>
  repoPipeline(repo: string): Promise<RepoPipeline>
  saveRepoPipeline(repo: string, override: RepoPipelineOverride): Promise<EnvConfig>
}

export interface SubmoduleInfo { path: string; sha: string; state: 'initialized' | 'uninitialized' | 'modified' | 'conflict'; ref: string }
export interface WorktreeInfo { path: string; sha: string; branch: string | null; main: boolean }

export interface PakGitApi extends ReleaseApi, OrganizationApi {
  listGroups(): Promise<string[]>
  createGroup(name: string): Promise<string[]>
  renameGroup(oldName: string, newName: string): Promise<void>
  deleteGroup(name: string): Promise<void>
  setRepoGroup(path: string, group: string | null): Promise<void>
  submodules(repo: string): Promise<SubmoduleInfo[]>
  submoduleUpdate(repo: string, paths?: string[]): Promise<void>
  worktrees(repo: string): Promise<WorktreeInfo[]>
  worktreeAdd(repo: string, path: string, branch: string, create: boolean): Promise<void>
  worktreeRemove(repo: string, path: string, force?: boolean): Promise<void>
  formatPatch(repo: string, sha: string, dest: string): Promise<void>
  applyPatchFile(repo: string, file: string): Promise<void>
  clean(repo: string, includeIgnored: boolean): Promise<void>
  trash(repo: string, paths: string[]): Promise<void>
  saveFileDialog(title: string, defaultName: string): Promise<string | null>
  openFileDialog(title: string): Promise<string | null>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<Settings>
  applyPatch(repo: string, patch: string, opts: { cached: boolean; reverse?: boolean }): Promise<void>
  resolveConflict(repo: string, path: string, side: 'ours' | 'theirs'): Promise<void>
  markResolved(repo: string, paths: string[]): Promise<void>
  conflictFile(repo: string, path: string): Promise<string>
  rebaseInteractive(repo: string, base: string, todo: RebaseTodoEntry[], rewords?: Record<string, string>): Promise<void>
  blameStructured(repo: string, path: string, rev?: string): Promise<BlameLine[]>
  stashShow(repo: string, index: number): Promise<string>
  setUpstream(repo: string, branch: string, upstream: string): Promise<void>
  emptyCommit(repo: string, message: string): Promise<void>

  listRepos(): Promise<RepoEntry[]>
  addRepo(path?: string): Promise<RepoEntry | null>
  removeRepo(path: string): Promise<void>
  cloneRepo(url: string, dest: string): Promise<RepoEntry>
  initRepo(path: string): Promise<RepoEntry>
  pickDirectory(title?: string): Promise<string | null>

  status(repo: string): Promise<RepoStatus>
  refs(repo: string): Promise<Refs>
  log(repo: string, opts?: { limit?: number; all?: boolean; skip?: number; path?: string; follow?: boolean }): Promise<Commit[]>
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

// ---------- issue trackers (Linear first; Jira / GitHub Issues can implement the same shape) ----------

export type TrackerId = 'none' | 'linear'

export interface TrackerIssue {
  key: string
  title: string
  status: string
  /** generic bucket so the UI can colour statuses without knowing the tracker */
  statusType: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'unknown'
  url: string
  assignee?: string
  /** branch name suggested by the tracker (Linear "copy git branch name") */
  branchName?: string
}

export interface TrackerStatus {
  provider: TrackerId
  configured: boolean
  /** e.g. workspace or user name once authenticated */
  account?: string
  error?: string
}

export interface TrackerSettings {
  provider: TrackerId
  /** 'oauth' = sign in with the browser (recommended), 'apiKey' = personal API key */
  authMethod: 'oauth' | 'apiKey'
  linearApiKey: string
  /** OAuth application (created once in Linear ▸ Settings ▸ API ▸ OAuth applications) */
  linearClientId: string
  /** optional with PKCE; only needed if the OAuth app requires it */
  linearClientSecret: string
  /** tokens are stored encrypted by the main process; the renderer only sees whether they exist */
  linearAccessToken: string
  linearRefreshToken: string
  linearTokenExpiry: number
  /** tracker state to set when starting work on an issue; empty = do not update */
  stateOnStart: string
}

export interface OAuthResult { ok: boolean; account?: string; error?: string }

// ---------- release planning ----------

/** One stage of the delivery pipeline, e.g. dev, staging, production. */
export interface Environment {
  id: string
  name: string
  branch: string
  /**
   * how work reaches this environment:
   * - feature-pr: one pull request per feature branch (feature → environment)
   * - release-branch: picked items are merged into a release branch cut from the environment, then one pull request
   * - merge: direct merge into the environment branch, no pull request
   */
  strategy: 'feature-pr' | 'release-branch' | 'merge'
  /** tracker state to set when work lands here; empty = do not update */
  trackerState: string
}

export interface EnvConfig {
  remote: string
  /** ordered from first (least stable) to last (production) */
  environments: Environment[]
  /** id of the environment new feature branches are cut from (normally the last one) */
  baseEnv: string
  releasePrefix: string
  /** after a release lands in an environment, merge it back into every earlier environment */
  backMerge: boolean
  /** issue-key prefixes to recognise (e.g. CYB4, CYB2); empty = taken from the tracker, else inferred */
  issuePrefixes: string[]
  /** branch prefixes that are never work items (release/sync/bot branches) */
  excludePrefixes: string[]
}

export interface ReleaseBranchRef {
  /** short ref as used with git, e.g. origin/taha/cyb4-1-foo or taha/cyb4-1-foo */
  ref: string
  name: string
  remote: string | null
  sha: string
  date: string
  /** own commits not on prod (first-parent, no merges); only computed for unreleased items */
  own?: number
  /** cut from dev/stage: its first-parent line contains environment merge commits */
  basedOnEnv?: boolean
}

export interface ReleaseItem {
  /** stable id: issue key when known, otherwise the normalised branch name */
  id: string
  issueKey: string | null
  /** branch name without -dev/-stage/-main suffix */
  name: string
  branches: ReleaseBranchRef[]
  /** environment id -> work is contained in that environment's branch */
  inEnv: Record<string, boolean>
  /** the branch's own commits not yet on prod (first-parent, no merges); null when no branch exists */
  commitsAheadOfProd: number | null
  /** the branch was cut from an environment branch (dev/stage) and carries its history */
  basedOnEnv: boolean
  /** true when the work only exists as commits on an env branch (branch deleted): needs cherry-pick */
  needsCherryPick: boolean
  /** commits found on env branches carrying the issue key (used for cherry-pick fallback and details) */
  commits: Commit[]
  lastActivity: string
  issue?: TrackerIssue
  archived: boolean
  /** manual corrections of inEnv (environment id -> true/false), when PakGit cannot see a merge */
  overrides: Record<string, boolean>
}

export interface BranchTarget { name: string; existing: boolean }
export interface PrepareOptions { push: boolean; openPr: boolean }
/** a promotion that stopped on a conflict and can be continued once the merge is committed */
export interface PendingPromotion { envId: string; branch: string; remaining: { id: string; ref: string | null; commits: string[] }[]; options: PrepareOptions }

export interface ReleaseAnalysis {
  config: EnvConfig
  /** environment id -> resolved git ref (remote-tracking when available), null when the branch does not exist */
  refs: Record<string, string | null>
  items: ReleaseItem[]
  releaseBranches: ReleaseBranchRef[]
  currentBranch: string | null
  rerere: boolean
}

export interface PromoteResult {
  merged: string[]
  conflict: string | null
  skipped: string[]
  message: string
  /** branch that was created (release or sync branch) */
  branch?: string
  /** pull-request pages opened or to open */
  prUrls?: string[]
}

export interface PullRequestInfo { url: string; head: string; base: string; title: string; provider: 'github' | 'gitlab' | 'bitbucket' | 'unknown' }

export interface ReleaseApi {
  releaseConfig(repo: string): Promise<EnvConfig>
  detectReleaseConfig(repo: string): Promise<EnvConfig>
  saveReleaseConfig(repo: string, cfg: EnvConfig): Promise<EnvConfig>
  releaseAnalyze(repo: string): Promise<ReleaseAnalysis>
  /** merge feature branches (or cherry-pick their commits) into an environment's branch */
  promote(repo: string, envId: string, items: { id: string; ref: string | null; commits: string[] }[], push: boolean): Promise<PromoteResult>
  /** create a release branch cut from the environment's branch containing the given items, push it and open a pull request */
  startRelease(repo: string, envId: string, name: string, items: { id: string; ref: string | null; commits: string[] }[], push: boolean): Promise<PromoteResult>
  /** merge the items into one branch (new from the environment, or existing), optionally push and open the PR; stops at the first conflict */
  prepareBranch(repo: string, envId: string, target: BranchTarget, items: { id: string; ref: string | null; commits: string[] }[], options: PrepareOptions): Promise<PromoteResult & { remaining?: { id: string; ref: string | null; commits: string[] }[] }>
  setArchived(repo: string, ids: string[], archived: boolean): Promise<void>
  setOverrides(repo: string, id: string, overrides: Record<string, boolean> | null): Promise<void>
  /** open one pull request per feature branch into the environment */
  openFeaturePRs(repo: string, envId: string, items: { id: string; ref: string | null; commits: string[] }[]): Promise<PromoteResult>
  /** compute the hosting provider's pull-request page for head → base (and open it in the browser) */
  openPullRequest(repo: string, head: string, base: string, title: string, body: string): Promise<PullRequestInfo>
  /** merge a release branch into an environment, tag, then back-merge into the earlier environments */
  finishRelease(repo: string, envId: string, releaseBranch: string, tag: string | null, push: boolean): Promise<PromoteResult>
  /** back-merge the last environment into every earlier one */
  syncEnvironments(repo: string, push: boolean): Promise<PromoteResult>
  startIssue(repo: string, key: string, branchName: string): Promise<void>
  enableRerere(repo: string): Promise<void>

  trackerStatus(): Promise<TrackerStatus>
  /** opens the browser for the OAuth login and resolves when the callback arrives */
  trackerLogin(): Promise<OAuthResult>
  trackerLogout(): Promise<void>
  /** the redirect URL that must be registered on the OAuth application */
  trackerRedirectUrl(): Promise<string>
  trackerIssues(keys: string[]): Promise<TrackerIssue[]>
  trackerMyIssues(): Promise<TrackerIssue[]>
  trackerSetState(key: string, stateName: string): Promise<void>
  trackerStates(key: string): Promise<string[]>
}
