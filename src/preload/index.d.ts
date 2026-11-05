import type { PakGitApi } from '@shared/types'
declare global {
  interface Window {
    pakgit: PakGitApi
    pakgitMenu: { on(cb: (action: string) => void): () => void; platform: string }
  }
}
export {}
