import type { Commit } from '@shared/types'

export interface GraphRow {
  commit: Commit
  lane: number
  /** lanes occupied on this row (for drawing vertical pass-throughs) */
  lanes: (string | null)[]
  /** edges from this row to the next: [fromLane, toLane, color] */
  edges: { from: number; to: number; color: number }[]
  color: number
  /** lane was allocated on this row: nothing above connects to it */
  fresh: boolean
}

export const LANE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

/** Straightforward lane assignment: each lane holds the sha it expects next. */
export function layoutGraph(commits: Commit[]): GraphRow[] {
  const rows: GraphRow[] = []
  let lanes: (string | null)[] = []
  const laneColor = new Map<number, number>()
  let nextColor = 0
  for (const c of commits) {
    let lane = lanes.indexOf(c.sha)
    const fresh = lane === -1
    if (lane === -1) {
      lane = lanes.indexOf(null)
      if (lane === -1) { lane = lanes.length; lanes.push(null) }
      lanes[lane] = c.sha
      laneColor.set(lane, nextColor++ % LANE_COLORS.length)
    }
    const color = laneColor.get(lane) ?? 0
    const rowLanes = [...lanes]
    const edges: GraphRow['edges'] = []
    // collapse other lanes that also pointed at this commit (merges into this lane)
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === c.sha) { edges.push({ from: i, to: lane, color: laneColor.get(i) ?? 0 }); lanes[i] = null }
    }
    const next = [...lanes]
    const [p0, ...rest] = c.parents
    if (p0) {
      next[lane] = p0
      edges.push({ from: lane, to: lane, color })
    } else next[lane] = null
    for (const p of rest) {
      let target = next.indexOf(p)
      if (target === -1) {
        target = next.indexOf(null, 0)
        if (target === -1 || target === lane) { target = next.length; next.push(null) }
        next[target] = p
        laneColor.set(target, nextColor++ % LANE_COLORS.length)
      }
      edges.push({ from: lane, to: target, color: laneColor.get(target) ?? 0 })
    }
    for (let i = 0; i < next.length; i++) {
      if (i !== lane && next[i] && lanes[i] === next[i]) edges.push({ from: i, to: i, color: laneColor.get(i) ?? 0 })
    }
    rows.push({ commit: c, lane, lanes: rowLanes, edges, color, fresh })
    while (next.length && next[next.length - 1] === null) next.pop()
    lanes = next
  }
  return rows
}
