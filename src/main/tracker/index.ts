import type { TrackerSettings } from '@shared/types'
import { LinearProvider } from './linear'
import { NoTracker, type TrackerProvider } from './provider'

/**
 * One provider instance per organization (each organization can connect a different Linear
 * workspace). `tracker()` returns the active organization's provider.
 */
const none = new NoTracker()
const instances = new Map<string, TrackerProvider>()
let activeOrg = 'personal'

export function configureTrackerFor(orgId: string, s: TrackerSettings | undefined, onTokensChanged?: (patch: Partial<TrackerSettings>) => void): TrackerProvider {
  const id = s?.provider ?? 'none'
  let p = instances.get(orgId)
  if (!p || p.id !== id) { p = id === 'linear' ? new LinearProvider() : none; instances.set(orgId, p) }
  if (onTokensChanged) p.onTokensChanged = onTokensChanged
  if (s && p.id !== 'none') p.configure(s)
  return p
}
export function setActiveTrackerOrg(orgId: string): void { activeOrg = orgId }
export function trackerFor(orgId: string): TrackerProvider { return instances.get(orgId) ?? none }
export function tracker(): TrackerProvider { return trackerFor(activeOrg) }
/** kept for callers that configure a single tracker (tests) */
export function configureTracker(s: TrackerSettings | undefined, onTokensChanged?: (patch: Partial<TrackerSettings>) => void): TrackerProvider {
  return configureTrackerFor(activeOrg, s, onTokensChanged)
}
