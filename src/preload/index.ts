import { contextBridge, ipcRenderer } from 'electron'
import type { PakGitApi, GitLogLine } from '@shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as { ok: boolean; value?: T; error?: string }
  if (!r.ok) throw new Error(r.error ?? 'Unknown error')
  return r.value as T
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (channel: string): any => (...args: unknown[]) => invoke(channel, ...args)

const api: PakGitApi = {
  listRepos: call('repos:list'),
  addRepo: call('repos:add'),
  removeRepo: call('repos:remove'),
  cloneRepo: call('repos:clone'),
  initRepo: call('repos:init'),
  pickDirectory: call('dialog:directory'),
  status: call('git:status'),
  refs: call('git:refs'),
  log: call('git:log'),
  commitDetails: call('git:commitDetails'),
  commitFileDiff: call('git:commitFileDiff'),
  diff: call('git:diff'),
  fileAtHead: call('git:fileAtHead'),
  blame: call('git:blame'),
  stage: call('git:stage'),
  unstage: call('git:unstage'),
  discard: call('git:discard'),
  ignore: call('git:ignore'),
  commit: call('git:commit'),
  undoLastCommit: call('git:undoLastCommit'),
  fetch: call('git:fetch'),
  pull: call('git:pull'),
  push: call('git:push'),
  checkout: call('git:checkout'),
  createBranch: call('git:createBranch'),
  deleteBranch: call('git:deleteBranch'),
  renameBranch: call('git:renameBranch'),
  merge: call('git:merge'),
  rebase: call('git:rebase'),
  rebaseAction: call('git:rebaseAction'),
  mergeAction: call('git:mergeAction'),
  cherryPick: call('git:cherryPick'),
  revert: call('git:revert'),
  reset: call('git:reset'),
  createTag: call('git:createTag'),
  deleteTag: call('git:deleteTag'),
  stashSave: call('git:stashSave'),
  stashApply: call('git:stashApply'),
  stashDrop: call('git:stashDrop'),
  addRemote: call('git:addRemote'),
  removeRemote: call('git:removeRemote'),
  openTerminal: call('os:terminal'),
  openInEditor: call('os:openEditor'),
  revealInFinder: call('os:reveal'),
  gitVersion: call('git:version'),
  workspace: call('org:workspace'),
  orgGet: call('org:get'),
  orgSetActive: call('org:setActive'),
  orgCreate: call('org:create'),
  orgUpdate: call('org:update'),
  orgDelete: call('org:delete'),
  orgMoveRepo: call('org:moveRepo'),
  orgProposals: call('org:proposals'),
  orgExport: call('org:export'),
  orgImport: call('org:import'),
  orgOverview: call('org:overview'),
  orgTrackerStatus: call('org:trackerStatus'),
  orgTrackerSetSecrets: call('org:trackerSetSecrets'),
  orgTrackerLogin: call('org:trackerLogin'),
  orgTrackerLogout: call('org:trackerLogout'),
  repoPipeline: call('release:repoPipeline'),
  saveRepoPipeline: call('release:saveRepoPipeline'),
  releaseConfig: call('release:config'),
  detectReleaseConfig: call('release:detectConfig'),
  saveReleaseConfig: call('release:saveConfig'),
  releaseAnalyze: call('release:analyze'),
  promote: call('release:promote'),
  startRelease: call('release:start'),
  finishRelease: call('release:finish'),
  syncEnvironments: call('release:sync'),
  prepareBranch: call('release:prepareBranch'),
  setArchived: call('release:setArchived'),
  setOverrides: call('release:setOverrides'),
  openFeaturePRs: call('release:openFeaturePRs'),
  openPullRequest: call('release:openPR'),
  startIssue: call('release:startIssue'),
  enableRerere: call('release:enableRerere'),
  trackerStatus: call('tracker:status'),
  trackerLogin: call('tracker:login'),
  trackerLogout: call('tracker:logout'),
  trackerRedirectUrl: call('tracker:redirectUrl'),
  trackerIssues: call('tracker:issues'),
  trackerMyIssues: call('tracker:myIssues'),
  trackerSetState: call('tracker:setState'),
  trackerStates: call('tracker:states'),
  listGroups: call('repos:groups'),
  createGroup: call('repos:createGroup'),
  renameGroup: call('repos:renameGroup'),
  deleteGroup: call('repos:deleteGroup'),
  setRepoGroup: call('repos:setGroup'),
  submodules: call('git:submodules'),
  submoduleUpdate: call('git:submoduleUpdate'),
  worktrees: call('git:worktrees'),
  worktreeAdd: call('git:worktreeAdd'),
  worktreeRemove: call('git:worktreeRemove'),
  formatPatch: call('git:formatPatch'),
  applyPatchFile: call('git:applyPatchFile'),
  clean: call('git:clean'),
  trash: call('os:trash'),
  saveFileDialog: call('dialog:saveFile'),
  openFileDialog: call('dialog:openFile'),
  getSettings: call('settings:get'),
  saveSettings: call('settings:save'),
  applyPatch: call('git:applyPatch'),
  resolveConflict: call('git:resolveConflict'),
  markResolved: call('git:markResolved'),
  conflictFile: call('git:conflictFile'),
  rebaseInteractive: call('git:rebaseInteractive'),
  blameStructured: call('git:blameStructured'),
  stashShow: call('git:stashShow'),
  setUpstream: call('git:setUpstream'),
  emptyCommit: call('git:emptyCommit'),
  getGitLog: call('git:logHistory'),
  onRepoChanged: (cb) => {
    const l = (_e: unknown, repo: string) => cb(repo)
    ipcRenderer.on('repo:changed', l)
    return () => ipcRenderer.removeListener('repo:changed', l)
  },
  onGitLog: (cb) => {
    const l = (_e: unknown, line: GitLogLine) => cb(line)
    ipcRenderer.on('git:log', l)
    return () => ipcRenderer.removeListener('git:log', l)
  }
}

contextBridge.exposeInMainWorld('pakgit', api)
contextBridge.exposeInMainWorld('pakgitMenu', {
  on: (cb: (action: string) => void) => {
    const l = (_e: unknown, action: string) => cb(action)
    ipcRenderer.on('menu', l)
    return () => ipcRenderer.removeListener('menu', l)
  },
  platform: process.platform
})
