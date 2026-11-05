import React, { useEffect, useRef, useState } from 'react'
import { useStore, type DialogSpec } from '@/lib/store'

export function Panel({ title, actions, children, className }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`panel ${className ?? ''}`}>
      <header className="panel-header"><span className="panel-title">{title}</span><span className="panel-actions">{actions}</span></header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

export function Split({ dir, initial, min = 120, children, storageKey }: { dir: 'h' | 'v'; initial: number; min?: number; children: [React.ReactNode, React.ReactNode]; storageKey?: string }): JSX.Element {
  const [size, setSize] = useState<number>(() => {
    if (storageKey) { const v = localStorage.getItem('split:' + storageKey); if (v) return +v }
    return initial
  })
  const ref = useRef<HTMLDivElement>(null)
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const start = dir === 'h' ? e.clientX : e.clientY
    const startSize = size
    const move = (ev: MouseEvent) => {
      const total = dir === 'h' ? ref.current!.clientWidth : ref.current!.clientHeight
      const next = Math.min(total - min, Math.max(min, startSize + ((dir === 'h' ? ev.clientX : ev.clientY) - start)))
      setSize(next)
    }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      if (storageKey) setSize((s) => { localStorage.setItem('split:' + storageKey, String(s)); return s })
    }
    document.body.style.cursor = dir === 'h' ? 'col-resize' : 'row-resize'
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  return (
    <div ref={ref} className={`split split-${dir}`}>
      <div className="split-a" style={dir === 'h' ? { width: size } : { height: size }}>{children[0]}</div>
      <div className={`split-handle split-handle-${dir}`} onMouseDown={onDown} />
      <div className="split-b">{children[1]}</div>
    </div>
  )
}

export function Btn({ children, onClick, title, disabled, kind, small, active }: { children: React.ReactNode; onClick?: () => void; title?: string; disabled?: boolean; kind?: 'primary' | 'danger' | 'ghost'; small?: boolean; active?: boolean }): JSX.Element {
  return <button className={`btn ${kind ?? ''} ${small ? 'small' : ''} ${active ? 'active' : ''}`} onClick={onClick} title={title} disabled={disabled}>{children}</button>
}

export function Icon({ name, size = 16 }: { name: string; size?: number }): JSX.Element {
  const paths: Record<string, string> = {
    pull: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
    push: 'M12 21V9m0 0l-4 4m4-4l4 4M4 5h16',
    fetch: 'M4 12h16m0 0l-5-5m5 5l-5 5',
    commit: 'M12 8a4 4 0 100 8 4 4 0 000-8zM2 12h6m8 0h6',
    branch: 'M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm12-9a3 3 0 100-6 3 3 0 000 6zm0 0c0 4-4 5-8 6',
    stash: 'M4 7h16v4H4zM6 11v9h12v-9M10 15h4',
    merge: 'M6 3v18M6 9c0 4 6 4 12 6m0 0a3 3 0 100 6 3 3 0 000-6z',
    rebase: 'M6 3v18M18 3v8m0 0a3 3 0 100 6 3 3 0 000-6zM6 15c0-4 6-4 12-4',
    refresh: 'M20 12a8 8 0 01-14.5 4.6M4 12a8 8 0 0114.5-4.6M4 4v5h5M20 20v-5h-5',
    terminal: 'M4 4h16v16H4zM7 9l3 3-3 3M12 15h5',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
    check: 'M5 12l5 5L20 7',
    x: 'M6 6l12 12M18 6L6 18',
    tag: 'M3 12l9-9h9v9l-9 9zM16 8h.01',
    folder: 'M3 6h6l2 2h10v10H3z',
    stage: 'M12 19V5m0 0l-5 5m5-5l5 5',
    unstage: 'M12 5v14m0 0l-5-5m5 5l5-5',
    discard: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13',
    log: 'M4 6h16M4 12h10M4 18h7',
    sun: 'M12 4v2m0 12v2m8-8h-2M6 12H4m12.5-5.5l-1.5 1.5M8 16l-1.5 1.5m0-11L8 8m8 8l1.5 1.5M12 8a4 4 0 100 8 4 4 0 000-8z',
    moon: 'M20 14A8 8 0 0110 4a8 8 0 1010 10z',
    search: 'M10 4a6 6 0 100 12 6 6 0 000-12zm5 11l5 5',
    file: 'M6 2h8l4 4v16H6zM14 2v4h4',
    gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zm7.4 3a7.4 7.4 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 00-2-1.2L14.6 2H9.4L9 4.6a7.5 7.5 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 000 2.4l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 002 1.2l.4 2.6h5.2l.4-2.6a7.5 7.5 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
    submodule: 'M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h2v5.5',
    worktree: 'M3 20h18M6 20V9l6-5 6 5v11M10 20v-6h4v6'
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name] ?? ''} /></svg>
}

