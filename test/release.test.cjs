const g = require('../out/test/backend.cjs').git
const rel = require('../out/test/backend.cjs').release
const fs = require('fs'), path = require('path'), os = require('os')
const assert = require('assert')
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pakgit-rel-'))
  rel.setReleaseConfigDir(root)
  const opened = []; rel.setPrOpener(async (url) => { opened.push(url) })
  // PR link building for the hosting providers
  assert.equal(rel.pullRequestUrl('git@github.com:Org/repo.git', 'release/x', 'main', 'T', 'B').url, 'https://github.com/Org/repo/compare/main...release%2Fx?expand=1&title=T&body=B')
  assert(rel.pullRequestUrl('https://gitlab.com/g/p.git', 'h', 'b', 'T', 'B').url.includes('/-/merge_requests/new?merge_request%5Bsource_branch%5D=h'))
  assert.equal(rel.pullRequestUrl('https://bitbucket.org/w/r', 'h', 'b', 'T', 'B').provider, 'bitbucket')
  assert.equal(rel.pullRequestUrl('/tmp/local.git', 'h', 'b', 'T', 'B').url, '')
  const origin = path.join(root, 'origin.git'); const repo = path.join(root, 'work')
  await g.run(['init', '--bare', '-b', 'main', origin], { cwd: root })
  await g.run(['clone', '-q', origin, repo], { cwd: root })
  const cfgUser = async () => { await g.run(['config', 'user.email', 't@example.com'], { cwd: repo }); await g.run(['config', 'user.name', 'T'], { cwd: repo }) }
  await cfgUser()
  const write = (f, c) => fs.writeFileSync(path.join(repo, f), c)
  const commit = async (msg) => { await g.stage(repo, ['.']); await g.commit(repo, { message: msg }) }
  // main with one commit; dev and stage branched from it
  write('app.txt', 'v1\n'); await commit('initial'); await g.push(repo, { remote: 'origin', branch: 'main', setUpstream: true })
  await g.createBranch(repo, 'dev', 'main'); await g.createBranch(repo, 'stage', 'main')
  await g.run(['push', 'origin', 'dev', 'stage'], { cwd: repo })
  // two features from main, merged into dev; one of them also into stage
  const feature = async (branch, file, msg) => { await g.checkout(repo, 'main'); await g.createBranch(repo, branch, 'main', true); write(file, msg + '\n'); await commit(msg); await g.run(['push', '-u', 'origin', branch], { cwd: repo }) }
  await feature('taha/cyb4-1-login', 'login.txt', 'feat: login (CYB4-1)')
  await feature('taha/cyb4-2-report', 'report.txt', 'feat: report (CYB4-2)')
  await g.checkout(repo, 'dev'); await g.merge(repo, 'taha/cyb4-1-login', { noFf: true }); await g.merge(repo, 'taha/cyb4-2-report', { noFf: true }); await g.push(repo, { remote: 'origin', branch: 'dev' })
  await g.checkout(repo, 'stage'); await g.merge(repo, 'taha/cyb4-1-login', { noFf: true }); await g.push(repo, { remote: 'origin', branch: 'stage' })
  // a branch-less issue: commit directly on dev with a key (deleted-branch scenario)
  await g.checkout(repo, 'dev'); write('hotspot.txt', 'x\n'); await commit('fix: hotspot (CYB4-3)'); await g.push(repo, { remote: 'origin', branch: 'dev' })

  const cfg = await rel.releaseConfig(repo)
  assert.deepEqual(cfg.environments.map((e) => [e.id, e.branch, e.strategy]), [['dev', 'dev', 'feature-pr'], ['stage', 'stage', 'release-branch'], ['prod', 'main', 'release-branch']])
  assert.equal(cfg.baseEnv, 'prod'); assert.equal(cfg.remote, 'origin')
  let a = await rel.analyze(repo)
  assert.deepEqual(a.refs, { dev: 'origin/dev', stage: 'origin/stage', prod: 'origin/main' })
  const byKey = Object.fromEntries(a.items.map((i) => [i.issueKey, i]))
  assert.deepEqual(byKey['CYB4-1'].inEnv, { dev: true, stage: true, prod: false })
  assert.equal(byKey['CYB4-2'].inEnv.stage, false); assert.equal(byKey['CYB4-2'].commitsAheadOfProd, 1); assert.equal(byKey['CYB4-2'].basedOnEnv, false)
  assert.equal(byKey['CYB4-3'].needsCherryPick, true); assert.equal(byKey['CYB4-3'].inEnv.dev, true); assert.equal(byKey['CYB4-3'].commits.length, 1)
  assert.equal(byKey['CYB4-1'].branches[0].ref, 'origin/taha/cyb4-1-login')
  const toItem = (it) => ({ id: it.id, ref: it.branches[0]?.ref ?? null, commits: it.commits.map((c) => c.sha) })

  // promote CYB4-2 (branch) and CYB4-3 (cherry-pick) to stage
  let r = await rel.promote(repo, 'stage', [toItem(byKey['CYB4-2']), toItem(byKey['CYB4-3'])], true)
  assert.equal(r.conflict, null); assert.deepEqual(r.merged, ['CYB4-2', 'CYB4-3'])
  a = await rel.analyze(repo)
  assert.equal(a.items.find((i) => i.issueKey === 'CYB4-2').inEnv.stage, true)
  assert.equal(a.items.find((i) => i.issueKey === 'CYB4-3').inEnv.stage, true)
  // promoting again skips
  r = await rel.promote(repo, 'stage', [toItem(byKey['CYB4-2'])], false); assert.deepEqual(r.skipped, ['CYB4-2'])

  // release CYB4-1 only
  r = await rel.startRelease(repo, 'prod', '2026-W46', [toItem(byKey['CYB4-1'])], true)
  assert.equal(r.conflict, null); assert.equal((await g.status(repo)).branch, 'release/2026-W46'); assert.equal(r.branch, 'release/2026-W46')
  assert(fs.existsSync(path.join(repo, 'login.txt')) && !fs.existsSync(path.join(repo, 'report.txt')), 'release contains only CYB4-1')
  assert.equal(opened.length, 0, 'local remote has no PR page; no browser opened'); assert(r.message.includes('Cannot build a pull-request link'))
  // direct-merge environments for the finish/back-merge path of the test
  const direct = await rel.releaseConfig(repo); direct.environments.forEach((e) => { e.strategy = 'merge' }); await rel.saveReleaseConfig(repo, direct)
  r = await rel.finishRelease(repo, 'prod', 'release/2026-W46', 'v2026.46', true)
  assert.equal(r.conflict, null, r.message); assert.deepEqual(r.merged, ['release/2026-W46', 'main → stage', 'stage → dev'])
  a = await rel.analyze(repo)
  assert.equal(a.items.find((i) => i.issueKey === 'CYB4-1').inEnv.prod, true)
  assert.equal(a.items.find((i) => i.issueKey === 'CYB4-2').inEnv.prod, false)
  assert.equal((await g.refs(repo)).tags[0].name, 'v2026.46')
  // main is now an ancestor of dev and stage (no drift)
  assert.equal((await g.run(['merge-base', '--is-ancestor', 'main', 'dev'], { cwd: repo, allowFail: true })).code, 0)
  // conflict path: feature that conflicts with what stage has
  await g.checkout(repo, 'main'); await g.createBranch(repo, 'taha/cyb4-4-clash', 'main', true); write('report.txt', 'CLASH\n'); await commit('feat: clash (CYB4-4)'); await g.run(['push', '-u', 'origin', 'taha/cyb4-4-clash'], { cwd: repo })
  r = await rel.promote(repo, 'stage', [{ id: 'CYB4-4', ref: 'origin/taha/cyb4-4-clash', commits: [] }], false)
  assert.equal(r.conflict, 'CYB4-4'); assert.equal((await g.status(repo)).state, 'merging'); await g.mergeAction(repo, 'abort')
  // start issue
  await rel.startIssue(repo, 'taha/cyb4-5-new'); assert.equal((await g.status(repo)).branch, 'taha/cyb4-5-new')
  await rel.enableRerere(repo); assert.equal((await rel.analyze(repo)).rerere, true)
  // --- custom pipeline: 4 environments, custom ids, release branch into 'uat', base = prod
  const custom = {
    remote: 'origin', releasePrefix: 'rel/', backMerge: true, baseEnv: 'live',
    environments: [
      { id: 'dev', name: 'Dev', branch: 'dev', strategy: 'merge', trackerState: '' },
      { id: 'qa', name: 'QA', branch: 'stage', strategy: 'merge', trackerState: '' },
      { id: 'uat', name: 'UAT', branch: 'uat', strategy: 'release-branch', trackerState: '' },
      { id: 'live', name: 'Live', branch: 'main', strategy: 'merge', trackerState: '' }
    ]
  }
  await rel.saveReleaseConfig(repo, custom)
  await g.checkout(repo, 'main'); await g.createBranch(repo, 'uat', 'main'); await g.run(['push', 'origin', 'uat'], { cwd: repo })
  a = await rel.analyze(repo)
  assert.deepEqual(Object.keys(a.refs), ['dev', 'qa', 'uat', 'live']); assert.equal(a.refs.uat, 'origin/uat')
  const two = a.items.find((i) => i.issueKey === 'CYB4-2')
  assert.deepEqual(two.inEnv, { dev: true, qa: true, uat: false, live: false })
  r = await rel.startRelease(repo, 'uat', 'u1', [toItem(two)], true); assert.equal((await g.status(repo)).branch, 'rel/u1')
  assert.equal((await g.run(['merge-base', '--is-ancestor', 'origin/uat', 'rel/u1'], { cwd: repo, allowFail: true })).code, 0, 'release branch is cut from the target environment')
  r = await rel.finishRelease(repo, 'uat', 'rel/u1', null, true)
  assert.equal(r.conflict, null, r.message); assert.deepEqual(r.merged, ['rel/u1', 'uat → stage', 'stage → dev'], 'back-merge walks the configured chain')
  a = await rel.analyze(repo); assert.deepEqual(a.items.find((i) => i.issueKey === 'CYB4-2').inEnv, { dev: true, qa: true, uat: true, live: false })
  // promote by plain merge into 'live' (strategy merge) and sync down from the last environment
  r = await rel.promote(repo, 'live', [toItem(two)], true); assert.deepEqual(r.merged, ['CYB4-2'])
  r = await rel.syncEnvironments(repo, true)
  // uat uses the release-branch strategy -> sync branch + PR; the direct-merge steps keep merging from main
  assert(r.merged[0].startsWith('main → uat (PR from sync/main-into-uat-'), r.merged.join(','))
  assert.deepEqual(r.merged.slice(1), ['main → stage', 'stage → dev'])
  a = await rel.analyze(repo); assert.deepEqual(a.items.find((i) => i.issueKey === 'CYB4-2').inEnv, { dev: true, qa: true, uat: true, live: true })
  // PR-mode sync: a new hotfix on main, environments use pull requests -> sync branches, no direct pushes to env branches
  const prCfg = await rel.releaseConfig(repo); prCfg.environments.forEach((e) => { e.strategy = e.id === 'live' ? 'merge' : 'release-branch' }); await rel.saveReleaseConfig(repo, prCfg)
  await g.checkout(repo, 'main'); fs.writeFileSync(path.join(repo, 'hotfix.txt'), 'h\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'hotfix (CYB4-9)' }); await g.push(repo, { remote: 'origin', branch: 'main' })
  const uatBefore = (await g.run(['rev-parse', 'origin/uat'], { cwd: repo })).stdout.trim()
  r = await rel.syncEnvironments(repo, true)
  assert.equal(r.conflict, null, r.message); assert.equal(r.merged.length, 3); assert(r.merged[0].startsWith('main → uat (PR from sync/main-into-uat-')); assert(r.merged[2].startsWith('main → dev (PR from sync/main-into-dev-'), 'PR mode keeps merging from the same source')
  assert.equal((await g.run(['rev-parse', 'origin/uat'], { cwd: repo })).stdout.trim(), uatBefore, 'environment branch untouched; sync branch pushed instead')
  const syncBranches = (await g.refs(repo)).branches.filter((b) => b.remote && b.name.startsWith('sync/main-into-')).map((b) => b.name.replace(/-\d{4}-\d{2}-\d{2}$/, ''))
  assert.deepEqual(syncBranches.sort(), ['sync/main-into-dev', 'sync/main-into-stage', 'sync/main-into-uat'])
  // feature PRs: skipped without a branch, otherwise one per item (no page for a local remote -> error surfaces)
  await assert.rejects(rel.openFeaturePRs(repo, 'dev', [{ id: 'CYB4-2', ref: 'origin/taha/cyb4-2-report', commits: [] }]), /Cannot build a pull-request link/)
  r = await rel.openFeaturePRs(repo, 'dev', [{ id: 'X', ref: null, commits: ['abc'] }]); assert.deepEqual(r.skipped, ['X'])
  // two-environment pipeline (dev -> main) and start-issue base env
  await rel.saveReleaseConfig(repo, { remote: 'origin', releasePrefix: 'release/', backMerge: false, baseEnv: 'dev', environments: [
    { id: 'dev', name: 'Dev', branch: 'dev', strategy: 'merge', trackerState: '' }, { id: 'prod', name: 'Prod', branch: 'main', strategy: 'merge', trackerState: '' }] })
  a = await rel.analyze(repo); assert.deepEqual(Object.keys(a.items[0].inEnv), ['dev', 'prod'])
  await rel.startIssue(repo, 'from-dev'); assert.equal((await g.run(['merge-base', '--is-ancestor', 'origin/dev', 'from-dev'], { cwd: repo, allowFail: true })).code, 0, 'branch cut from configured base env')
  // legacy flat config migrates into the identity-keyed state folder on first use
  const stateDir = await rel.repoStateDir(repo); assert(stateDir.startsWith(path.join(root, 'repos')), stateDir); assert(fs.existsSync(path.join(stateDir, 'pipeline.json')))
  fs.rmSync(path.join(stateDir, 'pipeline.json'))
  fs.writeFileSync(path.join(root, 'release-config.json'), JSON.stringify({ [repo]: { remote: 'origin', dev: 'dev', stage: 'stage', prod: 'main', releasePrefix: 'release/' } }))
  const mig = await rel.releaseConfig(repo); assert.deepEqual(mig.environments.map((e) => e.id), ['dev', 'stage', 'prod']); assert.equal(mig.environments[2].strategy, 'release-branch')
  assert(fs.existsSync(path.join(stateDir, 'pipeline.json')), 'moved into the state folder'); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'release-config.json'), 'utf8')), {}, 'legacy entry removed')
  // --- archive, overrides, prefixes, exclusions
  await rel.saveReleaseConfig(repo, { ...(await rel.releaseConfig(repo)), environments: [
    { id: 'dev', name: 'Dev', branch: 'dev', strategy: 'release-branch', trackerState: '' }, { id: 'stage', name: 'Stage', branch: 'stage', strategy: 'release-branch', trackerState: '' }, { id: 'prod', name: 'Prod', branch: 'main', strategy: 'release-branch', trackerState: '' }], baseEnv: 'prod', issuePrefixes: [] })
  await g.checkout(repo, 'main'); await g.createBranch(repo, 'sync/main-into-dev-2026-01-01', 'main'); await g.createBranch(repo, 'dependabot/npm_and_yarn/undici-7.30.1', 'main'); await g.createBranch(repo, 'ops/noise-1-thing', 'main')
  a = await rel.analyze(repo)
  assert(!a.items.some((i) => i.name.startsWith('sync/') || i.name.startsWith('dependabot/')), 'sync and bot branches excluded')
  const noise = a.items.find((i) => i.name === 'ops/noise-1-thing'); assert(noise && noise.issueKey === null, 'NOISE-1 is not an issue key (prefix seen once)')
  assert(a.items.some((i) => i.issueKey === 'CYB4-1'), 'CYB4 prefix kept (seen on several branches)')
  await rel.saveReleaseConfig(repo, { ...(await rel.releaseConfig(repo)), issuePrefixes: ['cyb4'] })
  a = await rel.analyze(repo); assert.equal(a.config.issuePrefixes[0], 'CYB4')
  const four = a.items.find((i) => i.issueKey === 'CYB4-4'); assert(four && four.archived === false)
  await rel.setArchived(repo, ['CYB4-4'], true); a = await rel.analyze(repo); assert.equal(a.items.find((i) => i.issueKey === 'CYB4-4').archived, true)
  await rel.setArchived(repo, ['CYB4-4'], false); a = await rel.analyze(repo); assert.equal(a.items.find((i) => i.issueKey === 'CYB4-4').archived, false)
  // manual override: CYB4-4 is not on dev by git, mark it as on dev
  assert.equal(a.items.find((i) => i.issueKey === 'CYB4-4').inEnv.dev, false)
  await rel.setOverrides(repo, 'CYB4-4', { dev: true }); a = await rel.analyze(repo)
  let f4 = a.items.find((i) => i.issueKey === 'CYB4-4'); assert.equal(f4.inEnv.dev, true); assert.deepEqual(f4.overrides, { dev: true })
  await rel.setOverrides(repo, 'CYB4-4', null); a = await rel.analyze(repo); assert.equal(a.items.find((i) => i.issueKey === 'CYB4-4').inEnv.dev, false)
  // analysis cache: same refs and state -> served from cache; a new commit invalidates it
  a = await rel.analyze(repo); assert.equal(a.fromCache, true, 'second analysis comes from the tip-keyed cache')
  assert.equal((await rel.analyze(repo, { cache: false })).fromCache, false)
  await g.checkout(repo, 'main'); fs.writeFileSync(path.join(repo, 'cache.txt'), 'c\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'bust cache' })
  a = await rel.analyze(repo); assert.equal(a.fromCache, false, 'new tip -> fresh analysis'); assert.equal((await rel.analyze(repo)).fromCache, true)
  // manual link: a branch without a key becomes part of an issue
  await g.createBranch(repo, 'feature/no-key-here', 'main'); a = await rel.analyze(repo)
  assert(a.items.some((i) => i.id === 'feature/no-key-here' && i.issueKey === null), 'keyless branch is its own item')
  await rel.setLink(repo, 'feature/no-key-here', 'cyb4-4'); a = await rel.analyze(repo)
  f4 = a.items.find((i) => i.issueKey === 'CYB4-4'); assert(f4.branches.some((b) => b.name === 'feature/no-key-here'), 'linked branch joins the issue'); assert.deepEqual(f4.linkedFrom, ['feature/no-key-here'])
  assert(!a.items.some((i) => i.id === 'feature/no-key-here'))
  await rel.setLink(repo, 'feature/no-key-here', null); a = await rel.analyze(repo); assert(a.items.some((i) => i.id === 'feature/no-key-here'), 'unlinked again')
  // --- prepareBranch: new branch from the environment, then an existing branch, with a conflict and a resume
  await g.checkout(repo, 'main'); await g.createBranch(repo, 'taha/cyb4-7-a', 'main', true); fs.writeFileSync(path.join(repo, 'seven.txt'), 'a\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'seven a (CYB4-7)' }); await g.run(['push', '-u', 'origin', 'taha/cyb4-7-a'], { cwd: repo })
  await g.checkout(repo, 'main'); await g.createBranch(repo, 'taha/cyb4-8-b', 'main', true); fs.writeFileSync(path.join(repo, 'seven.txt'), 'b\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'seven b (CYB4-8)' }); await g.run(['push', '-u', 'origin', 'taha/cyb4-8-b'], { cwd: repo })
  await g.checkout(repo, 'main'); await g.createBranch(repo, 'taha/cyb4-10-c', 'main', true); fs.writeFileSync(path.join(repo, 'ten.txt'), 'c\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'ten c (CYB4-10)' }); await g.run(['push', '-u', 'origin', 'taha/cyb4-10-c'], { cwd: repo })
  const inp = (id, ref) => ({ id, ref, commits: [] })
  r = await rel.prepareBranch(repo, 'stage', { name: 'release/stage-x', existing: false }, [inp('CYB4-7', 'origin/taha/cyb4-7-a'), inp('CYB4-8', 'origin/taha/cyb4-8-b'), inp('CYB4-10', 'origin/taha/cyb4-10-c')], { push: true, openPr: false })
  assert.equal(r.conflict, 'CYB4-8'); assert.deepEqual(r.merged, ['CYB4-7']); assert.deepEqual(r.remaining.map((x) => x.id), ['CYB4-10']); assert.equal(r.branch, 'release/stage-x')
  assert.equal((await g.status(repo)).state, 'merging'); assert.equal((await g.status(repo)).branch, 'release/stage-x')
  assert.equal((await g.run(['merge-base', '--is-ancestor', 'origin/stage', 'release/stage-x'], { cwd: repo, allowFail: true })).code, 0, 'new branch cut from the target environment')
  // resolve the conflict like the user would (take theirs), commit, then continue with the remaining item on the existing branch
  await g.resolveConflict(repo, 'seven.txt', 'theirs'); await g.mergeAction(repo, 'continue')
  await assert.rejects(rel.prepareBranch(repo, 'stage', { name: 'release/stage-x', existing: false }, [], { push: false, openPr: false }), /already exists/)
  r = await rel.prepareBranch(repo, 'stage', { name: 'release/stage-x', existing: true }, r.remaining, { push: true, openPr: false })
  assert.equal(r.conflict, null, r.message); assert.deepEqual(r.merged, ['CYB4-10']); assert(fs.existsSync(path.join(repo, 'ten.txt')))
  assert.equal((await g.run(['rev-parse', 'origin/release/stage-x'], { cwd: repo })).stdout.trim(), (await g.run(['rev-parse', 'release/stage-x'], { cwd: repo })).stdout.trim(), 'pushed')
  // already-included items are skipped
  r = await rel.prepareBranch(repo, 'stage', { name: 'release/stage-x', existing: true }, [inp('CYB4-7', 'origin/taha/cyb4-7-a')], { push: false, openPr: false }); assert.deepEqual(r.skipped, ['CYB4-7'])
  await assert.rejects(rel.prepareBranch(repo, 'stage', { name: 'nope/missing', existing: true }, [], { push: false, openPr: false }), /does not exist/)
  console.log('ALL RELEASE TESTS PASSED in', root)
  fs.rmSync(root, { recursive: true, force: true })
})().catch((e) => { console.error('FAILED:', e); process.exit(1) })
