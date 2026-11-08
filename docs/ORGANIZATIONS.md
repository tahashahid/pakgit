# Organizations — design proposal (revision 2)

Status: phases 1 to 4 implemented (see section 12). Revision 2 after a critical second pass;
the changes from revision 1 are listed at the end (section 14).

Phase 4 notes (what shipped, and what was left out):
- Configuration repository: `Organization.configRepo` (url, branch, file, lastApplied). The
  clone lives in `<userData>/config-repos/<org>/`. *Check* fetches and diffs the file against
  the local organization (flattened paths such as `pipeline.environments[stage].trackerState`),
  the Organization header shows a banner when the file changed since the last apply, *Review
  and apply* applies it (repositories not cloned here are kept as `knownRepos` with Clone
  buttons, so a later push does not drop them), *Push my configuration* writes and pushes.
- Saved views: `Organization.views` (tab + filters) shown as chips on Work and Ready, shared
  through the configuration repository like everything else on the organization.
- Slack: incoming webhook per person (a secret), events on the organization (created, pull
  request merged, finished with the notes, reverted). Notifications never block a release.
- Revert: a `revert/<name>-<env>` branch from the environment with the landing commit reverted
  (the merge commit, or the squash commit naming the pull request), pushed, pull request
  opened; the release becomes *reverted* when every repository reverted cleanly.
- Clean up merged branches: remote branches contained in the last environment per repository,
  grouped and filtered by kind, deleted on the remote and locally when not checked out.
- Release calendar: `Organization.calendar` (weekday + time per environment); the Overview
  shows the next release and a countdown.
- Jira Cloud provider (REST v3, e-mail + API token per person): same interface as Linear,
  projects as teams, transitions as states, remote links for pull requests.
- Not built: Linear Releases sync (the API surface is still moving), GitLab / Bitbucket
  pull-request state (links keep working), GitHub Issues as a tracker (its numeric keys do not
  fit the key-in-branch-name convention without a prefix).

Phase 3 notes (what shipped, and where it differs from the proposal):
- Releases are created from the Ready tab (*Promote selected…*). The dialog runs the gates
  first; blocking gates need the target branch name typed as confirmation and the override
  is recorded on the release. The per-repository Release view keeps its own, record-less
  promotion for single repositories.
- Release records live in `orgs/<id>/releases.json`. Per repository they hold the requested
  inputs, merged / skipped items, a pause (conflict + remaining items), the pull request (or
  the compare page opened in the browser), whether the branch landed in the environment, an
  error (e.g. a dirty working tree, retried with *Retry*) and a drop reason.
- Gates: tracker state (allowed states per environment), partly promoted, dev-based, frozen,
  previous environment; each off / warn / block, stored on the template environment
  (`Environment.gates`); defaults as in section 13.7. Freezes live on the organization
  (`freezes`), with an optional until-day; *Lift* in the Organization header.
- Hosting: GitHub through the gh CLI (its login, or an org-specific token passed as GH_TOKEN),
  REST with the token when gh is missing. Pull-request state, checks, review decision,
  mergeability, creation with reviewers / labels / draft / body template. GitLab and
  Bitbucket keep the compare-page links. Linking rules 4–5 (attachments and PR titles) are
  not applied automatically; the data they need (issue attachment URLs, PR lists) is fetched
  and shown (Ready tab PR column), and *Link branch…* covers the rest.
- Tracker events: state on PR opened (`trackerStateOnPr`), state on Finish (`trackerState`),
  attach the PR to the Linear issue (off by default).
- Deployed-version probes are stored with the repository pipeline override (`probes`), read on
  the Overview and on release cards; the value must be a commit, tag or branch known to the
  clone. Deploy order is a list of repository identities on the organization.

Phase 2 notes (what shipped, and where it differs from the proposal):
- Per-repository state now lives in `repos/<slug>-<hash>/` keyed by the normalised remote URL
  (`pipeline.json`, `archive.json`, `overrides.json`, `links.json`, `analysis-cache.json`,
  `meta.json`). Entries of the old flat files move over on first use; repositories without a
  remote are keyed by path.
- The analysis cache is keyed on every ref tip plus the pipeline, archive, overrides, links
  and issue prefixes; HEAD and tracker data are re-read on every call. Refresh bypasses it.
