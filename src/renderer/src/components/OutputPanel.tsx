import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { Btn, Panel } from './ui'

export function OutputPanel(): JSX.Element {
  const { output } = useStore()
  const [expanded, setExpanded] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [output.length])
  return (
    <Panel title="Output" actions={<Btn small kind="ghost" onClick={() => setExpanded(null)}>Collapse</Btn>}>
      <div className="output" ref={ref} style={{ height: '100%', overflow: 'auto' }}>
        {output.slice(-200).map((l) => (
          <div key={l.id} className={`line ${l.code !== 0 ? 'fail' : ''}`} onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
            <span className="cmd">{l.command}</span><span className="ms">{l.durationMs} ms{l.code !== 0 ? ` · exit ${l.code}` : ''}</span>
            {(expanded === l.id || l.code !== 0) && (l.stderr || l.stdout) && <pre>{l.stderr || l.stdout}</pre>}
          </div>
        ))}
      </div>
    </Panel>
  )
}
