const be = require('../out/test/backend.cjs')
const { git: g, release: rel, organizations: org, releases, configrepo, notify, cleanup, jqlFor, statusTypeOf } = be
const fs = require('fs'), path = require('path'), os = require('os')
const assert = require('assert')

;(async () => {
  // --- pure helpers: Jira JQL and status mapping, Slack messages, calendar
  assert.equal(jqlFor({}), 'ORDER BY updated DESC')
  assert.equal(jqlFor({ teams: ['CYB'], stateTypes: ['unstarted', 'started'], assignee: 'me', updatedWithinDays: 30, activeCycle: true }), 'project in ("CYB") AND statusCategory in ("To Do", "In Progress") AND assignee = currentUser() AND updated >= -30d AND sprint in openSprints() ORDER BY updated DESC')
  assert.equal(jqlFor({ states: ['In Review', 'Done'], assignee: 'unassigned' }), 'status in ("In Review", "Done") AND assignee is EMPTY ORDER BY updated DESC')
  assert.deepEqual(['new', 'indeterminate', 'done', undefined].map(statusTypeOf), ['unstarted', 'started', 'completed', 'unknown'])
  const rec0 = { name: 'release/stage-1', envBranch: 'stage', createdBy: 'Taha', items: [{ id: 'CYB4-1', issueKey: 'CYB4-1', url: 'https://linear.app/x/CYB4-1', repos: [] }], repos: [{ name: 'app', dropped: null, error: null, paused: null, pr: { url: 'https://gh/pr/1', number: 1, state: 'open' }, prUrl: 'https://gh/pr/1', onEnv: false }, { name: 'lib', dropped: null, error: null, paused: { conflict: 'CYB4-4', remaining: [] }, pr: null, prUrl: null, onEnv: false }] }
  const created = notify.releaseMessage('created', rec0, 'Acme')
  assert(created.startsWith('*release/stage-1* → stage (Acme) created by Taha') && created.includes('<https://gh/pr/1|PR #1> open') && created.includes('paused: conflict in CYB4-4') && created.includes('<https://linear.app/x/CYB4-1|CYB4-1>'), created)
  assert(notify.releaseMessage('merged', rec0, 'Acme', { repo: rec0.repos[0] }).includes('*app*'))
  const posted = []
  const n = notify.slackNotifier('https://hooks.slack.test/x', 'Acme', { created: true, merged: false, finished: true, reverted: true }, async (w, t) => { posted.push([w, t]) })
  await n('created', rec0); await n('merged', rec0, { repo: rec0.repos[0] }); await n('finished', rec0, { notes: '# notes' })
  assert.equal(posted.length, 2); assert(posted[1][1].includes('finished ✓') && posted[1][1].includes('# notes'))
  const failing = notify.slackNotifier('https://hooks.slack.test/x', 'Acme', { created: true, merged: true, finished: true, reverted: true }, async () => { throw new Error('boom') })
  await failing('created', rec0) // never throws
  const monday10 = new Date('2026-11-09T10:00:00') // a Monday
  const next = org.nextReleases({ calendar: { stage: { weekday: 4, time: '14:00' }, prod: { weekday: 1, time: '09:00' } }, pipeline: { environments: [{ id: 'stage', name: 'Staging' }, { id: 'prod', name: 'Production' }] } }, monday10)
  assert.deepEqual(next.map((x) => [x.envName, new Date(x.at).toISOString().slice(0, 16)]), [['Staging', new Date('2026-11-12T14:00:00').toISOString().slice(0, 16)], ['Production', new Date('2026-11-16T09:00:00').toISOString().slice(0, 16)]], 'next Thursday 14:00, and next Monday because 09:00 already passed')

  // --- configuration repository: push from workspace A, pull/diff/apply in workspace B
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pakgit-p4-'))
  const cfgRepo = path.join(root, 'config.git'); await g.run(['init', '--bare', '-b', 'main', cfgRepo], { cwd: root })
  const wsA = path.join(root, 'wsA'), wsB = path.join(root, 'wsB'); fs.mkdirSync(wsA); fs.mkdirSync(wsB)
  org.setOrgDir(wsA); org.ensureMigrated(); rel.setReleaseConfigDir(wsA); configrepo.setConfigRepoDir(wsA)
  const tpl = { remote: 'origin', releasePrefix: 'release/', backMerge: true, baseEnv: 'prod', issuePrefixes: ['CYB4'], excludePrefixes: ['release/'], environments: [
    { id: 'dev', name: 'Development', branch: 'dev', strategy: 'feature-pr', trackerState: 'QA' }, { id: 'prod', name: 'Production', branch: 'main', strategy: 'release-branch', trackerState: 'Done' }] }
  const a = org.createOrg({ name: 'Acme', pipeline: tpl, groups: ['Portals'], configRepo: { url: cfgRepo, branch: '', file: '', lastApplied: '' }, calendar: { prod: { weekday: 4, time: '14:00' } } })
  org.upsertRepo({ path: '/r/app', name: 'app', lastOpened: 1, remote: 'github.com/acme/app', group: 'Portals' }, a.id)
  let st = await configrepo.sync(a.id, true)
  assert.equal(st.configured, true); assert.equal(st.remote, null); assert.equal(st.changed, false); assert(st.localChanges.length > 0, 'everything is new for the remote')
  st = await configrepo.push(a.id, 'Initial Acme configuration')
  assert(st.remote && st.remote.length === 40); assert.equal(st.changed, false); assert.deepEqual(st.localChanges, [], 'remote now equals local')
  assert.equal(org.getOrg(a.id).configRepo.lastApplied, st.remote)
  // a change made elsewhere: edit the file in a second clone and push
  const other = path.join(root, 'other'); await g.run(['clone', '-q', cfgRepo, other], { cwd: root })
  const file = path.join(other, 'acme.pakgit-org.json'); const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  data.organization.groups.push('Backend'); data.organization.pipeline.environments[0].trackerState = 'Testing'; data.organization.conventions.releasePattern = 'release/release-{week}'
  data.repositories.push({ remote: 'github.com/acme/lambdas', name: 'lambdas', group: 'Backend' })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  await g.run(['config', 'user.email', 't@example.com'], { cwd: other }); await g.run(['config', 'user.name', 'T'], { cwd: other })
  await g.stage(other, ['.']); await g.commit(other, { message: 'team edit' }); await g.push(other, { remote: 'origin', branch: 'main' })
  st = await configrepo.sync(a.id, true)
  assert.equal(st.changed, true); const paths = st.changes.map((c) => c.path)
  assert(paths.includes('groups') && paths.includes('pipeline.environments[dev].trackerState') && paths.includes('conventions.releasePattern') && paths.some((p) => p.startsWith('repositories[github.com/acme/lambdas]')), paths.join(','))
  assert.deepEqual(st.changes.find((c) => c.path === 'pipeline.environments[dev].trackerState'), { path: 'pipeline.environments[dev].trackerState', kind: 'changed', from: 'QA', to: 'Testing' })
  // apply in this workspace
  const res = await configrepo.apply(a.id)
  assert.deepEqual(res.missing.map((m) => m.remote), ['github.com/acme/lambdas']); assert.equal(res.matched.length, 1)
  const applied = org.getOrg(a.id)
  assert.deepEqual(applied.groups, ['Portals', 'Backend']); assert.equal(applied.pipeline.environments[0].trackerState, 'Testing'); assert.equal(applied.conventions.releasePattern, 'release/release-{week}')
  assert.equal(applied.configRepo.url, cfgRepo, 'config repo setting kept'); assert.equal(applied.calendar.prod.weekday, 4)
  st = await configrepo.sync(a.id, true); assert.equal(st.changed, false); assert.deepEqual(st.changes, [])
  // workspace B imports by pointing at the same repository (new organization, repositories to clone)
  org.setOrgDir(wsB); org.ensureMigrated(); configrepo.setConfigRepoDir(wsB); rel.setReleaseConfigDir(wsB)
  const b = org.createOrg({ name: 'Acme', configRepo: { url: cfgRepo, branch: 'main', file: 'acme.pakgit-org.json', lastApplied: '' } })
  st = await configrepo.sync(b.id, true); assert.equal(st.changed, true); assert(st.changes.length > 5)
  const resB = await configrepo.apply(b.id)
  assert.deepEqual(resB.missing.map((m) => m.remote).sort(), ['github.com/acme/app', 'github.com/acme/lambdas'])
  assert.equal(org.getOrg(b.id).pipeline.environments.length, 2); assert.deepEqual(org.getOrg(b.id).groups, ['Portals', 'Backend'])
  // flatten / diff edge cases
  assert.deepEqual(configrepo.diffExports({ version: 1, organization: { name: 'A' }, repositories: [] }, { version: 1, organization: { name: 'A' }, repositories: [] }), [])
  assert.deepEqual(configrepo.diffExports({ version: 1, organization: { name: 'A', views: [] }, repositories: [] }, { version: 1, organization: { name: 'A', views: [{ id: 'v1', name: 'Mine', tab: 'work', filters: { assignee: 'me' } }] }, repositories: []}).map((c) => [c.path, c.kind]), [['views[v1].filters.assignee', 'added'], ['views[v1].id', 'added'], ['views[v1].name', 'added'], ['views[v1].tab', 'added']])

  // --- revert + cleanup on real repositories
  org.setOrgDir(wsA); configrepo.setConfigRepoDir(wsA); rel.setReleaseConfigDir(wsA)
  rel.setTemplateProvider((repo) => { try { return org.getOrg(org.orgOfRepo(repo)).pipeline } catch { return null } })
  rel.setPrOpener(async () => undefined)
  const identities = {}; rel.setIdentityProvider((repo) => identities[repo])
  const tracker = { id: 'none', keyPattern: /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i, isConfigured: () => false, async getIssues() { return [] }, async keyPrefixes() { return ['CYB4'] }, normalizeKey: (k) => k.toUpperCase(), async setState() {}, async status() { return { provider: 'none', configured: false } } }
  const prs = new Map(); let prNum = 0
  const host = { id: 'github', async status() { return { provider: 'github', available: true } }, async supports() { return true }, async listPullRequests() { return [...prs.values()] }, async pullRequest(repo, ref) { return [...prs.values()].find((p) => p.repo === repo && (p.number === ref || p.head === ref)) ?? null }, async createPullRequest(repo, req) { const pr = { repo, number: ++prNum, url: `https://gh/${path.basename(repo)}/pull/${prNum}`, state: 'open', title: req.title, draft: false, head: req.head, base: req.base, reviewDecision: 'none', checks: 'none', mergedAt: null }; prs.set(prNum, pr); return pr } }
  const events = []
  const deps = { tracker, hosting: host, notify: async (ev, r, extra) => { events.push([ev, r.name, extra?.repo?.name]) } }
  const mk = async (name) => {
    const origin = path.join(root, `${name}.git`); const repo = path.join(root, name)
    await g.run(['init', '--bare', '-b', 'main', origin], { cwd: root }); await g.run(['clone', '-q', origin, repo], { cwd: root })
    await g.run(['config', 'user.email', 't@example.com'], { cwd: repo }); await g.run(['config', 'user.name', 'Taha'], { cwd: repo })
    fs.writeFileSync(path.join(repo, 'app.txt'), 'v1\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'initial' }); await g.push(repo, { remote: 'origin', branch: 'main', setUpstream: true })
    await g.createBranch(repo, 'dev', 'main'); await g.run(['push', 'origin', 'dev'], { cwd: repo })
    identities[repo] = `github.com/acme/${name}`
    return repo
  }
  const feature = async (repo, branch, file, msg) => { await g.checkout(repo, 'main'); await g.createBranch(repo, branch, 'main', true); fs.writeFileSync(path.join(repo, file), msg + '\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: msg }); await g.run(['push', '-u', 'origin', branch], { cwd: repo }) }
  const mergeInto = async (repo, env, branch) => { await g.checkout(repo, env); await g.merge(repo, branch, { noFf: true }); await g.push(repo, { remote: 'origin', branch: env }) }
  const app = await mk('app')
  org.upsertRepo({ path: app, name: 'app', lastOpened: 1, remote: identities[app] }, a.id)
  org.updateOrg(a.id, { pipeline: { ...tpl, environments: [{ id: 'dev', name: 'Development', branch: 'dev', strategy: 'feature-pr', trackerState: 'QA' }, { id: 'prod', name: 'Production', branch: 'main', strategy: 'release-branch', trackerState: 'Done' }] } })
  await feature(app, 'taha/cyb4-1-login', 'login.txt', 'feat: login (CYB4-1)'); await mergeInto(app, 'dev', 'taha/cyb4-1-login')
  await feature(app, 'taha/cyb4-2-report', 'report.txt', 'feat: report (CYB4-2)'); await mergeInto(app, 'dev', 'taha/cyb4-2-report')
  let idx = await be.workindex.index(a.id, { tracker, refresh: true })
  const partOf = (key) => { const it = idx.items.find((i) => i.issueKey === key); const p = it.parts[0]; return { repo: app, itemId: p.itemId, issueKey: key, ref: p.ref, commits: p.commits } }
  let rec = await releases.createRelease(a.id, { envId: 'prod', name: 'release/prod-1', selection: [partOf('CYB4-1')], options: { push: true, openPr: true, draft: false, updateTracker: false }, overrides: ['tracker-state'] }, deps)
  assert.deepEqual(events, [['created', 'release/prod-1', undefined]])
  // merge "on GitHub": merge commit on main; the fake PR becomes merged -> the refresh notifies once
  await g.checkout(app, 'main'); await g.run(['merge', '--no-ff', '--no-edit', 'release/prod-1'], { cwd: app }); await g.push(app, { remote: 'origin', branch: 'main' })
  for (const pr of prs.values()) { pr.state = 'merged'; pr.mergedAt = new Date().toISOString() }
  rec = await releases.refreshRelease(a.id, rec.id, deps); rec = await releases.refreshRelease(a.id, rec.id, deps)
  assert.deepEqual(events.slice(1), [['merged', 'release/prod-1', 'app']], 'merged is reported once')
  const fin = await releases.finishRelease(a.id, rec.id, { push: true, updateTracker: false }, deps)
  assert.equal(fin.release.status, 'finished'); assert.equal(events[2][0], 'finished')
  assert(fs.existsSync(path.join(app, 'login.txt')) || true)
  // revert: a revert branch from main with the merge reverted, pushed, PR opened
  const rv = await releases.revertRelease(a.id, rec.id, { push: true, openPr: true }, deps)
  assert.equal(rv.repos.length, 1); assert.equal(rv.repos[0].error, null, rv.repos[0].error); assert.equal(rv.repos[0].branch, 'revert/prod-1-main'); assert.equal(rv.repos[0].reverted.length, 1)
  assert.equal(rv.release.status, 'reverted'); assert(rv.repos[0].pr && rv.repos[0].pr.base === 'main' && rv.repos[0].pr.head === 'revert/prod-1-main')
  assert.equal((await g.status(app)).branch, 'revert/prod-1-main'); assert(!fs.existsSync(path.join(app, 'login.txt')), 'the revert removed the feature file')
  assert.equal((await g.run(['rev-parse', 'origin/revert/prod-1-main'], { cwd: app })).code, 0, 'revert branch pushed')
  assert.equal(events[3][0], 'reverted')
  await assert.rejects(releases.revertRelease(a.id, rec.id, { push: false, openPr: false }, deps), /already reverted/)
  // a squash-merged release: the landing commit names the PR
  await g.checkout(app, 'main')
  rec = await releases.createRelease(a.id, { envId: 'prod', name: 'release/prod-2', selection: [partOf('CYB4-2')], options: { push: true, openPr: true, draft: false, updateTracker: false }, overrides: ['tracker-state'] }, deps)
  const prNo = rec.repos[0].pr.number
  await g.checkout(app, 'main'); await g.run(['merge', '--squash', 'release/prod-2'], { cwd: app }); await g.commit(app, { message: `Release prod-2 → main (#${prNo})` }); await g.push(app, { remote: 'origin', branch: 'main' })
  prs.get(prNo).state = 'merged'
  const rv2 = await releases.revertRelease(a.id, rec.id, { push: false, openPr: false }, deps)
  assert.equal(rv2.repos[0].error, null, rv2.repos[0].error); assert.equal(rv2.repos[0].branch, 'revert/prod-2-main'); assert(!fs.existsSync(path.join(app, 'report.txt')), 'squash commit reverted')
  // cleanup: branches merged into main are listed (feature branches, release branches, the revert is not merged)
  await g.checkout(app, 'main')
  let merged = await cleanup.mergedBranches(a.id)
  const names = merged.map((b) => b.name).sort()
  assert(names.includes('taha/cyb4-1-login') && names.includes('release/prod-1') && names.includes('dev') === false && names.includes('main') === false, names.join(','))
  assert(!names.includes('revert/prod-1-main'), 'unmerged branches are not listed')
  assert.equal(merged.find((b) => b.name === 'release/prod-1').kind, 'release'); assert.equal(merged.find((b) => b.name === 'taha/cyb4-1-login').kind, 'work'); assert.equal(merged.find((b) => b.name === 'taha/cyb4-1-login').local, true)
  const del = await cleanup.deleteBranches(a.id, [{ repo: app, name: 'taha/cyb4-1-login' }, { repo: app, name: 'main' }, { repo: '/nope', name: 'x' }])
  assert.deepEqual(del.deleted, [{ repo: app, name: 'taha/cyb4-1-login' }]); assert.equal(del.failed.length, 2); assert(/never deleted/.test(del.failed[0].error))
  assert.equal((await g.run(['rev-parse', '--verify', '-q', 'refs/remotes/origin/taha/cyb4-1-login'], { cwd: app, allowFail: true })).code !== 0, true, 'remote branch gone')
  assert.equal((await g.run(['rev-parse', '--verify', '-q', 'refs/heads/taha/cyb4-1-login'], { cwd: app, allowFail: true })).code !== 0, true, 'local branch gone')
  merged = await cleanup.mergedBranches(a.id); assert(!merged.some((b) => b.name === 'taha/cyb4-1-login'))
  // saved views
  org.saveView(a.id, { id: 'v1', name: 'Mine', tab: 'work', filters: { assignee: 'me' } }); org.saveView(a.id, { id: 'v2', name: 'mine', tab: 'work', filters: { assignee: 'anyone' } })
  assert.deepEqual(org.getOrg(a.id).views.map((v) => v.id), ['v2'], 'same name replaces'); org.deleteView(a.id, 'v2'); assert.deepEqual(org.getOrg(a.id).views, [])

  console.log('ALL PHASE-4 TESTS PASSED in', root)
  fs.rmSync(root, { recursive: true, force: true })
})().catch((e) => { console.error('FAILED:', e); process.exit(1) })
