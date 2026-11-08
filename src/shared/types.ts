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
  /** GitHub CLI executable; empty = auto-detect */
  ghPath: string
}

// ---------- organizations ----------

/** Shareable part of a tracker connection (no secrets). */
export interface TrackerConfig {
  provider: TrackerId
  authMethod: 'oauth' | 'apiKey'
  linearClientId: string
  /** Jira Cloud site, e.g. https://acme.atlassian.net */
  jiraSite: string
  stateOnStart: string
}
/** Per-person part of a connection (tracker or hosting), stored encrypted and never exported. */
export interface TrackerAuth {
  linearApiKey: string
  linearClientSecret: string
  linearAccessToken: string
  linearRefreshToken: string
  linearTokenExpiry: number
  /** GitHub personal access token used when the gh CLI is not signed in */
  githubToken: string
  /** Jira Cloud: the e-mail of the account and its API token */
  jiraEmail: string
  jiraToken: string
  /** Slack incoming webhook URL (a secret: per person, never exported) */
  slackWebhook: string
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
  /** hosting provider (pull-request state and creation); shareable part only */
  hosting: HostingConfig
  /** environment id -> active freeze (promotions into it warn or block) */
  freezes: Record<string, Freeze>
  /** repository identities (remote, else path) in deploy order; unlisted repositories follow by name */
  deployOrder: string[]
  /** shared configuration repository (phase 4); null = export/import by file only */
  configRepo: ConfigRepo | null
  /** saved filter sets shown as chips on the Work and Ready tabs */
  views: SavedView[]
  notifications: NotificationConfig
  /** environment id -> release cadence (shown as a countdown on the Overview) */
  calendar: Record<string, Cadence>
  /** repositories of the organization that are not cloned on this machine (from an import or the configuration repository); kept so exports and pushes do not lose them */
  knownRepos: { remote: string; name: string; group: string | null }[]
  howWeWork: string
  createdAt: number
}

// ---------- sharing, views, notifications, calendar (phase 4) ----------

export interface ConfigRepo {
  url: string
  /** branch to read and write; empty = the remote default */
  branch: string
  /** file inside the repository, e.g. pakgit/acme.pakgit-org.json */
  file: string
  /** commit of the file last applied here (so a change is reported once) */
  lastApplied: string
}
export interface ConfigChange { path: string; kind: 'added' | 'removed' | 'changed'; from?: string; to?: string }
export interface ConfigSyncState {
  configured: boolean
  /** commit of the remote file, null when it does not exist yet */
  remote: string | null
  changed: boolean
  changes: ConfigChange[]
  /** the local configuration differs from the remote file (push would change it) */
  localChanges: ConfigChange[]
  error?: string
  fetchedAt: number
}
export interface SavedView { id: string; name: string; tab: 'work' | 'ready'; filters: Record<string, string | number | boolean> }
export interface NotificationConfig { slack: { enabled: boolean; created: boolean; merged: boolean; finished: boolean; reverted: boolean } }
export interface Cadence { /** 1 = Monday … 7 = Sunday */ weekday: number; /** HH:MM local time */ time: string }
export interface NextRelease { envId: string; envName: string; at: number; inHours: number }

// ---------- branch cleanup and reverts (phase 4) ----------

export interface MergedBranch { repo: string; repoName: string; name: string; ref: string; sha: string; date: string; kind: 'work' | 'release' | 'sync' | 'other'; local: boolean }
export interface CleanupResult { deleted: { repo: string; name: string }[]; failed: { repo: string; name: string; error: string }[] }
export interface RevertResult { release: ReleaseRecord; repos: { repo: string; branch: string | null; pr: PullRequestStatus | null; prUrl: string | null; reverted: string[]; error: string | null }[] }

// ---------- hosting (phase 3): pull-request state and creation ----------

