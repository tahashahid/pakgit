# SmartGit analysis (basis for PakGit)

Target: `/Applications/SmartGit.app`, SmartGit 26.1.052 (com.syntevo.smartgit).
Method: static inventory with REA (`open_binary` + `inspect_artifact`, 1719 entries,
no integrity contradictions) plus jar/resource inspection. No bytecode was decompiled:
`smartgit.jar` is name-obfuscated (`smartgit/zz.class` ...), and SmartGit's licence
forbids it anyway. PakGit is an original implementation of the same *feature set*.

## Architecture (as shipped)

| Layer | SmartGit | PakGit equivalent |
|---|---|---|
| Launcher | native `SmartGit` Mach-O that boots `bootloader.jar` on a bundled JRE | Electron main process |
| UI toolkit | Eclipse SWT (`org.eclipse.swt.cocoa.macosx.aarch64.jar`), themes via `*-theme.properties` | React + CSS variables (light/dark themes) |
| Git backend | bundled `git` 2.53.0 CLI, invoked as a subprocess | system or bundled `git` CLI via `child_process` |
| SSH | sshj + `smartssh.sh` / `askpass.sh` helpers | OS git credential helpers / ssh-agent |
| File watching | `fsNotifier` native helper | chokidar on `.git` and working tree |
| Hosting | GraphQL client (`graphql-queries.jar`) for GitHub/GitLab/Bitbucket/Azure | out of scope for v1 |
| Markdown / templates | flexmark, pebble | not needed |

## Perspectives (windows)

Icons `switch-window-std`, `switch-window-log`, `switch-window-wt`, `perspective-compare`,
`perspective-blame-origin`, `perspective-review`:

1. **Standard window** – Repositories, Branches, Files, Changes, Commit, Journal, Output.
2. **Log window** – Graph, Commits, Files, Changes.
3. **Working Tree window** – files-first layout.
4. Compare / Blame / Review / Conflict Solver windows.

## Command catalogue (from UI string constants and icon names)

Repository: Add/Open Repository, Clone, Search Repos, Submodules (init/update/open),
Worktrees (Add/Remove Worktree), Repository Root, Open Terminal, Refresh, Background fetch.

Working tree / index: Stage, Unstage, Discard Changes, Discard to Stash, Ignore (file / Global
Ignore / Remove & Ignore), Index Editor, view filters (staged, unchanged, ignored, untracked,
skipped, assumed-unchanged, rename sources, recursive, from submodules).

Commit: Commit Staged Changes, Commit All Changes, Commit & Push, Commit Subset, Amend last
commit, Edit commit message, Edit commit author, Create Empty Commit, Undo Last Commit,
Bypass commit hook, Sign-off.

Branches: Add Branch, Check Out Branch, Check out remote branch, Checkout Tag, Track remote
branch, Rename Branch, Delete local/remote branch, Delete from all remotes, Create version tag,
Delete Tag, Git-Flow (Feature/Bugfix/Hotfix/Release start/finish/integrate).

Remotes: Fetch / Fetch All / Fetch More / Fetch From, Pull (merge or rebase, Configure Pull),
Push / Force Push / Push To / Push Up To, Add/Rename/Delete Remote Repository, Remote Properties,
Push Gerrit.

History rewriting: Merge (incl. Convert to Merge Commit, Octopus, Merge Subtree, Abort Merge),
Rebase, Rebase Interactive (Reorder, Squash, Move and Squash, Split Commit, Skip Commit,
Continue Rebase), Cherry Pick, Revert (& Commit), Reset (soft/mixed/hard, Reset Advanced),
Bisect.

Stashes: Save Stash, Stash All, Apply Stash, Drop Stash(es), Rename Stash, Automatically
save stash.

Conflicts: Conflict Solver (three-way merge, layouts: all / left-merge / left-right-above-merge
/ merge-right), Take Left/Right, Next/Previous Conflict, Leave Conflicted, External Conflict
Solver, Resolve Conflict.

Investigation: Log, File Log, Blame, Compare (with Each Other / with Repository / File Compare),
Investigate, Go to First/Last/Next/Previous Commit, Ignore Whitespace, Neighboring Commits.

Hosting: GitHub, GitLab, Bitbucket, Azure DevOps (Pull Requests, Merge Requests, Review,
Issue Fetcher). AI helpers: explaining, rewording, stashing.

## v1 scope for PakGit

Standard window with the panels above, backed by the git CLI, for Windows, macOS and Linux.
Hosting-provider integration, Git-Flow, the three-way conflict solver UI and AI helpers are
deferred to later milestones (see README).
