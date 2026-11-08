# PakGit

A cross-platform Git client for **Windows, macOS and Linux**, modelled on SmartGit's
"Standard window" workflow. Built with Electron, Angular and TypeScript on top of the
`git` command line, so it supports every repository your `git` does (SSH keys,
credential helpers, LFS, hooks, submodules).

See [ANALYSIS.md](ANALYSIS.md) for the SmartGit feature analysis this design is based on.

## Features (v0.2)

- **Repositories** panel: open, clone, initialize; persisted list; open in terminal / file manager
- **Branches** panel: local branches, remotes, tags, stashes, submodules, worktrees; checkout (incl.
  tracking remote branches), add / rename / delete / push branch, track remote branch, merge, rebase,
  add / delete tag, apply / pop / drop stash, init / update submodules, add / remove worktrees
- **Files** panel: staged, unstaged, untracked and conflicted groups; stage / unstage (checkbox,
  double-click, context menu), discard, move to trash, ignore, file log, blame, multi-select, filter
- **Changes** panel: unified or side-by-side diff with line numbers, whitespace toggle, **stage / unstage
  individual hunks**, conflict view (Take Ours / Take Theirs / Edit / Mark Resolved), blame view, stash preview
- **Commit** panel: subject + body, recent messages, amend, commit all, no-verify, sign-off,
  Commit & Push, undo last commit, empty commit; merge / rebase continue, skip and abort banners
- **Log** panel: commit graph with lanes, refs as pills, filter, all-branches / current-branch toggle,
  load more, per-file history (follows renames); context menu with checkout, branch/tag from commit,
  cherry-pick, revert, merge, rebase, **interactive rebase** (reorder, reword, squash, fixup, drop),
  reset (soft / mixed / hard), create patch
- **Commit Details** panel: metadata, message, changed files with +/- counts, per-file diff
- **Output** panel: every git command with timing, exit code and stderr
- **Release** perspective: a configurable pipeline of environments (e.g. dev → stage → main);
  see what is ready for each one grouped by Linear issue; promote by pull request: one PR per
  feature branch, or a release branch cut from the environment with only the picked items and
  one PR (direct merge is an opt-in per environment); sync environments after a release via
  PRs; start work on a Linear issue from main. The process is documented in
  [docs/WORKFLOW.md](docs/WORKFLOW.md). Issue trackers are pluggable (`src/main/tracker/`);
  Linear is the first provider. Pull-request pages are built for GitHub, GitLab and Bitbucket.
- **Organizations** (phases 1–2 of [docs/ORGANIZATIONS.md](docs/ORGANIZATIONS.md)): repositories,
  groups, a shared pipeline template that repositories inherit and override, conventions and the
  issue-tracker connection live per organization; a Personal organization holds everything else.
  Organization overview with per-repository health (ready counts, drift, dev-based branches,
  unmerged release branches, issues partly promoted across repositories); new-organization
  wizard from the repositories' hosting owner; export/import of an organization file (remote
  URLs only, no secrets)
- **Releases across repositories** (phase 3): *Promote selected…* in the Ready tab runs the
  pre-flight checks (tracker state, partly promoted, dev-based, freeze, previous environment;
  each off / warn / block per environment), creates one branch name in every repository
  involved in deploy order, opens one pull request per repository on GitHub (through the gh
  CLI or a token; compare-page links elsewhere) and records a release. The Releases tab shows
  each repository's pull request (state, checks, review), whether it landed, a pause on a
  conflict with Resume, Finish (back-merge + Linear states) and release notes. Environments
  can be frozen; deployed-version probes (HTTP JSON, HTTP text, git tag) show what each
  environment runs
- **Sharing and ecosystem** (phase 4): a configuration repository keeps the organization file
  in git (check, review the diff, apply, push back); saved views as chips on Work and Ready;
  Slack notifications on release events; Revert release (revert branch + pull request per
  repository); Clean up merged branches; a release calendar with a countdown on the Overview;
  Jira Cloud as a second issue tracker
- **Planning across repositories**: a work-item index merges every repository's release
  analysis by issue key. *Work* tab: tracker issues × repositories with team, status, assignee,
  cycle and date filters, start work in several repositories at once, link a branch that follows
  no convention, set status, assign to me. *Ready* tab: the release table in organization scope
  with a Repository column, group chips and partly-promoted warnings; the per-repository Release
  view shows where else an issue lives. Quick open (Cmd/Ctrl+K) jumps to a repository, a branch
  in any repository, an issue or a release. Analyses are cached per repository and keyed on the
  branch tips; per-repository state follows the remote URL, so a re-clone keeps it
- Repository groups; branches and tags shown as folders by `/` prefix
- Repository menu: apply patch, clean working tree
- **Settings**: git executable, default pull strategy, background fetch interval, log size,
  discard confirmation, theme, issue tracker (Linear: sign in with the browser via OAuth + PKCE,
  or a personal API key; tokens stored encrypted with the OS keychain)