- Issue-key prefixes are shared across the organization: a prefix seen with two or more
  numbers anywhere in the organization counts in every repository (linking rules 1–2 then
  find CYB4-1 in a repository that holds only that one CYB4 branch).
- Linking rule 3 (the tracker's branch name) is applied in the Work tab for issues loaded from
  the tracker; rule 6 is *Link branch…* (Work) / *Link to issue…* (Ready and Release rows).
- The Ready tab promotes one repository at a time: *Promote selected…* opens that repository's
  Release view with the items ticked. Cross-repository promotion and releases stay in phase 3.
- Quick open took Cmd/Ctrl+K; *Commit…* moved to Cmd/Ctrl+Shift+K.
- Work rows are the tracker issues matching the filters plus every issue found in git that the
  tracker list did not include, so the tab also works without a tracker.

## 1. The problem

Today PakGit is repository-centric: one flat list of repositories with optional groups, one
issue-tracker connection for the whole app, a pipeline configured per repository, release
planning per repository.

A team does not work like that. CyberNut has several repositories under one GitHub
organization (`Project-CyberNut`), one Linear workspace, the same environments and the same
weekly release (`release/release-2026-W45`), and issues whose work lands in more than one
repository. Nothing in PakGit sees across repositories, so the questions that matter at
release time have no answer in the app:

- What is ready for stage across all repositories?
- Is CYB4-2428 fully on stage, or only the frontend half?
- Which repositories does this week's release touch, and are all its pull requests merged?
- Is what is on the `stage` branch actually deployed to the staging environment?
- Which of the 73 remote branches already merged into `main` can be deleted?

An **organization** is the container that answers those questions: it owns repositories,
the integrations they share, the pipeline they share, and the planning that spans them.

## 2. Principles

1. **Zero configuration to start, everything configurable later.** The organization is
   inferred from GitHub owners, the pipeline from existing branches, issue prefixes from
   Linear teams. Every inferred value can be overridden and shows where it came from.
2. **One place per concern.** Organization = shared configuration and planning scope.
   Repository = git work. Group = a visual folder, also usable as a filter. No concept has
   two jobs, and no new concept is introduced when an existing one can be extended.
3. **Inheritance with overrides, never duplication.** Pipelines, conventions and tracker
   mappings are defined once per organization; a repository overrides only what differs.
4. **Local-first, no server, no accounts.** Configuration is plain JSON that can be exported,
   imported and shared through git. Secrets are never in it; every person authenticates
   themselves. Shared configuration and personal UI state are kept in separate files.
5. **One engine, two scopes.** Organization views run the existing release engine over
   several repositories. The per-repository Release view is the organization view filtered to
   one repository.
6. **Same safety rules.** Nothing done from the organization bypasses the pull-request flow or
   touches an environment branch directly. Checks before a promotion warn; they can be
   overridden with a confirmation, never silently.
7. **Progressive disclosure.** Four tabs and one Configure dialog. Advanced options stay out
   of sight until needed.
8. **PakGit observes and prepares; it does not deploy.** It creates branches and pull
   requests, reads what git and the tools report, and tells the team what is where. Deploys
   stay with CI. Where a deploy can be *observed* (a version endpoint, a tag), PakGit shows it.

## 3. Who needs what

| Role | Questions | What they get |
|---|---|---|
| Developer | Where do I start CYB4-2510, which repos does it touch, is my part on dev, is my PR green? | **Work** tab: pick the issue, pick the repositories, branches are created from `main` and the issue moves to In Progress. Each row shows the issue's branches per repository, their environment, and their PR state. |
| QA | What landed on dev today across repos? What is waiting for me? | **Overview** activity, the *ready for stage* counts per repository, Work filtered by state QA. |
| Product / UAT | What is on stage now, what did I approve for production, is it deployed yet? | **Ready** filtered to *To main*, Linear status next to each item, deployed-version marker per environment. |
| Release manager | Build this week's release across repos without missing half-done work, in the right order, and know when it is done | **Releases**: tick items across repos, one branch name everywhere, one PR per repo, checks before creating it (partly promoted, dev-based, tracker state), deploy order, PR state, finish with sync, release notes. |
| New team member | Which repos exist, where do I clone them, how do we work? | Import the organization file: repositories listed by remote URL with *Clone*, pipeline and conventions set, the team's "How we work" text. |
| Solo user | I don't want any of this | **Personal** has every feature and no required setup. The switcher only appears once an organization exists. |

## 4. Concepts

```
Workspace (the app on this machine)
├── Personal                      ← implicit organization for repositories without one
└── Organization "CyberNut"
    ├── Repositories (grouped or flat)      identity = remote URL; local path per machine
    ├── Pipeline template                   dev → stage → main: strategies, tracker states, gates, freeze
    ├── Conventions                         branch naming, release naming, issue prefixes, ignored prefixes
    ├── Integrations                        tracker (Linear), hosting (GitHub), notifications (Slack) …
    ├── Releases                            named cross-repository promotions and their pull requests
    ├── Views                               saved filters
    └── How we work                         the team's process text, shown in the help panel
```

- **Organization**: name, colour, repositories and groups, pipeline template, conventions,
  integrations, releases, views. A repository belongs to exactly one organization (or
  Personal) and can be moved; a path exists once in the workspace.
- **Personal**: the implicit organization. Same features; no integrations unless added.
  Today's list, groups, pipelines, archive, overrides and Linear connection migrate here.
- **Repository identity**: the normalised remote URL (`github.com/project-cybernut/admin-portal-v2`,
  no protocol, no `.git`, lower-case) is the stable identity across machines; the local path
  is per machine. Two checkouts of the same remote are one repository with two paths.
  Repositories without a remote are keyed by path and cannot be exported.
- **Work item**: an issue (or an un-ticketed branch) with one *part* per repository that
  carries branches or commits for it. The cross-repository link.
- **Release**: a named promotion across repositories: the same branch name in each affected
  repository, one pull request per repository, a record of their state, and generated notes.
- **Integration**: a connected tool with a *type* (tracker, hosting, notifications, CI) and a
  *provider*. Configuration is per organization and shareable; authentication is per person.

## 5. Navigation and screens

### 5.1 Switcher and sidebar

```
┌ REPOSITORIES ──────────────────── ⊞  + ┐
│ ● CyberNut ▾                            │   ← CyberNut ✓ · Personal · ─ · New organization… · Manage…
│ ▾ Portals                           3   │
│     admin-portal-v2                     │
│     cybernut-user-portal                │
│     user-portal-micro-learning-v2       │
│ ▾ Backend                           1   │
│     lambdas                             │
│   google-addon                          │
└─────────────────────────────────────────┘
```

Switching changes the repository list, the active integrations and the Organization
perspective. Window title: `PakGit — CyberNut`. Shortcut Cmd/Ctrl+Shift+O.

### 5.2 Quick open (Cmd/Ctrl+K)

One box to jump anywhere in the organization: repository, branch (in any repository),
issue key, release name. Typing `CYB4-2428` shows the issue with its parts; Enter opens it in
Work. This is the fastest way to answer "where is X?" and costs little to build on the index.

### 5.3 The Organization perspective (Cmd/Ctrl+5)

Four tabs and one Configure dialog. Group chips (Portals, Backend) filter every tab.

**Overview**

```
CyberNut · 5 repositories · Linear ✓ Cybernut (CYB4, CYB2) · GitHub ✓ Project-CyberNut        [Fetch all] [Sync all] [Configure…]
Ready across repos:  12 → stage   3 → main   ·   2 releases in progress   ·   ⚠ 4 issues partly promoted   ·   73 merged branches to clean up

Portals
┌ admin-portal-v2 ────────────────────────────┐ ┌ cybernut-user-portal ───────────────────────┐
│ on main · clean · fetched 5 min ago         │ │ on dev · 2 changed · ↑1                     │
│ → stage 7   → main 1    drift main→dev: 38 ⚠│ │ → stage 3   → main 0                        │
│ release/stage-2026-W46  PR #3890 open ✓ ci  │ │ stage deployed: 2 commits behind branch ⚠  │
└─────────────────────────────────────────────┘ └─────────────────────────────────────────────┘
```

One card per repository: branch, working-tree state, ahead/behind, ready counts per
environment, release branches with PR and CI state, health warnings (drift between
environments, dev-based branches, stale release branches, deployed version behind the
branch). Clicking a card opens the repository in the Standard view.

**Work** — planning by issue

```
[Team CYB4 ▾] [State: In Progress, QA ▾] [Assignee ▾] [Cycle ▾] [Updated 30 d ▾] [Group: Portals]  🔍
Issue       Status   Title                               admin-portal-v2      user-portal       lambdas
CYB4-2495   QA       [FE] Serve the CS Internal Dashboard  dev ✓ · PR #3881 ✓  —                 —
CYB4-2428   UAT      [FE] Add /api/region route            stage ✓             dev ✓ ⚠           —
CYB4-2510   Todo     Export compliance report              no branch            no branch         no branch      [Start work ▾]
```

Rows come from the tracker, so planned-but-unstarted work is visible. Columns are the
organization's repositories (filtered by group). A cell is that issue's part in that
repository: highest environment, pull-request state when hosting is connected, ⚠ when the
issue's parts sit on different environments. Actions on a row: Start work (choose
repositories), Link branch… (for branches that follow no convention), change state, assign
to me, open in Linear.

