# Branching and release workflow

This is the process PakGit's **Release** view is built around. It is designed for three
environments (`dev` → `stage` → `main`), selective promotion (not everything that is on
`dev` goes to `stage`, not everything on `stage` goes to production) and as few merge
conflicts as possible.

```
 Linear issue CYB4-1234
        │  branch from main
        ▼
 taha/cyb4-1234-slug ──PR──▶ dev   (QA tests here)            Linear: In Review → QA
        │
        └──────────── PR ──▶ stage (UAT by product team)       Linear: UAT
                                   │ pick approved items
                                   ▼
                      release/2026-W46 ──PR──▶ main (production)  Linear: Done
                                                 │
                                   back-merge: main → stage → dev
```

## The one rule that makes selective releases possible

**Every piece of work lives on exactly one branch, created from `main`, and that same
branch is merged into every environment.** Never copy a branch per environment
(`…-dev`, `…-stage`, `…-main`) and never promote by merging `dev` into `stage` or `stage`
into `main` wholesale.

Why: a branch cut from `main` contains only its own changes. Merging it into `dev`,
`stage` and a release branch applies the same diff three times, so you can pick any
subset of branches for any environment. A branch cut from `dev` drags every unreleased
`dev` change with it and cannot be promoted on its own.

## Step by step

### 1. Start a task

1. In Linear move the issue to **In Progress**.
2. Create the branch from the latest `main`, named after the issue. Linear's
   "copy git branch name" gives the right name (`taha/cyb4-1234-short-title`):

   ```bash
   git fetch origin
   git switch -c taha/cyb4-1234-short-title origin/main
   ```

   In PakGit: Release view ▸ **Start work on issue…** does both.
3. Commit with the issue key in the message (`fix(threats): … (CYB4-1234)`), so the
   work stays traceable even if the branch is deleted later.

### 2. Get it onto `dev` (QA)

1. Before opening the PR, bring the branch up to date with `main` so it still applies
   cleanly everywhere:

   ```bash
   git fetch origin
   git rebase origin/main        # only while the branch is not merged anywhere yet
   ```

   If the branch was already merged into `dev`, do **not** rebase; merge instead:
   `git merge origin/main`.
