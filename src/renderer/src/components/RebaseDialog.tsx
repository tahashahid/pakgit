import React, { useState } from 'react'
import { useStore } from '@/lib/store'
import { Btn } from './ui'
import type { RebaseTodoEntry } from '@shared/types'

const ACTIONS: RebaseTodoEntry['action'][] = ['pick', 'reword', 'squash', 'fixup', 'drop']
const HELP: Record<RebaseTodoEntry['action'], string> = {
  pick: 'keep as is', reword: 'keep, change message', squash: 'merge into previous, keep messages', fixup: 'merge into previous, discard message', drop: 'remove commit'
}

export function RebaseDialog(): JSX.Element | null {
  const { rebase, setRebase, run, api, repo } = useStore()
  const [todo, setTodo] = useState<RebaseTodoEntry[]>(() => rebase?.todo ?? [])
  const [rewords, setRewords] = useState<Record<string, string>>({})
  if (!rebase || !repo) return null
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= todo.length) return
    const next = [...todo]; const t = next[i]; next[i] = next[j]; next[j] = t
    setTodo(next)
  }
  const set = (i: number, action: RebaseTodoEntry['action']) => setTodo(todo.map((t, k) => (k === i ? { ...t, action } : t)))
  const firstIsSquash = todo.length > 0 && (todo[0].action === 'squash' || todo[0].action === 'fixup')
  const submit = () => {
    setRebase(null)
    void run('Interactive rebase', () => api.rebaseInteractive(repo.path, rebase.base, todo, rewords), { success: 'Rebase finished' })
  }
  return (
    <div className="modal-backdrop" onMouseDown={() => setRebase(null)}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Rebase Interactive</h2>
        <p className="modal-message">Oldest commit first. Reorder with the arrows, pick an action per commit. Squash and fixup fold a commit into the one above it.</p>
        <div className="rebase-list">
          {todo.map((t, i) => (
            <div key={t.sha} className={`rebase-row ${t.action}`}>
              <Btn small onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</Btn>
              <Btn small onClick={() => move(i, 1)} disabled={i === todo.length - 1} title="Move down">↓</Btn>
              <select value={t.action} onChange={(e) => set(i, e.target.value as RebaseTodoEntry['action'])} title={HELP[t.action]}>
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <span className="mono muted">{t.sha.slice(0, 7)}</span>
              {t.action === 'reword'
                ? <input value={rewords[t.sha] ?? t.subject} onChange={(e) => setRewords({ ...rewords, [t.sha]: e.target.value })} />
                : <span className="subject" title={t.subject}>{t.subject}</span>}
            </div>
          ))}
        </div>
        {firstIsSquash && <p className="modal-message" style={{ color: 'var(--danger)' }}>The first commit cannot be squashed or fixed up: there is nothing above it.</p>}
        <div className="modal-actions">
          <Btn onClick={() => setRebase(null)}>Cancel</Btn>
          <Btn kind="primary" disabled={firstIsSquash || todo.every((t) => t.action === 'drop')} onClick={submit}>Rebase</Btn>
        </div>
      </div>
    </div>
  )
}
