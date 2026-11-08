const be = require('../out/test/backend.cjs')
const { git: g, release: rel, organizations: org, releases, hosting, trackers, probes, checksOf, githubSlug } = be
const fs = require('fs'), path = require('path'), os = require('os')
const assert = require('assert')

/** A tracker that knows a few issues and records state changes and attachments. */
function fakeTracker(issues) {
  const calls = { states: [], attached: [] }
  const byKey = new Map(issues.map((i) => [i.key, { statusType: 'started', url: `https://linear.app/x/${i.key}`, ...i }]))
  return { calls, id: 'linear', keyPattern: /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i, configure() {}, isConfigured: () => true,
    async status() { return { provider: 'linear', configured: true, account: 'fake' } },
    async getIssues(keys) { return keys.map((k) => byKey.get(k.toUpperCase())).filter(Boolean) },
    async myActiveIssues() { return [...byKey.values()] }, async listIssues() { return { issues: [...byKey.values()], nextCursor: null } }, async teams() { return [{ key: 'CYB4', name: 'Cyber' }] },
    async states() { return ['In Progress', 'Ready To Deploy', 'UAT', 'Done'] },
    async setState(key, state) { calls.states.push([key, state]); const i = byKey.get(key); if (i) i.status = state },
    async assignToMe() {}, normalizeKey: (k) => k.toUpperCase(), async keyPrefixes() { return ['CYB4'] },
    async attachPullRequest(key, url) { calls.attached.push([key, url]) } }
}
/** A hosting provider that creates numbered pull requests and lets the test set their state. */
function fakeHosting() {
  const prs = new Map(); let n = 100
  return { prs, id: 'github', async status() { return { provider: 'github', available: true, account: 'fake', via: 'gh' } }, async supports() { return true },
    async listPullRequests(repo) { return [...prs.values()].filter((p) => p.repo === repo) },
    async pullRequest(repo, ref) { return [...prs.values()].find((p) => p.repo === repo && (p.number === ref || p.head === ref)) ?? null },
    async createPullRequest(repo, req) { const pr = { repo, number: ++n, url: `https://github.com/acme/${path.basename(repo)}/pull/${n}`, state: 'open', title: req.title, draft: !!req.draft, head: req.head, base: req.base, reviewDecision: 'none', checks: 'pending', mergedAt: null, body: req.body, reviewers: req.reviewers, labels: req.labels }; prs.set(n, pr); return pr } }
}

