/** Notifications (phase 4): Slack incoming webhooks with messages about release events. */
import type { ReleaseRecord, ReleaseRepo } from '@shared/types'

export type ReleaseEvent = 'created' | 'merged' | 'finished' | 'reverted'
export type Notifier = (event: ReleaseEvent, rec: ReleaseRecord, extra?: { repo?: ReleaseRepo; notes?: string }) => Promise<void>

export async function postSlack(webhook: string, text: string): Promise<void> {
  const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Slack webhook: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`)
}

const prText = (rr: ReleaseRepo): string => rr.pr ? `<${rr.pr.url}|PR #${rr.pr.number}> ${rr.pr.state}` : rr.prUrl ? `<${rr.prUrl}|pull request>` : 'no pull request'
const repoLine = (rr: ReleaseRepo): string => `• *${rr.name}*: ${rr.dropped ? `dropped (${rr.dropped})` : rr.error ? `error: ${rr.error}` : rr.paused ? `paused: conflict in ${rr.paused.conflict}` : `${prText(rr)}${rr.onEnv ? ' · landed' : ''}`}`
const itemsLine = (rec: ReleaseRecord): string => rec.items.map((it) => (it.url ? `<${it.url}|${it.issueKey ?? it.id}>` : it.issueKey ?? it.id)).join(', ')

/** Slack mrkdwn message for a release event. */
export function releaseMessage(event: ReleaseEvent, rec: ReleaseRecord, orgName: string, extra?: { repo?: ReleaseRepo; notes?: string }): string {
  const head = `*${rec.name}* → ${rec.envBranch} (${orgName})`
  if (event === 'created') return `${head} created${rec.createdBy ? ` by ${rec.createdBy}` : ''}\n${rec.repos.map(repoLine).join('\n')}\nItems: ${itemsLine(rec)}`
  if (event === 'merged' && extra?.repo) return `${head}: *${extra.repo.name}* ${prText(extra.repo)}${extra.repo.pr?.state === 'merged' ? ' ✓' : ''}`
  if (event === 'finished') return `${head} finished ✓\n${rec.repos.filter((r) => !r.dropped).map(repoLine).join('\n')}${extra?.notes ? `\n\`\`\`\n${extra.notes.slice(0, 2500)}\n\`\`\`` : ''}`
  if (event === 'reverted') return `${head} reverted ⚠\n${rec.repos.filter((r) => r.revert).map((r) => `• *${r.name}*: ${r.revert!.pr ? `<${r.revert!.pr.url}|PR #${r.revert!.pr.number}>` : r.revert!.prUrl ? `<${r.revert!.prUrl}|pull request>` : r.revert!.branch}`).join('\n')}`
  return `${head}: ${event}`
}

/** A notifier that posts to Slack when the organization enabled the event; errors are swallowed (notifications never block a release). */
export function slackNotifier(webhook: string, orgName: string, events: Record<ReleaseEvent, boolean>, post: (webhook: string, text: string) => Promise<void> = postSlack): Notifier {
  return async (event, rec, extra) => {
    if (!events[event] || !webhook.trim()) return
    try { await post(webhook.trim(), releaseMessage(event, rec, orgName, extra)) } catch { /* best effort */ }
  }
}
