/**
 * Auto-update through GitHub Releases (electron-updater). Checks on start when the app is packaged,
 * reports progress to the renderer, and installs on request. On macOS updates install only when the
 * app is signed; otherwise the release page is offered instead.
 */
import { app, shell } from 'electron'
import type { UpdateStatus } from '@shared/types'

const RELEASES_URL = 'https://github.com/tahashahid/pakgit/releases'
let status: UpdateStatus = { state: 'idle', version: app.getVersion() }
let listeners: ((s: UpdateStatus) => void)[] = []
const emit = (s: Partial<UpdateStatus>): void => { status = { ...status, ...s }; for (const l of listeners) l(status) }
export function onUpdateStatus(l: (s: UpdateStatus) => void): void { listeners.push(l) }
export function updateStatus(): UpdateStatus { return status }

type Updater = typeof import('electron-updater')['autoUpdater']
let updater: Updater | null = null
function get(): Updater | null {
  if (updater) return updater
  if (!app.isPackaged) return null
  try {
    // required lazily so a dev run without the dependency bundled keeps working
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => emit({ state: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) => emit({ state: 'downloading', available: info.version, percent: 0 }))
    autoUpdater.on('update-not-available', () => emit({ state: 'up-to-date', available: undefined, checkedAt: Date.now() }))
    autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => emit({ state: 'ready', available: info.version, percent: 100 }))
    autoUpdater.on('error', (e) => {
      const msg = e?.message ?? String(e)
      // before the first release GitHub has nothing to offer: that is "up to date", not a failure
      if (/No published versions/i.test(msg)) emit({ state: 'up-to-date', available: undefined, error: undefined, checkedAt: Date.now() })
      else emit({ state: 'error', error: msg })
    })
    updater = autoUpdater
  } catch (e) { emit({ state: 'error', error: e instanceof Error ? e.message : String(e) }) }
  return updater
}

/** Check for a newer release; silent = no error toast for the automatic check on start. */
export async function checkForUpdates(silent = false): Promise<UpdateStatus> {
  const u = get()
  if (!u) { emit({ state: 'unsupported', error: app.isPackaged ? 'Updater unavailable' : 'Updates are checked in the installed app only', checkedAt: Date.now() }); return status }
  try { await u.checkForUpdates() }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/No published versions/i.test(msg)) emit({ state: 'up-to-date', available: undefined, error: undefined, checkedAt: Date.now() })
    else emit({ state: 'error', error: silent ? undefined : msg })
  }
  return status
}
/** Quit and install the downloaded update; falls back to the releases page when installing is not possible (unsigned macOS build). */
export async function installUpdate(): Promise<void> {
  const u = get()
  if (!u || status.state !== 'ready') { await shell.openExternal(RELEASES_URL); return }
  try { u.quitAndInstall() } catch (e) { emit({ state: 'error', error: e instanceof Error ? e.message : String(e) }); await shell.openExternal(RELEASES_URL) }
}
export function openReleases(): Promise<void> { return shell.openExternal(RELEASES_URL) }
