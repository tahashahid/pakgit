const g = require('../out/test/git.cjs')
const fs = require('fs'), path = require('path'), os = require('os')
const assert = require('assert')
;(async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pakgit-test-'))
  await g.init(repo)
  await g.run(['config', 'user.email', 't@example.com'], { cwd: repo }); await g.run(['config', 'user.name', 'T'], { cwd: repo })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
  let st = await g.status(repo)
  assert.equal(st.files[0].area, 'untracked'); assert.equal(st.branch, 'main')
  await g.stage(repo, ['a.txt'])
  st = await g.status(repo); assert.equal(st.files[0].area, 'staged'); assert.equal(st.files[0].index, 'A')
  await g.unstage(repo, ['a.txt']); st = await g.status(repo); assert.equal(st.files[0].area, 'untracked')
  await g.stage(repo, ['a.txt'])
  await g.commit(repo, { message: 'first\n\nbody here' })
  let log = await g.log(repo); assert.equal(log.length, 1); assert.equal(log[0].subject, 'first'); assert.equal(log[0].body, 'body here')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\nworld\n')
  st = await g.status(repo); assert.equal(st.files[0].area, 'unstaged'); assert.equal(st.files[0].worktree, 'M')
  const d = await g.diff(repo, 'a.txt', 'unstaged'); assert(d.includes('+world'))
  await g.stashSave(repo, 'wip', true); st = await g.status(repo); assert.equal(st.files.length, 0)
  let refs = await g.refs(repo); assert.equal(refs.stashes.length, 1); assert(refs.stashes[0].message.includes('wip'))
  await g.stashApply(repo, 0, true); st = await g.status(repo); assert.equal(st.files.length, 1)
  await g.stage(repo, ['.']); await g.commit(repo, { message: 'second' })
  await g.createBranch(repo, 'feature', undefined, true)
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n'); await g.stage(repo, ['b.txt']); await g.commit(repo, { message: 'feature work' })
  await g.checkout(repo, 'main'); await g.merge(repo, 'feature', { noFf: true })
  log = await g.log(repo); assert.equal(log.length, 4); assert.equal(log[0].parents.length, 2)
  refs = await g.refs(repo); assert.deepEqual(refs.branches.map(b => b.name).sort(), ['feature', 'main']); assert(refs.branches.find(b => b.name === 'main').current)
  await g.createTag(repo, 'v1', undefined, 'release'); refs = await g.refs(repo); assert.equal(refs.tags[0].name, 'v1')
  const det = await g.commitDetails(repo, log[1].sha); assert.equal(det.files[0].path, 'b.txt'); assert.equal(det.files[0].status, 'A')
  const fd = await g.commitFileDiff(repo, log[1].sha, 'b.txt'); assert(fd.includes('+b'))
  await g.rebase(repo, 'main'); await g.reset(repo, 'HEAD~1', 'soft'); st = await g.status(repo)
  await g.deleteBranch(repo, 'feature', true); await g.deleteTag(repo, 'v1')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n'); await g.discard(repo, [{ path: 'a.txt', area: 'unstaged' }]); assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'hello\nworld\n')
  fs.writeFileSync(path.join(repo, 'junk.log'), ''); await g.ignore(repo, '*.log'); st = await g.status(repo); assert(!st.files.some(f => f.path === 'junk.log'))
  // conflict + abort
  await g.createBranch(repo, 'c1', undefined, true); fs.writeFileSync(path.join(repo, 'a.txt'), 'A\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'c1' })
  await g.checkout(repo, 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'B\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'c2' })
  await g.merge(repo, 'c1').catch(() => {}); st = await g.status(repo); assert.equal(st.state, 'merging'); assert.equal(st.files.find(f => f.path === 'a.txt').area, 'conflicted')
  await g.mergeAction(repo, 'abort'); st = await g.status(repo); assert.equal(st.state, 'clean')
  // --- v0.2: hunk staging, conflict resolution, blame, stash show, worktrees, patches, interactive rebase, clean
  fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'nine lines' })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'line1 changed\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9 changed\n')
  let raw = await g.diff(repo, 'a.txt', 'unstaged')
  const hunks = raw.split('\n@@').length - 1; assert.equal(hunks, 2, 'expected two hunks')
  const rl = raw.split('\n'); const h1 = rl.findIndex(l => l.startsWith('@@')); const h2 = rl.findIndex((l, i) => i > h1 && l.startsWith('@@'))
  const header = rl.slice(0, h1).join('\n') + '\n'; const firstHunk = rl.slice(h1, h2).join('\n') + '\n'
  await g.applyPatch(repo, header + firstHunk, { cached: true })
  st = await g.status(repo); assert.deepEqual(st.files.map(f => f.area).sort(), ['staged', 'unstaged'], 'partially staged')
  await g.applyPatch(repo, header + firstHunk, { cached: true, reverse: true })
  st = await g.status(repo); assert.deepEqual(st.files.map(f => f.area), ['unstaged'])
  await g.discard(repo, [{ path: 'a.txt', area: 'unstaged' }])
  const bl = await g.blameStructured(repo, 'a.txt'); assert.equal(bl.length, 9); assert.equal(bl[0].summary, 'nine lines'); assert.equal(bl[0].author, 'T')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'stashed\n'); await g.stashSave(repo, 'preview'); const ss = await g.stashShow(repo, 0); assert(ss.includes('+stashed')); await g.stashDrop(repo, 0)
  // conflict resolve ours/theirs
  await g.createBranch(repo, 'cx', undefined, true); fs.writeFileSync(path.join(repo, 'a.txt'), 'X\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'cx' })
  await g.checkout(repo, 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'Y\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: 'cy' })
  await g.merge(repo, 'cx').catch(() => {}); st = await g.status(repo); assert.equal(st.state, 'merging')
  assert(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8').includes('<<<<<<<'))
  await g.resolveConflict(repo, 'a.txt', 'theirs'); assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'X\n')
  st = await g.status(repo); assert.equal(st.files.find(f => f.path === 'a.txt').area, 'staged'); await g.mergeAction(repo, 'continue'); st = await g.status(repo); assert.equal(st.state, 'clean')
  // interactive rebase: reorder + squash + reword + drop
  for (const n of ['r1', 'r2', 'r3', 'r4']) { fs.writeFileSync(path.join(repo, n + '.txt'), n + '\n'); await g.stage(repo, ['.']); await g.commit(repo, { message: n }) }
  log = await g.log(repo, { all: false }); const [c4, c3, c2, c1] = log
  await g.rebaseInteractive(repo, c1.parents[0], [
    { action: 'pick', sha: c1.sha, subject: c1.subject },
    { action: 'pick', sha: c3.sha, subject: c3.subject },
    { action: 'squash', sha: c2.sha, subject: c2.subject },
    { action: 'reword', sha: c4.sha, subject: c4.subject }
  ], { [c4.sha]: 'r4 reworded' })
  log = await g.log(repo, { all: false }); assert.deepEqual(log.slice(0, 3).map(c => c.subject), ['r4 reworded', 'r3', 'r1'], 'reorder+squash+reword')
  assert(log[1].body.includes('r2'), 'squash keeps message'); assert(fs.existsSync(path.join(repo, 'r2.txt')))
  // drop
  await g.rebaseInteractive(repo, log[2].sha, [{ action: 'drop', sha: log[1].sha, subject: log[1].subject }, { action: 'pick', sha: log[0].sha, subject: log[0].subject }])
  assert(!fs.existsSync(path.join(repo, 'r3.txt'))); assert(fs.existsSync(path.join(repo, 'r4.txt')))
  // patches
  log = await g.log(repo, { all: false }); const patch = path.join(repo, '..', 'pakgit-test.patch'); await g.formatPatch(repo, log[0].sha, patch); assert(fs.readFileSync(patch, 'utf8').includes('r4 reworded'))
  await g.reset(repo, 'HEAD~1', 'hard'); assert(!fs.existsSync(path.join(repo, 'r4.txt'))); await g.applyPatchFile(repo, patch); assert(fs.existsSync(path.join(repo, 'r4.txt'))); fs.rmSync(patch)
  // worktrees
  const wtDir = path.join(os.tmpdir(), 'pakgit-wt-' + Date.now()); await g.worktreeAdd(repo, wtDir, 'wt-branch', true)
  let wts = await g.worktrees(repo); assert.equal(wts.length, 2); assert.equal(wts[1].branch, 'wt-branch'); await g.worktreeRemove(repo, wtDir, true); wts = await g.worktrees(repo); assert.equal(wts.length, 1)
  assert.deepEqual(await g.submodules(repo), [])
  // clean
  fs.writeFileSync(path.join(repo, 'untracked.tmp'), ''); await g.clean(repo, false); assert(!fs.existsSync(path.join(repo, 'untracked.tmp')))
  await g.setUpstream(repo, 'main', 'cx').catch(() => {}) // no remote: expected to fail quietly
  console.log('ALL BACKEND TESTS PASSED in', repo, '| git log entries:', g.getLogHistory().length)
  fs.rmSync(repo, { recursive: true, force: true })
})().catch((e) => { console.error('FAILED:', e); process.exit(1) })
