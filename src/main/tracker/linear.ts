import type { IssuePage, IssueQuery, TrackerIssue, TrackerSettings, TrackerStatus, TrackerTeam } from '@shared/types'
import type { TrackerProvider } from './provider'

const ENDPOINT = 'https://api.linear.app/graphql'
export const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize'
export const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token'
export const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke'

interface GqlIssue { identifier: string; title: string; url: string; branchName: string; updatedAt?: string; priority?: number; team?: { key: string } | null; state: { name: string; type: string }; assignee?: { name: string; isMe?: boolean } | null; attachments?: { nodes: { url: string }[] } | null }
const FIELDS = 'identifier title url branchName updatedAt priority team { key } state { name type } assignee { name isMe } attachments(first: 20) { nodes { url } }'

export class LinearProvider implements TrackerProvider {
  readonly id = 'linear' as const
  readonly keyPattern = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i
  private settings: TrackerSettings | null = null
  private cache = new Map<string, TrackerIssue>()
  private stateCache = new Map<string, { id: string; name: string; type: string }[]>()
  private teamCache: TrackerTeam[] | null = null
  private viewerId: string | null = null
  onTokensChanged?: (patch: Partial<TrackerSettings>) => void
  private refreshing: Promise<void> | null = null

  configure(s: TrackerSettings): void {
    const prev = this.settings
    this.settings = { ...s }
    if (!prev || prev.authMethod !== s.authMethod || prev.linearApiKey !== s.linearApiKey || prev.linearAccessToken !== s.linearAccessToken) { this.cache.clear(); this.stateCache.clear(); this.teamCache = null; this.viewerId = null }
  }
  isConfigured(): boolean {
    const s = this.settings; if (!s) return false
    return s.authMethod === 'oauth' ? !!s.linearAccessToken : !!s.linearApiKey?.trim()
  }
  normalizeKey(key: string): string { return key.toUpperCase() }
  invalidate(keys?: string[]): void { if (!keys) this.cache.clear(); else for (const k of keys) this.cache.delete(this.normalizeKey(k)) }

