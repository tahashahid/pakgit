import { app, BrowserWindow, dialog, ipcMain, shell, Menu, nativeTheme } from 'electron'
import { join, basename, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { spawn } from 'child_process'
import chokidar, { FSWatcher } from 'chokidar'
import * as git from './git'
import type { CommitOptions, DiffRequest, FileArea, RepoEntry } from '@shared/types'

// ---------- repository registry ----------

const storeFile = () => join(app.getPath('userData'), 'repositories.json')
function loadRepos(): RepoEntry[] {
  try { return JSON.parse(readFileSync(storeFile(), 'utf8')) } catch { return [] }
}
function saveRepos(list: RepoEntry[]): void {
  mkdirSync(dirname(storeFile()), { recursive: true })
  writeFileSync(storeFile(), JSON.stringify(list, null, 2))
}
async function registerRepo(path: string): Promise<RepoEntry> {
  const top = await git.topLevel(path)
  const list = loadRepos().filter((r) => r.path !== top)
  const entry: RepoEntry = { path: top, name: basename(top), lastOpened: Date.now() }
  list.unshift(entry)
  saveRepos(list)
  return entry
}

// ---------- settings ----------

import type { Settings } from '@shared/types'
const settingsFile = () => join(app.getPath('userData'), 'settings.json')
const defaultSettings: Settings = { gitPath: '', pullMode: 'merge', autoFetchMinutes: 0, logLimit: 400, confirmDiscard: true }
function loadSettings(): Settings {
  try { return { ...defaultSettings, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) } } catch { return { ...defaultSettings } }
}
function saveSettings(s: Settings): Settings {
  mkdirSync(dirname(settingsFile()), { recursive: true })
  const merged = { ...defaultSettings, ...s }
  writeFileSync(settingsFile(), JSON.stringify(merged, null, 2))
  git.setGitExecutable(merged.gitPath)
  return merged
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
      const img = await win.webContents.capturePage()
      writeFileSync(process.env.PAKGIT_SCREENSHOT!, img.toPNG())
      console.log(`screenshot written to ${process.env.PAKGIT_SCREENSHOT}`)
      app.quit()
    }, Number(process.env.PAKGIT_SCREENSHOT_DELAY ?? 4000)))
  }
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  const query = process.env.PAKGIT_SCREENSHOT_SELECT ? { select: process.env.PAKGIT_SCREENSHOT_SELECT } : undefined
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (query ? `?select=${encodeURIComponent(query.select)}` : ''))
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
        { label: 'Clone…', accelerator: 'CmdOrCtrl+Shift+O', click: send('repo:clone') },
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
        { label: 'Commit…', accelerator: 'CmdOrCtrl+K', click: send('local:commit') },
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
        { label: 'Standard Window', accelerator: 'CmdOrCtrl+1', click: send('view:standard') },
        { label: 'Log Window', accelerator: 'CmdOrCtrl+2', click: send('view:log') },
        { label: 'Working Tree Window', accelerator: 'CmdOrCtrl+3', click: send('view:worktree') },
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
    const entry = await registerRepo(target)
    await watchRepo(entry.path)
    return entry
  })
  handle('repos:remove', (path: string) => {
    saveRepos(loadRepos().filter((r) => r.path !== path))
    watchers.get(path)?.close(); watchers.delete(path)
  })
  handle('repos:clone', async (url: string, dest: string) => {
    await git.clone(url, dest)
    const entry = await registerRepo(dest)
    await watchRepo(entry.path)
    return entry
  })
  handle('repos:init', async (path: string) => {
    await git.init(path)
    const entry = await registerRepo(path)
    await watchRepo(entry.path)
    return entry
  })
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
  handle('git:addRemote', (repo: string, n: string, u: string) => git.addRemote(repo, n, u))
  handle('git:removeRemote', (repo: string, n: string) => git.removeRemote(repo, n))
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
  handle('settings:get', () => loadSettings())
  handle('settings:save', (s: Settings) => saveSettings(s))
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

app.whenReady().then(() => {
  git.setLogSink((line) => broadcast('git:log', line))
  git.setGitExecutable(loadSettings().gitPath)
  registerIpc()
  buildMenu()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
