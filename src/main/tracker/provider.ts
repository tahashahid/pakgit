import type { TrackerId, TrackerIssue, TrackerSettings, TrackerStatus } from '@shared/types'

/** Pluggable issue-tracker provider. Implement this for Jira, GitHub Issues, etc. */
export interface TrackerProvider {
  readonly id: TrackerId
  /** called when the provider refreshed its tokens and they must be persisted */
  onTokensChanged?: (patch: Partial<TrackerSettings>) => void
  /** matches issue keys inside branch names and commit messages (case-insensitive) */
  readonly keyPattern: RegExp
  configure(settings: TrackerSettings): void
  isConfigured(): boolean
  status(): Promise<TrackerStatus>
  getIssues(keys: string[]): Promise<TrackerIssue[]>
  myActiveIssues(): Promise<TrackerIssue[]>
  states(key: string): Promise<string[]>
  setState(key: string, stateName: string): Promise<void>
  /** normalise a key found in text to the canonical form, e.g. cyb4-12 -> CYB4-12 */
  normalizeKey(key: string): string
}

export class NoTracker implements TrackerProvider {
  readonly id = 'none' as const
  readonly keyPattern = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i
  configure(): void { /* nothing */ }
  isConfigured(): boolean { return false }
  async status(): Promise<TrackerStatus> { return { provider: 'none', configured: false } }
  async getIssues(): Promise<TrackerIssue[]> { return [] }
  async myActiveIssues(): Promise<TrackerIssue[]> { return [] }
  async states(): Promise<string[]> { return [] }
  async setState(): Promise<void> { throw new Error('No issue tracker configured') }
  normalizeKey(key: string): string { return key.toUpperCase() }
}
