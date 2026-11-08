const g = require('../out/test/backend.cjs').git
const rel = require('../out/test/backend.cjs').release
const org = require('../out/test/backend.cjs').organizations
const wi = require('../out/test/backend.cjs').workindex
const ov = require('../out/test/backend.cjs').overview
const fs = require('fs'), path = require('path'), os = require('os')
const assert = require('assert')
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pakgit-idx-'))
  org.setOrgDir(root); org.ensureMigrated()
  rel.setReleaseConfigDir(root)
  rel.setPrOpener(async () => undefined)
  // two repositories with local bare origins; identities are provided like the main process does (from the registry)
  const identities = {}
  rel.setIdentityProvider((repo) => identities[repo])
  const mk = async (name) => {
    const origin = path.join(root, `${name}.git`); const repo = path.join(root, name)
    await g.run(['init', '--bare', '-b', 'main', origin], { cwd: root })
    await g.run(['clone', '-q', origin, repo], { cwd: root })
    await g.run(['config', 'user.email', 't@example.com'], { cwd: repo }); await g.run(['config', 'user.name', 'Taha Shahid'], { cwd: repo })
    fs.writeFileSync(path.join(repo, 'app.txt'), 'v1\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'initial' }); await g.push(repo, { remote: 'origin', branch: 'main', setUpstream: true })
    await g.createBranch(repo, 'dev', 'main'); await g.createBranch(repo, 'stage', 'main'); await g.run(['push', 'origin', 'dev', 'stage'], { cwd: repo })
    identities[repo] = `github.com/acme/${name}`
    return repo
  }
  const feature = async (repo, branch, file, msg) => { await g.checkout(repo, 'main'); await g.createBranch(repo, branch, 'main', true); fs.writeFileSync(path.join(repo, file), msg + '\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: msg }); await g.run(['push', '-u', 'origin', branch], { cwd: repo }) }
  const mergeInto = async (repo, env, branch) => { await g.checkout(repo, env); await g.merge(repo, branch, { noFf: true }); await g.push(repo, { remote: 'origin', branch: env }) }
  const app = await mk('app'), lib = await mk('lib')
  // CYB4-1: in app on dev + stage, in lib on dev only -> partly promoted
  await feature(app, 'taha/cyb4-1-login', 'login.txt', 'feat: login (CYB4-1)'); await mergeInto(app, 'dev', 'taha/cyb4-1-login'); await mergeInto(app, 'stage', 'taha/cyb4-1-login')
  await feature(lib, 'taha/cyb4-1-login-lib', 'login.txt', 'feat: login lib (CYB4-1)'); await mergeInto(lib, 'dev', 'taha/cyb4-1-login-lib')
  // CYB4-2: app only, on dev
  await feature(app, 'taha/cyb4-2-report', 'report.txt', 'feat: report (CYB4-2)'); await mergeInto(app, 'dev', 'taha/cyb4-2-report')
  // a keyless branch in lib
  await feature(lib, 'feature/thing', 'thing.txt', 'thing')
  // legacy archive entry for app, written before any analysis: must migrate into the identity-keyed state
  fs.writeFileSync(path.join(root, 'release-archive.json'), JSON.stringify({ [app]: ['CYB4-2'] }))

  const o = org.createOrg({ name: 'Acme', pipeline: null })
  org.upsertRepo({ path: app, name: 'app', lastOpened: 1, remote: identities[app], group: 'Apps' }, o.id)
  org.upsertRepo({ path: lib, name: 'lib', lastOpened: 2, remote: identities[lib] }, o.id)
  org.createGroup(o.id, 'Apps'); org.setRepoGroup(app, 'Apps')

  let built = await wi.buildIndex(o.id)
  let idx = built.index
  assert.deepEqual(idx.repos.map((r) => [r.name, r.error ?? null, r.environments.map((e) => e.id)]), [['app', null, ['dev', 'stage', 'prod']], ['lib', null, ['dev', 'stage', 'prod']]])
  assert.deepEqual(idx.environments.map((e) => [e.id, e.branch]), [['dev', 'dev'], ['stage', 'stage'], ['prod', 'main']])
  const byKey = Object.fromEntries(idx.items.map((i) => [i.id, i]))
  const one = byKey['CYB4-1']
  assert.equal(one.parts.length, 2); assert.equal(one.partlyPromoted, true, 'CYB4-1 sits on stage in app and dev in lib')
  assert.deepEqual(one.parts.map((p) => [p.repoName, p.highest, p.linkedBy]), [['app', 'stage', 'branch'], ['lib', 'dev', 'branch']])
  assert.equal(byKey['CYB4-2'].parts.length, 1); assert.equal(byKey['CYB4-2'].partlyPromoted, false)
  assert.equal(byKey['CYB4-2'].parts[0].archived, true, 'legacy archive migrated by identity')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'release-archive.json'), 'utf8')), {}, 'legacy entry removed')
  const keyless = idx.items.find((i) => i.issueKey === null && i.name === 'feature/thing')
  assert(keyless && keyless.id === `${lib}::feature/thing` && keyless.parts.length === 1)
  assert(idx.branches.some((b) => b.kind === 'env' && b.name === 'main' && b.repoName === 'app'))
  assert(idx.branches.some((b) => b.kind === 'work' && b.name === 'feature/thing' && b.repoName === 'lib' && b.sha))
  // levels: nowhere < dev < stage < prod
  assert.equal(wi.levelOf({ envIds: ['dev', 'stage', 'prod'], highest: 'prod' }), 0)
  assert.equal(wi.levelOf({ envIds: ['dev', 'stage', 'prod'], highest: 'dev' }), -2)
  assert.equal(wi.levelOf({ envIds: ['prod'], highest: 'prod' }), 0)
  assert.equal(wi.levelOf({ envIds: ['prod'], highest: null }), -Infinity)

  // manual link: the keyless lib branch becomes CYB4-2's second part
  await rel.setLink(lib, 'feature/thing', 'CYB4-2')
  idx = (await wi.buildIndex(o.id)).index
  const two = idx.items.find((i) => i.id === 'CYB4-2')
  assert.deepEqual(two.parts.map((p) => [p.repoName, p.linkedBy, p.branch]), [['app', 'branch', 'taha/cyb4-2-report'], ['lib', 'manual', 'feature/thing']])
  assert(!idx.items.some((i) => i.name === 'feature/thing' && i.issueKey === null))
  // the archived app part does not count for partly-promoted; the lib part is nowhere -> single live part
  assert.equal(two.partlyPromoted, false)
  await rel.setArchived(app, ['CYB4-2'], false)
  idx = (await wi.buildIndex(o.id)).index
  assert.equal(idx.items.find((i) => i.id === 'CYB4-2').partlyPromoted, true, 'app on dev, lib nowhere')

  // the archive change re-analysed app; the next build is served from the analysis cache for both
  assert.deepEqual(idx.repos.map((r) => r.fromCache), [false, true])
  idx = (await wi.buildIndex(o.id)).index
  assert.deepEqual(idx.repos.map((r) => r.fromCache), [true, true])
  idx = (await wi.index(o.id, { refresh: true }))
  assert.deepEqual(idx.repos.map((r) => r.fromCache), [false, false])

  // state keyed by identity: a second clone of app shares archive/links
  const app2 = path.join(root, 'app2'); await g.run(['clone', '-q', path.join(root, 'app.git'), app2], { cwd: root }); identities[app2] = identities[app]
  await rel.setArchived(app, ['CYB4-1'], true)
  assert.equal((await rel.analyze(app2)).items.find((i) => i.issueKey === 'CYB4-1').archived, true, 'archive follows the remote identity')
  assert.equal(await rel.repoStateDir(app2), await rel.repoStateDir(app))
  await rel.setArchived(app, ['CYB4-1'], false)

  // overview reuses the index: partly promoted on cards and totals
  const view = await ov.overview(o.id)
  assert.equal(view.totals.partlyPromoted, 2, 'CYB4-1 and CYB4-2')
  assert.deepEqual(view.repos.map((c) => [c.repo.name, c.partlyPromoted]), [['app', 2], ['lib', 2]])
  assert(view.totals.warnings >= 1)

  // start work in several repositories
  const sw = await wi.startWork(o.id, { key: 'CYB4-5', branch: 'taha/cyb4-5-new', repos: [app, lib, '/nope'] })
  assert.deepEqual(sw.created, [app, lib]); assert.deepEqual(sw.failed.map((f) => f.repo), ['/nope'])
  assert.equal((await g.status(app)).branch, 'taha/cyb4-5-new'); assert.equal((await g.status(lib)).branch, 'taha/cyb4-5-new')
  assert.equal((await g.run(['merge-base', '--is-ancestor', 'origin/main', 'taha/cyb4-5-new'], { cwd: lib, allowFail: true })).code, 0, 'cut from the base environment')
  await assert.rejects(wi.startWork(o.id, { key: null, branch: ' ', repos: [app] }), /Branch name is empty/)
  // branch name suggestions
  assert.equal(await wi.suggestBranch(o.id, { key: 'CYB4-7', title: 'Add region route', branchName: 'hanzala/cyb4-7-add-region-route' }), 'hanzala/cyb4-7-add-region-route', 'tracker suggestion wins with the default convention')
  assert.equal(await wi.suggestBranch(o.id, { key: 'CYB4-7', title: 'Add region route!' }), 'taha/cyb4-7-add-region-route')
  org.updateOrg(o.id, { conventions: { branchPattern: 'feature/{key}-{slug}', releasePattern: 'release/{env}-{week}' } })
  assert.equal(await wi.suggestBranch(o.id, { key: 'CYB4-7', title: 'Add region route', branchName: 'x/y' }), 'feature/cyb4-7-add-region-route', 'custom pattern beats the tracker suggestion')

  console.log('ALL WORK-INDEX TESTS PASSED in', root)
  fs.rmSync(root, { recursive: true, force: true })
})().catch((e) => { console.error('FAILED:', e); process.exit(1) })
