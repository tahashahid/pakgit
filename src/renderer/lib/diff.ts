export interface DiffLine { kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'; text: string; oldNo?: number; newNo?: number }
export interface DiffFile { header: string; lines: DiffLine[]; binary: boolean }

export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = []
  let cur: DiffFile | null = null
  let oldNo = 0, newNo = 0
  const all = raw.split('\n')
  if (all.length && all[all.length - 1] === '') all.pop()
  for (const line of all) {
    if (line.startsWith('diff --git')) { cur = { header: line, lines: [], binary: false }; files.push(cur); continue }
    if (!cur) { if (line.trim()) { cur = { header: '', lines: [], binary: false }; files.push(cur) } else continue }
    if (line.startsWith('Binary files')) { cur.binary = true; cur.lines.push({ kind: 'meta', text: line }); continue }
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldNo = m ? +m[1] : 0; newNo = m ? +m[2] : 0
      cur.lines.push({ kind: 'hunk', text: line }); continue
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity') || line.startsWith('rename') || line.startsWith('old mode') || line.startsWith('new mode')) {
      cur.lines.push({ kind: 'meta', text: line }); continue
    }
    if (line.startsWith('+')) cur.lines.push({ kind: 'add', text: line.slice(1), newNo: newNo++ })
    else if (line.startsWith('-')) cur.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++ })
    else if (line.startsWith('\\')) cur.lines.push({ kind: 'meta', text: line })
    else if (line.length || cur.lines.length) cur.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
  }
  return files
}

export function diffStats(raw: string): { add: number; del: number } {
  let add = 0, del = 0
  for (const l of raw.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) add++
    else if (l.startsWith('-') && !l.startsWith('---')) del++
  }
  return { add, del }
}

/** Split a single-file unified diff into its header and raw hunks (for hunk-level staging). */
export function splitHunks(raw: string): { header: string; hunks: string[] } {
  const lines = raw.split('\n')
  const header: string[] = []
  const hunks: string[] = []
  let cur: string[] | null = null
  for (const l of lines) {
    if (l.startsWith('@@')) { if (cur) hunks.push(cur.join('\n')); cur = [l]; continue }
    if (cur) cur.push(l); else header.push(l)
  }
  if (cur) hunks.push(cur.join('\n'))
  return { header: header.join('\n'), hunks: hunks.map((h) => h.replace(/\n+$/, '')) }
}

export interface SideRow { left?: DiffLine; right?: DiffLine; kind: 'ctx' | 'change' | 'hunk' | 'meta' }
/** Pair deletions with additions for a side-by-side rendering. */
export function toSideBySide(lines: DiffLine[]): SideRow[] {
  const rows: SideRow[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.kind === 'ctx') { rows.push({ left: l, right: l, kind: 'ctx' }); i++; continue }
    if (l.kind === 'hunk' || l.kind === 'meta') { rows.push({ left: l, kind: l.kind }); i++; continue }
    const dels: DiffLine[] = [], adds: DiffLine[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++])
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++])
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++) rows.push({ left: dels[k], right: adds[k], kind: 'change' })
  }
  return rows
}
