import React, { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { Btn } from './ui'
import type { Settings } from '@shared/types'

export function SettingsDialog(): JSX.Element | null {
  const { showSettings, setShowSettings, settings, saveSettings, theme, toggleTheme } = useStore()
  const [s, setS] = useState<Settings | null>(settings)
  useEffect(() => { setS(settings) }, [settings, showSettings])
  if (!showSettings || !s) return null
  const upd = (patch: Partial<Settings>) => setS({ ...s, ...patch })
  return (
    <div className="modal-backdrop" onMouseDown={() => setShowSettings(false)}>
      <form className="modal wide" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void saveSettings(s); setShowSettings(false) }}>
        <h2>Settings</h2>
        <div className="settings-grid">
          <label className="field"><span>Git executable (empty = auto-detect)</span><input value={s.gitPath} placeholder="git" onChange={(e) => upd({ gitPath: e.target.value })} /></label>
          <label className="field"><span>Default pull strategy</span>
            <select value={s.pullMode} onChange={(e) => upd({ pullMode: e.target.value as Settings['pullMode'] })}>
              <option value="merge">merge</option><option value="rebase">rebase</option><option value="ff-only">fast-forward only</option>
            </select></label>
          <label className="field"><span>Background fetch every (minutes, 0 = off)</span><input type="number" min={0} value={s.autoFetchMinutes} onChange={(e) => upd({ autoFetchMinutes: Math.max(0, +e.target.value || 0) })} /></label>
          <label className="field"><span>Commits to load in Log</span><input type="number" min={50} step={50} value={s.logLimit} onChange={(e) => upd({ logLimit: Math.max(50, +e.target.value || 400) })} /></label>
          <label className="field field-check"><input type="checkbox" checked={s.confirmDiscard} onChange={(e) => upd({ confirmDiscard: e.target.checked })} /><span>Confirm before discarding changes</span></label>
          <label className="field field-check"><input type="checkbox" checked={theme === 'dark'} onChange={toggleTheme} /><span>Dark theme</span></label>
        </div>
        <div className="modal-actions">
          <Btn onClick={() => setShowSettings(false)}>Cancel</Btn>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </div>
  )
}
