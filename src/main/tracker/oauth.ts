import { createServer, type Server } from 'http'
import { createHash, randomBytes } from 'crypto'
import { shell } from 'electron'
import type { TrackerSettings } from '@shared/types'
import { LINEAR_AUTHORIZE_URL, LINEAR_REVOKE_URL, LINEAR_TOKEN_URL } from './linear'

/** Fixed port so the redirect URL can be registered on the OAuth application. */
export const OAUTH_PORT = 48422
export const OAUTH_REDIRECT = `http://localhost:${OAUTH_PORT}/callback`

let pending: Server | null = null

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const page = (title: string, body: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b6b3a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center;max-width:420px"><h1 style="font-weight:600">${title}</h1><p style="opacity:.85">${body}</p></div></body>`

/**
 * Authorization-code flow with PKCE: open the browser, wait for the callback on localhost,
 * exchange the code. Returns the token fields to merge into the tracker settings.
 */
export async function linearLogin(s: TrackerSettings): Promise<Partial<TrackerSettings>> {
  if (!s.linearClientId?.trim()) throw new Error('Set the Linear OAuth client ID first (Settings ▸ Issue tracker)')
  if (pending) { pending.close(); pending = null }
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Linear sign-in timed out (5 minutes)')) }, 5 * 60_000)
    const cleanup = () => { clearTimeout(timer); pending?.close(); pending = null }
    pending = createServer((req, res) => {
      const url = new URL(req.url ?? '/', OAUTH_REDIRECT)
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return }
      const err = url.searchParams.get('error')
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page('Sign-in cancelled', `Linear returned: ${err}. You can close this window.`))
        cleanup(); reject(new Error(`Linear sign-in failed: ${url.searchParams.get('error_description') ?? err}`)); return
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' }); res.end(page('Sign-in failed', 'State mismatch. Please try again from PakGit.'))
        cleanup(); reject(new Error('OAuth state mismatch')); return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page('PakGit is connected to Linear', 'You can close this window and return to PakGit.'))
      cleanup(); resolve(url.searchParams.get('code') ?? '')
    })
    pending.on('error', (e) => { cleanup(); reject(new Error(`Could not listen on port ${OAUTH_PORT}: ${e.message}`)) })
    pending.listen(OAUTH_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_id: s.linearClientId.trim(), redirect_uri: OAUTH_REDIRECT, response_type: 'code', scope: 'read,write',
        state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'consent', actor: 'user'
      })
      void shell.openExternal(`${LINEAR_AUTHORIZE_URL}?${params.toString()}`)
    })
  })
  if (!code) throw new Error('Linear did not return an authorization code')

  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: OAUTH_REDIRECT, client_id: s.linearClientId.trim(), code_verifier: verifier })
  if (s.linearClientSecret?.trim()) body.set('client_secret', s.linearClientSecret.trim())
  const res = await fetch(LINEAR_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !json.access_token) throw new Error(`Linear token exchange failed: ${json.error_description || json.error || res.status}`)
  return { linearAccessToken: json.access_token, linearRefreshToken: json.refresh_token ?? '', linearTokenExpiry: Date.now() + (json.expires_in ?? 86400) * 1000 }
}

export async function linearLogout(s: TrackerSettings): Promise<void> {
  if (s.linearAccessToken) {
    await fetch(LINEAR_REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: s.linearAccessToken }) }).catch(() => undefined)
  }
}
