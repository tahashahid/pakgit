/** Folder tree built from slash-separated names (branches, tags), SmartGit-style. */
export interface TreeNode<T> {
  name: string
  /** full folder path, e.g. "feature/auth" */
  path: string
  children: TreeNode<T>[]
  items: { label: string; item: T }[]
  /** number of leaves in this subtree */
  count: number
}

export function buildTree<T>(items: T[], nameOf: (item: T) => string): TreeNode<T> {
  const root: TreeNode<T> = { name: '', path: '', children: [], items: [], count: 0 }
  for (const item of items) {
    const parts = nameOf(item).split('/')
    const label = parts.pop() ?? ''
    let node = root
    for (const part of parts) {
      let next = node.children.find((c) => c.name === part)
      if (!next) { next = { name: part, path: node.path ? `${node.path}/${part}` : part, children: [], items: [], count: 0 }; node.children.push(next) }
      node = next
    }
    node.items.push({ label, item })
  }
  const finish = (n: TreeNode<T>): number => {
    n.children.sort((a, b) => a.name.localeCompare(b.name))
    n.items.sort((a, b) => a.label.localeCompare(b.label))
    n.count = n.items.length + n.children.reduce((sum, c) => sum + finish(c), 0)
    return n.count
  }
  finish(root)
  return root
}

/** Folder paths that contain the given full name (used to keep the current branch visible). */
export function ancestorsOf(name: string): string[] {
  const parts = name.split('/'); parts.pop()
  const out: string[] = []
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}
