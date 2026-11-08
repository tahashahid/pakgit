import type { HostingId, HostingStatus, PullRequestStatus } from '@shared/types'

export interface CreatePrRequest { head: string; base: string; title: string; body: string; draft?: boolean; reviewers?: string[]; labels?: string[] }

/** Pluggable hosting provider: pull-request state and creation. GitHub is the first; GitLab / Bitbucket can implement the same shape. */
export interface HostingProvider {
  readonly id: HostingId
  /** account-level status (gh login or token); with a repository, also whether its remote is served by this provider */
  status(repo?: string): Promise<HostingStatus>
  /** the repository's remote is on this provider and credentials are available */
  supports(repo: string): Promise<boolean>
  /** pull requests of the repository in every state, newest first (cached unless fresh) */
  listPullRequests(repo: string, fresh?: boolean): Promise<PullRequestStatus[]>
  /** one pull request by number or head branch, with checks and review decision; null when there is none */
  pullRequest(repo: string, ref: number | string): Promise<PullRequestStatus | null>
  createPullRequest(repo: string, req: CreatePrRequest): Promise<PullRequestStatus>
}

export class NoHosting implements HostingProvider {
  readonly id = 'none' as const
  async status(): Promise<HostingStatus> { return { provider: 'none', available: false } }
  async supports(): Promise<boolean> { return false }
  async listPullRequests(): Promise<PullRequestStatus[]> { return [] }
  async pullRequest(): Promise<PullRequestStatus | null> { return null }
  async createPullRequest(): Promise<PullRequestStatus> { throw new Error('No hosting provider connected') }
}