  /** Authorization header: raw key for personal API keys, Bearer for OAuth tokens (refreshed when expiring). */
  private async authHeader(): Promise<string> {
    const s = this.settings
    if (!s) throw new Error('Linear is not configured')
    if (s.authMethod !== 'oauth') {
      if (!s.linearApiKey?.trim()) throw new Error('Linear API key is not set (Organization ▸ Configure ▸ Integrations)')
      return s.linearApiKey.trim()
    }
    if (!s.linearAccessToken) throw new Error('Not signed in to Linear (Organization ▸ Configure ▸ Integrations ▸ Sign in)')
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
      key: i.identifier, title: i.title, url: i.url, status: i.state.name, branchName: i.branchName, assignee: i.assignee?.name, assigneeIsMe: i.assignee?.isMe ?? false,
      team: i.team?.key ?? i.identifier.split('-')[0], updatedAt: i.updatedAt, priority: i.priority, links: i.attachments?.nodes.map((a) => a.url).filter(Boolean) ?? [],
      statusType: t === 'backlog' || t === 'unstarted' || t === 'started' || t === 'completed' || t === 'canceled' ? t : 'unknown'
    }
  }

  async status(): Promise<TrackerStatus> {
    if (!this.isConfigured()) return { provider: 'linear', configured: false }
    try {
      const d = await this.gql<{ viewer: { id: string; name: string; organization: { name: string } } }>('{ viewer { id name organization { name } } }')
      this.viewerId = d.viewer.id
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
            `query($team: String!, $numbers: [Float!]!) { issues(first: 100, filter: { team: { key: { eq: $team } }, number: { in: $numbers } }) { nodes { ${FIELDS} } } }`,
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
      `{ issues(first: 100, orderBy: updatedAt, filter: { assignee: { isMe: { eq: true } }, state: { type: { in: ["unstarted", "started"] } } }) { nodes { ${FIELDS} } } }`
    )
    return d.issues.nodes.map((n) => this.toIssue(n))
  }

  async listIssues(q: IssueQuery): Promise<IssuePage> {
    const filter: Record<string, unknown> = {}
    if (q.teams?.length) filter['team'] = { key: { in: q.teams } }
    if (q.states?.length) filter['state'] = { name: { in: q.states } }
    else if (q.stateTypes?.length) filter['state'] = { type: { in: q.stateTypes } }
    if (q.assignee === 'me') filter['assignee'] = { isMe: { eq: true } }
    else if (q.assignee === 'unassigned') filter['assignee'] = { null: true }
    if (q.updatedWithinDays) filter['updatedAt'] = { gte: new Date(Date.now() - q.updatedWithinDays * 86400_000).toISOString() }
    if (q.activeCycle) filter['cycle'] = { isActive: { eq: true } }
    const d = await this.gql<{ issues: { nodes: GqlIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(
      `query($filter: IssueFilter, $first: Int, $after: String) { issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) { nodes { ${FIELDS} } pageInfo { hasNextPage endCursor } } }`,
      { filter, first: Math.min(250, Math.max(1, q.first ?? 100)), after: q.after ?? null }
    )
    const issues = d.issues.nodes.map((n) => this.toIssue(n))
    for (const i of issues) this.cache.set(i.key, i)
    return { issues, nextCursor: d.issues.pageInfo.hasNextPage ? d.issues.pageInfo.endCursor : null }
  }

  async teams(): Promise<TrackerTeam[]> {
    if (!this.isConfigured()) return []
    if (!this.teamCache) {
      const d = await this.gql<{ teams: { nodes: { key: string; name: string }[] } }>('{ teams(first: 100) { nodes { key name } } }')
      this.teamCache = d.teams.nodes.map((t) => ({ key: t.key.toUpperCase(), name: t.name })).sort((a, b) => a.key.localeCompare(b.key))
    }
    return this.teamCache
  }

  private async teamStates(team: string): Promise<{ id: string; name: string; type: string }[]> {
    if (!this.stateCache.has(team)) {
      const d = await this.gql<{ workflowStates: { nodes: { id: string; name: string; type: string }[] } }>(
        `query($team: String!) { workflowStates(filter: { team: { key: { eq: $team } } }) { nodes { id name type } } }`, { team })
      this.stateCache.set(team, d.workflowStates.nodes)
    }
    return this.stateCache.get(team)!
  }
  async keyPrefixes(): Promise<string[]> {
    try { return (await this.teams()).map((t) => t.key) } catch { return [] }
  }
  async states(key: string): Promise<string[]> { return (await this.teamStates(this.normalizeKey(key).split('-')[0])).map((s) => s.name) }

  private async issueId(key: string): Promise<string> {
    const k = this.normalizeKey(key)
    const d = await this.gql<{ issues: { nodes: { id: string }[] } }>(
      `query($team: String!, $num: Float!) { issues(filter: { team: { key: { eq: $team } }, number: { eq: $num } }) { nodes { id } } }`,
      { team: k.split('-')[0], num: +k.split('-')[1] })
    const id = d.issues.nodes[0]?.id
    if (!id) throw new Error(`Issue ${k} not found in Linear`)
    return id
  }

  async setState(key: string, stateName: string): Promise<void> {
    const k = this.normalizeKey(key)
    const states = await this.teamStates(k.split('-')[0])
    const state = states.find((s) => s.name.toLowerCase() === stateName.toLowerCase())
    if (!state) throw new Error(`Linear state "${stateName}" not found for ${k}`)
    const id = await this.issueId(k)
    await this.gql(`mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, { id, stateId: state.id })
    const cached = this.cache.get(k); if (cached) this.cache.set(k, { ...cached, status: state.name, statusType: state.type === 'backlog' || state.type === 'unstarted' || state.type === 'started' || state.type === 'completed' || state.type === 'canceled' ? state.type : 'unknown' })
  }

  async attachPullRequest(key: string, url: string, title?: string): Promise<void> {
    const id = await this.issueId(key)
    await this.gql(`mutation($id: String!, $url: String!, $title: String) { attachmentLinkGitHubPR(issueId: $id, url: $url, title: $title) { success } }`, { id, url, title: title ?? null })
    this.cache.delete(this.normalizeKey(key))
  }

  async assignToMe(key: string): Promise<void> {
    const k = this.normalizeKey(key)
    if (!this.viewerId) { const d = await this.gql<{ viewer: { id: string } }>('{ viewer { id } }'); this.viewerId = d.viewer.id }
    const id = await this.issueId(k)
    await this.gql(`mutation($id: String!, $assigneeId: String!) { issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success } }`, { id, assigneeId: this.viewerId })
    this.cache.delete(k)
  }
}