export function Dialog(): JSX.Element | null {
  const { dialog } = useStore()
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const first = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)
  useEffect(() => {
    if (!dialog) return
    const v: Record<string, string | boolean> = {}
    for (const f of dialog.spec.fields ?? []) v[f.key] = f.type === 'checkbox' ? f.value === 'true' : (f.value ?? (f.type === 'select' ? f.options?.[0] ?? '' : ''))
    setValues(v)
    setTimeout(() => first.current?.focus(), 30)
  }, [dialog])
  if (!dialog) return null
  const spec: DialogSpec = dialog.spec
  const submit = () => dialog.resolve(values)
  return (
    <div className="modal-backdrop" onMouseDown={() => dialog.resolve(null)}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit() }}
        onKeyDown={(e) => { if (e.key === 'Escape') dialog.resolve(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}>
        <h2>{spec.title}</h2>
        {spec.message && <p className="modal-message">{spec.message}</p>}
        {(spec.fields ?? []).map((f, i) => (
          <label key={f.key} className={`field ${f.type === 'checkbox' ? 'field-check' : ''}`}>
            {f.type === 'checkbox' ? (
              <><input type="checkbox" checked={!!values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} /><span>{f.label}</span></>
            ) : f.type === 'textarea' ? (
              <><span>{f.label}</span><textarea ref={i === 0 ? (first as React.RefObject<HTMLTextAreaElement>) : undefined} rows={4} value={String(values[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} /></>
            ) : f.type === 'select' ? (
              <><span>{f.label}</span><select ref={i === 0 ? (first as React.RefObject<HTMLSelectElement>) : undefined} value={String(values[f.key] ?? '')} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select></>
            ) : (
              <><span>{f.label}</span><input ref={i === 0 ? (first as React.RefObject<HTMLInputElement>) : undefined} value={String(values[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} /></>
            )}
          </label>
        ))}
        <div className="modal-actions">
          <Btn onClick={() => dialog.resolve(null)}>Cancel</Btn>
          <button type="submit" className={`btn ${spec.danger ? 'danger' : 'primary'}`}>{spec.okLabel ?? 'OK'}</button>
        </div>
      </form>
    </div>
  )
}

export function Toasts(): JSX.Element {
  const { toasts } = useStore()
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
}

export interface MenuItem { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean; separator?: boolean }
export function ContextMenu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('mousedown', close); window.addEventListener('keydown', close); window.addEventListener('blur', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); window.removeEventListener('blur', close) }
  }, [onClose])
  const style: React.CSSProperties = { left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - items.length * 28 - 16) }
  return (
    <div className="context-menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) => it.separator ? <div key={i} className="context-sep" /> : (
        <button key={i} className={`context-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled} onClick={() => { it.onClick?.(); onClose() }}>{it.label}</button>
      ))}
    </div>
  )
}

export function useContextMenu(): [JSX.Element | null, (e: React.MouseEvent, items: MenuItem[]) => void] {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const open = (e: React.MouseEvent, items: MenuItem[]) => { e.preventDefault(); e.stopPropagation(); setState({ x: e.clientX, y: e.clientY, items }) }
  const el = state ? <ContextMenu {...state} onClose={() => setState(null)} /> : null
  return [el, open]
}

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime()
  const s = Math.max(0, (Date.now() - d) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString()
}