export type HostingId = 'none' | 'github'
export interface HostingConfig {
  /** auto = GitHub when the remote is on github.com and gh or a token is available */
  provider: 'auto' | 'github' | 'none'
  /** pull-request body template; tokens {name}, {env}, {items}, {repo} */
  prTemplate: string
  reviewers: string[]
  labels: string[]
  draft: boolean
  /** attach the pull request to the Linear issue when PakGit opens one */
  attachPrsToIssues: boolean
}
export interface HostingStatus { provider: HostingId; available: boolean; account?: string; via?: 'gh' | 'token'; error?: string }
export interface PullRequestStatus {
  number: number
  url: string
  state: 'open' | 'merged' | 'closed'
  title: string
  draft: boolean
  head: string
  base: string
  headSha?: string
  mergeable?: 'mergeable' | 'conflicting' | 'unknown'
  reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'none'
  checks: 'success' | 'failure' | 'pending' | 'none'
  mergedAt?: string | null
  updatedAt?: string
}

// ---------- gates, freeze, probes (phase 3) ----------

export type GateId = 'tracker-state' | 'partly-promoted' | 'dev-based' | 'frozen' | 'previous-env'
export type GateMode = 'off' | 'warn' | 'block'
export interface GateConfig { id: GateId; mode: GateMode; /** tracker-state: allowed state names; empty = any */ states?: string[] }
export interface GateResult { id: GateId; label: string; mode: GateMode; ok: boolean; message: string; details: string[] }
export interface GateCheck { results: GateResult[]; blocked: GateId[]; warnings: GateId[] }
export interface Freeze { note: string; /** yyyy-mm-dd, lifts automatically after that day; null = until lifted by hand */ until: string | null }
export interface Probe { type: 'http-json' | 'http-text' | 'git-tag'; url?: string; /** http-json: dot path to the commit/version field */ path?: string; /** http-text: regular expression, first capture group */ regex?: string; /** git-tag: glob of tags that mark deployments, e.g. deployed/stage-* */ tagPattern?: string }
export interface ProbeResult { envId: string; status: 'same' | 'behind' | 'ahead' | 'unknown' | 'none'; deployed?: string; behind?: number; ahead?: number; error?: string; at: number }

// ---------- releases (phase 3): one object per cross-repository release ----------

export interface PromoteInput { id: string; ref: string | null; commits: string[] }
export interface ReleaseSelection { repo: string; itemId: string; issueKey: string | null; title?: string; ref: string | null; commits: string[] }
export interface ReleaseItemRef { id: string; issueKey: string | null; title?: string; url?: string; repos: string[] }
export interface ReleaseRepo {
  path: string
  remote: string | null
  name: string
  branch: string
  base: string
  items: string[]
  /** what was asked for, kept so an errored repository can be retried */
  inputs: PromoteInput[]
  merged: string[]
  skipped: string[]
  /** stopped on a conflict; remaining items are merged on Resume */
  paused: { conflict: string; remaining: PromoteInput[] } | null
  dropped: string | null
  pr: PullRequestStatus | null
  /** compare page opened in the browser when no hosting provider is connected */
  prUrl: string | null
  /** the release branch is contained in the environment branch */
  onEnv: boolean
  error: string | null
  /** a revert branch was created for this repository (phase 4) */
  revert?: { branch: string; commits: string[]; pr: PullRequestStatus | null; prUrl: string | null; at: number } | null
}
export interface ReleaseRecord {
  id: string
  name: string
  envId: string
  envName: string
  envBranch: string
  createdAt: number
  createdBy: string
  items: ReleaseItemRef[]
  repos: ReleaseRepo[]
  gates: GateResult[]
  overridden: GateId[]
  status: 'in-progress' | 'finished' | 'dropped' | 'reverted'
  finishedAt: number | null
  notes: string
  options: { push: boolean; openPr: boolean; draft: boolean }
}
export interface CreateReleaseRequest { envId: string; name: string; selection: ReleaseSelection[]; options: { push: boolean; openPr: boolean; draft: boolean; updateTracker: boolean }; overrides: GateId[] }
export interface FinishReleaseResult { release: ReleaseRecord; results: { repo: string; result: PromoteResult }[] }
export interface OrganizationSummary { id: string; name: string; color: string; repoCount: number }
export interface WorkspaceState { version: number; active: string; organizations: OrganizationSummary[] }
/** repositories sharing a hosting owner, proposed as an organization */
export interface OwnerProposal { host: string; owner: string; repos: RepoEntry[] }
export interface OrgExport {
  version: 1
  /** everything shareable; repositories not cloned locally are listed under repositories, not here */
  organization: Omit<Organization, 'id' | 'createdAt' | 'knownRepos'>
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
  /** environment id -> how to read the deployed version of this repository there */
  probes?: Record<string, Probe>
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
  /** issues with a part in this repository that sit on different environments across the organization */
  partlyPromoted?: number
  fromCache?: boolean
  /** deployed-version probe results (only environments with a probe) */
  deployed?: ProbeResult[]
}
export interface OrgOverview {
  org: OrganizationSummary
  /** active freezes by environment id */
  freezes: Record<string, Freeze>
  repos: RepoOverviewCard[]
  totals: { ready: { id: string; name: string; count: number }[]; unreleased: number; warnings: number; partlyPromoted: number }
  generatedAt: number
}