2. Open a PR **feature → dev**, get review, merge with a merge commit (no squash,
   no rebase-merge: squashing creates new commits and breaks the "same branch
   everywhere" rule). Linear: **In Review** → **QA**.
3. If the merge into `dev` conflicts, resolve it there once. With `rerere` enabled
   (PakGit turns it on for the repository), Git remembers the resolution and replays
   it when the same branch is later merged into `stage` and the release branch.

### 3. Promote to `stage` (UAT)

Only what QA approved goes to `stage`, and nothing lands on an environment branch
without a pull request:

1. In PakGit's Release view, tab **To Staging** lists everything that is on `dev` but
   not on `stage`. Tick the items and click **Create release branch + PR**. PakGit cuts
   `release/stage-2026-W46` from `stage`, merges each selected feature branch (never
   `dev` itself) into it, pushes it and opens the pull request **release/… → stage** in
   your browser.
   By hand: `git switch -c release/stage-2026-W46 origin/stage && git merge --no-ff origin/taha/cyb4-1234-…`.
2. Review and merge the PR with a merge commit. Linear: **UAT**.

### 4. Release to production

1. Tab **To Production** lists what is on `stage` but not on `main`. Tick what the
   product team approved (Linear **Ready To Deploy**) and click **Create release
   branch + PR**. PakGit cuts `release/main-2026-W46` from `main`, merges the selected
   feature branches into it and opens the PR **release/… → main**.
2. Run the final checks, merge the PR with a merge commit, tag (`v2026.46`).
3. **Sync environments** in PakGit creates `sync/main-into-stage-…` and
   `sync/main-into-dev-…` branches and opens their pull requests, so the three branches
   never drift apart. This back-merge is what prevents the next round of conflicts.
4. Linear: **Done**.

### 5. Hotfixes

Branch from `main`, PR into `main`, then **Sync environments** (PRs `main → stage`,
`main → dev`). Never hotfix on `dev` or `stage` directly.

### Promoting several items at once

**Promote selected…** merges the ticked items into one branch: a new one cut from the
target environment (default `release/<env>-<week>`) or an existing branch you pick.
PakGit merges the items one by one. If one conflicts it stops on that branch; resolve the
conflict in the Files panel, commit the merge, and use **Continue** in the banner to merge
the remaining items, then push and open the pull request. **Open pull request…** opens a
PR page from any branch into any environment.

### When PakGit cannot see a merge

If something is already on an environment but was merged in a way git cannot trace
(squash merge, cherry-pick, a re-done branch), right-click the item ▸ **Fix tracking…**
and tick the environments it is really on. The correction is remembered (marked with `*`)
until you reset it. Items you no longer care about can be **archived**; the Archived tab
lists them and lets you unarchive.

### Direct merges

Each environment's promotion strategy is configurable (Release ▸ Configure…):
**feature PRs**, **release branch + PR** (the defaults above) or **direct merge**, which
merges and pushes without a pull request for teams that want that.

### 6. Dropping work that will not ship

If something merged into `dev` is cancelled, revert its merge commit on `dev`
(`git revert -m 1 <merge sha>`). Because it was never merged to `stage` or `main`,
nothing else is needed. Optionally, after a release, **rebuild `dev`**: reset `dev`
to `main` and re-merge the still-open feature branches. This removes leftovers and is
safe because every branch still exists.

## Rules that keep conflicts rare

| Rule | Why |
|---|---|
| Branch from `main`, never from `dev` or `stage` | Keeps the branch independent so it can be promoted alone |
| One branch per issue, same branch into every environment | Same diff everywhere; `rerere` can reuse conflict resolutions |
| Merge commits for PRs, no squash / rebase-merge | Squash rewrites the commits, so the next environment sees "new" changes and conflicts |
| Rebase on `origin/main` only before the first merge; merge `main` in afterwards | Rebasing a shared branch creates duplicate commits |
| Back-merge `main → stage → dev` after every release and hotfix | Divergence is where conflicts come from (admin-portal-v2 had `main` 38 commits ahead of `dev`) |
| Keep branches small and short-lived; split big issues into sub-issues | Fewer overlapping edits |
| Enable `git config rerere.enabled true` in every repository | Resolve a conflict once, reuse it in the next environment |
| Do not reformat files or mass-rename in a feature branch | Formatting churn conflicts with everything |

## Configuring the pipeline

The environments are not fixed. In the Release view, **Configure…** opens the pipeline
editor for the current repository:

- an ordered list of environments, each with a display name, its branch, a promotion
  strategy (**feature PRs**: one pull request per feature branch; **release branch + PR**:
  the picked items are merged into a release branch cut from the environment and one
  pull request is opened; **direct merge**: no pull request) and an optional tracker state
  to set when work is promoted there;
- the remote, the release-branch prefix, which environment new feature branches are cut
  from (normally production), and whether to back-merge after releases.

PakGit detects a default from the branches that exist (`dev` → `stage` → `main`, or just
`main`, etc.). Examples that work with the same view: `develop → main`,
`dev → qa → uat → production`, or a single `main` with release branches. A work item is
"ready" for an environment when it is contained in the previous one and not yet in that
one; the tabs, columns, actions and the help text follow the configured pipeline.

## Linear status mapping used by PakGit

| Event | Linear state (default mapping) |
|---|---|
| Start work on issue | In Progress (Settings ▸ Issue tracker) |
| PR opened to `dev` | In Review (set manually when opening the PR) |
| Merged into `dev` | QA (per-environment, Configure…) |
| Merged into `stage` | UAT (per-environment, Configure…) |
| Approved for production | Ready To Deploy (set by the product team) |
| Release merged into `main` | Done (per-environment, Configure…) |

Status updates are optional (toggle in the Release view) and the state names are
configurable per environment. Other trackers (Jira, GitHub
Issues) plug into the same provider interface; Linear is the first implementation.
