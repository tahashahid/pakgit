# PakGit

A cross-platform Git client for **Windows, macOS and Linux**, modelled on SmartGit's
"Standard window" workflow. Built with Electron, React and TypeScript on top of the
`git` command line, so it supports every repository your `git` does (SSH keys,
credential helpers, LFS, hooks, submodules).

See [ANALYSIS.md](ANALYSIS.md) for the SmartGit feature analysis this design is based on.

## Features (v0.1)

- **Repositories** panel: open, clone, initialize; persisted list; open in terminal / file manager
- **Branches** panel: local branches, remotes, tags, stashes; checkout (incl. tracking remote
  branches), add / rename / delete branch, merge, rebase, add / delete tag, apply / pop / drop stash
- **Files** panel: staged, unstaged, untracked and conflicted groups; stage / unstage (checkbox,
  double-click, context menu), discard, ignore, multi-select, filter
- **Changes** panel: unified diff with line numbers, add/delete colouring, whitespace toggle
- **Commit** panel: subject + body, amend, commit all, no-verify, sign-off, Commit & Push,
  undo last commit; merge / rebase continue, skip and abort banners
- **Log** panel: commit graph with lanes, refs as pills, filter; context menu with checkout,
  branch/tag from commit, cherry-pick, revert, merge, rebase, reset (soft / mixed / hard)
- **Commit Details** panel: metadata, message, changed files with +/- counts, per-file diff
- **Output** panel: every git command with timing, exit code and stderr
- Three perspectives (Standard, Log, Working Tree), light and dark theme, resizable panes with
  persisted sizes, automatic refresh on working-tree changes (chokidar)

## Development

```bash
npm install
npm run dev        # start with hot reload
npm run typecheck
npm run test:backend   # exercises the git wrapper against a temporary repository
npm run build
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
src/renderer/  React UI (store, actions, panels, graph layout, diff parser)
src/shared/    types shared between processes
```

## Roadmap

- Hosting providers (GitHub / GitLab / Bitbucket / Azure DevOps): pull requests, reviews
- Three-way conflict solver and built-in file compare
- Interactive rebase editor (reorder, squash, reword, split)
- Git-Flow commands, worktrees, submodule management, bisect
- Blame perspective, file log
- Bundled git for platforms without one
