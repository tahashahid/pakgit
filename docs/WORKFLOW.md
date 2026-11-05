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

Only what QA approved goes to `stage`:

1. In PakGit's Release view, tab **To stage** lists everything that is on `dev` but
   not on `stage`. Tick the items, click **Merge into stage**. PakGit merges each
   feature branch (not `dev`) into `stage` with a merge commit and pushes.
   By hand: `git switch stage && git pull --ff-only && git merge --no-ff origin/taha/cyb4-1234-…`.
2. Linear: **UAT**.

### 4. Release to production

1. Tab **To production** lists what is on `stage` but not on `main`. Tick what the
   product team approved (Linear **Ready To Deploy**) and click **Create release
   branch**. PakGit creates `release/2026-W46` from `main` and merges the selected
   feature branches into it.
2. Open a PR **release/… → main**, run the final checks, merge with a merge commit,
   tag (`v2026.46`).
3. **Finish release** in PakGit (or by hand) merges `main` back into `stage` and then
   `dev`, so the three branches never drift apart. This back-merge is what prevents
   the next round of conflicts.
4. Linear: **Done**.

### 5. Hotfixes

Branch from `main`, PR into `main`, then back-merge `main → stage → dev` (Release view
▸ **Sync environments**). Never hotfix on `dev` or `stage` directly.

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

## Linear status mapping used by PakGit

| Event | Linear state |
|---|---|
| Start work on issue | In Progress |
| PR opened to `dev` | In Review (set manually when opening the PR) |
| Merged into `dev` | QA |
| Merged into `stage` | UAT |
| Approved for production | Ready To Deploy (set by the product team) |
| Release merged into `main` | Done |

Status updates are optional (toggle in the Release view). Other trackers (Jira, GitHub
Issues) plug into the same provider interface; Linear is the first implementation.
