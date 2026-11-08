import { Component, computed, input } from '@angular/core'

const PATHS: Record<string, string> = {
  pull: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
  push: 'M12 21V9m0 0l-4 4m4-4l4 4M4 5h16',
  fetch: 'M4 12h16m0 0l-5-5m5 5l-5 5',
  commit: 'M12 8a4 4 0 100 8 4 4 0 000-8zM2 12h6m8 0h6',
  branch: 'M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm12-9a3 3 0 100-6 3 3 0 000 6zm0 0c0 4-4 5-8 6',
  stash: 'M4 7h16v4H4zM6 11v9h12v-9M10 15h4',
  merge: 'M6 3v18M6 9c0 4 6 4 12 6m0 0a3 3 0 100 6 3 3 0 000-6z',
  rebase: 'M6 3v18M18 3v8m0 0a3 3 0 100 6 3 3 0 000-6zM6 15c0-4 6-4 12-4',
  refresh: 'M20 12a8 8 0 01-14.5 4.6M4 12a8 8 0 0114.5-4.6M4 4v5h5M20 20v-5h-5',
  terminal: 'M4 4h16v16H4zM7 9l3 3-3 3M12 15h5',
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  x: 'M6 6l12 12M18 6L6 18',
  tag: 'M3 12l9-9h9v9l-9 9zM16 8h.01',
  folder: 'M3 6h6l2 2h10v10H3z',
  stage: 'M12 19V5m0 0l-5 5m5-5l5 5',
  unstage: 'M12 5v14m0 0l-5-5m5 5l5-5',
  discard: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13',
  sun: 'M12 4v2m0 12v2m8-8h-2M6 12H4m12.5-5.5l-1.5 1.5M8 16l-1.5 1.5m0-11L8 8m8 8l1.5 1.5M12 8a4 4 0 100 8 4 4 0 000-8z',
  moon: 'M20 14A8 8 0 0110 4a8 8 0 1010 10z',
  file: 'M6 2h8l4 4v16H6zM14 2v4h4',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zm7.4 3a7.4 7.4 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 00-2-1.2L14.6 2H9.4L9 4.6a7.5 7.5 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 000 2.4l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 002 1.2l.4 2.6h5.2l.4-2.6a7.5 7.5 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  submodule: 'M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h2v5.5',
  worktree: 'M3 20h18M6 20V9l6-5 6 5v11M10 20v-6h4v6',
  clone: 'M4 4h12v12H4zM8 8h12v12H8z',
  'folder-plus': 'M3 6h6l2 2h10v10H3zM12 10v6M9 13h6',
  'folder-open': 'M3 7h6l2 2h10l-2 9H3zM3 7v11',
  search: 'M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM20 20l-4.6-4.6',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.5 1.5M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.5-1.5',
  play: 'M7 4l12 8-12 8z',
  warning: 'M12 3l10 18H2zM12 10v5M12 18h.01'
}

@Component({
  selector: 'pg-icon',
  template: `<svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="d()" /></svg>`,
  styles: [':host { display: inline-flex; line-height: 0; }']
})
export class Icon {
  readonly name = input.required<string>()
  readonly size = input(16)
  readonly d = computed(() => PATHS[this.name()] ?? '')
}