// ---------- work-item index (phase 2): one issue, its parts in every repository ----------

/** One repository's share of an issue: the work item the release analysis found there. */
export interface WorkPart {
  repo: string
  repoName: string
  group: string | null
  /** id of the ReleaseItem inside the repository (issue key or normalised branch name) */
  itemId: string
  issueKey: string | null
  name: string
  branch: string | null
  ref: string | null
  branchCount: number
  /** the repository's environment ids, in pipeline order */
  envIds: string[]
  inEnv: Record<string, boolean>
  /** id of the most stable environment that contains the work, null when nowhere */
  highest: string | null
  archived: boolean
  basedOnEnv: boolean
  needsCherryPick: boolean
  own: number | null
  lastActivity: string
  overrides: Record<string, boolean>
  commits: string[]
  linkedBy: 'branch' | 'commits' | 'manual'
}
export interface WorkItem {
  /** issue key, or "<repo path>::<item id>" for work without a key */
  id: string
  issueKey: string | null
  name: string
  issue?: TrackerIssue
  parts: WorkPart[]
  /** parts sit on different environments */
  partlyPromoted: boolean
  lastActivity: string
}
export interface IndexRepo {
  path: string
  name: string
  group: string | null
  remote: string | null
  environments: { id: string; name: string; branch: string }[]
  error?: string
  fromCache?: boolean
}
export interface IndexBranch { repo: string; repoName: string; name: string; ref: string; sha: string | null; kind: 'env' | 'release' | 'work' }
export interface WorkIndex {
  org: OrganizationSummary
  repos: IndexRepo[]
  /** union of the repositories' environments in pipeline order (the organization template when there is one); branch = the template's, else the first repository's */
  environments: { id: string; name: string; branch: string }[]
  items: WorkItem[]
  branches: IndexBranch[]
  generatedAt: number
}
export interface StartWorkRequest { key: string | null; branch: string; repos: string[] }
export interface StartWorkResult { created: string[]; failed: { repo: string; error: string }[] }
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
  orgOverview(id: string, opts?: { refresh?: boolean }): Promise<OrgOverview>
  orgTrackerStatus(id: string): Promise<OrgTrackerStatus>
  orgTrackerSetSecrets(id: string, secrets: { linearApiKey?: string; linearClientSecret?: string }): Promise<void>
  orgTrackerLogin(id: string): Promise<OAuthResult>
  orgTrackerLogout(id: string): Promise<void>
  repoPipeline(repo: string): Promise<RepoPipeline>
  saveRepoPipeline(repo: string, override: RepoPipelineOverride): Promise<EnvConfig>
  /** the cross-repository work-item index; refresh bypasses the analysis cache */
  orgIndex(id: string, opts?: { refresh?: boolean }): Promise<WorkIndex>
  /** create the issue branch in several repositories of the organization */
  orgStartWork(id: string, req: StartWorkRequest): Promise<StartWorkResult>
  /** branch name for an issue from the organization's convention (or the tracker's suggestion) */
  orgSuggestBranch(id: string, issue: { key: string; title: string; branchName?: string }): Promise<string>
  // phase 3: hosting, gates, releases, freeze, probes
  orgHostingStatus(id: string): Promise<HostingStatus>
  orgHostingSetToken(id: string, token: string): Promise<void>
  orgEvaluateGates(id: string, envId: string, selection: ReleaseSelection[]): Promise<GateCheck>
  orgReleases(id: string): Promise<ReleaseRecord[]>
  orgCreateRelease(id: string, req: CreateReleaseRequest): Promise<ReleaseRecord>
  /** continue a paused repository (after the conflict was resolved and committed); skipRemaining pushes and opens the PR without the rest */
  orgResumeRelease(id: string, releaseId: string, repo: string, opts: { skipRemaining: boolean }): Promise<ReleaseRecord>
  orgDropReleaseRepo(id: string, releaseId: string, repo: string, reason: string): Promise<ReleaseRecord>
  /** re-read pull-request state and whether each branch landed in the environment */
  orgRefreshRelease(id: string, releaseId: string): Promise<ReleaseRecord>
  orgFinishRelease(id: string, releaseId: string, opts: { push: boolean; updateTracker: boolean }): Promise<FinishReleaseResult>
  orgDropRelease(id: string, releaseId: string, reason: string): Promise<ReleaseRecord>
  orgReleaseNotes(id: string, releaseId: string): Promise<string>
  orgSetFreeze(id: string, envId: string, freeze: Freeze | null): Promise<Organization>
  /** deployed-version probes for one repository (or every repository of the organization) */
  orgProbe(id: string, repo?: string): Promise<Record<string, ProbeResult[]>>
  /** pull requests of a repository from the hosting provider (cached), newest first */
  hostingPullRequests(repo: string, fresh?: boolean): Promise<PullRequestStatus[]>
  // phase 4: sharing, notifications, revert, cleanup, calendar
  /** fetch the configuration repository and compare its file with this organization */
  orgConfigSync(id: string, fresh?: boolean): Promise<ConfigSyncState>
  /** apply the remote file to this organization */
  orgConfigApply(id: string): Promise<ImportResult>
  /** write this organization to the configuration repository and push */
  orgConfigPush(id: string, message: string): Promise<ConfigSyncState>
  orgSetSecret(id: string, secrets: { slackWebhook?: string; jiraEmail?: string; jiraToken?: string }): Promise<void>
  orgSecretsStatus(id: string): Promise<{ slackWebhook: boolean; jiraToken: boolean; jiraEmail: string }>
  orgTestSlack(id: string): Promise<void>
  orgRevertRelease(id: string, releaseId: string, opts: { push: boolean; openPr: boolean }): Promise<RevertResult>
  orgMergedBranches(id: string): Promise<MergedBranch[]>
  orgDeleteBranches(id: string, branches: { repo: string; name: string }[]): Promise<CleanupResult>
  orgNextReleases(id: string): Promise<NextRelease[]>
}

