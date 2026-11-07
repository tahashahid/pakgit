import { app, BrowserWindow, dialog, ipcMain, shell, Menu, nativeTheme, safeStorage } from 'electron'
import { join, basename, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { spawn } from 'child_process'
import chokidar, { FSWatcher } from 'chokidar'
import * as git from './git'
import * as release from './release'
import * as orgs from './organizations'
import { overview as orgOverview } from './overview'
import * as workindex from './workindex'
import { configureTrackerFor, setActiveTrackerOrg, tracker, trackerFor } from './tracker'
import { linearLogin, linearLogout, OAUTH_REDIRECT } from './tracker/oauth'
import type { BranchTarget, CommitOptions, DiffRequest, FileArea, IssueQuery, OrgExport, Organization, PrepareOptions, RepoEntry, RepoPipelineOverride, StartWorkRequest, TrackerAuth, TrackerConfig, TrackerSettings } from '@shared/types'

// ---------- repository registry (per organization, see organizations.ts) ----------

const loadRepos = (): RepoEntry[] => orgs.orgRepos(orgs.activeOrgId())
async function remoteIdentity(path: string): Promise<string | null> {
  try { const r = await git.refs(path); const o = r.remotes.find((x) => x.name === 'origin') ?? r.remotes[0]; return orgs.normalizeRemote(o?.fetchUrl) } catch { return null }
}
async function registerRepo(path: string, orgId?: string): Promise<RepoEntry> {
  const top = await git.topLevel(path)
  const existing = orgs.findRepo(top)
  const entry = orgs.upsertRepo({ path: top, name: basename(top), lastOpened: Date.now(), group: existing?.group ?? null, remote: existing?.remote ?? (await remoteIdentity(top)) }, orgId ?? existing?.org ?? orgs.activeOrgId())
  return entry
}
/** Fill remote identities for repositories migrated from the flat layout (once, in the background). */
async function fillRemotes(): Promise<void> {
  for (const r of orgs.allRepos()) if (r.remote === undefined && existsSync(r.path)) orgs.setRepoRemote(r.path, await remoteIdentity(r.path))
}

// ---------- settings (app-wide) and per-person tracker auth (per organization, encrypted) ----------

import type { Settings } from '@shared/types'
const settingsFile = () => join(app.getPath('userData'), 'settings.json')
const defaultSettings: Settings = { gitPath: '', pullMode: 'merge', autoFetchMinutes: 0, logLimit: 400, confirmDiscard: true }
const emptyAuth = (): TrackerAuth => ({ linearApiKey: '', linearClientSecret: '', linearAccessToken: '', linearRefreshToken: '', linearTokenExpiry: 0 })
// Secrets are encrypted at rest with the OS keychain when available (Electron safeStorage).
const SECRET_FIELDS = ['linearApiKey', 'linearClientSecret', 'linearAccessToken', 'linearRefreshToken'] as const
const enc = (v: string): string => (v && safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(v).toString('base64') : v)
const dec = (v: string): string => { try { return v?.startsWith('enc:') && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v ?? '' } catch { return '' } }
interface SettingsFile extends Settings { auth?: Record<string, TrackerAuth>; tracker?: Record<string, unknown> }
function readSettingsFile(): SettingsFile {
  try {
    const s = JSON.parse(readFileSync(settingsFile(), 'utf8')) as SettingsFile
    const auth: Record<string, TrackerAuth> = {}
    for (const [k, v] of Object.entries(s.auth ?? {})) { const a = { ...emptyAuth(), ...v }; for (const f of SECRET_FIELDS) a[f] = dec(a[f]); auth[k] = a }
    return { ...defaultSettings, ...s, auth }
  } catch { return { ...defaultSettings, auth: {} } }
}
function writeSettingsFile(s: SettingsFile): void {
  mkdirSync(dirname(settingsFile()), { recursive: true })
  const onDisk: SettingsFile = { ...s, auth: {} }
  for (const [k, v] of Object.entries(s.auth ?? {})) { const a = { ...v }; for (const f of SECRET_FIELDS) a[f] = enc(a[f]); onDisk.auth![k] = a }
  delete onDisk.tracker
  writeFileSync(settingsFile(), JSON.stringify(onDisk, null, 2))
}
function loadSettings(): Settings { const { auth: _a, tracker: _t, ...s } = readSettingsFile(); return s }
function saveSettings(s: Settings): Settings {
  const file = readSettingsFile()
  const merged: SettingsFile = { ...file, ...defaultSettings, ...s, auth: file.auth }
  writeSettingsFile(merged)
  git.setGitExecutable(merged.gitPath)
  return loadSettings()
}
const authKey = (orgId: string, provider: string) => `${orgId}:${provider}`
function loadAuth(orgId: string, provider: string): TrackerAuth { return readSettingsFile().auth?.[authKey(orgId, provider)] ?? emptyAuth() }
function saveAuth(orgId: string, provider: string, patch: Partial<TrackerAuth>): void {
  const file = readSettingsFile(); file.auth = file.auth ?? {}
  file.auth[authKey(orgId, provider)] = { ...emptyAuth(), ...(file.auth[authKey(orgId, provider)] ?? {}), ...patch }
  writeSettingsFile(file)
}
/** The resolved runtime settings for an organization's tracker: shareable config + this person's auth. */
function trackerSettings(orgId: string): TrackerSettings {
  const cfg = orgs.getOrg(orgId).tracker
  return { ...cfg, ...loadAuth(orgId, cfg.provider) }
}
function configureOrgTracker(orgId: string): void {
  const cfg = orgs.getOrg(orgId).tracker
  configureTrackerFor(orgId, trackerSettings(orgId), (patch) => {
    const authPatch: Partial<TrackerAuth> = {}
    for (const f of [...SECRET_FIELDS, 'linearTokenExpiry'] as const) if (f in patch) (authPatch as Record<string, unknown>)[f] = (patch as Record<string, unknown>)[f]
    saveAuth(orgId, cfg.provider, authPatch)
  })
}
/** Legacy single tracker block in settings.json (pre-organizations) -> Personal organization config + auth. */
function legacyTracker(): { config: TrackerConfig; auth: TrackerAuth } | null {
  const t = readSettingsFile().tracker as Record<string, string | number> | undefined
  if (!t || typeof t !== 'object') return null
  const a = emptyAuth()
  for (const f of SECRET_FIELDS) a[f] = dec(String(t[f] ?? ''))
  a.linearTokenExpiry = Number(t['linearTokenExpiry'] ?? 0)
  return { config: { provider: (t['provider'] as TrackerConfig['provider']) ?? 'none', authMethod: (t['authMethod'] as TrackerConfig['authMethod']) ?? 'oauth', linearClientId: String(t['linearClientId'] ?? ''), stateOnStart: String(t['stateOnStart'] ?? 'In Progress') }, auth: a }
}

// ---------- file watching ----------

const watchers = new Map<string, FSWatcher>()
const pending = new Map<string, NodeJS.Timeout>()
function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}
async function watchRepo(repo: string): Promise<void> {
  if (watchers.has(repo)) return
  const dir = await git.gitDir(repo)
  const watcher = chokidar.watch([repo, dir], {
    ignoreInitial: true,
    ignored: (p) => /[\\/]\.git[\\/](objects|lfs|logs)[\\/]/.test(p) || /[\\/]node_modules[\\/]/.test(p) || p.endsWith('.lock'),
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })
  watcher.on('all', () => {
    clearTimeout(pending.get(repo))
    pending.set(repo, setTimeout(() => broadcast('repo:changed', repo), 250))
  })
  watchers.set(repo, watcher)
}

