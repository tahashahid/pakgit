import type { TrackerIssue, TrackerSettings, TrackerStatus } from '@shared/types'
import type { TrackerProvider } from './provider'

const ENDPOINT = 'https://api.linear.app/graphql'

interface GqlIssue { identifier: string; title: string; url: string; branchName: string; state: { name: string; type: string }; assignee?: { name: string } | null }

export class LinearProvider implements TrackerProvider {
  readonly id = 'linear' as const
  readonly keyPattern = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i
  private apiKey = ''
  private cache = new Map<string, TrackerIssue>()
  private stateCache = new Map<string, { id: string; name: string; type: string }[]>()

  configure(s: TrackerSettings): void { if (s.linearApiKey !== this.apiKey) { this.apiKey = s.linearApiKey ?? ''; this.cache.clear(); this.stateCache.clear() } }
  isConfigured(): boolean { return !!this.apiKey.trim() }
  normalizeKey(key: string): string { return key.toUpperCase() }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.isConfigured()) throw new Error('Linear API key is not set (Settings ▸ Issue tracker)')
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.apiKey.trim() },
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
