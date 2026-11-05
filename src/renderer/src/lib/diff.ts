export interface DiffLine { kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'; text: string; oldNo?: number; newNo?: number }
export interface DiffFile { header: string; lines: DiffLine[]; binary: boolean }

export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = []
  let cur: DiffFile | null = null
  let oldNo = 0, newNo = 0
  for (const line of raw.split('\n')) {
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