// ---------- window ----------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 600,
    title: 'PakGit',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: process.platform === 'linux' ? join(__dirname, '../../build/icon.png') : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f3f4f6',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  win.on('ready-to-show', () => win.show())
  // Dev helpers: PAKGIT_DEBUG=1 echoes renderer console output; PAKGIT_SCREENSHOT=/path.png captures the window and quits.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  win.webContents.on('console-message', (e: any, level?: unknown, message?: unknown) => {
    const lvl = e?.level ?? level
    const msg = e?.message ?? message
    if (process.env.PAKGIT_DEBUG || lvl === 'error' || lvl === 'warning' || lvl === 2 || lvl === 3) console.log(`[renderer:${String(lvl)}] ${String(msg)}`)
  })
  if (process.env.PAKGIT_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.PAKGIT_SCREENSHOT_EVAL) {
        try { console.log('eval:', JSON.stringify(await win.webContents.executeJavaScript(process.env.PAKGIT_SCREENSHOT_EVAL))) }
        catch (e) { console.log('eval error:', e instanceof Error ? e.message : String(e)) }
      }
      const img = await win.webContents.capturePage()
      writeFileSync(process.env.PAKGIT_SCREENSHOT!, img.toPNG())
      console.log(`screenshot written to ${process.env.PAKGIT_SCREENSHOT}`)
      app.quit()
    }, Number(process.env.PAKGIT_SCREENSHOT_DELAY ?? 4000)))
  }
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  const query: Record<string, string> = {}
  if (process.env.PAKGIT_SCREENSHOT_SELECT) query.select = process.env.PAKGIT_SCREENSHOT_SELECT
  if (process.env.PAKGIT_SCREENSHOT_PERSPECTIVE) query.perspective = process.env.PAKGIT_SCREENSHOT_PERSPECTIVE
  const qs = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : ''
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'] + qs)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  return win
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const send = (ch: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('menu', ch)
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Repository',
      submenu: [
        { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: send('repo:open') },
        { label: 'Clone…', accelerator: 'CmdOrCtrl+Shift+C', click: send('repo:clone') },
        { label: 'Initialize…', click: send('repo:init') },
        { type: 'separator' },
        { label: 'Apply Patch…', click: send('repo:apply-patch') },
        { label: 'Clean Working Tree…', click: send('repo:clean') },
        { type: 'separator' },
        { label: 'Refresh', accelerator: 'F5', click: send('repo:refresh') },
        { label: 'Open in Terminal', accelerator: 'CmdOrCtrl+Alt+T', click: send('repo:terminal') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Remote',
      submenu: [
        { label: 'Fetch', accelerator: 'CmdOrCtrl+Shift+F', click: send('remote:fetch') },
        { label: 'Pull', accelerator: 'CmdOrCtrl+Shift+L', click: send('remote:pull') },
        { label: 'Push', accelerator: 'CmdOrCtrl+Shift+P', click: send('remote:push') }
      ]
    },
    {
      label: 'Local',
      submenu: [
        { label: 'Commit…', accelerator: 'CmdOrCtrl+Shift+K', click: send('local:commit') },
        { label: 'Stage All', accelerator: 'CmdOrCtrl+Shift+A', click: send('local:stage-all') },
        { label: 'Stash…', accelerator: 'CmdOrCtrl+Shift+S', click: send('local:stash') },
        { type: 'separator' },
        { label: 'Create Empty Commit…', click: send('local:empty-commit') }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Quick Open…', accelerator: 'CmdOrCtrl+K', click: send('view:quick-open') },
        { type: 'separator' },
        { label: 'Standard Window', accelerator: 'CmdOrCtrl+1', click: send('view:standard') },
        { label: 'Log Window', accelerator: 'CmdOrCtrl+2', click: send('view:log') },
        { label: 'Working Tree Window', accelerator: 'CmdOrCtrl+3', click: send('view:worktree') },
        { label: 'Release Window', accelerator: 'CmdOrCtrl+4', click: send('view:release') },
        { label: 'Organization Window', accelerator: 'CmdOrCtrl+5', click: send('view:organization') },
        { label: 'Switch Organization…', accelerator: 'CmdOrCtrl+Shift+O', click: send('org:switch') },
        { type: 'separator' },
        { label: 'Toggle Theme', click: send('view:theme') },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('view:settings') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'PakGit on GitHub', click: () => shell.openExternal('https://github.com/') }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- IPC ----------

function handle<T extends unknown[], R>(channel: string, fn: (...args: T) => Promise<R> | R): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...(args as T)) } }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
}

