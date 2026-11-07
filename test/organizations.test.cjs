const org = require('../out/test/organizations.cjs')
const fs = require('fs'), path = require('path'), os = require('os')
const assert = require('assert')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pakgit-org-'))
org.setOrgDir(root)

// --- remote identity
assert.equal(org.normalizeRemote('https://github.com/Project-CyberNut/admin-portal-v2.git'), 'github.com/project-cybernut/admin-portal-v2')
assert.equal(org.normalizeRemote('git@github.com:Project-CyberNut/admin-portal-v2.git'), 'github.com/project-cybernut/admin-portal-v2')
assert.equal(org.normalizeRemote('ssh://git@gitlab.example.com:2222/group/sub/repo/'), 'gitlab.example.com/group/sub/repo')
assert.equal(org.normalizeRemote('https://user:tok@bitbucket.org/w/r'), 'bitbucket.org/w/r')
assert.equal(org.normalizeRemote(''), null); assert.equal(org.normalizeRemote('/tmp/local.git'), null)
assert.deepEqual(org.parseIdentity('gitlab.example.com/group/sub/repo'), { host: 'gitlab.example.com', owner: 'group/sub', name: 'repo' })

// --- migration from the flat layout
fs.writeFileSync(path.join(root, 'repositories.json'), JSON.stringify([
  { path: '/r/admin', name: 'admin', lastOpened: 1, group: 'Work', remote: 'github.com/project-cybernut/admin-portal-v2' },
  { path: '/r/user', name: 'user', lastOpened: 2, group: null, remote: 'github.com/project-cybernut/cybernut-user-portal' },
  { path: '/r/pakgit', name: 'pakgit', lastOpened: 3, group: 'Work', remote: 'github.com/tahashahid/pakgit' },
  { path: '/r/local', name: 'local', lastOpened: 4 }
]))
fs.writeFileSync(path.join(root, 'groups.json'), JSON.stringify(['Work']))
let m = org.ensureMigrated({ provider: 'linear', authMethod: 'oauth', linearClientId: 'cid', stateOnStart: 'In Progress' })
assert.equal(m.migrated, true); assert.equal(org.ensureMigrated().migrated, false, 'idempotent')
assert(!fs.existsSync(path.join(root, 'repositories.json')) && fs.existsSync(path.join(root, 'repositories.json.migrated')))
let ws = org.workspace()
assert.equal(ws.active, 'personal'); assert.deepEqual(ws.organizations.map((o) => [o.id, o.repoCount]), [['personal', 4]])
const personal = org.getOrg('personal')
assert.deepEqual(personal.groups, ['Work']); assert.equal(personal.tracker.provider, 'linear'); assert.equal(personal.tracker.linearClientId, 'cid')
assert.equal(org.orgRepos('personal').find((r) => r.name === 'admin').group, 'Work')

// --- proposals from owners
const props = org.proposals('personal')
assert.deepEqual(props.map((p) => [p.owner, p.repos.length]), [['project-cybernut', 2], ['tahashahid', 1]])

// --- create an organization and move repositories
const cyber = org.createOrg({ name: 'CyberNut', pipeline: null, tracker: personal.tracker })
assert.equal(cyber.id, 'cybernut'); assert.notEqual(cyber.color, personal.color)
org.moveRepo('/r/admin', 'cybernut'); org.moveRepo('/r/user', 'cybernut')
assert.deepEqual(org.workspace().organizations.map((o) => [o.id, o.repoCount]), [['personal', 2], ['cybernut', 2]])
assert.equal(org.findRepo('/r/admin').org, 'cybernut'); assert.equal(org.findRepo('/r/admin').group, null, 'group cleared when moving')
assert.equal(org.orgOfRepo('/r/pakgit'), 'personal')
// a path exists once: adding it to another organization moves it
org.upsertRepo({ path: '/r/pakgit', name: 'pakgit', lastOpened: 9 }, 'cybernut')
assert.equal(org.orgRepos('personal').length, 1); assert.equal(org.orgRepos('cybernut').length, 3)
org.moveRepo('/r/pakgit', 'personal')
// groups per organization
org.createGroup('cybernut', 'Portals'); org.setRepoGroup('/r/admin', 'Portals'); org.setRepoGroup('/r/user', 'Portals')
assert.deepEqual(org.groups('cybernut'), ['Portals'])
org.renameGroup('cybernut', 'Portals', 'Web'); assert.equal(org.findRepo('/r/user').group, 'Web')
org.updateOrg('cybernut', { groups: [] }); assert.equal(org.findRepo('/r/user').group, null, 'removing a group clears it on repositories')
org.setRepoGroup('/r/admin', 'Web')
// active organization
assert.equal(org.setActive('cybernut').active, 'cybernut'); assert.throws(() => org.setActive('nope'), /Unknown organization/)
const dup = org.createOrg({ name: 'CyberNut' }); assert.equal(dup.id, 'cybernut-2'); org.deleteOrg('cybernut-2')
assert.throws(() => org.deleteOrg('personal'), /Personal cannot be deleted/)
assert.equal(org.updateOrg('personal', { name: 'Renamed' }).name, 'Personal', 'Personal keeps its name')

