/** Jira Cloud provider (REST API v3, e-mail + API token). Issue keys look like Linear's (PROJ-123), so the release engine needs no change. */
import type { IssuePage, IssueQuery, TrackerIssue, TrackerSettings, TrackerStatus, TrackerTeam } from '@shared/types'
import type { TrackerProvider } from './provider'

interface JiraIssue { key: string; fields: { summary: string; updated?: string; priority?: { id: string } | null; project?: { key: string } | null; status: { name: string; statusCategory?: { key: string } }; assignee?: { displayName: string; accountId: string } | null } }
const FIELDS = 'summary,status,assignee,updated,priority,project'

export function statusTypeOf(categoryKey: string | undefined): TrackerIssue['statusType'] {
  if (categoryKey === 'new') return 'unstarted'
  if (categoryKey === 'indeterminate') return 'started'
  if (categoryKey === 'done') return 'completed'
  return 'unknown'
}
const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`
/** JQL for the Work tab filters. */
export function jqlFor(f: IssueQuery): string {
  const parts: string[] = []
  if (f.teams?.length) parts.push(`project in (${f.teams.map(q).join(', ')})`)
  if (f.states?.length) parts.push(`status in (${f.states.map(q).join(', ')})`)
  else if (f.stateTypes?.length) {
    const cats = f.stateTypes.map((t): string | null => (t === 'backlog' || t === 'unstarted' ? 'To Do' : t === 'started' ? 'In Progress' : t === 'completed' ? 'Done' : null)).filter((x): x is string => !!x)
    if (cats.length) parts.push(`statusCategory in (${[...new Set(cats)].map(q).join(', ')})`)
  }
  if (f.assignee === 'me') parts.push('assignee = currentUser()')
  else if (f.assignee === 'unassigned') parts.push('assignee is EMPTY')
  if (f.updatedWithinDays) parts.push(`updated >= -${f.updatedWithinDays}d`)
  if (f.activeCycle) parts.push('sprint in openSprints()')
  return `${parts.join(' AND ')}${parts.length ? ' ' : ''}ORDER BY updated DESC`
}

export class JiraProvider implements TrackerProvider {
  readonly id = 'jira' as const
  readonly keyPattern = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i
  private settings: TrackerSettings | null = null
  private cache = new Map<string, TrackerIssue>()
  private projectCache: TrackerTeam[] | null = null
  private meCache: { accountId: string; displayName: string } | null = null
  onTokensChanged?: (patch: Partial<TrackerSettings>) => void

  configure(s: TrackerSettings): void {
    const prev = this.settings
    this.settings = { ...s }
    if (!prev || prev.jiraSite !== s.jiraSite || prev.jiraEmail !== s.jiraEmail || prev.jiraToken !== s.jiraToken) { this.cache.clear(); this.projectCache = null; this.meCache = null }
  }
  isConfigured(): boolean { const s = this.settings; return !!s && !!s.jiraSite?.trim() && !!s.jiraEmail?.trim() && !!s.jiraToken?.trim() }
  normalizeKey(key: string): string { return key.toUpperCase() }
  invalidate(keys?: string[]): void { if (!keys) this.cache.clear(); else for (const k of keys) this.cache.delete(this.normalizeKey(k)) }

  private site(): string { return (this.settings?.jiraSite ?? '').trim().replace(/\/+$/, '') }
  private async rest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const s = this.settings
    if (!this.isConfigured() || !s) throw new Error('Jira is not configured (Organization ▸ Configure ▸ Integrations)')
    const res = await fetch(`${this.site()}${path}`, {
      method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(20_000),
      headers: { Authorization: 'Basic ' + Buffer.from(`${s.jiraEmail.trim()}:${s.jiraToken.trim()}`).toString('base64'), Accept: 'application/json', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) }
    })
    if (!res.ok) { let msg = `HTTP ${res.status}`; try { const j = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> }; msg = j.errorMessages?.join('; ') || Object.values(j.errors ?? {}).join('; ') || msg } catch { /* keep */ } throw new Error(`Jira: ${msg}`) }
    return res.status === 204 ? ({} as T) : ((await res.json()) as T)
  }
  private toIssue(i: JiraIssue): TrackerIssue {
    const slug = i.fields.summary.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    return {
      key: i.key, title: i.fields.summary, url: `${this.site()}/browse/${i.key}`, status: i.fields.status.name, statusType: statusTypeOf(i.fields.status.statusCategory?.key),
      assignee: i.fields.assignee?.displayName, assigneeIsMe: !!this.meCache && i.fields.assignee?.accountId === this.meCache.accountId,
      branchName: `${i.key.toLowerCase()}-${slug}`, team: i.fields.project?.key ?? i.key.split('-')[0], updatedAt: i.fields.updated, priority: i.fields.priority ? Number(i.fields.priority.id) || undefined : undefined
    }
  }
  private async me(): Promise<{ accountId: string; displayName: string }> {
    if (!this.meCache) this.meCache = await this.rest<{ accountId: string; displayName: string }>('/rest/api/3/myself')
    return this.meCache
  }
  private async search(jql: string, max = 100, nextPageToken?: string): Promise<{ issues: JiraIssue[]; nextPageToken?: string }> {
    const params = new URLSearchParams({ jql, maxResults: String(max), fields: FIELDS })
    if (nextPageToken) params.set('nextPageToken', nextPageToken)
    return this.rest<{ issues: JiraIssue[]; nextPageToken?: string }>(`/rest/api/3/search/jql?${params}`)
  }

  async status(): Promise<TrackerStatus> {
    if (!this.isConfigured()) return { provider: 'jira', configured: false }
    try { const me = await this.me(); return { provider: 'jira', configured: true, account: `${me.displayName} @ ${this.site().replace(/^https?:\/\//, '')}` } }
    catch (e) { return { provider: 'jira', configured: true, error: e instanceof Error ? e.message : String(e) } }
  }
  async getIssues(keys: string[]): Promise<TrackerIssue[]> {
    const wanted = [...new Set(keys.map((k) => this.normalizeKey(k)))]
    const missing = wanted.filter((k) => !this.cache.has(k))
    if (missing.length && this.isConfigured()) {
      await this.me().catch(() => undefined)
      for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50)
        try { const d = await this.search(`key in (${chunk.join(', ')})`, 50); for (const n of d.issues) this.cache.set(n.key, this.toIssue(n)) }
        catch { /* unknown keys make the whole search fail: look them up one by one */ for (const k of chunk) { try { const d = await this.search(`key = ${k}`, 1); for (const n of d.issues) this.cache.set(n.key, this.toIssue(n)) } catch { /* not found */ } } }
      }
    }
    return wanted.map((k) => this.cache.get(k)).filter((x): x is TrackerIssue => !!x)
  }
  async myActiveIssues(): Promise<TrackerIssue[]> { await this.me(); return (await this.search('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC')).issues.map((n) => this.toIssue(n)) }
  async listIssues(f: IssueQuery): Promise<IssuePage> {
    await this.me().catch(() => undefined)
    const d = await this.search(jqlFor(f), Math.min(100, Math.max(1, f.first ?? 100)), f.after || undefined)
    const issues = d.issues.map((n) => this.toIssue(n)); for (const i of issues) this.cache.set(i.key, i)
    return { issues, nextCursor: d.nextPageToken ?? null }
  }
  async teams(): Promise<TrackerTeam[]> {
    if (!this.isConfigured()) return []
    if (!this.projectCache) { const d = await this.rest<{ values: { key: string; name: string }[] }>('/rest/api/3/project/search?maxResults=100'); this.projectCache = d.values.map((p) => ({ key: p.key.toUpperCase(), name: p.name })).sort((a, b) => a.key.localeCompare(b.key)) }
    return this.projectCache
  }
  async keyPrefixes(): Promise<string[]> { try { return (await this.teams()).map((t) => t.key) } catch { return [] } }
  private async transitions(key: string): Promise<{ id: string; name: string; to: { name: string } }[]> { return (await this.rest<{ transitions: { id: string; name: string; to: { name: string } }[] }>(`/rest/api/3/issue/${this.normalizeKey(key)}/transitions`)).transitions }
  async states(key: string): Promise<string[]> { return [...new Set((await this.transitions(key)).map((t) => t.to.name))] }
  async setState(key: string, stateName: string): Promise<void> {
    const k = this.normalizeKey(key)
    const t = (await this.transitions(k)).find((x) => x.to.name.toLowerCase() === stateName.toLowerCase() || x.name.toLowerCase() === stateName.toLowerCase())
    if (!t) throw new Error(`Jira: no transition to "${stateName}" from the current status of ${k}`)
    await this.rest(`/rest/api/3/issue/${k}/transitions`, { method: 'POST', body: { transition: { id: t.id } } })
    this.cache.delete(k)
  }
  async assignToMe(key: string): Promise<void> { const me = await this.me(); await this.rest(`/rest/api/3/issue/${this.normalizeKey(key)}/assignee`, { method: 'PUT', body: { accountId: me.accountId } }); this.cache.delete(this.normalizeKey(key)) }
  async attachPullRequest(key: string, url: string, title?: string): Promise<void> {
    await this.rest(`/rest/api/3/issue/${this.normalizeKey(key)}/remotelink`, { method: 'POST', body: { object: { url, title: title ?? url } } })
  }
}
