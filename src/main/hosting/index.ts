import type { HostingConfig } from '@shared/types'
import { GitHubProvider } from './github'
import { NoHosting, type HostingProvider } from './provider'

/** One hosting provider per organization (each can use a different account or token). */
const none = new NoHosting()
const instances = new Map<string, HostingProvider>()

export function configureHostingFor(orgId: string, cfg: HostingConfig, auth: { token?: string; ghPath?: string }): HostingProvider {
  const wanted = cfg.provider === 'none' ? 'none' : 'github'
  let p = instances.get(orgId)
  if (!p || p.id !== wanted) { p = wanted === 'github' ? new GitHubProvider() : none; instances.set(orgId, p) }
  if (p instanceof GitHubProvider) p.configure({ token: auth.token, ghPath: auth.ghPath })
  return p
}
export function hostingFor(orgId: string): HostingProvider { return instances.get(orgId) ?? none }
/** Replace the provider of an organization (tests inject a fake). */
export function setHostingFor(orgId: string, p: HostingProvider): void { instances.set(orgId, p) }
