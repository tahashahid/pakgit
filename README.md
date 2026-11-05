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
- **Release** perspective: see what is on dev but not on stage, and on stage but not on
  production, grouped by Linear issue; tick items and merge them into stage, create a release
  branch from main with only the approved items, finish a release (merge, tag, back-merge
  main → stage → dev), sync environments, start work on a Linear issue from main. The process
  is documented in [docs/WORKFLOW.md](docs/WORKFLOW.md). Issue trackers are pluggable
  (`src/main/tracker/`); Linear is the first provider.
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

PakGit talks to Linear directly. Two options in Settings ▸ Issue tracker:

1. **Sign in with Linear** (recommended). Someone in the workspace creates an OAuth application
   once in Linear ▸ Settings ▸ API ▸ OAuth applications with the callback URL
   `http://localhost:48422/callback`. Everyone then pastes its *client ID* into PakGit and clicks
   **Sign in with Linear**; the browser opens, you approve, and PakGit stores the token
   encrypted and refreshes it automatically. The client ID is not secret; PKCE is used, so no
   client secret is needed.
2. **Personal API key** from Linear ▸ Settings ▸ Security & access.

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

- Hosting providers (GitHub / GitLab / Bitbucket / Azure DevOps): pull requests, reviews
- Three-way merge editor (today: take ours / theirs, or edit externally and mark resolved)
- Split commit in interactive rebase; rebase across merge commits
- Git-Flow commands, bisect, LFS
- Bundled git for platforms without one