- Three perspectives (Standard, Log, Working Tree), light and dark theme, resizable panes with
  persisted sizes, automatic refresh on working-tree changes (chokidar)

## Angular variant (this branch)

This branch (`angular-ui`) is the same application with the renderer rewritten in **Angular 22**
(standalone components, signals, zoneless change detection). The `main` branch holds the React
renderer. Everything outside `src/renderer` (main process, git wrapper, preload API, shared types,
graph layout, diff parser, stylesheet) is identical in both branches, so the two can be compared
one component at a time:

| React (`main`) | Angular (`angular-ui`) |
|---|---|
| `src/renderer/src/lib/store.tsx` (context + hooks) | `src/renderer/app/store.service.ts` (signals) |
| `src/renderer/src/lib/actions.ts` (hook) | `src/renderer/app/actions.service.ts` (service) |
| `src/renderer/src/components/*.tsx` | `src/renderer/app/panels/*.ts`, `app/ui/*.ts` |
| electron-vite builds the renderer | Angular CLI builds it (`angular.json`), electron-vite builds main + preload |

## Connecting Linear

PakGit talks to Linear directly. The connection belongs to an organization (Organization ▸
Configure… ▸ Integrations); the Personal organization has one too. Two options:

1. **Sign in with Linear** (recommended). Someone in the workspace creates an OAuth application
   once in Linear ▸ Settings ▸ API ▸ OAuth applications with the callback URL
   `http://localhost:48422/callback`. Everyone then pastes its *client ID* into PakGit and clicks
   **Sign in with Linear**; the browser opens, you approve, and PakGit stores the token
   encrypted and refreshes it automatically. The client ID is not secret; PKCE is used, so no
   client secret is needed.
2. **Personal API key** from Linear ▸ Settings ▸ Security & access.

## Install

Installers for every platform are published on the
[GitHub Releases](https://github.com/tahashahid/pakgit/releases) page:

| Platform | File |
|---|---|
| macOS (Apple Silicon, Intel) | `PakGit-<version>-mac-<arch>.dmg` (or `.zip`) |
| Windows | `PakGit-<version>-win-x64.exe` (installer) or the portable `.exe` |
| Linux | `PakGit-<version>-linux-x64.AppImage`, `.deb` or `.rpm` |

The app checks GitHub Releases for a newer version shortly after start and from Help ▸ Check for
Updates… (also in Settings). Windows and Linux builds update in place. macOS builds update in
place only when they are signed and notarised; unsigned builds open the releases page instead.
Until the builds are signed, macOS shows the usual "unidentified developer" warning on first
launch (right-click ▸ Open), and Windows SmartScreen asks to confirm.

## Releasing a version

1. Bump the version in `package.json` (for example `0.2.0`) and commit.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The **Release** workflow (`.github/workflows/release.yml`) builds macOS, Windows and Linux
   installers, runs the backend tests, and uploads everything to a **draft** GitHub Release.
4. Review the draft on GitHub and publish it. Published releases are what the in-app updater
   sees.

Signing is optional and configured through repository secrets: `CSC_LINK` (base64 `.p12`),
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for macOS
(set `notarize: true` in `electron-builder.yml` once they exist); `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD` for Windows. Without them the workflow still produces working, unsigned
installers. The **CI** workflow runs the typecheck and the backend tests on every push and pull
request. Both workflows use Node 24 (npm 11), the version that writes `package-lock.json` here;
an older npm reads the lock file differently and refuses `npm ci`.

## Development

```bash
npm install
npm run dev        # ng serve on :4200 + Electron with live reload
npm run typecheck
npm run test:backend   # exercises the git wrapper against a temporary repository
npm run build      # ng build + electron-vite build
```

Set `PAKGIT_GIT=/path/to/git` to use a specific git executable.

## Packaging

```bash
npm run dist:mac     # .dmg, .zip
npm run dist:win     # NSIS installer, portable .exe   (run on Windows or with wine)
npm run dist:linux   # AppImage, .deb, .rpm
```

Artifacts land in `dist/`. Users need `git` on their PATH (on Windows, Git for Windows is also
detected in its default install locations).

## Layout

```
src/main/      Electron main process: window, menu, IPC, repo registry, file watcher
src/main/git.ts   git CLI wrapper (status, refs, log, diff, commit, remote, branch, stash…)
src/preload/   contextBridge API exposed to the renderer as window.pakgit
src/renderer/  Angular UI (store + actions services, panels, ui primitives, graph layout, diff parser)
src/shared/    types shared between processes
```

## Roadmap

- Organizations, later: Linear Releases sync, GitLab / Bitbucket pull-request state, GitHub
  Issues as a tracker, a headless mode for CI (docs/ORGANIZATIONS.md)
- Hosting providers (GitHub / GitLab / Bitbucket / Azure DevOps): pull requests, reviews
- Three-way merge editor (today: take ours / theirs, or edit externally and mark resolved)
- Split commit in interactive rebase; rebase across merge commits
- Git-Flow commands, bisect, LFS
- Bundled git for platforms without one