;(async () => {
  // --- pure helpers
  assert.equal(githubSlug('git@github.com:Project-CyberNut/admin-portal-v2.git'), 'Project-CyberNut/admin-portal-v2')
  assert.equal(githubSlug('https://github.com/tahashahid/pakgit'), 'tahashahid/pakgit'); assert.equal(githubSlug('https://gitlab.com/g/p.git'), null)
  assert.equal(checksOf([{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', state: 'SUCCESS' }]), 'success')
  assert.equal(checksOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: null }]), 'pending')
  assert.equal(checksOf([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }]), 'failure'); assert.equal(checksOf([]), 'none')
  assert.deepEqual(releases.defaultGates(true).map((x) => [x.id, x.mode]), [['tracker-state', 'block'], ['partly-promoted', 'block'], ['dev-based', 'warn'], ['frozen', 'block'], ['previous-env', 'block']])
  assert.deepEqual(releases.gatesFor({ gates: [{ id: 'dev-based', mode: 'block' }, { id: 'tracker-state', mode: 'off' }] }, false).map((x) => [x.id, x.mode]), [['tracker-state', 'off'], ['partly-promoted', 'warn'], ['dev-based', 'block'], ['frozen', 'block'], ['previous-env', 'block']])
  assert.equal(org.freezeActive({ note: 'x', until: null }), true); assert.equal(org.freezeActive({ note: 'x', until: '2000-01-01' }), false); assert.equal(org.freezeActive({ note: 'x', until: '2999-01-01' }), true)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pakgit-relz-'))
  org.setOrgDir(root); org.ensureMigrated(); rel.setReleaseConfigDir(root)
  rel.setTemplateProvider((repo) => { try { return org.getOrg(org.orgOfRepo(repo)).pipeline } catch { return null } })
  const opened = []; rel.setPrOpener(async (url) => { opened.push(url) })
  const identities = {}; rel.setIdentityProvider((repo) => identities[repo])
  const mk = async (name) => {
    const origin = path.join(root, `${name}.git`); const repo = path.join(root, name)
    await g.run(['init', '--bare', '-b', 'main', origin], { cwd: root }); await g.run(['clone', '-q', origin, repo], { cwd: root })
    await g.run(['config', 'user.email', 't@example.com'], { cwd: repo }); await g.run(['config', 'user.name', 'Taha Shahid'], { cwd: repo })
    fs.writeFileSync(path.join(repo, 'app.txt'), 'v1\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'initial' }); await g.push(repo, { remote: 'origin', branch: 'main', setUpstream: true })
    await g.createBranch(repo, 'dev', 'main'); await g.createBranch(repo, 'stage', 'main'); await g.run(['push', 'origin', 'dev', 'stage'], { cwd: repo })
    identities[repo] = `github.com/acme/${name}`
    return repo
  }
  const feature = async (repo, branch, file, msg, from = 'main') => { await g.checkout(repo, from); await g.createBranch(repo, branch, from, true); fs.writeFileSync(path.join(repo, file), msg + '\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: msg }); await g.run(['push', '-u', 'origin', branch], { cwd: repo }) }
  const mergeInto = async (repo, env, branch) => { await g.checkout(repo, env); await g.merge(repo, branch, { noFf: true }); await g.push(repo, { remote: 'origin', branch: env }) }
  const app = await mk('app'), lib = await mk('lib')
  const o = org.createOrg({ name: 'Acme', deployOrder: ['github.com/acme/lib'] })
  org.upsertRepo({ path: app, name: 'app', lastOpened: 1, remote: identities[app] }, o.id)
  org.upsertRepo({ path: lib, name: 'lib', lastOpened: 2, remote: identities[lib] }, o.id)
  const tracker = fakeTracker([
    { key: 'CYB4-1', title: 'Login', status: 'Ready To Deploy' }, { key: 'CYB4-2', title: 'Report', status: 'In Progress' },
    { key: 'CYB4-4', title: 'Clash', status: 'Ready To Deploy' }, { key: 'CYB4-5', title: 'Split', status: 'Ready To Deploy' }])
  trackers.setTrackerFor(o.id, tracker)
  const host = fakeHosting(); hosting.setHostingFor(o.id, host)
  const deps = { tracker, hosting: host }
  // CYB4-1 on dev in both; CYB4-2 on dev in app only; CYB4-4 on dev in lib but it clashes with a commit on stage
  await feature(app, 'taha/cyb4-1-login', 'login.txt', 'feat: login (CYB4-1)'); await mergeInto(app, 'dev', 'taha/cyb4-1-login')
  await feature(lib, 'taha/cyb4-1-login', 'login.txt', 'feat: login lib (CYB4-1)'); await mergeInto(lib, 'dev', 'taha/cyb4-1-login')
  await feature(app, 'taha/cyb4-2-report', 'report.txt', 'feat: report (CYB4-2)'); await mergeInto(app, 'dev', 'taha/cyb4-2-report')
  await g.checkout(lib, 'stage'); fs.writeFileSync(path.join(lib, 'clash.txt'), 'stage version\n'); await g.stage(lib, ['.']); await g.commit(lib, { message: 'hotfix on stage' }); await g.push(lib, { remote: 'origin', branch: 'stage' })
  await feature(lib, 'taha/cyb4-4-clash', 'clash.txt', 'feat: clash (CYB4-4)'); await mergeInto(lib, 'dev', 'taha/cyb4-4-clash')
  // CYB4-5: app on stage, lib on dev -> partly promoted; a dev-based branch in app
  await feature(app, 'taha/cyb4-5-split', 'split.txt', 'feat: split (CYB4-5)'); await mergeInto(app, 'dev', 'taha/cyb4-5-split'); await mergeInto(app, 'stage', 'taha/cyb4-5-split')
  await feature(lib, 'taha/cyb4-5-split', 'split.txt', 'feat: split lib (CYB4-5)'); await mergeInto(lib, 'dev', 'taha/cyb4-5-split')
  await feature(app, 'taha/devbased-work', 'fromdev.txt', 'dev based', 'dev')

  const idx = await be.workindex.index(o.id, { tracker })
  const partOf = (key, repo) => { const it = idx.items.find((i) => i.issueKey === key || i.name === key); const p = it.parts.find((x) => x.repo === repo); return { repo, itemId: p.itemId, issueKey: it.issueKey, title: it.issue?.title, ref: p.ref, commits: p.commits } }

  // --- gates for stage: CYB4-2 is In Progress -> warning only (stage is not the last environment); CYB4-5 partly promoted -> warning
  let check = await releases.checkGates(o.id, 'stage', [partOf('CYB4-1', app), partOf('CYB4-2', app), partOf('CYB4-5', lib)], deps)
  assert.deepEqual(check.blocked, []); assert.deepEqual(check.warnings.sort(), ['partly-promoted'])
  assert(check.results.find((r) => r.id === 'tracker-state').message.includes('Any state'), 'stage requires no particular state by default')
  // for prod the same checks block; the dev-based branch warns; an item not yet on stage is blocked by previous-env
  check = await releases.checkGates(o.id, 'prod', [partOf('CYB4-2', app), partOf('CYB4-5', app), partOf('taha/devbased-work', app)], deps)
  assert.deepEqual(check.blocked.sort(), ['partly-promoted', 'previous-env', 'tracker-state']); assert.deepEqual(check.warnings, ['dev-based'])
  assert(check.results.find((r) => r.id === 'tracker-state').details[0].startsWith('CYB4-2 in app: In Progress'))
  // freeze blocks stage until lifted; an expired freeze does not
  org.setFreeze(o.id, 'stage', { note: 'UAT in progress', until: null })
  check = await releases.checkGates(o.id, 'stage', [partOf('CYB4-1', app)], deps); assert.deepEqual(check.blocked, ['frozen']); assert(check.results.find((r) => r.id === 'frozen').message.includes('UAT in progress'))
  org.setFreeze(o.id, 'stage', { note: 'old', until: '2000-01-01' }); check = await releases.checkGates(o.id, 'stage', [partOf('CYB4-1', app)], deps); assert.deepEqual(check.blocked, [])
  org.setFreeze(o.id, 'stage', null); assert.deepEqual(org.getOrg(o.id).freezes, {})
  // creating a release while blocked fails unless the gate is overridden
  await assert.rejects(releases.createRelease(o.id, { envId: 'prod', name: 'release/prod-x', selection: [partOf('CYB4-2', app)], options: { push: false, openPr: false, draft: false, updateTracker: false }, overrides: [] }, deps), /Blocked by pre-flight checks/)

  // --- create a release into stage: lib first (deploy order), app second; lib pauses on CYB4-4
  const sel = [partOf('CYB4-1', app), partOf('CYB4-1', lib), partOf('CYB4-4', lib)]
  let rec = await releases.createRelease(o.id, { envId: 'stage', name: 'release/stage-2026-W46', selection: sel, options: { push: true, openPr: true, draft: true, updateTracker: true }, overrides: [] }, deps)
  assert.equal(rec.status, 'in-progress'); assert.equal(rec.envBranch, 'stage'); assert.equal(rec.createdBy, 'Taha Shahid')
  assert.deepEqual(rec.repos.map((r) => r.name), ['lib', 'app'], 'deploy order puts lib first')
  assert.deepEqual(rec.items.map((it) => [it.id, it.title, it.repos.length]).sort(), [['CYB4-1', 'Login', 2], ['CYB4-4', 'Clash', 1]])
  const libRepo = rec.repos[0], appRepo = rec.repos[1]
  assert.deepEqual(libRepo.merged, ['CYB4-1']); assert.equal(libRepo.paused.conflict, 'CYB4-4'); assert.deepEqual(libRepo.paused.remaining, []); assert.equal(libRepo.pr, null)
  assert.deepEqual(appRepo.merged, ['CYB4-1']); assert.equal(appRepo.paused, null); assert.equal(appRepo.pr.number, 101); assert.equal(appRepo.pr.draft, true); assert.equal(appRepo.pr.base, 'stage'); assert.equal(appRepo.pr.head, 'release/stage-2026-W46')
  assert((await g.status(lib)).state === 'merging', 'lib is left in the conflict for the user to resolve')
  assert.equal((await g.run(['rev-parse', 'origin/release/stage-2026-W46'], { cwd: app })).code, 0, 'app branch pushed')
  assert.equal(host.prs.get(101).body.includes('CYB4-1 Login (https://linear.app/x/CYB4-1)'), true, 'PR body lists the items with tracker links')
  assert.deepEqual(releases.listReleases(o.id).map((r) => r.id), [rec.id])
  await assert.rejects(releases.createRelease(o.id, { envId: 'stage', name: 'release/stage-2026-W46', selection: [partOf('CYB4-2', app)], options: { push: false, openPr: false, draft: false, updateTracker: false }, overrides: [] }, deps), /already in progress/)
  assert(!releases.readyToFinish(rec))
  // resume lib after resolving the conflict
  await g.resolveConflict(lib, 'clash.txt', 'theirs'); await g.mergeAction(lib, 'continue')
  rec = await releases.resumeRelease(o.id, rec.id, lib, { skipRemaining: false }, deps)
  const lib2 = rec.repos[0]
  assert.equal(lib2.paused, null); assert.deepEqual(lib2.merged, ['CYB4-1', 'CYB4-4']); assert.equal(lib2.pr.number, 102); assert.equal(lib2.error, null)
  assert.equal((await g.run(['rev-parse', 'origin/release/stage-2026-W46'], { cwd: lib })).code, 0, 'lib branch pushed on resume')
  // tracker: no state on PR configured in the detected pipeline -> no state changes yet; attachments off by default
  assert.deepEqual(tracker.calls.states, []); assert.deepEqual(tracker.calls.attached, [])
  // refresh: nothing merged yet
  rec = await releases.refreshRelease(o.id, rec.id, deps)
  assert.deepEqual(rec.repos.map((r) => [r.pr.state, r.onEnv]), [['open', false], ['open', false]]); assert(!releases.readyToFinish(rec))
  await assert.rejects(releases.finishRelease(o.id, rec.id, { push: true, updateTracker: true }, deps), /Not landed yet in lib, app/)
  // merge the pull requests "on GitHub": merge the release branches into stage and push; the fake marks the PRs merged
  for (const repo of [lib, app]) { await g.checkout(repo, 'stage'); await g.run(['merge', '--no-ff', '--no-edit', 'release/stage-2026-W46'], { cwd: repo }); await g.push(repo, { remote: 'origin', branch: 'stage' }) }
  for (const pr of host.prs.values()) { pr.state = 'merged'; pr.mergedAt = new Date().toISOString(); pr.checks = 'success' }
  rec = await releases.refreshRelease(o.id, rec.id, deps)
  assert.deepEqual(rec.repos.map((r) => [r.pr.state, r.onEnv]), [['merged', true], ['merged', true]]); assert(releases.readyToFinish(rec))
  // notes before finishing
  const notes = releases.releaseNotes(o.id, rec.id)
  assert(notes.startsWith('# release/stage-2026-W46 → stage')); assert(notes.includes('## lib') && notes.includes('- CYB4-4: Clash') && notes.includes('pull/101'))
  // finish: back-merges stage into dev in each repository (release-branch strategy -> sync branches, PR pages via the opener) and moves tracker states
  const fin = await releases.finishRelease(o.id, rec.id, { push: true, updateTracker: true }, deps)
  assert.equal(fin.release.status, 'finished'); assert(fin.release.finishedAt > 0)
  assert.deepEqual(fin.results.map((r) => [path.basename(r.repo), r.result.conflict]), [['lib', null], ['app', null]])
  assert(fin.results.every((r) => r.result.merged.some((m) => m.startsWith('stage → dev'))), fin.results.map((r) => r.result.message).join(' | '))
  assert.deepEqual(tracker.calls.states.sort(), [['CYB4-1', 'UAT'], ['CYB4-4', 'UAT']], 'detected pipeline: stage arrival state is UAT')
  assert.equal(releases.getRelease(o.id, rec.id).status, 'finished')
  await assert.rejects(releases.finishRelease(o.id, rec.id, { push: false, updateTracker: false }, deps), /is finished/)
  // the work index now sees CYB4-1 and CYB4-4 on stage in lib
  const after = await be.workindex.index(o.id, { tracker, refresh: true })
  assert.equal(after.items.find((i) => i.issueKey === 'CYB4-4').parts[0].highest, 'stage')

  // --- a second release with an error in one repository (dirty working tree), drop it, drop the release
  fs.writeFileSync(path.join(app, 'app.txt'), 'dirty\n')
  rec = await releases.createRelease(o.id, { envId: 'stage', name: 'release/stage-2', selection: [partOf('CYB4-2', app), partOf('CYB4-5', lib)], options: { push: false, openPr: false, draft: false, updateTracker: false }, overrides: ['tracker-state', 'partly-promoted'] }, deps)
  assert.deepEqual(rec.overridden, [], 'warnings need no override for stage')
  const appErr = rec.repos.find((r) => r.name === 'app'); assert(appErr.error && /uncommitted changes/.test(appErr.error), appErr.error)
  assert.deepEqual(rec.repos.find((r) => r.name === 'lib').merged, ['CYB4-5'])
  await g.run(['checkout', '--', 'app.txt'], { cwd: app })
  rec = await releases.resumeRelease(o.id, rec.id, app, { skipRemaining: false }, deps)
  assert.equal(rec.repos.find((r) => r.name === 'app').error, null); assert.deepEqual(rec.repos.find((r) => r.name === 'app').merged, ['CYB4-2'], 'an errored repository can be retried')
  rec = releases.dropRepo(o.id, rec.id, app, 'not this week'); assert.equal(rec.repos.find((r) => r.name === 'app').dropped, 'not this week')
  rec = releases.dropRelease(o.id, rec.id, 'superseded'); assert.equal(rec.status, 'dropped'); assert(rec.notes.includes('superseded'))
  assert.deepEqual(releases.listReleases(o.id).map((r) => r.status), ['dropped', 'finished'], 'newest first once nothing is in progress')
  // tracker state on PR opened + attachments when configured on the template
  org.updateOrg(o.id, { hosting: { ...org.getOrg(o.id).hosting, attachPrsToIssues: true, reviewers: ['alice'], labels: ['release'] }, pipeline: { ...(await rel.releaseConfig(app)), environments: (await rel.releaseConfig(app)).environments.map((e) => (e.id === 'stage' ? { ...e, trackerStateOnPr: 'In Review' } : e)) } })
  tracker.calls.states.length = 0
  await g.checkout(lib, 'main'); fs.writeFileSync(path.join(lib, 'six.txt'), '6\n'); await g.stage(lib, ['.']); await g.commit(lib, { message: 'six' })
  await feature(lib, 'taha/cyb4-6-six', 'six.txt', 'feat: six (CYB4-6)'); await mergeInto(lib, 'dev', 'taha/cyb4-6-six')
  const idx2 = await be.workindex.index(o.id, { tracker, refresh: true })
  const six = idx2.items.find((i) => i.issueKey === 'CYB4-6').parts[0]
  rec = await releases.createRelease(o.id, { envId: 'stage', name: 'release/stage-3', selection: [{ repo: lib, itemId: six.itemId, issueKey: 'CYB4-6', ref: six.ref, commits: six.commits }], options: { push: true, openPr: true, draft: false, updateTracker: true }, overrides: [] }, deps)
  const pr3 = rec.repos[0].pr; assert(pr3 && pr3.number === 103); assert.deepEqual(host.prs.get(103).reviewers, ['alice']); assert.deepEqual(host.prs.get(103).labels, ['release'])
  assert.deepEqual(tracker.calls.states, [['CYB4-6', 'In Review']]); assert.deepEqual(tracker.calls.attached, [['CYB4-6', pr3.url]])

  // --- probes: a git-tag probe pointing at an older commit on stage reports "behind"
  await g.checkout(app, 'stage'); const old = (await g.run(['rev-parse', 'HEAD~1'], { cwd: app })).stdout.trim()
  await g.run(['tag', 'deployed/stage-1', old], { cwd: app })
  const cfg = await rel.releaseConfig(app)
  let pr = await probes.probeEnv(app, cfg, 'stage', { type: 'git-tag', tagPattern: 'deployed/stage-*' }, true)
  assert.equal(pr.status, 'behind'); assert(pr.behind >= 1, 'counts the merge and its side commits'); assert.equal(pr.deployed, 'deployed/stage-1')
  await g.run(['tag', 'deployed/stage-2', 'stage'], { cwd: app })
  pr = await probes.probeEnv(app, cfg, 'stage', { type: 'git-tag', tagPattern: 'deployed/stage-*' }, true); assert.equal(pr.status, 'same')
  pr = await probes.probeEnv(app, cfg, 'stage', { type: 'git-tag', tagPattern: 'nothing/*' }, true); assert.equal(pr.status, 'unknown'); assert(/No tag matches/.test(pr.error))
  pr = await probes.probeEnv(app, cfg, 'stage', { type: 'http-json', url: 'http://127.0.0.1:9/version', path: 'commit' }, true); assert.equal(pr.status, 'unknown'); assert(pr.error)
  await rel.saveRepoPipeline(app, { mode: 'org', probes: { stage: { type: 'git-tag', tagPattern: 'deployed/stage-*' } } })
  assert.equal((await rel.repoPipeline(app)).override.probes.stage.type, 'git-tag', 'probes are kept with the repository override')
  const ov = await be.overview.overview(o.id, { tracker })
  assert.equal(ov.repos.find((c) => c.repo.name === 'app').deployed[0].status, 'same')

  console.log('ALL RELEASE-ENGINE TESTS PASSED in', root)
  fs.rmSync(root, { recursive: true, force: true })
})().catch((e) => { console.error('FAILED:', e); process.exit(1) })
