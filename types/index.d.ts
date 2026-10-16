export type MapFile = { p: string; lines: number }

export type RepoMap = { root: string; repo: string; commonDir: string; files: MapFile[]; version: number }

export type Session = {
  reads: Record<string, number>
  readAt: Record<string, number>
  changedAt: Record<string, number>
  labels: Record<string, string>
  recent: string[]
}

export type FileChange = { added: number; deleted: number; isBinary: boolean; blob: string }

export type Changes = { root: string; baseline: string; tree: string; files: Record<string, FileChange>; trees: string[]; folder: string; objects: string; nested: string[] }

export type Theme = 'dark' | 'light'

declare module 'claude-code' {
  interface PluginState {
    filemap: {
      map: Shaped<RepoMap | null>
      root: Shaped<string>
      session: Shaped<Session>
      changes: Shaped<Changes | null>
      isStale: Shaped<boolean>
      isGitPaused: Shaped<boolean>
      theme: Shaped<Theme>
      zoom: Shaped<string>
      epoch: Shaped<number>
    }
  }
}