function registerIpc(): void {
  handle('repos:list', () => loadRepos())
  handle('repos:add', async (path?: string) => {
    let target = path
    if (!target) {
      const r = await dialog.showOpenDialog({ title: 'Open Repository', properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      target = r.filePaths[0]
    }
    if (!(await git.isRepo(target))) throw new Error(`${target} is not a Git repository`)
    const entry = await registerRepo(target, orgs.activeOrgId())
    await watchRepo(entry.path)
    return entry
  })
  handle('repos:remove', (path: string) => {
    orgs.removeRepo(path)
    watchers.get(path)?.close(); watchers.delete(path)
  })
  handle('repos:clone', async (url: string, dest: string) => {
    await git.clone(url, dest)
    const entry = await registerRepo(dest, orgs.activeOrgId())
    await watchRepo(entry.path)
    return entry
  })
  handle('repos:init', async (path: string) => {
    await git.init(path)
    const entry = await registerRepo(path, orgs.activeOrgId())
    await watchRepo(entry.path)
    return entry
  })
  handle('repos:groups', () => orgs.groups(orgs.activeOrgId()))
  handle('repos:createGroup', (name: string) => orgs.createGroup(orgs.activeOrgId(), name))
  handle('repos:renameGroup', (oldName: string, newName: string) => orgs.renameGroup(orgs.activeOrgId(), oldName, newName))
  handle('repos:deleteGroup', (name: string) => orgs.deleteGroup(orgs.activeOrgId(), name))
  handle('repos:setGroup', (path: string, group: string | null) => orgs.setRepoGroup(path, group))

  // ---- organizations
  handle('org:workspace', () => orgs.workspace())
  handle('org:get', (id: string) => orgs.getOrg(id))
  handle('org:setActive', (id: string) => { const w = orgs.setActive(id); setActiveTrackerOrg(id); configureOrgTracker(id); return w })
  handle('org:create', async (input: { name: string; color?: string; repoPaths?: string[]; moveTrackerFrom?: string | null }) => {
    const from = input.moveTrackerFrom ? orgs.getOrg(input.moveTrackerFrom) : null
    const o = orgs.createOrg({ name: input.name, color: input.color, tracker: from ? from.tracker : undefined })
    if (from) {
      saveAuth(o.id, from.tracker.provider, loadAuth(from.id, from.tracker.provider))
      orgs.updateOrg(from.id, { tracker: { provider: 'none', authMethod: 'oauth', linearClientId: '', stateOnStart: from.tracker.stateOnStart } })
      saveAuth(from.id, from.tracker.provider, emptyAuth())
      configureOrgTracker(from.id)
    }
    for (const p of input.repoPaths ?? []) orgs.moveRepo(p, o.id)
    configureOrgTracker(o.id)
    return orgs.getOrg(o.id)
  })
  handle('org:update', (id: string, patch: Partial<Omit<Organization, 'id' | 'createdAt'>>) => {
    if (patch.pipeline) patch.pipeline = release.validatePipeline(patch.pipeline)
    const o = orgs.updateOrg(id, patch)
    configureOrgTracker(id)
    return o
  })
  handle('org:delete', (id: string) => { const w = orgs.deleteOrg(id); setActiveTrackerOrg(w.active); return w })
  handle('org:moveRepo', (path: string, orgId: string) => { orgs.moveRepo(path, orgId) })
  handle('org:proposals', async () => { await fillRemotes(); return orgs.proposals(orgs.activeOrgId()) })
  handle('org:export', async (id: string) => {
    const data = orgs.exportOrg(id)
    const r = await dialog.showSaveDialog({ title: 'Export organization', defaultPath: `${orgs.slugify(data.organization.name)}.pakgit-org.json`, filters: [{ name: 'PakGit organization', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, JSON.stringify(data, null, 2))
    return r.filePath
  })
  handle('org:import', async () => {
    const r = await dialog.showOpenDialog({ title: 'Import organization', properties: ['openFile'], filters: [{ name: 'PakGit organization', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    await fillRemotes()
    const data = JSON.parse(readFileSync(r.filePaths[0], 'utf8')) as OrgExport
    const res = orgs.importOrg(data)
    configureOrgTracker(res.org.id)
    return res
  })
  handle('org:overview', (id: string, opts?: { refresh?: boolean }) => orgOverview(id, { refresh: !!opts?.refresh, tracker: trackerFor(id) }))
  handle('org:index', (id: string, opts?: { refresh?: boolean }) => workindex.index(id, { refresh: !!opts?.refresh, tracker: trackerFor(id) }))
  handle('org:startWork', (id: string, req: StartWorkRequest) => workindex.startWork(id, req))
  handle('org:suggestBranch', (id: string, issue: { key: string; title: string; branchName?: string }) => workindex.suggestBranch(id, issue))
  handle('org:trackerStatus', async (id: string) => {
    const cfg = orgs.getOrg(id).tracker; const auth = loadAuth(id, cfg.provider)
    const st = await trackerFor(id).status()
    return { ...st, provider: cfg.provider, hasApiKey: !!auth.linearApiKey, signedIn: !!auth.linearAccessToken }
  })
  handle('org:trackerSetSecrets', (id: string, secrets: { linearApiKey?: string; linearClientSecret?: string }) => {
    const cfg = orgs.getOrg(id).tracker
    saveAuth(id, cfg.provider, secrets)
    configureOrgTracker(id)
  })
  const loginOrg = async (id: string) => {
    try {
      const patch = await linearLogin(trackerSettings(id))
      saveAuth(id, 'linear', patch as Partial<TrackerAuth>)
      if (orgs.getOrg(id).tracker.authMethod !== 'oauth') orgs.updateOrg(id, { tracker: { ...orgs.getOrg(id).tracker, authMethod: 'oauth' } })
      configureOrgTracker(id)
      const st = await trackerFor(id).status()
      for (const w of BrowserWindow.getAllWindows()) { w.show(); w.focus() }
      return { ok: !st.error, account: st.account, error: st.error }
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  }
  const logoutOrg = async (id: string) => {
    await linearLogout(trackerSettings(id))
    saveAuth(id, 'linear', { linearAccessToken: '', linearRefreshToken: '', linearTokenExpiry: 0 })
    configureOrgTracker(id)
  }
  handle('org:trackerLogin', (id: string) => loginOrg(id))
  handle('org:trackerLogout', (id: string) => logoutOrg(id))
  handle('release:repoPipeline', (repo: string) => release.repoPipeline(repo))
  handle('release:saveRepoPipeline', (repo: string, o: RepoPipelineOverride) => release.saveRepoPipeline(repo, o))
  handle('dialog:directory', async (title?: string) => {
    const r = await dialog.showOpenDialog({ title: title ?? 'Select Directory', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  handle('git:status', async (repo: string) => { await watchRepo(repo); return git.status(repo) })
  handle('git:refs', (repo: string) => git.refs(repo))
  handle('git:log', (repo: string, opts?: { limit?: number; all?: boolean; skip?: number; path?: string; follow?: boolean }) => git.log(repo, opts))
  handle('git:commitDetails', (repo: string, sha: string) => git.commitDetails(repo, sha))
  handle('git:commitFileDiff', (repo: string, sha: string, path: string) => git.commitFileDiff(repo, sha, path))
  handle('git:diff', (req: DiffRequest) => git.diff(req.repo, req.path, req.area, req.oldPath))
  handle('git:fileAtHead', (repo: string, path: string) => git.fileAtHead(repo, path))
  handle('git:blame', (repo: string, path: string) => git.blame(repo, path))

  handle('git:stage', (repo: string, paths: string[]) => git.stage(repo, paths))
  handle('git:unstage', (repo: string, paths: string[]) => git.unstage(repo, paths))
  handle('git:discard', (repo: string, files: { path: string; area: FileArea }[]) => git.discard(repo, files))
  handle('git:ignore', (repo: string, pattern: string) => git.ignore(repo, pattern))
  handle('git:commit', async (repo: string, opts: CommitOptions) => {
    await git.commit(repo, opts)
    if (opts.push) await git.push(repo, {})
  })
  handle('git:undoLastCommit', (repo: string) => git.undoLastCommit(repo))

  handle('git:fetch', (repo: string, remote?: string, prune?: boolean) => git.fetch(repo, remote, prune))
  handle('git:pull', (repo: string, mode: 'merge' | 'rebase' | 'ff-only') => git.pull(repo, mode))
  handle('git:push', (repo: string, opts: Parameters<typeof git.push>[1]) => git.push(repo, opts))

  handle('git:checkout', (repo: string, ref: string, opts?: Parameters<typeof git.checkout>[2]) => git.checkout(repo, ref, opts))
  handle('git:createBranch', (repo: string, name: string, start?: string, co?: boolean) => git.createBranch(repo, name, start, co))
  handle('git:deleteBranch', (repo: string, name: string, force?: boolean, remote?: string) => git.deleteBranch(repo, name, force, remote))
  handle('git:renameBranch', (repo: string, a: string, b: string) => git.renameBranch(repo, a, b))
  handle('git:merge', (repo: string, ref: string, opts?: Parameters<typeof git.merge>[2]) => git.merge(repo, ref, opts))
  handle('git:rebase', (repo: string, ref: string) => git.rebase(repo, ref))
  handle('git:rebaseAction', (repo: string, a: 'continue' | 'abort' | 'skip') => git.rebaseAction(repo, a))
  handle('git:mergeAction', (repo: string, a: 'continue' | 'abort') => git.mergeAction(repo, a))
  handle('git:cherryPick', (repo: string, sha: string) => git.cherryPick(repo, sha))
  handle('git:revert', (repo: string, sha: string) => git.revert(repo, sha))
  handle('git:reset', (repo: string, ref: string, mode: 'soft' | 'mixed' | 'hard') => git.reset(repo, ref, mode))
  handle('git:createTag', (repo: string, name: string, sha?: string, msg?: string) => git.createTag(repo, name, sha, msg))
  handle('git:deleteTag', (repo: string, name: string) => git.deleteTag(repo, name))

  handle('git:stashSave', (repo: string, msg?: string, u?: boolean) => git.stashSave(repo, msg, u))
  handle('git:stashApply', (repo: string, i: number, pop?: boolean) => git.stashApply(repo, i, pop))
  handle('git:stashDrop', (repo: string, i: number) => git.stashDrop(repo, i))
  // the remote identity keys the repository's planning state: refresh it when remotes change
  const remoteChanged = async (repo: string): Promise<void> => { release.forgetIdentity(repo); if (orgs.findRepo(repo)) orgs.setRepoRemote(repo, await remoteIdentity(repo)) }
  handle('git:addRemote', async (repo: string, n: string, u: string) => { await git.addRemote(repo, n, u); await remoteChanged(repo) })
  handle('git:removeRemote', async (repo: string, n: string) => { await git.removeRemote(repo, n); await remoteChanged(repo) })
  handle('git:version', () => git.version())
  handle('git:submodules', (repo: string) => git.submodules(repo))
  handle('git:submoduleUpdate', (repo: string, paths?: string[]) => git.submoduleUpdate(repo, paths))
  handle('git:worktrees', (repo: string) => git.worktrees(repo))
  handle('git:worktreeAdd', (repo: string, p: string, b: string, c: boolean) => git.worktreeAdd(repo, p, b, c))
  handle('git:worktreeRemove', (repo: string, p: string, f?: boolean) => git.worktreeRemove(repo, p, f))
  handle('git:formatPatch', (repo: string, sha: string, dest: string) => git.formatPatch(repo, sha, dest))
  handle('git:applyPatchFile', (repo: string, f: string) => git.applyPatchFile(repo, f))
  handle('git:clean', (repo: string, x: boolean) => git.clean(repo, x))
  handle('os:trash', async (repo: string, paths: string[]) => { for (const p of paths) await shell.trashItem(join(repo, p)) })
  handle('dialog:saveFile', async (title: string, defaultName: string) => {
    const r = await dialog.showSaveDialog({ title, defaultPath: defaultName })
    return r.canceled ? null : r.filePath ?? null
  })
  handle('dialog:openFile', async (title: string) => {
    const r = await dialog.showOpenDialog({ title, properties: ['openFile'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  handle('release:config', (repo: string) => release.releaseConfig(repo))
  handle('release:saveConfig', (repo: string, cfg: Parameters<typeof release.saveReleaseConfig>[1]) => release.saveReleaseConfig(repo, cfg))
  handle('release:analyze', async (repo: string, opts?: { refresh?: boolean }) => {
    const orgId = orgs.orgOfRepo(repo)
    return release.analyze(repo, { cache: !opts?.refresh, tracker: trackerFor(orgId), prefixes: await workindex.prefixHint(orgId, trackerFor(orgId)) })
  })
  handle('release:promote', (repo: string, env: string, items: release.PromoteInput[], push: boolean) => release.promote(repo, env, items, push))
  handle('release:start', (repo: string, env: string, name: string, items: release.PromoteInput[], push: boolean) => release.startRelease(repo, env, name, items, push))
  handle('release:finish', (repo: string, env: string, branch: string, tag: string | null, push: boolean) => release.finishRelease(repo, env, branch, tag, push))
  handle('release:detectConfig', (repo: string) => release.detectConfig(repo))
  handle('release:sync', (repo: string, push: boolean) => release.syncEnvironments(repo, push))
  handle('release:prepareBranch', (repo: string, env: string, target: BranchTarget, items: release.PromoteInput[], options: PrepareOptions) => release.prepareBranch(repo, env, target, items, options))
  handle('release:setArchived', (repo: string, ids: string[], archived: boolean) => release.setArchived(repo, ids, archived))
  handle('release:setOverrides', (repo: string, id: string, o: Record<string, boolean> | null) => release.setOverrides(repo, id, o))
  handle('release:setLink', (repo: string, id: string, key: string | null) => release.setLink(repo, id, key))
  handle('release:openFeaturePRs', (repo: string, env: string, items: release.PromoteInput[]) => release.openFeaturePRs(repo, env, items))
  handle('release:openPR', (repo: string, head: string, base: string, title: string, body: string) => release.openPullRequest(repo, head, base, title, body))
  handle('release:startIssue', (repo: string, _key: string, branchName: string) => release.startIssue(repo, branchName))
  handle('release:enableRerere', (repo: string) => release.enableRerere(repo))
  handle('tracker:status', () => tracker().status())
  handle('tracker:issues', (keys: string[]) => tracker().getIssues(keys))
  handle('tracker:myIssues', () => tracker().myActiveIssues())
  handle('tracker:setState', (key: string, state: string) => tracker().setState(key, state))
  handle('tracker:states', (key: string) => tracker().states(key))
  handle('tracker:listIssues', (q: IssueQuery) => tracker().listIssues(q ?? {}))
  handle('tracker:teams', () => tracker().teams())
  handle('tracker:assignToMe', (key: string) => tracker().assignToMe(key))
  handle('settings:get', () => loadSettings())
  handle('settings:save', (s: Settings) => saveSettings(s))
  handle('tracker:redirectUrl', () => OAUTH_REDIRECT)
  handle('tracker:login', () => loginOrg(orgs.activeOrgId()))
  handle('tracker:logout', () => logoutOrg(orgs.activeOrgId()))
  handle('git:applyPatch', (repo: string, patch: string, o: { cached: boolean; reverse?: boolean }) => git.applyPatch(repo, patch, o))
  handle('git:resolveConflict', (repo: string, path: string, side: 'ours' | 'theirs') => git.resolveConflict(repo, path, side))
  handle('git:markResolved', (repo: string, paths: string[]) => git.markResolved(repo, paths))
  handle('git:conflictFile', (repo: string, path: string) => git.conflictFile(repo, path))
  handle('git:rebaseInteractive', (repo: string, base: string, todo: git.RebaseTodoEntry[], rewords?: Record<string, string>) => git.rebaseInteractive(repo, base, todo, rewords))
  handle('git:blameStructured', (repo: string, path: string, rev?: string) => git.blameStructured(repo, path, rev))
  handle('git:stashShow', (repo: string, i: number) => git.stashShow(repo, i))
  handle('git:setUpstream', (repo: string, b: string, u: string) => git.setUpstream(repo, b, u))
  handle('git:emptyCommit', (repo: string, m: string) => git.emptyCommit(repo, m))
  handle('git:logHistory', () => git.getLogHistory())

  handle('os:terminal', (repo: string) => {
    if (process.platform === 'darwin') spawn('open', ['-a', 'Terminal', repo], { detached: true }).unref()
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', 'cmd', '/K', `cd /d "${repo}"`], { detached: true, shell: true }).unref()
    else {
      const term = process.env.TERMINAL ?? ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'].find((t) =>
        (process.env.PATH ?? '').split(':').some((d) => existsSync(join(d, t)))) ?? 'xterm'
      spawn(term, [], { cwd: repo, detached: true }).unref()
    }
  })
  handle('os:openEditor', (repo: string, path: string) => shell.openPath(join(repo, path)))
  handle('os:reveal', (repo: string, path?: string) => shell.showItemInFolder(path ? join(repo, path) : repo))
}

// Dev/test helper: run against another profile folder without touching the real one.
if (process.env.PAKGIT_USER_DATA) app.setPath('userData', process.env.PAKGIT_USER_DATA)

app.whenReady().then(() => {
  git.setLogSink((line) => broadcast('git:log', line))
  git.setGitExecutable(loadSettings().gitPath)
  orgs.setOrgDir(app.getPath('userData'))
  // migration: flat repositories/groups and the single tracker block become the Personal organization
  const legacy = legacyTracker()
  const m = orgs.ensureMigrated(legacy?.config ?? null)
  if (m.migrated && legacy) { saveAuth(orgs.PERSONAL, legacy.config.provider, legacy.auth); const f = readSettingsFile(); delete f.tracker; writeSettingsFile(f) }
  for (const o of orgs.listOrgs()) configureOrgTracker(o.id)
  setActiveTrackerOrg(orgs.activeOrgId())
  void fillRemotes()
  release.setReleaseConfigDir(app.getPath('userData'))
  release.setTemplateProvider((repo) => { try { return orgs.getOrg(orgs.orgOfRepo(repo)).pipeline } catch { return null } })
  release.setIdentityProvider((repo) => orgs.findRepo(repo)?.remote ?? undefined)
  release.setPrOpener((url) => shell.openExternal(url))
  registerIpc()
  buildMenu()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