**Ready** — the existing Release table in organization scope

```
[To stage 12] [To main 3] [All unreleased] [Released] [Archived]                      [Group ▾] [Status ▾] [Updated ▾]
☐  Issue      Status  Title                    Repo                  dev  stage  main  Own  PR
☑  CYB4-2428  UAT     Add /api/region route    admin-portal-v2        ✓    ✓           12   #3870 merged
☑  CYB4-2428  UAT     Add /api/region route    cybernut-user-portal   ✓                 3   #612 open ⚠ not on stage
☐  CYB4-2467  QA      Account dropdown         admin-portal-v2        ✓                 1   #3875 conflicting
[Promote selected…]  [Open pull request…]  [Sync all environments]  [Start work on issue…]
```

Same table as the per-repository Release view with a Repo column, group filter and PR
column. *Promote selected…* runs the pre-flight checks (section 6.4), then creates one
branch name in every repository that has a selected item, merges per repository, opens one
PR per repository, and records a **release** (next tab). A conflict pauses only that
repository; the others continue; the release shows which one is paused and offers Resume.

**Releases** — the named cross-repository releases

```
release/stage-2026-W46  → stage · created 2 h ago · 7 items · 3 repositories           [Finish] [Notes] [Revert…]
  1. lambdas              PR #212  merged ✓ 10:12
  2. admin-portal-v2      PR #3890 open · ci ✓ · review pending
  3. cybernut-user-portal paused: conflict in CYB4-2428          [Resume]
Deployed: lambdas stage = branch ✓ · admin-portal-v2 stage 2 behind
```

