import type { TrackerSettings } from '@shared/types'
import { LinearProvider } from './linear'
import { NoTracker, type TrackerProvider } from './provider'

const providers: Record<string, TrackerProvider> = { none: new NoTracker(), linear: new LinearProvider() }
let current: TrackerProvider = providers['none']

export function configureTracker(s: TrackerSettings | undefined, onTokensChanged?: (patch: Partial<TrackerSettings>) => void): TrackerProvider {
  const id = s?.provider && providers[s.provider] ? s.provider : 'none'
  current = providers[id]
  if (onTokensChanged) for (const p of Object.values(providers)) p.onTokensChanged = onTokensChanged
  if (s) current.configure(s)
  return current
}
export function tracker(): TrackerProvider { return current }
