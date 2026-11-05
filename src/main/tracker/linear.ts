import type { TrackerIssue, TrackerSettings, TrackerStatus } from '@shared/types'
import type { TrackerProvider } from './provider'

const ENDPOINT = 'https://api.linear.app/graphql'
export const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize'
export const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token'
export const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke'

interface GqlIssue { identifier: string; title: string; url: string; branchName: string; state: { name: string; type: string }; assignee?: { name: string } | null }

export class LinearProvider implements TrackerProvider {
  readonly id = 'linear' as const
  readonly keyPattern = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i
  private settings: TrackerSettings | null = null
  private cache = new Map<string, TrackerIssue>()
  private stateCache = new Map<string, { id: string; name: string; type: string }[]>()
  onTokensChanged?: (patch: Partial<TrackerSettings>) => void
  private refreshing: Promise<void> | null = null

  configure(s: TrackerSettings): void {
    const prev = this.settings
    this.settings = { ...s }
    if (!prev || prev.authMethod !== s.authMethod || prev.linearApiKey !== s.linearApiKey || prev.linearAccessToken !== s.linearAccessToken) { this.cache.clear(); this.stateCache.clear() }
  }
  isConfigured(): boolean {
    const s = this.settings; if (!s) return false
    return s.authMethod === 'oauth' ? !!s.linearAccessToken : !!s.linearApiKey?.trim()
  }
  normalizeKey(key: string): string { return key.toUpperCase() }

  /** Authorization header: raw key for personal API keys, Bearer for OAuth tokens (refreshed when expiring). */
  private async authHeader(): Promise<string> {
    const s = this.settings
    if (!s) throw new Error('Linear is not configured')
    if (s.authMethod !== 'oauth') {
      if (!s.linearApiKey?.trim()) throw new Error('Linear API key is not set (Settings ▸ Issue tracker)')
      return s.linearApiKey.trim()
    }
    if (!s.linearAccessToken) throw new Error('Not signed in to Linear (Settings ▸ Issue tracker ▸ Sign in)')
    if (s.linearTokenExpiry && Date.now() > s.linearTokenExpiry - 5 * 60_000 && s.linearRefreshToken) await this.refresh()
    return `Bearer ${this.settings!.linearAccessToken}`
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      const s = this.settings!
      const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.linearRefreshToken, client_id: s.linearClientId })
      if (s.linearClientSecret) body.set('client_secret', s.linearClientSecret)
      const res = await fetch(LINEAR_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
      const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
      if (!res.ok || !json.access_token) throw new Error(`Linear token refresh failed: ${json.error_description || json.error || res.status}. Sign in again.`)
      const patch: Partial<TrackerSettings> = { linearAccessToken: json.access_token, linearRefreshToken: json.refresh_token ?? s.linearRefreshToken, linearTokenExpiry: Date.now() + (json.expires_in ?? 86400) * 1000 }
      this.settings = { ...s, ...patch }
      this.onTokensChanged?.(patch)
    })().finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const auth = await this.authHeader()
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ query, variables })
    })
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (!res.ok || json.errors?.length) throw new Error(json.errors?.map((e) => e.message).join('; ') || `Linear API error ${res.status}`)
    return json.data as T
  }

  private toIssue(i: GqlIssue): TrackerIssue {
    const t = i.state.type
    return {
      key: i.identifier, title: i.title, url: i.url, status: i.state.name, branchName: i.branchName, assignee: i.assignee?.name,
      statusType: t === 'backlog' || t === 'unstarted' || t === 'started' || t === 'completed' || t === 'canceled' ? t : 'unknown'
    }
  }

  async status(): Promise<TrackerStatus> {
    if (!this.isConfigured()) return { provider: 'linear', configured: false }
    try {
      const d = await this.gql<{ viewer: { name: string; organization: { name: string } } }>('{ viewer { name organization { name } } }')
      return { provider: 'linear', configured: true, account: `${d.viewer.name} @ ${d.viewer.organization.name}` }
    } catch (e) { return { provider: 'linear', configured: true, error: e instanceof Error ? e.message : String(e) } }
  }

  async getIssues(keys: string[]): Promise<TrackerIssue[]> {
    const wanted = [...new Set(keys.map((k) => this.normalizeKey(k)))]
    const missing = wanted.filter((k) => !this.cache.has(k))
    if (missing.length && this.isConfigured()) {
      // group by team key, query numbers per team
      const byTeam = new Map<string, number[]>()
      for (const k of missing) { const [team, num] = k.split('-'); if (!byTeam.has(team)) byTeam.set(team, []); byTeam.get(team)!.push(+num) }
      for (const [team, numbers] of byTeam) {
        for (let i = 0; i < numbers.length; i += 100) {
          const chunk = numbers.slice(i, i + 100)
          const d = await this.gql<{ issues: { nodes: GqlIssue[] } }>(
            `query($team: String!, $numbers: [Float!]!) { issues(first: 100, filter: { team: { key: { eq: $team } }, number: { in: $numbers } }) { nodes { identifier title url branchName state { name type } assignee { name } } } }`,
            { team, numbers: chunk }
          )
          for (const n of d.issues.nodes) this.cache.set(n.identifier, this.toIssue(n))
        }
      }
    }
    return wanted.map((k) => this.cache.get(k)).filter((x): x is TrackerIssue => !!x)
  }

  async myActiveIssues(): Promise<TrackerIssue[]> {
    const d = await this.gql<{ issues: { nodes: GqlIssue[] } }>(
      `{ issues(first: 100, orderBy: updatedAt, filter: { assignee: { isMe: { eq: true } }, state: { type: { in: ["unstarted", "started"] } } }) { nodes { identifier title url branchName state { name type } assignee { name } } } }`
    )
    return d.issues.nodes.map((n) => this.toIssue(n))
  }

  private async teamStates(team: string): Promise<{ id: string; name: string; type: string }[]> {
    if (!this.stateCache.has(team)) {
      const d = await this.gql<{ workflowStates: { nodes: { id: string; name: string; type: string }[] } }>(
        `query($team: String!) { workflowStates(filter: { team: { key: { eq: $team } } }) { nodes { id name type } } }`, { team })
      this.stateCache.set(team, d.workflowStates.nodes)
    }
    return this.stateCache.get(team)!
  }
  async states(key: string): Promise<string[]> { return (await this.teamStates(this.normalizeKey(key).split('-')[0])).map((s) => s.name) }

  async setState(key: string, stateName: string): Promise<void> {
    const k = this.normalizeKey(key)
    const states = await this.teamStates(k.split('-')[0])
    const state = states.find((s) => s.name.toLowerCase() === stateName.toLowerCase())
    if (!state) throw new Error(`Linear state "${stateName}" not found for ${k}`)
    const d = await this.gql<{ issues: { nodes: { id: string }[] } }>(
      `query($team: String!, $num: Float!) { issues(filter: { team: { key: { eq: $team } }, number: { eq: $num } }) { nodes { id } } }`,
      { team: k.split('-')[0], num: +k.split('-')[1] })
    const id = d.issues.nodes[0]?.id
    if (!id) throw new Error(`Issue ${k} not found in Linear`)
    await this.gql(`mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, { id, stateId: state.id })
    const cached = this.cache.get(k); if (cached) this.cache.set(k, { ...cached, status: state.name })
  }
}