/** In-app updater state (GitHub Releases through electron-updater). */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error' | 'unsupported'
  /** the running version */
  version: string
  /** the newer version found, when any */
  available?: string
  percent?: number
  error?: string
  checkedAt?: number
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

  /** in-app updates */
  updateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  openReleases(): Promise<void>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
}

// ---------- issue trackers (Linear first; Jira / GitHub Issues can implement the same shape) ----------

export type TrackerId = 'none' | 'linear' | 'jira'

export interface TrackerIssue {
  key: string
  title: string
  status: string
  /** generic bucket so the UI can colour statuses without knowing the tracker */
  statusType: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'unknown'
  url: string
  assignee?: string
  /** the signed-in person is the assignee */
  assigneeIsMe?: boolean
  /** branch name suggested by the tracker (Linear "copy git branch name") */
  branchName?: string
  /** team key, e.g. CYB4 */
  team?: string
  updatedAt?: string
  priority?: number
  /** attachment URLs (pull requests attached through the hosting integration) */
  links?: string[]
}

export interface TrackerTeam { key: string; name: string }
/** Filters for the Work tab; every field is optional (empty = no filter). */
export interface IssueQuery {
  teams?: string[]
  /** state names, e.g. ["In Progress", "QA"] */
  states?: string[]
  stateTypes?: TrackerIssue['statusType'][]
  assignee?: 'me' | 'anyone' | 'unassigned'
  updatedWithinDays?: number
  activeCycle?: boolean
  first?: number
  after?: string
}
export interface IssuePage { issues: TrackerIssue[]; nextCursor: string | null }

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
  /** Jira Cloud site and this person's credentials */
  jiraSite: string
  jiraEmail: string
  jiraToken: string
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
  /** tracker state to set when a pull request into this environment is opened; empty = do not update */
  trackerStateOnPr?: string
  /** pre-flight checks for promotions into this environment; missing = defaults (see gatesFor) */
  gates?: GateConfig[]
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
  /** ids of branch items that were linked to this issue by hand (Link to issue…) */
  linkedFrom: string[]
}