// --- pipeline inheritance
const template = { remote: 'origin', releasePrefix: 'release/', backMerge: true, baseEnv: 'prod', issuePrefixes: ['CYB4'], excludePrefixes: ['release/'], environments: [
  { id: 'dev', name: 'Development', branch: 'dev', strategy: 'feature-pr', trackerState: 'QA' },
  { id: 'stage', name: 'Staging', branch: 'stage', strategy: 'release-branch', trackerState: 'UAT' },
  { id: 'prod', name: 'Production', branch: 'main', strategy: 'release-branch', trackerState: 'Done' }] }
org.updateOrg('cybernut', { pipeline: template })
let r = org.applyOverride(template, { mode: 'org', branchMap: { stage: 'staging' }, strategyMap: { dev: 'merge' } })
assert.deepEqual(r.environments.map((e) => [e.id, e.branch, e.strategy]), [['dev', 'dev', 'merge'], ['stage', 'staging', 'release-branch'], ['prod', 'main', 'release-branch']])
r = org.applyOverride(template, { mode: 'org', disabled: ['dev', 'stage'] })
assert.deepEqual(r.environments.map((e) => e.id), ['prod']); assert.equal(r.baseEnv, 'prod')
r = org.applyOverride(template, { mode: 'org', disabled: ['prod'] }); assert.equal(r.baseEnv, 'stage', 'base falls back to the last remaining environment')
assert.throws(() => org.applyOverride(template, { mode: 'org', disabled: ['dev', 'stage', 'prod'] }), /All environments are disabled/)
assert.strictEqual(org.applyOverride(template, { mode: 'custom' }), template)
assert.strictEqual(org.applyOverride(template, null), template)

// --- export / import round trip
const exp = org.exportOrg('cybernut')
assert.equal(exp.version, 1); assert.equal(exp.organization.name, 'CyberNut'); assert.equal(exp.organization.pipeline.environments.length, 3)
assert.deepEqual(exp.repositories.map((x) => [x.remote, x.group]).sort(), [['github.com/project-cybernut/admin-portal-v2', 'Web'], ['github.com/project-cybernut/cybernut-user-portal', null]])
assert(!JSON.stringify(exp).includes('/r/'), 'no local paths exported'); assert(!('linearAccessToken' in exp.organization.tracker), 'no secrets exported')
// import into a fresh workspace: one repository present (by remote), one missing
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pakgit-org2-')); org.setOrgDir(root2); org.ensureMigrated()
org.upsertRepo({ path: '/other/admin', name: 'admin-portal-v2', lastOpened: 1, remote: 'github.com/project-cybernut/admin-portal-v2' }, 'personal')
let imp = org.importOrg(exp)
assert.equal(imp.org.name, 'CyberNut'); assert.equal(imp.matched.length, 1); assert.equal(imp.matched[0].path, '/other/admin'); assert.equal(imp.matched[0].group, 'Web')
assert.deepEqual(imp.missing.map((x) => x.remote), ['github.com/project-cybernut/cybernut-user-portal'])
assert.equal(org.findRepo('/other/admin').org, 'cybernut'); assert.deepEqual(org.getOrg('cybernut').groups, ['Web'])
assert.equal(org.getOrg('cybernut').pipeline.environments[1].branch, 'stage')
// importing again updates in place instead of duplicating
imp = org.importOrg({ ...exp, organization: { ...exp.organization, howWeWork: 'updated' } })
assert.equal(org.workspace().organizations.filter((o) => o.name === 'CyberNut').length, 1); assert.equal(org.getOrg('cybernut').howWeWork, 'updated')
assert.throws(() => org.importOrg({ version: 2 }), /Not a PakGit organization file/)
// delete moves repositories back to Personal
org.deleteOrg('cybernut'); assert.equal(org.findRepo('/other/admin').org, 'personal'); assert.equal(org.workspace().organizations.length, 1)

console.log('ALL ORGANIZATION TESTS PASSED in', root)
fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(root2, { recursive: true, force: true })
