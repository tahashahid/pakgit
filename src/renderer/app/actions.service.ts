import { Injectable, inject } from '@angular/core'
import { Store } from './store.service'
import type { BranchInfo, Commit, FileEntry, StashInfo, TagInfo } from '@shared/types'

/** All user-facing git operations with their dialogs (mirrors SmartGit's command catalogue). */
@Injectable({ providedIn: 'root' })
export class Actions {
  private readonly s = inject(Store)
  private get repoPath(): string | undefined { return this.s.repo()?.path }

  /** Built lazily so the closures see the live store. */
  readonly a = this.build()

  private build() {
    const s = this.s
    const api = s.api
    const prompt = s.prompt.bind(s)
    const run = s.run.bind(s)
    const toast = s.toast.bind(s)
    const repo = () => this.repoPath
    const need = (): string => { const r = repo(); if (!r) throw new Error('No repository selected'); return r }
    const local = () => (s.refs()?.branches ?? []).filter((b) => !b.remote).map((b) => b.name)
    const allRefs = () => [...(s.refs()?.branches ?? []).map((b) => b.fullName), ...(s.refs()?.tags ?? []).map((t) => t.name)]
    return {
      // --- repositories & groups ---
      openRepo: (group?: string | null) => s.addRepo(undefined, group),
      createGroup: async (): Promise<string | null> => {
        const v = await prompt({ title: 'New Group', okLabel: 'Create', fields: [{ key: 'name', label: 'Group name', placeholder: 'e.g. Work' }] })
        if (!v || !String(v.name).trim()) return null
        const name = String(v.name).trim()
        try { await api.createGroup(name); await s.reloadRepos(); return name } catch (e) { toast('error', String(e)); return null }
      },
      renameGroup: async (name: string) => {
        const v = await prompt({ title: 'Rename Group', okLabel: 'Rename', fields: [{ key: 'name', label: 'New name', value: name }] })
        if (!v || !String(v.name).trim() || v.name === name) return
        try { await api.renameGroup(name, String(v.name).trim()); await s.reloadRepos() } catch (e) { toast('error', String(e)) }
      },
      deleteGroup: async (name: string) => {
        if (!(await prompt({ title: 'Delete Group', danger: true, okLabel: 'Delete', message: `Delete group "${name}"? Its repositories stay in the list, ungrouped.` }))) return
        try { await api.deleteGroup(name); await s.reloadRepos() } catch (e) { toast('error', String(e)) }
      },
      moveRepoToGroup: async (path: string, group: string | null) => {
        try { await api.setRepoGroup(path, group); await s.reloadRepos() } catch (e) { toast('error', String(e)) }
      },
      clone: async () => {
        const v = await prompt({ title: 'Clone Repository', okLabel: 'Clone', fields: [
          { key: 'url', label: 'Repository URL', placeholder: 'https://github.com/user/repo.git' },
          { key: 'dest', label: 'Target directory (leave empty to choose)', placeholder: '' }
        ] })
        if (!v || !v.url) return
        let dest = String(v.dest || '')
        if (!dest) {
          const parent = await api.pickDirectory('Choose parent directory')
          if (!parent) return
          const name = String(v.url).replace(/\/+$/, '').split('/').pop()!.replace(/\.git$/, '')
          dest = `${parent}/${name}`
        }
        const entry = await run('Clone', () => api.cloneRepo(String(v.url), dest), { success: 'Clone finished' })
        if (entry) { await s.addRepo(entry.path) }
      },
      init: async () => {
        const dir = await api.pickDirectory('Choose directory to initialize')
        if (!dir) return
        const entry = await run('Initialize', () => api.initRepo(dir))
        if (entry) await s.addRepo(entry.path)
      },
      terminal: () => this.repoPath && api.openTerminal(this.repoPath),
      // --- remote ---
      fetch: (remote?: string) => run('Fetch', () => api.fetch(need(), remote, true), { success: 'Fetched' }),
      pull: async () => {
        const v = await prompt({ title: 'Pull', okLabel: 'Pull', message: `Pull ${s.status()?.upstream ?? 'upstream'} into ${s.status()?.branch ?? 'HEAD'}`, fields: [
          { key: 'mode', label: 'Strategy', type: 'select', options: [s.settings()?.pullMode ?? 'merge', ...(['merge', 'rebase', 'ff-only'] as const).filter((m) => m !== (s.settings()?.pullMode ?? 'merge'))] }
        ] })
        if (!v) return
        await run('Pull', () => api.pull(need(), v.mode as 'merge'), { success: 'Pull finished' })
      },
      push: async () => {
        const remotes = (s.refs()?.remotes ?? []).map((r) => r.name)
        if (!remotes.length) { toast('error', 'No remote configured. Add one via Branches ▸ Remotes.'); return }
        const v = await prompt({ title: 'Push', okLabel: 'Push', fields: [
          { key: 'remote', label: 'Remote', type: 'select', options: remotes },
          { key: 'branch', label: 'Branch', value: s.status()?.branch ?? '' },
          { key: 'setUpstream', label: 'Set as upstream (--set-upstream)', type: 'checkbox', value: String(!s.status()?.upstream) },
          { key: 'force', label: 'Force push (--force-with-lease)', type: 'checkbox' },
          { key: 'tags', label: 'Push tags', type: 'checkbox' }
        ] })
        if (!v) return
        await run('Push', () => api.push(need(), { remote: String(v.remote), branch: String(v.branch), setUpstream: !!v.setUpstream, force: !!v.force, tags: !!v.tags }), { success: 'Pushed' })
      },
      addRemote: async () => {
        const v = await prompt({ title: 'Add Remote Repository', okLabel: 'Add', fields: [{ key: 'name', label: 'Name', value: 'origin' }, { key: 'url', label: 'URL' }] })
        if (!v || !v.name || !v.url) return
        await run('Add remote', () => api.addRemote(need(), String(v.name), String(v.url)))
      },
      removeRemote: async (name: string) => {
        if (!(await prompt({ title: 'Delete Remote Repository', danger: true, okLabel: 'Delete', message: `Remove remote "${name}"?` }))) return
        await run('Remove remote', () => api.removeRemote(need(), name))
      },
      // --- working tree ---
      stage: (files: FileEntry[]) => run('Stage', () => api.stage(need(), files.map((f) => f.path))),
      unstage: (files: FileEntry[]) => run('Unstage', () => api.unstage(need(), files.map((f) => f.path))),
      stageAll: () => run('Stage all', () => api.stage(need(), ['.'])),
      unstageAll: () => run('Unstage all', () => api.unstage(need(), ['.'])),
      discard: async (files: FileEntry[]) => {
        if (s.settings()?.confirmDiscard !== false) {
          const v = await prompt({ title: 'Discard Changes', danger: true, okLabel: 'Discard', message: `Discard local changes of ${files.length === 1 ? files[0].path : files.length + ' files'}?\nUntracked files will be deleted. This cannot be undone.` })
          if (!v) return
        }
        await run('Discard', () => api.discard(need(), files.map((f) => ({ path: f.path, area: f.area }))))
      },
      trash: async (files: FileEntry[]) => {
        const v = await prompt({ title: 'Move to Trash', okLabel: 'Move to Trash', message: `Move ${files.length === 1 ? files[0].path : files.length + ' untracked files'} to the system trash?` })
        if (!v) return
        await run('Move to trash', () => api.trash(need(), files.map((f) => f.path)))
      },
      clean: async () => {
        const v = await prompt({ title: 'Clean Working Tree', danger: true, okLabel: 'Delete', message: 'Delete all untracked files and directories? This cannot be undone.', fields: [{ key: 'x', label: 'Also delete ignored files (-x)', type: 'checkbox' }] })
        if (!v) return
        await run('Clean', () => api.clean(need(), !!v.x), { success: 'Working tree cleaned' })
      },
      resolve: (file: FileEntry, side: 'ours' | 'theirs') => run(`Take ${side}`, () => api.resolveConflict(need(), file.path, side)),
      markResolved: (files: FileEntry[]) => run('Mark resolved', () => api.markResolved(need(), files.map((f) => f.path))),
      fileLog: (file: { path: string }) => { s.setLogPath(file.path); if (s.perspective() === 'worktree') s.perspective.set('standard') },
      blame: (file: { path: string }, rev?: string) => s.showBlame(file.path, rev),
      createPatch: async (c: Commit) => {
        const safe = c.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
        const dest = await api.saveFileDialog('Create Patch', `0001-${safe || c.shortSha}.patch`)
        if (!dest) return
        await run('Create patch', () => api.formatPatch(need(), c.sha, dest), { success: `Patch written to ${dest}` })
      },
      applyPatch: async () => {
        const file = await api.openFileDialog('Apply Patch')
        if (!file) return
        await run('Apply patch', () => api.applyPatchFile(need(), file), { success: 'Patch applied' })
      },
      emptyCommit: async () => {
        const v = await prompt({ title: 'Create Empty Commit', okLabel: 'Commit', fields: [{ key: 'message', label: 'Message', type: 'textarea' }] })
        if (!v || !v.message) return
        await run('Empty commit', () => api.emptyCommit(need(), String(v.message)))
      },
      rebaseInteractive: async (from: Commit) => {
        const r = need()
        const list = await api.log(r, { all: false, limit: 1000 })
        const idx = list.findIndex((c) => c.sha === from.sha)
        if (idx === -1) { toast('error', 'Commit is not on the current branch'); return }
        const chain = list.slice(0, idx + 1).reverse()
        if (chain.some((c) => c.parents.length > 1)) { toast('error', 'Interactive rebase over merge commits is not supported here'); return }
        const base = from.parents[0] ?? '--root'
        s.rebase.set({ base, todo: chain.map((c) => ({ action: 'pick', sha: c.sha, subject: c.subject })) })
      },
      pushBranch: async (b: BranchInfo) => {
        const remotes = (s.refs()?.remotes ?? []).map((r) => r.name)
        if (!remotes.length) { toast('error', 'No remote configured.'); return }
        const v = await prompt({ title: `Push ${b.name}`, okLabel: 'Push', fields: [
          { key: 'remote', label: 'Remote', type: 'select', options: remotes },
          { key: 'setUpstream', label: 'Set as upstream', type: 'checkbox', value: String(!b.upstream) },
          { key: 'force', label: 'Force push (--force-with-lease)', type: 'checkbox' }
        ] })
        if (!v) return
        await run('Push', () => api.push(need(), { remote: String(v.remote), branch: b.name, setUpstream: !!v.setUpstream, force: !!v.force }), { success: `Pushed ${b.name}` })
      },
      setUpstream: async (b: BranchInfo) => {
        const options = (s.refs()?.branches ?? []).filter((x) => x.remote).map((x) => x.fullName)
        if (!options.length) { toast('error', 'No remote branches. Fetch first.'); return }
        const guess = options.find((o) => o.endsWith('/' + b.name))
        const v = await prompt({ title: `Track Remote Branch for ${b.name}`, okLabel: 'Set', fields: [{ key: 'u', label: 'Upstream', type: 'select', options: guess ? [guess, ...options.filter((o) => o !== guess)] : options }] })
        if (!v) return
        await run('Set upstream', () => api.setUpstream(need(), b.name, String(v.u)))
      },
      submoduleUpdate: (paths?: string[]) => run('Update submodules', () => api.submoduleUpdate(need(), paths), { success: 'Submodules updated' }),
      worktreeAdd: async () => {
        const dir = await api.pickDirectory('Choose directory for the new worktree')
        if (!dir) return
        const v = await prompt({ title: 'Add Worktree', okLabel: 'Add', message: dir, fields: [
          { key: 'branch', label: 'Branch' },
          { key: 'create', label: 'Create new branch', type: 'checkbox', value: 'true' }
        ] })
        if (!v || !v.branch) return
        await run('Add worktree', () => api.worktreeAdd(need(), dir, String(v.branch), !!v.create))
      },
      worktreeRemove: async (path: string) => {
        const v = await prompt({ title: 'Remove Worktree', danger: true, okLabel: 'Remove', message: path, fields: [{ key: 'force', label: 'Force (discard local changes there)', type: 'checkbox' }] })
        if (!v) return
        await run('Remove worktree', () => api.worktreeRemove(need(), path, !!v.force))
      },
      openPath: (path: string) => void s.addRepo(path),
      ignore: async (file: FileEntry) => {
        const v = await prompt({ title: 'Ignore', okLabel: 'Ignore', fields: [{ key: 'pattern', label: 'Pattern to add to .gitignore', value: file.path }] })
        if (!v || !v.pattern) return
        await run('Ignore', () => api.ignore(need(), String(v.pattern)))
      },
      openFile: (file: FileEntry) => this.repoPath && api.openInEditor(this.repoPath, file.path),
      reveal: (file?: FileEntry) => this.repoPath && api.revealInFinder(this.repoPath, file?.path),
      focusCommit: () => document.querySelector<HTMLInputElement>('.commit-form .subject')?.focus(),
      undoLastCommit: async () => {
        if (!(await prompt({ title: 'Undo Last Commit', okLabel: 'Undo', message: 'Move HEAD to the previous commit and keep the changes staged?' }))) return
        await run('Undo last commit', () => api.undoLastCommit(need()))
      },
      // --- stash ---
      stash: async () => {
        const v = await prompt({ title: 'Save Stash', okLabel: 'Stash', fields: [
          { key: 'message', label: 'Message', placeholder: 'optional' },
          { key: 'untracked', label: 'Include untracked files', type: 'checkbox', value: 'true' }
        ] })
        if (!v) return
        await run('Stash', () => api.stashSave(need(), String(v.message || ''), !!v.untracked), { success: 'Stash saved' })
      },
      stashApply: (st: StashInfo, pop: boolean) => run(pop ? 'Pop stash' : 'Apply stash', () => api.stashApply(need(), st.index, pop)),
      stashDrop: async (st: StashInfo) => {
        if (!(await prompt({ title: 'Drop Stash', danger: true, okLabel: 'Drop', message: `Drop "${st.message}"?` }))) return
        await run('Drop stash', () => api.stashDrop(need(), st.index))
      },
      // --- branches ---
      addBranch: async (startPoint?: string) => {
        const v = await prompt({ title: 'Add Branch', okLabel: 'Add', fields: [
          { key: 'name', label: 'Name' },
          { key: 'start', label: 'Start point', value: startPoint ?? s.status()?.branch ?? 'HEAD' },
          { key: 'checkout', label: 'Check out new branch', type: 'checkbox', value: 'true' }
        ] })
        if (!v || !v.name) return
        await run('Add branch', () => api.createBranch(need(), String(v.name), String(v.start), !!v.checkout))
      },
      checkout: async (b: BranchInfo) => {
        if (b.remote) {
          const localName = b.name
          const exists = local().includes(localName)
          if (exists) await run('Checkout', () => api.checkout(need(), localName))
          else await run('Checkout', () => api.checkout(need(), b.fullName, { createBranch: localName, track: true }))
        } else await run('Checkout', () => api.checkout(need(), b.name))
      },
      checkoutCommit: async (c: Commit) => {
        if (!(await prompt({ title: 'Check Out Commit', okLabel: 'Checkout', message: `Check out ${c.shortSha} (detached HEAD)?` }))) return
        await run('Checkout', () => api.checkout(need(), c.sha))
      },
      checkoutTag: (t: TagInfo) => run('Checkout tag', () => api.checkout(need(), t.name)),
      deleteBranch: async (b: BranchInfo) => {
        const v = await prompt({ title: 'Delete Branch', danger: true, okLabel: 'Delete', message: `Delete ${b.remote ? 'remote ' : ''}branch "${b.fullName}"?`, fields: b.remote ? [] : [{ key: 'force', label: 'Force delete (even if unmerged)', type: 'checkbox' }] })
        if (!v) return
        await run('Delete branch', () => api.deleteBranch(need(), b.name, !!v.force, b.remote ?? undefined))
      },
      renameBranch: async (b: BranchInfo) => {
        const v = await prompt({ title: 'Rename Branch', okLabel: 'Rename', fields: [{ key: 'name', label: 'New name', value: b.name }] })
        if (!v || !v.name || v.name === b.name) return
        await run('Rename branch', () => api.renameBranch(need(), b.name, String(v.name)))
      },
      merge: async (ref?: string) => {
        const v = await prompt({ title: 'Merge', okLabel: 'Merge', fields: [
          { key: 'ref', label: 'Merge into current branch', type: 'select', options: ref ? [ref, ...allRefs().filter((r) => r !== ref)] : allRefs() },
          { key: 'noFf', label: 'Create merge commit even if fast-forward is possible', type: 'checkbox' },
          { key: 'squash', label: 'Squash', type: 'checkbox' }
        ] })
        if (!v || !v.ref) return
        await run('Merge', () => api.merge(need(), String(v.ref), { noFf: !!v.noFf, squash: !!v.squash }), { success: 'Merge finished' })
      },
      rebase: async (ref?: string) => {
        const v = await prompt({ title: 'Rebase', okLabel: 'Rebase', fields: [
          { key: 'ref', label: 'Rebase current branch onto', type: 'select', options: ref ? [ref, ...allRefs().filter((r) => r !== ref)] : allRefs() }
        ] })
        if (!v || !v.ref) return
        await run('Rebase', () => api.rebase(need(), String(v.ref)), { success: 'Rebase finished' })
      },
      rebaseAction: (action: 'continue' | 'abort' | 'skip') => run(`Rebase ${action}`, () => api.rebaseAction(need(), action)),
      mergeAction: (action: 'continue' | 'abort') => run(`Merge ${action}`, () => api.mergeAction(need(), action)),
      cherryPick: (c: Commit) => run('Cherry pick', () => api.cherryPick(need(), c.sha)),
      revert: (c: Commit) => run('Revert', () => api.revert(need(), c.sha)),
      reset: async (c: Commit) => {
        const v = await prompt({ title: 'Reset', danger: true, okLabel: 'Reset', message: `Reset ${s.status()?.branch ?? 'HEAD'} to ${c.shortSha} "${c.subject}"`, fields: [
          { key: 'mode', label: 'Mode', type: 'select', options: ['mixed', 'soft', 'hard'] }
        ] })
        if (!v) return
        await run('Reset', () => api.reset(need(), c.sha, v.mode as 'mixed'))
      },
      addTag: async (c?: Commit) => {
        const v = await prompt({ title: 'Add Tag', okLabel: 'Add', fields: [
          { key: 'name', label: 'Tag name' },
          { key: 'message', label: 'Message (empty = lightweight tag)', type: 'textarea' }
        ] })
        if (!v || !v.name) return
        await run('Add tag', () => api.createTag(need(), String(v.name), c?.sha, String(v.message || '') || undefined))
      },
      deleteTag: async (t: TagInfo) => {
        if (!(await prompt({ title: 'Delete Tag', danger: true, okLabel: 'Delete', message: `Delete tag "${t.name}"?` }))) return
        await run('Delete tag', () => api.deleteTag(need(), t.name))
      },
      copy: (text: string) => { void navigator.clipboard.writeText(text); toast('info', 'Copied to clipboard') }
    }
  }
}