Each release lists its repositories in deploy order, with branch, PR, CI and review state
and deployed-version markers. *Finish* runs Sync environments in each repository once all
PRs are merged and moves tracker states. *Notes* generates release notes (issues, titles,
links, per repository) to copy or post. *Revert…* creates revert branches and PRs for the
release's merge commits in each repository.

**Configure…** dialog, with sections: General (name, colour, "How we work"), Repositories &
groups (membership, move between organizations, deploy order), Pipeline (the template, with
the repositories' inheritance table), Conventions, Integrations, Sharing (export, import,
configuration repository).

### 5.4 Per-repository views

Standard, Log and Working Tree are unchanged. The per-repository Release view gets a scope
toggle `This repo | Organization` (organization scope = the Ready tab filtered to nothing).
Rows in repository scope show a hint when the issue also has parts elsewhere ("also in
user-portal: on dev"), so the cross-repository fact is visible where the work happens.

## 6. Cross-repository intelligence

### 6.1 The work-item index

Per repository the existing analysis runs (branches by issue key, environment containment,
own commits, dev-based detection). The organization merges results by issue key:

```
CYB4-2428
  admin-portal-v2:      hanzala/cyb4-2428-region-from-domain   dev ✓ stage ✓ main ✗   PR #3870 merged
  cybernut-user-portal: cyb4-2428-region-api                    dev ✓ stage ✗ main ✗   PR #612 open
  tracker: UAT, assignee Hanzala, url …
```

Linking rules, applied in order, each attaching a part to an issue:

1. issue key in the branch name;
2. issue key in commit messages on environment branches (covers deleted branches);
3. the tracker's own branch name for the issue (Linear stores `branchName`);
4. the tracker's attachments: Linear's GitHub integration attaches pull requests to issues,
   so an issue's PR URLs identify repository and head branch even when the branch name
   carries no key;
5. pull-request titles and bodies mentioning the key (through the hosting integration);
6. a manual link (Work ▸ *Link branch…*), remembered like a tracking override.

The index is cached per repository, keyed on the branch tips, and refreshed on fetch or on
demand. Five repositories of 300 branches analyse in parallel in a few seconds.

### 6.2 Warnings only an organization can give

- **Partly promoted**: parts of one issue sit on different environments.
- **Dev-based**: branches cut from dev/stage (already detected), aggregated per repository.
- **Drift**: an environment branch ahead of the previous one by more than N commits
  (admin-portal-v2 had `main` 38 commits ahead of `dev`); suggests Sync environments.
- **Stale release branches**: release branches with no open PR and not merged.
- **Deployed version behind**: the environment's deployed commit is behind its branch
  (section 6.5).
- **Tracker relations**: an item in a release whose Linear blocker or parent issue is not
  included (later; needs issue relations from the tracker).

### 6.3 Cross-repository promotion and releases

One branch name across repositories keeps a release traceable. Release records store
`{ id, name, environment, createdAt, createdBy, items, repos: [{ remote, branch, base, prUrl, prNumber, prState, ciState, mergedAt, paused }], notes }`.
State comes from git (branch merged into the environment) and, when hosting is connected,
from the pull request and its checks.

### 6.4 Pre-flight checks (gates)

Per environment, configurable in the pipeline template, each either *warn* or *block*:

- tracker state of every item is in an allowed set (e.g. `Ready To Deploy` for main);
- no item is partly promoted across the organization;
- no branch is dev-based;
- the environment is not frozen (section 6.6);
- the previous environment contains the item (already enforced by the tabs).

Blocked checks can be overridden with a typed confirmation and are recorded on the
release. Results are shown in the Promote dialog before anything is created.

### 6.5 Deployed-version probe

Optional, per repository and environment: how to read the deployed commit. Types: HTTP
JSON (`https://stage.example.com/version`, JSON path `commit`), HTTP text with a regex, or a
git tag pattern (`deployed/stage`). PakGit compares it with the environment branch and shows
"deployed = branch", "2 commits behind", or "unknown". This is the only way the app can say
*deployed* rather than *merged*, and it is read-only.

### 6.6 Freeze

An environment can be frozen with a note and an optional until-date ("stage frozen for UAT
until Friday"). Promotions into it warn or block (gate), the Overview shows the freeze, and
it lifts automatically at the date.

### 6.7 Deploy order

An ordered list of repositories per organization (optionally per environment), used as the
display order on releases and as a checklist. PakGit does not enforce it beyond showing it.

### 6.8 Organization-wide actions

Fetch all; Sync all environments; Quick open; Start work in several repositories; Clean up
merged branches (lists remote branches merged into the last environment, grouped by
repository, with multi-select delete and a confirmation; 73 candidates today in
admin-portal-v2 alone); activity list of recent merges on environment branches grouped by
issue.

## 7. Integrations

A registry of providers. Each declares a type, a configuration schema (plain fields, so the
UI is generated), capabilities, and separates *configuration* (shareable) from
*authentication* (per person). The tracker interface in `src/main/tracker/` becomes the first
of these types.

| Type | Provider | Gives | Auth |
|---|---|---|---|
| tracker | Linear (now) | issues, states, assignee, branch names, attachments (PR links), relations, state updates, my issues, release notes / Releases when the workspace has them | OAuth or API key, per person |
| tracker | Jira, GitHub Issues (later) | same interface | per person |
| hosting | GitHub (next) | PR state, mergeability, review decision, checks; create PRs with template, reviewers and labels; merged detection; branch deletion. Through the `gh` CLI when it is installed and logged in (zero setup on most developer machines), else a token | per person |
| hosting | GitLab, Bitbucket (later) | PR/MR links now; state later | per person |
| notifications | Slack incoming webhook (later) | messages on release created / merged / finished, with the notes | webhook URL is a secret: stored per person, prompted on import |
| CI | through hosting checks (GitHub Actions) | check status on release PRs | via hosting |

Tracker-side writes, all optional and off by default except state changes:
- state changes on start / PR opened / PR merged / finished (section 8);
- attach the PR to the issue when PakGit opens one (Linear `attachmentLinkGitHubPR`), so
  Linear shows it even without the GitHub integration;
- create a Linear Release for a PakGit release and sync its notes, when the workspace uses
  Linear Releases.

Adding a provider means implementing one interface and registering it; the UI needs no
change.

## 8. Configuration and inheritance

Resolution order for any setting: **repository override → organization → detected default**.

- **Pipeline template** (organization): environments with strategies, tracker states, gates,
  freeze, release-name pattern, base environment, back-merge.
- **Repository pipeline**: *Use organization pipeline* (default) with an optional branch-name
  map (`stage → staging`), an environment subset (a library repository uses only `main`),
  strategy overrides, and deployed-version probes; or a fully custom pipeline (today's
  editor). Every inherited value is labelled *inherited* with Override / Reset actions.
- **Tracker state events** per environment: on PR opened, on merged (needs hosting), on
  promoted (when there is no hosting; today's behaviour), on released. On start: global.
- **Conventions**: issue prefixes (default: the tracker's team keys); ignored branch
  prefixes; branch-name pattern for Start work (`{user}/{key}-{slug}`, or the tracker's
  suggestion); release-name pattern with tokens `{env}`, `{week}`, `{date}`, `{name}`,
  `{seq}` (CyberNut's current `release/release-{week}` is one setting away).
- **Views**: saved filter sets per organization shown as chips.
- **Shared vs local**: the organization file holds everything above. Column widths,
  collapsed groups, last tab, dismissed warnings are local UI state in a separate file and
  never exported.

## 9. Storage, sharing and migration

```
<userData>/
  workspace.json                     { version, organizations: [ids], active }
  orgs/<id>/
    org.json                         name, colour, groups, pipeline, conventions, integrations (config), deploy order, views, how-we-work
    repositories.json                [{ remote, path, name, group, lastOpened }]
    releases.json                    releases (section 6.3)
    ui-state.json                    local only
  repos/<identity-hash>/             per-repository state, independent of organization
    pipeline.json                    override (if any)
    archive.json, overrides.json, links.json
    analysis-cache.json
  settings.json                      app settings + per-person auth (encrypted with safeStorage), keyed by organization + provider
```

- **Export / import**: one JSON file with `org.json` and the repository list by remote URL,
  no paths, no secrets. Import creates the organization, matches repositories already on
  the machine by remote, offers to clone the rest, and prompts for any secret an integration
  needs. (Cheap; included in phase 1 so the team can adopt together.)
- **Configuration repository**: point an organization at a small git repository containing
  that file. PakGit pulls on start, shows a diff of what changed, and applies it; local
  edits can be pushed back from Configure ▸ Sharing. No server, full history, reviewable.
- **Migration**: the current repository list, groups, pipelines, archive and overrides move
  to Personal; the Linear connection becomes Personal's tracker. The first-run wizard then
  proposes organizations from the GitHub owners found in the remotes ("Create CyberNut with
  these 5 repositories and move the Linear connection to it?"). Nothing is lost; nothing is
  required.
- Every file has a `version`; migrations live in one module and run once.

## 10. Small things and edge cases

- Moving a repository between organizations keeps its per-repository state.
- Deleting an organization moves its repositories to Personal; per-repository state stays.
- Several organizations can connect different Linear workspaces with the same OAuth client ID.
- A monorepo is one repository with one pipeline.
- Issue keys from several teams (CYB4, CYB2) are all valid; Work filters by team.
- Work in a repository outside the organization is shown with a note, not hidden.
- Offline: git-based views work; tracker and hosting columns show "not loaded".
- Tracker rate limits (Linear allows on the order of 1,500 requests per hour): issues are
  fetched in batches by team and number, cached, and refreshed on demand; the Work tab pages.
- Large organizations: analysis per repository runs in parallel with a tip-keyed cache; the
  Overview shows cached numbers first and refreshes in place.
- Release names must be unique per organization; a second release on the same day gets
  `{seq}`.
- A paused repository in a release can be resumed or dropped from the release; dropping it
  records the reason.
- Reverting a release creates revert branches and PRs; it never force-pushes.
- No permissions model: the app is local. Shared state such as "who approved" would need a
  server and is a separate decision.
- Naming: "Organization" matches GitHub and the team's language. Linear's "workspace" is
  shown only as the tracker's name inside Integrations.

## 11. Testing

Every phase ships with engine tests built on temporary repositories (as `test/release.test.cjs`
does today, extended to several repositories with a shared origin), plus screenshot checks
of the views. The index, the gates, the release records and the migration are the parts
worth the most test coverage because mistakes there are silent.

## 12. Phases

### Phase 1 — Foundation
- Organizations and Personal; switcher; repositories and groups per organization; migration
  of all existing data; first-run wizard that proposes organizations from GitHub owners.
- Configure dialog: General, Repositories & groups, Pipeline template with the inheritance
  table, Conventions (prefixes, ignored prefixes, name patterns), Integrations (tracker moves
  here from app settings; Personal keeps today's behaviour), Sharing (export / import).
- Per-repository pipeline: *Use organization pipeline* + branch map + environment subset;
  inherited labels; Override / Reset.
- Overview tab with cards (branch state, ready counts, health warnings that need only git).
- Tests: migration, inheritance resolution, organization CRUD, export/import round trip.
- Done when: a user with today's data sees no difference until they create an organization;
  CyberNut can be created in two clicks and shared as one file.

### Phase 2 — Planning across repositories (implemented)
- Work-item index with linking rules 1–3 and 6 (manual link); analysis cache.
- Work tab (tracker issues × repositories, filters, state change, assign to me, Start work in
  several repositories, Link branch).
- Ready tab (organization scope, Repo column, group filter) and the scope toggle in the
  per-repository Release view; partly-promoted and drift warnings; health numbers on cards.
- Quick open (Cmd/Ctrl+K).
- Tests: index merging, warnings, multi-repository start work.
- Done when: "is CYB4-2428 fully on stage?" is answered by one row.

### Phase 3 — Releases (implemented)
- Cross-repository Promote with pre-flight checks (gates), freeze, deploy order; release
  records; Releases tab with Resume / drop / Finish (sync + tracker states) / Notes.
- Hosting integration (GitHub via `gh`, token fallback): PR state, checks, review decision,
  merged detection, PR creation with template / reviewers / labels; linking rules 4–5;
  tracker events on PR opened / merged; attach PRs to Linear issues.
- Deployed-version probes.
- Tests: multi-repository promotion with a conflict in one repository, release state
  transitions, gate evaluation.
- Done when: this week's release is one object with a visible state from "created" to
  "finished".

### Phase 4 — Sharing and ecosystem (implemented, see the notes at the top)
- Configuration repository sync with diff; saved views.
- Slack notifications; release notes generation; Linear Releases sync; Revert release;
  Clean up merged branches; release calendar (cadence per environment, default names and a
  countdown on the Overview).
- Jira and GitHub Issues providers; GitLab / Bitbucket PR state.
- Each item is independent and can be reordered by demand.

### Later, only if asked for
- A small sync service for shared state (approvals, assignments) and multi-user releases.
- A headless mode / CLI so CI can create or finish releases.
- Windows and Linux installers signed and published; auto-update.

## 13. Open decisions

1. Personal as an always-present organization (recommended) versus every repository in a
   named organization.
2. Tracker connection per organization (recommended) versus one global connection.
3. One branch name per release across repositories (recommended).
4. Export/import in phase 1 and the configuration repository in phase 4 (recommended), or
   the configuration repository earlier because the team adopts PakGit together.
5. GitHub access through the `gh` login when present, token otherwise (recommended).
6. Tab names: Overview · Work · Ready · Releases (recommended), or keep "Release" for the
   table and call the named releases "Trains".
7. Which gates block by default for `main`: tracker state in {Ready To Deploy} and not
   partly promoted (recommended), others warn.

## 14. What changed in revision 2

- Simplified navigation: four tabs plus one Configure dialog instead of six tabs; group
  chips filter every tab; Quick open added.
- Linking rules extended with Linear attachments, PR titles/bodies and a manual link; the
  Work tab says "no branch" with a Link action instead of "not started".
- Pull-request state, checks and review decision through the GitHub CLI; PR creation with
  templates and reviewers; tracker state on PR opened / merged instead of only on promote;
  attaching PRs to Linear issues.
- Pre-flight checks (gates), environment freeze, deploy order on releases, deployed-version
  probes, release notes, revert release, merged-branch clean-up, release calendar.
- Repository pipeline overrides can be a subset of environments, not only renamed branches.
- Shared configuration and local UI state separated; secrets prompted on import; export /
  import moved into phase 1; first-run wizard added; rate limits and uniqueness rules noted.
- Phases rewritten with contents, tests and a "done when" line each.
