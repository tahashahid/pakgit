const g = require('../out/test/git.cjs')
const rel = require('../out/test/release.cjs')
const fs = require('fs'), path = require('path'), os = require('os')
const assert = require('assert')
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pakgit-rel-'))
  rel.setReleaseConfigDir(root)
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
  assert.deepEqual([cfg.dev, cfg.stage, cfg.prod, cfg.remote], ['dev', 'stage', 'main', 'origin'])
  let a = await rel.analyze(repo)
  assert.deepEqual(a.refs, { dev: 'origin/dev', stage: 'origin/stage', prod: 'origin/main' })
  const byKey = Object.fromEntries(a.items.map((i) => [i.issueKey, i]))
  assert.equal(byKey['CYB4-1'].inDev, true); assert.equal(byKey['CYB4-1'].inStage, true); assert.equal(byKey['CYB4-1'].inProd, false)
  assert.equal(byKey['CYB4-2'].inStage, false); assert.equal(byKey['CYB4-2'].commitsAheadOfProd, 1)
  assert.equal(byKey['CYB4-3'].needsCherryPick, true); assert.equal(byKey['CYB4-3'].inDev, true); assert.equal(byKey['CYB4-3'].commits.length, 1)
  assert.equal(byKey['CYB4-1'].branches[0].ref, 'origin/taha/cyb4-1-login')
  const toItem = (it) => ({ id: it.id, ref: it.branches[0]?.ref ?? null, commits: it.commits.map((c) => c.sha) })

  // promote CYB4-2 (branch) and CYB4-3 (cherry-pick) to stage
  let r = await rel.promote(repo, 'stage', [toItem(byKey['CYB4-2']), toItem(byKey['CYB4-3'])], true)
  assert.equal(r.conflict, null); assert.deepEqual(r.merged, ['CYB4-2', 'CYB4-3'])
  a = await rel.analyze(repo)
  assert.equal(a.items.find((i) => i.issueKey === 'CYB4-2').inStage, true)
  assert.equal(a.items.find((i) => i.issueKey === 'CYB4-3').inStage, true)
  // promoting again skips
  r = await rel.promote(repo, 'stage', [toItem(byKey['CYB4-2'])], false); assert.deepEqual(r.skipped, ['CYB4-2'])

  // release CYB4-1 only
  r = await rel.startRelease(repo, '2026-W46', [toItem(byKey['CYB4-1'])], true)
  assert.equal(r.conflict, null); assert.equal((await g.status(repo)).branch, 'release/2026-W46')
  assert(fs.existsSync(path.join(repo, 'login.txt')) && !fs.existsSync(path.join(repo, 'report.txt')), 'release contains only CYB4-1')
  r = await rel.finishRelease(repo, 'release/2026-W46', 'v2026.46', true)
  assert.equal(r.conflict, null, r.message); assert.deepEqual(r.merged, ['release/2026-W46', 'main → stage', 'stage → dev'])
  a = await rel.analyze(repo)
  assert.equal(a.items.find((i) => i.issueKey === 'CYB4-1').inProd, true)
  assert.equal(a.items.find((i) => i.issueKey === 'CYB4-2').inProd, false)
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
  console.log('ALL RELEASE TESTS PASSED in', root)
  fs.rmSync(root, { recursive: true, force: true })
})().catch((e) => { console.error('FAILED:', e); process.exit(1) })