export interface BranchTarget { name: string; existing: boolean }
export interface PrepareOptions { push: boolean; openPr: boolean }
/** a promotion that stopped on a conflict and can be continued once the merge is committed */
export interface PendingPromotion { envId: string; branch: string; remaining: PromoteInput[]; options: PrepareOptions }

export interface ReleaseAnalysis {
  config: EnvConfig
  /** environment id -> resolved git ref (remote-tracking when available), null when the branch does not exist */
  refs: Record<string, string | null>
  items: ReleaseItem[]
  releaseBranches: ReleaseBranchRef[]
  currentBranch: string | null
  rerere: boolean
  /** served from the tip-keyed analysis cache */
  fromCache?: boolean
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
  /** refresh bypasses the tip-keyed analysis cache and re-fetches tracker data */
  releaseAnalyze(repo: string, opts?: { refresh?: boolean }): Promise<ReleaseAnalysis>
  /** merge feature branches (or cherry-pick their commits) into an environment's branch */
  promote(repo: string, envId: string, items: { id: string; ref: string | null; commits: string[] }[], push: boolean): Promise<PromoteResult>
  /** create a release branch cut from the environment's branch containing the given items, push it and open a pull request */
  startRelease(repo: string, envId: string, name: string, items: { id: string; ref: string | null; commits: string[] }[], push: boolean): Promise<PromoteResult>
  /** merge the items into one branch (new from the environment, or existing), optionally push and open the PR; stops at the first conflict */
  prepareBranch(repo: string, envId: string, target: BranchTarget, items: { id: string; ref: string | null; commits: string[] }[], options: PrepareOptions): Promise<PromoteResult & { remaining?: { id: string; ref: string | null; commits: string[] }[] }>
  setArchived(repo: string, ids: string[], archived: boolean): Promise<void>
  setOverrides(repo: string, id: string, overrides: Record<string, boolean> | null): Promise<void>
  /** link a branch item that carries no issue key to an issue (null removes the link) */
  setLink(repo: string, itemId: string, issueKey: string | null): Promise<void>
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
  trackerListIssues(q: IssueQuery): Promise<IssuePage>
  trackerTeams(): Promise<TrackerTeam[]>
  trackerAssignToMe(key: string): Promise<void>
}
