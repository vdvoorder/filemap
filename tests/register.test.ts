import type { JsonValue, On, Shaped } from 'claude-code'
import { type Engine, expect, mock } from 'claude-code/testing'

import type { Changes, RepoMap, Session, Theme } from '../types'
import { PROPS_BUDGET, TREE_BUDGET, treeCost } from '../hooks/map'
import type { MapProps } from '../hooks/map-client'
import { register } from '../hooks/register'
import { hashOf, type Os, STATE_SHAPE, WINDOW_MS } from '../hooks/track'
import { test } from './limit'

const PLUGIN = 'filemap'
const CWD = 'C:\\work'
const ROOT = 'C:/work/repo'
const COMMON = 'C:/work/repo/.git'
const FEATURE = 'C:/work/repo-feature'
const NESTED = 'C:/work/repo/.claude/worktrees/stage1'
const OTHER = 'C:/work/other'
const FILE_A = 'C:\\work\\repo\\src\\a.ts'
const FILE_B = 'C:\\work\\repo\\src\\b.ts'
const FILE_C = 'C:\\work\\repo\\src\\c.ts'
const KEY_A = 'c:/work/repo/src/a.ts'
const KEY_B = 'c:/work/repo/src/b.ts'
const KEY_C = 'c:/work/repo/src/c.ts'
const LINUX_HOME = '/home/alex'
const LINUX_ROOT = '/home/alex/repo'
const TEMP = 'C:\\Temp'
const FOLDER = 'C:\\Temp/filemap-s1'
const COMMAND_INDEX = `${FOLDER}/command-0.index`
const JOB_INDEX = `${FOLDER}/job-0.index`
const OBJECTS = `${FOLDER}/objects-${hashOf('c:/work/repo/.git')}`
const ALTERNATES = `${OBJECTS}/info/alternates`
const COUNTS = `${FOLDER}/counts-${hashOf('c:/work/repo/.git')}`
const COUNT_OBJECTS = `${COUNTS}/objects`
const SETTINGS = ['core.looseCompression=0', 'core.safecrlf=false', 'core.splitIndex=false', 'core.bigFileThreshold=4095m']
const CONFIG = [`lfs.storage=${FOLDER}/lfs`, `core.hooksPath=${FOLDER}/hooks`, ...SETTINGS].flatMap(setting => ['-c', setting])
const PAUSED = { plugin: PLUGIN, key: 'isGitPaused' }
const FILLS = {
  dark: { neutral: 0x37342d, read: 0x454238, changed: 0x4f7bab, now: 0xdc7236 },
  light: { neutral: 0xd3ccbc, read: 0xbeb6a5, changed: 0x6a90bc, now: 0xd8692e },
}
const NOT_COUNTED = ' Changes are not counted: git could not describe the working tree.'
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const
const TURN = { answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as const
const PANE_PROPS = {
  title: 'File map',
  isFocused: false,
  bodyColumns: 64,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
const VIEWPORT = { columns: 200, rows: 50, isFullscreen: true }
const EDIT_RESULT = {
  filePath: FILE_A,
  oldString: 'a',
  newString: 'b',
  originalFile: 'a',
  structuredPatch: [],
  userModified: false,
  replaceAll: false,
}
const SHELL_RESULT = { stdout: '', stderr: '', interrupted: false }
const H0 = '0'.repeat(40)
const numbered = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}\n`).join('')
const A0 = numbered('a', 10)
const B0 = numbered('b', 3)
const POWERSHELL = ['powershell', '-NoProfile', '-NonInteractive', '-Command']
const DEFAULT_APP_ON_WINDOWS = [...POWERSHELL, 'Invoke-Item -LiteralPath $env:FILEMAP_OPEN']
const DEFAULT_APP_ON_LINUX = 'if command -v gio >/dev/null; then exec gio open "$1"; else exec xdg-open "$1"; fi </dev/null >/dev/null 2>&1'
const PROGRAM_ON_LINUX = 'command -v "$1" >/dev/null 2>&1 || { echo "$1 is not a program on PATH" >&2; exit 127; }; exec setsid -f "$1" "$2" </dev/null >/dev/null 2>&1'
const OPEN_MS = 10_000
const DOUBLE_MS = 450
const PROGRAM_ON_MAC =
  'if { [ -f "$1" ] && [ -x "$1" ]; } || { case "$1" in */*) false ;; *) command -v "$1" >/dev/null 2>&1 ;; esac; }; then "$1" "$2" </dev/null >/dev/null 2>&1 & exit 0; fi; exec open -a "$1" "$2"'
const AS_TEXT_ON_LINUX_START = 'app=$(xdg-mime query default text/plain 2>/dev/null); '
const isOpener = (argv: readonly string[], env: Record<string, string> | undefined) =>
  argv[0] === 'setsid' ||
  argv[0] === 'open' ||
  (argv[0] === 'sh' && (argv[2] === PROGRAM_ON_LINUX || argv[2] === PROGRAM_ON_MAC || argv[2]?.startsWith(AS_TEXT_ON_LINUX_START) === true)) ||
  (argv[0] === 'powershell' && env?.FILEMAP_OPEN !== undefined)
const openedOf = (opens: Array<{ argv: readonly string[]; env?: Record<string, string> }>) => opens.map(one => one.env?.FILEMAP_OPEN ?? one.argv.at(-1))

type GitName = 'rev-parse' | 'grep' | 'status' | 'read-tree' | 'update-index' | 'write-tree' | 'diff-tree' | 'hash-object' | 'ls-files'
const GIT_NAMES: readonly GitName[] = ['rev-parse', 'grep', 'status', 'read-tree', 'update-index', 'write-tree', 'diff-tree', 'hash-object', 'ls-files']
const WRITES_INDEX: readonly GitName[] = ['read-tree', 'update-index', 'write-tree']

type Gate = { open: () => void; closed: Promise<void>; reach: () => void; reached: Promise<void> }
type Worktree = { root: string; commonDir: string; head: string; files: Record<string, string> }

type Git = {
  worktrees: Worktree[]
  commits: Record<string, Record<string, string>>
  list?: string
  isIndexLocked: boolean
  failure?: string
  exits: Partial<Record<GitName, number>>
  cut: GitName[]
  refused: GitName[]
  killed: GitName[]
  stderr: Partial<Record<GitName, string>>
  holds: Partial<Record<GitName, Gate[]>>
  removing?: Gate[]
  ignored?: string[]
  idLength?: number
  executables?: string[]
  foreign?: string
  network?: string
  config: Record<string, string>
  sessionRoot: string
  sessionId: string
  env: Record<string, string>
  waits?: string
  theme: string
  keepsTheme?: string
  rowsFail?: string
  unreadable?: string
  unreadableReason?: string
  unlistable?: string
  opener: { exitCode: number; stderr: string } | { failure: string }
  os: Os
}

type Stored = {
  map?: RepoMap | null
  root?: string
  session?: Session
  changes?: Changes | null
  isStale?: boolean
  isGitPaused?: boolean
  theme?: Theme
  zoom?: string
}

type Run = { argv: readonly string[]; env?: Record<string, string>; stdin?: string; timeoutMs?: number }
type Removal = { argv: readonly string[]; env?: Record<string, string>; timeoutMs?: number; folders: string[] }

function repo(): Git {
  return {
    worktrees: [{ root: ROOT, commonDir: COMMON, head: 'c0', files: { 'src/a.ts': A0, 'src/b.ts': B0 } }],
    commits: { c0: { 'src/a.ts': A0, 'src/b.ts': B0 } },
    isIndexLocked: false,
    exits: {},
    cut: [],
    refused: [],
    killed: [],
    stderr: {},
    holds: {},
    config: {},
    sessionRoot: CWD,
    sessionId: 's1',
    env: { TEMP },
    theme: 'light',
    opener: { exitCode: 0, stderr: '' },
    os: 'win32',
  }
}

function withFolders(): Git {
  const git = repo()
  const files = { 'README.md': numbered('r', 6), 'docs/guide.md': numbered('g', 8), 'src/a.ts': A0, 'src/b.ts': B0, 'src/lib/c.ts': numbered('c', 5) }
  git.worktrees[0] = { root: ROOT, commonDir: COMMON, head: 'f0', files: { ...files } }
  git.commits.f0 = { ...files }
  return git
}

function onLinux(files: Record<string, string>): Git {
  return {
    ...repo(),
    worktrees: [{ root: LINUX_ROOT, commonDir: `${LINUX_ROOT}/.git`, head: 'x0', files: { ...files } }],
    commits: { x0: { ...files } },
    sessionRoot: LINUX_HOME,
    env: { TMPDIR: '/tmp', HOME: LINUX_HOME },
    os: 'linux',
  }
}

function withFeature(): Git {
  const git = repo()
  git.commits.c1 = { 'src/a.ts': A0, 'src/b.ts': B0, 'src/c.ts': 'c1\n' }
  git.worktrees.push({ root: FEATURE, commonDir: COMMON, head: 'c1', files: { ...git.commits.c1 } })
  return git
}

const slashed = (path: string) => path.replace(/\\/g, '/').replace(/^\/.*?\/(?=[A-Za-z]:\/)/, '')
const posix = (path: string) => path.replace(/^[A-Za-z]:(?=[\\/])/, '').replace(/\\/g, '/')
const keyOf = (path: string) => slashed(path).replace(/\/+$/, '').toLowerCase()
const keyIn = (git: Git, path: string) => (git.os === 'win32' ? keyOf(path) : posix(path).replace(/\/+$/, ''))
const tempKey = (path: string) => keyOf(path).replace(/^[a-z]:(?=\/)/, '')

function worktreeAt(git: Git, folder: string): Worktree | undefined {
  const key = keyIn(git, folder)
  const holding = git.worktrees.filter(one => key === keyIn(git, one.root) || key.startsWith(`${keyIn(git, one.root)}/`))
  return holding.sort((a, b) => b.root.length - a.root.length)[0]
}

const filesOf = (git: Git, root = ROOT) => (git.worktrees.find(one => one.root === root) as Worktree).files

function commitAll(git: Git, root = ROOT): void {
  const tree = git.worktrees.find(one => one.root === root) as Worktree
  const id = `c${Object.keys(git.commits).length}`
  git.commits[id] = { ...tree.files }
  tree.head = id
}

function nameOf(argv: readonly string[]): GitName {
  return argv.find((part): part is GitName => (GIT_NAMES as readonly string[]).includes(part)) as GitName
}

function hash(text: string): string {
  const sample = text.length > 65_536 ? `${text.length}:${text.slice(0, 4096)}:${text.slice(-4096)}` : text
  let h = 0x811c9dc5
  for (let i = 0; i < sample.length; i++) h = Math.imul(h ^ sample.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

const blobOf = (content: string | undefined) => (content === undefined ? H0 : hash(content).repeat(5))
const looseOf = (objects: string, id: string) => `${objects}/${id.slice(0, 2)}/${id.slice(2)}`
const isTreeObject = (path: string) => /\/t[0-9a-f]\/[0-9a-f]{7}$/.test(path)
const linesOf = (content: string) => (content === '' ? [] : content.replace(/\n$/, '').split('\n'))
const isBinary = (content: string | undefined) => content?.includes('\0') === true
const packOf = (objects: string, id: string) => `${objects}/pack/pack-${id}.pack`
const bytesOf = (size: string) => Number.parseInt(size, 10) * 1024 ** ('kmg'.indexOf(size.slice(-1).toLowerCase()) + 1)
const ARGUMENTS_MAX = 128 * 1024

function lineDiff(before: string, after: string): [number, number] {
  const pool = new Map<string, number>()
  for (const line of linesOf(before)) pool.set(line, (pool.get(line) ?? 0) + 1)
  let added = 0
  for (const line of linesOf(after)) {
    const left = pool.get(line) ?? 0
    if (left > 0) pool.set(line, left - 1)
    else added++
  }
  let deleted = 0
  for (const left of pool.values()) deleted += left
  return [added, deleted]
}

function statusOf(git: Git, tree: Worktree): string {
  const head = tree.head === '' ? {} : (git.commits[tree.head] ?? {})
  const lines = [`# branch.oid ${tree.head === '' ? '(initial)' : tree.head}`, '# branch.head main']
  const isIgnored = (path: string) => (git.ignored ?? []).some(folder => path.startsWith(folder))
  for (const path of [...new Set([...Object.keys(head), ...Object.keys(tree.files)])].sort()) {
    if (!Object.hasOwn(head, path)) {
      if (!isIgnored(path)) lines.push(`? ${path}`)
    }
    else if (!Object.hasOwn(tree.files, path)) lines.push(`1 .D N... 100644 100644 000000 ${H0} ${H0} ${path}`)
    else if (head[path] !== tree.files[path]) lines.push(`1 .M N... 100644 100644 100644 ${H0} ${H0} ${path}`)
  }
  for (const one of git.worktrees) {
    const inside = one.root.slice(tree.root.length + 1)
    if (keyIn(git, one.root).startsWith(`${keyIn(git, tree.root)}/`) && !(git.ignored ?? []).some(folder => inside.startsWith(folder))) lines.push(`? ${inside}/`)
  }
  return lines.map(line => `${line}\0`).join('')
}

const listing = (files: Record<string, string>) =>
  Object.keys(files)
    .sort()
    .filter(path => !isBinary(files[path]))
    .map(path => `${path}\0${linesOf(files[path] ?? '').length}\n`)
    .join('')

function subtreesOf(files: Record<string, string>): Map<string, { id: string; text: string }> {
  const entries = new Map<string, string[]>()
  for (const path of Object.keys(files).sort()) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const lines = entries.get(parts.slice(0, i).join('/')) ?? []
      lines.push(`${parts.slice(i).join('/')} ${blobOf(files[path])}`)
      entries.set(parts.slice(0, i).join('/'), lines)
    }
  }
  return new Map([...entries].map(([folder, lines]) => [folder, lines.join('\n')] as const).map(([folder, text]) => [folder, { id: `t${hash(text)}`, text }]))
}

function diffOf(a: Record<string, string>, b: Record<string, string>, hasTrees: boolean): string {
  const raw: Array<[string, string]> = []
  const numstat: string[] = []
  const status = (before: string | undefined, after: string | undefined) => (before === undefined ? 'A' : after === undefined ? 'D' : 'M')
  const [from, to] = hasTrees ? [subtreesOf(a), subtreesOf(b)] : [new Map(), new Map()]
  for (const folder of new Set([...from.keys(), ...to.keys()])) {
    const [before, after] = [from.get(folder)?.id, to.get(folder)?.id]
    if (before !== after) raw.push([folder, `:${before === undefined ? '000000' : '040000'} ${after === undefined ? '000000' : '040000'} ${before ?? H0} ${after ?? H0} ${status(before, after)}`])
  }
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const [before, after] = [a[path], b[path]]
    if (before === after) continue
    raw.push([path, `:${before === undefined ? '000000' : '100644'} ${after === undefined ? '000000' : '100644'} ${blobOf(before)} ${blobOf(after)} ${status(before, after)}`])
    const [added, deleted] = lineDiff(before ?? '', after ?? '')
    numstat.push(isBinary(before) || isBinary(after) ? `-\t-\t${path}` : `${added}\t${deleted}\t${path}`)
  }
  const sorted = raw.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).flatMap(([path, token]) => [token, path])
  return [...sorted, ...numstat].map(token => `${token}\0`).join('')
}

const isShellTool = (tool: unknown) => tool === 'Bash' || tool === 'PowerShell'

const themeRow = (value: string, previous: string) =>
  ({ key: 'theme', value, previous, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } }) as const

function gate(): Gate {
  let open = () => {}
  let reach = () => {}
  const closed = new Promise<void>(resolve => {
    open = resolve
  })
  const reached = new Promise<void>(resolve => {
    reach = resolve
  })
  return { open, closed, reach, reached }
}

function world(on: On, git: Git, cwd: () => string = () => CWD) {
  const state: Stored = {}
  const tags: Record<string, string> = {}
  const kept: { as: (key: string, written: Shaped<unknown>) => unknown } = { as: (_, written) => written }
  const opened: unknown[] = []
  const registered: unknown[] = []
  const logged: string[] = []
  const runs: Run[] = []
  const opens: Array<{ argv: readonly string[]; env?: Record<string, string>; timeoutMs: number | undefined }> = []
  const timeouts: Array<number | undefined> = []
  const toasts: string[] = []
  const toastMs: Array<number | undefined> = []
  const writes: Array<[string, string]> = []
  const exists: string[] = []
  const calls: string[] = []
  const lockTakers: (readonly string[])[] = []
  const indexes = new Map<string, Record<string, string>>()
  const trees = new Map<string, Record<string, string>>()
  const blobs = new Map<string, string>()
  const temp = new Map<string, { text: string; at: number }>()
  const removals: Removal[] = []
  const stateHolds: Partial<Record<string, Gate[]>> = {}
  const seeded: Stored = {}
  const privates: Array<{ argv: readonly string[]; writes: number }> = []
  const repoWrites: string[] = []
  const hooksRun: GitName[] = []
  const clock = mock.clock(on)
  const put = (path: string, text: string, at = clock.now()) => temp.set(tempKey(path), { text, at })
  const chainOf = (objects: string) => {
    const folders = [objects]
    for (let i = 0; i < folders.length && i < 6; i++) for (const line of (temp.get(tempKey(`${folders[i] ?? ''}/info/alternates`))?.text ?? '').split('\n')) if (line !== '') folders.push(line)
    return folders
  }
  const isCommitted = (id: string) => Object.values(git.commits).some(files => Object.values(files).some(content => blobOf(content) === id))
  const isTemp = (path: string) => [...temp.keys()].some(held => held === tempKey(path) || held.startsWith(`${tempKey(path)}/`))
  function runGit(argv: readonly string[], env: Record<string, string>, stdin: string): { exitCode: number; stdout: string; stderr: string } {
    const name = nameOf(argv)
    const tree = worktreeAt(git, String(argv[argv.indexOf('-C') + 1]))
    const index = env.GIT_INDEX_FILE
    const objects = env.GIT_OBJECT_DIRECTORY
    const storage = argv.find(part => part.startsWith('lfs.storage='))?.slice('lfs.storage='.length)
    const done = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
    const fails = (stderr: string) => ({ exitCode: 128, stdout: '', stderr })
    const setting = (key: string) => argv.findLast(part => part.startsWith(`${key}=`))?.slice(key.length + 1) ?? git.config[key]
    if (tree === undefined) return fails('fatal: not a git repository (or any of the parent directories): .git')
    if ((name === 'status' && !argv.includes('--no-optional-locks')) || (WRITES_INDEX.includes(name) && index === undefined)) {
      lockTakers.push(argv)
      if (git.isIndexLocked) return fails(`fatal: Unable to create '${tree.commonDir}/index.lock': File exists.`)
    }
    if (index !== undefined && WRITES_INDEX.includes(name) && isTemp(`${index}.lock`)) return fails(`fatal: Unable to create '${index}.lock': File exists.`)
    const store = objects ?? `${tree.commonDir}/objects`
    const isRepo = (folder: string) => keyIn(git, folder) === keyIn(git, `${tree.commonDir}/objects`)
    const has = (id: string) => chainOf(store).some(folder => (isRepo(folder) && isCommitted(id)) || temp.has(tempKey(looseOf(folder, id))) || temp.has(tempKey(packOf(folder, id))))
    const isStreamed = (content: string) => isBinary(content) && content.length > bytesOf(setting('core.bigFileThreshold') ?? '512m')
    const write = (id: string, content: string, what: string) => (objects === undefined ? repoWrites.push(what) : has(id) || put((isStreamed(content) ? packOf : looseOf)(objects, id), content))
    if (name !== 'rev-parse' && name !== 'grep' && !chainOf(store).some(isRepo)) return fails('fatal: unable to read tree')
    if (WRITES_INDEX.includes(name) && !argv.some(part => part.startsWith('core.hooksPath='))) hooksRun.push(name)
    if (WRITES_INDEX.includes(name) && index !== undefined && setting('core.splitIndex') === 'true') repoWrites.push(`${tree.commonDir}/sharedindex of ${name}`)
    const cleaned = (path: string) => {
      if (!path.endsWith('.pbix')) return
      if (storage === undefined) repoWrites.push(`lfs ${path}`)
      else put(`${storage}/objects/${hash(tree.files[path] ?? '')}`, tree.files[path] ?? '')
    }
    const head = git.commits[tree.head] ?? {}
    const held = indexes.get(index ?? '') ?? {}
    switch (name) {
      case 'rev-parse':
        return done(`${tree.root}\n${tree.commonDir}\n`)
      case 'grep': {
        if (setting('submodule.recurse') === 'true' && !argv.includes('--no-recurse-submodules')) return fails('fatal: --untracked not supported with --recurse-submodules')
        const isColoured = (setting('color.grep') ?? setting('color.ui')) === 'always' && !argv.includes('--no-color')
        return done((git.list ?? listing(tree.files)).replace(/([^\0\n]+)\0/g, (_, path: string) => (isColoured ? `\x1b[35m${path}\x1b[m\0` : `${path}\0`)))
      }
      case 'status':
        for (const path of Object.keys(tree.files)) if (head[path] !== tree.files[path]) cleaned(path)
        return done(statusOf(git, tree))
      case 'read-tree':
        indexes.set(index ?? '', argv.at(-1) === '--empty' ? {} : { ...git.commits[String(argv.at(-1))] })
        return done('')
      case 'hash-object': {
        const id = blobOf(stdin)
        blobs.set(id, stdin)
        write(id, stdin, `blob ${argv.at(-1)}`)
        return done(`${id}\n`)
      }
      case 'update-index': {
        const next = { ...held }
        if (argv.includes('--index-info')) {
          for (const [, mode = '', id = '', path = ''] of stdin.matchAll(/(\d+) ([0-9a-f]+)\t([^\0]+)\0/g)) {
            if (mode === '0' && id.length !== (git.idLength ?? id.length)) return fails(`fatal: malformed index info ${mode} ${id}\t${path}`)
            if (mode === '0') delete next[path]
            else next[path] = blobs.get(id) ?? ''
          }
          indexes.set(index ?? '', next)
          return done('')
        }
        const isSafe = setting('core.safecrlf') === 'true' && setting('core.autocrlf') === 'true'
        const converted = stdin.split('\0').find(path => isSafe && /(^|[^\r])\n/.test(tree.files[path] ?? ''))
        if (converted !== undefined) return fails(`fatal: LF would be replaced by CRLF in ${converted}`)
        for (const path of stdin.split('\0').filter(part => part !== '')) {
          if (!Object.hasOwn(tree.files, path)) delete next[path]
          else {
            next[path] = tree.files[path] as string
            cleaned(path)
            write(blobOf(tree.files[path]), tree.files[path] as string, `blob ${path}`)
          }
        }
        indexes.set(index ?? '', next)
        return done('')
      }
      case 'ls-files': {
        const specs = argv.slice(argv.indexOf('--') + 1).map(spec => /^:\(([^)]*)\)([\s\S]*)$/.exec(spec) ?? ['', '', spec])
        const isNamed = (path: string) => specs.some(([, magic = '', spec = '']) => (magic.split(',').includes('icase') ? spec.toLowerCase() === path.toLowerCase() : spec === path))
        return done(Object.keys(held).filter(isNamed).sort().map(path => `${path}\0`).join(''))
      }
      case 'write-tree': {
        for (const [path, content] of Object.entries(held)) if (head[path] !== content) cleaned(path)
        const id = `t${hash(JSON.stringify(Object.entries(held).sort()))}`
        trees.set(id, held)
        write(id, id, `tree ${id}`)
        for (const folder of subtreesOf(held).values()) write(folder.id, folder.text, `tree ${folder.id}`)
        return done(`${id}\n`)
      }
      case 'diff-tree': {
        const [from, to] = [String(argv.at(-2)), String(argv.at(-1))]
        const missing = [from, to].find(id => !has(id))
        if (missing !== undefined) return fails(`fatal: bad object ${missing}`)
        const [a, b] = [trees.get(from) ?? {}, trees.get(to) ?? {}]
        const changed = Object.keys({ ...a, ...b }).flatMap(path => (a[path] === b[path] ? [] : [a[path], b[path]]))
        const [folders, others] = [subtreesOf(a), subtreesOf(b)]
        const walked = [...new Set([...folders.keys(), ...others.keys()])].flatMap(folder => (folders.get(folder)?.id === others.get(folder)?.id ? [] : [folders.get(folder)?.id, others.get(folder)?.id]))
        const unread = [...changed.flatMap(content => (content === undefined ? [] : [blobOf(content)])), ...walked.filter(id => id !== undefined)].find(id => !has(id))
        if (unread !== undefined) return fails(`fatal: unable to read ${unread}`)
        return done(diffOf(a, b, argv.includes('-t')))
      }
    }
  }
  on('session.cwd', () => {
    calls.push('session.cwd')
    return { value: cwd() }
  })
  on('session.root', () => {
    calls.push('session.root')
    return { value: git.sessionRoot }
  })
  on('session.id', () => ({ value: git.sessionId }))
  on('env.get', (_, e) => ({ value: e.name === 'OS' && git.os === 'win32' ? 'Windows_NT' : git.env[e.name] }))
  on('fs.write', (_, e) => {
    writes.push([slashed(e.path), e.text])
    put(e.path, e.text)
    return { value: undefined }
  })
  const linked = () => git.worktrees.filter(one => keyIn(git, one.commonDir) !== `${keyIn(git, one.root)}/.git`)
  const idOf = (one: Worktree) => one.root.split('/').pop() ?? ''
  on('fs.read', (_, e) => {
    const worktree = linked().find(one => keyIn(git, `${one.commonDir}/worktrees/${idOf(one)}/gitdir`) === keyIn(git, e.path))
    if (worktree !== undefined) return { value: `${worktree.root}/.git\n` }
    const holder = worktreeAt(git, e.path)
    const own = holder === undefined ? undefined : Object.entries(holder.files).find(([file]) => keyIn(git, `${holder.root}/${file}`) === keyIn(git, e.path))
    if (own !== undefined) return { value: own[1] }
    const text = temp.get(tempKey(e.path))?.text
    return text === undefined ? { deny: `ENOENT: no such file, open '${e.path}'` } : { value: text }
  })
  on('fs.list', (_, e) => {
    if (git.unlistable !== undefined && tempKey(e.path ?? '') === tempKey(git.unlistable)) return { deny: `EACCES: permission denied, scandir '${e.path}'` }
    const worktrees = linked().filter(one => keyIn(git, `${one.commonDir}/worktrees`) === keyIn(git, e.path ?? ''))
    if (worktrees.length > 0) return { value: worktrees.map(one => ({ name: idOf(one), kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
    const prefix = `${tempKey(e.path ?? '')}/`
    const entries = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [key, file] of temp) {
      if (!key.startsWith(prefix)) continue
      const [name = '', ...deeper] = key.slice(prefix.length).split('/')
      entries.set(name, deeper.length === 0 ? { name, kind: 'file', size: file.text.length, mtimeMs: file.at, isLink: false } : { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
    }
    return { value: [...entries.values()] }
  })
  on('fs.exists', (_, e) => {
    const onShare = (path: string) => keyOf(path).replace(/^\/+/, '/')
    if (git.network !== undefined && onShare(e.path).startsWith(`${onShare(git.network)}/`)) return { deny: `$.fs.exists: ${e.path} refused: a network location is not reached from here` }
    if (!e.path.endsWith('.lock')) exists.push(git.os === 'win32' ? slashed(e.path) : posix(e.path))
    const key = keyIn(git, e.path)
    const isFile = git.worktrees.some(one => Object.keys(one.files).some(path => keyIn(git, `${one.root}/${path}`) === key))
    return { value: isFile || isTemp(e.path) || git.worktrees.some(one => `${keyIn(git, one.root)}/.git` === key) }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    toastMs.push(e.timeoutMs)
    return { value: undefined }
  })
  on('command.register', (_, e) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: git.waits === undefined ? { isPlaced: true } : { isPlaced: false, reason: git.waits } }
  })
  on('ui.log', (_, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('config.list', () => {
    calls.push('config.list')
    if (git.rowsFail !== undefined) return { deny: git.rowsFail }
    return {
      value: [
        {
          key: 'theme',
          label: 'Theme',
          kind: 'choice',
          value: git.theme,
          options: ['auto', 'dark', 'light'],
          provider: { plugin: 'engine', tier: 'core' },
          isLocked: false,
        },
      ],
    }
  })
  on('config.set', (_, e) => {
    if (git.keepsTheme !== undefined) return { deny: git.keepsTheme }
    git.theme = String(e.value)
    return { value: e.value }
  })
  on('process.run', async (_, e) => {
    timeouts.push(e.init?.timeoutMs)
    if (e.argv[0] === 'uname') return { value: { exitCode: 0, stdout: git.os === 'darwin' ? 'Darwin\n' : 'Linux\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'mkdir' || e.argv[0] === 'chmod') {
      privates.push({ argv: e.argv, writes: writes.length })
      const isRefused = e.argv[0] === 'chmod' && e.argv.at(-1) === git.foreign
      return { value: { exitCode: isRefused ? 1 : 0, stdout: '', stderr: isRefused ? `chmod: changing permissions of '${git.foreign}': Operation not permitted\n` : '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === 'test') {
      const isExecutable = e.argv[1] === '-x' && (git.executables ?? []).some(path => keyIn(git, path) === keyIn(git, String(e.argv[2])))
      return { value: { exitCode: isExecutable ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (isOpener(e.argv, e.init?.env)) {
      opens.push({ argv: e.argv, ...(e.init?.env ? { env: e.init.env } : {}), timeoutMs: e.init?.timeoutMs })
      return 'failure' in git.opener
        ? { deny: git.opener.failure }
        : { value: { exitCode: git.opener.exitCode, stdout: '', stderr: git.opener.stderr, isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === 'rm' && e.argv.reduce((size, part) => size + part.length + 1, 0) > ARGUMENTS_MAX) return { deny: 'spawn rm E2BIG' }
    if (e.argv[0] === 'powershell' || e.argv[0] === 'rm') {
      const held = git.removing?.shift()
      held?.reach()
      await held?.closed
      const folders = e.argv[0] === 'rm' ? e.argv.slice(3) : (e.init?.env?.FILEMAP_REMOVE ?? '').split('\n')
      removals.push({ argv: e.argv, ...(e.init?.env ? { env: e.init.env } : {}), ...(e.init?.timeoutMs !== undefined ? { timeoutMs: e.init.timeoutMs } : {}), folders })
      for (const folder of folders) for (const key of [...temp.keys()]) if (key === tempKey(folder) || key.startsWith(`${tempKey(folder)}/`)) temp.delete(key)
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const name = nameOf(e.argv)
    runs.push({ argv: e.argv, ...(e.init?.env ? { env: e.init.env } : {}), ...(e.init?.stdin !== undefined ? { stdin: e.init.stdin } : {}), ...(e.init?.timeoutMs !== undefined ? { timeoutMs: e.init.timeoutMs } : {}) })
    const held = git.holds[name]?.shift()
    held?.reach()
    await held?.closed
    if (git.failure !== undefined) throw new Error(git.failure)
    if (git.refused.includes(name)) return { deny: `git ${name} did not end in time` }
    const index = e.init?.env?.GIT_INDEX_FILE
    if (git.killed.includes(name) && index !== undefined) put(`${index}.lock`, '')
    if (git.killed.includes(name) && name === 'update-index' && e.init?.env?.GIT_OBJECT_DIRECTORY !== undefined) put(`${e.init.env.GIT_OBJECT_DIRECTORY}/0a/tmp_obj_killed`, 'part')
    if (git.killed.includes(name)) return { deny: `git ${name} was stopped at its time limit` }
    const ran = runGit(e.argv, e.init?.env ?? {}, e.init?.stdin ?? '')
    return {
      value: {
        exitCode: git.exits[name] ?? ran.exitCode,
        stdout: ran.stdout,
        stderr: git.stderr[name] ?? ran.stderr,
        isStdoutTruncated: git.cut.includes(name),
        isStderrTruncated: false,
      },
    }
  })
  on('state.get', { plugin: PLUGIN }, async (_, e, next) => {
    calls.push(`state.get ${e.key}`)
    const held = stateHolds[e.key]?.shift()
    held?.reach()
    await held?.closed
    if (e.key === git.unreadable) return { deny: git.unreadableReason ?? 'the state is gone' }
    const got = await next(e)
    const value = seeded[e.key as keyof Stored]
    if (value === undefined || got.value?.value !== undefined) return got
    return { value: { value: { shape: STATE_SHAPE, value }, version: got.value?.version ?? 0 } }
  })
  on('state.set', { plugin: PLUGIN }, async (_, e, next) => {
    calls.push(`state.set ${e.key}`)
    const done = await next({ ...e, value: kept.as(e.key, e.value) } as typeof e)
    if (done.value?.isSet === true) {
      Object.assign(state, { [e.key]: e.value.value })
      tags[e.key] = e.value.shape
    }
    return done
  })
  const gitCalls = () => runs.map(run => nameOf(run.argv))
  const counted = () =>
    Object.fromEntries(Object.entries(state.changes?.files ?? {}).map(([path, change]) => [path, change.isBinary ? 'binary' : `+${change.added} -${change.deleted}`]))
  return { state, tags, kept, seeded, privates, opened, registered, logged, runs, opens, removals, stateHolds, timeouts, toasts, toastMs, writes, exists, calls, lockTakers, temp, put, repoWrites, hooksRun, clock, gitCalls, counted, runGit }
}

function mountPane(
  $: Engine,
  over: { surface?: 'terminal' | 'desktop'; placement?: 'dock' | 'inline'; bodyColumns?: number; bodyRows?: number; viewport?: typeof VIEWPORT } = {},
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: over.surface ?? 'terminal',
    component: 'Pane',
    requestId: PLUGIN,
    viewport: over.viewport ?? VIEWPORT,
    props: { ...PANE_PROPS, placement: over.placement ?? 'dock', bodyColumns: over.bodyColumns ?? 64, scroll: { offset: 0, bodyRows: over.bodyRows ?? 40 } },
  })
}

type Ui = Awaited<ReturnType<typeof mountPane>>
type Drawn = Pick<Ui, 'find' | 'findAll'>

async function mapOf(ui: Drawn): Promise<MapProps> {
  return (await ui.find({ type: 'Client', key: 'map' }))?.props.props as MapProps
}

async function hoverRow(ui: Drawn): Promise<string> {
  return (await ui.findAll({ in: 'map', type: 'Text' })).at(-1)?.text ?? ''
}

const headerOf = (props: MapProps) => props.top + props.summary
const mapRowsOf = (props: MapProps) => props.rows.map(runs => runs.map(([text]) => text).join(''))

const mapColours = (props: MapProps) =>
  new Set(props.rows.flatMap(runs => runs.flatMap(([, ink, fill]) => [ink, fill])).filter(index => index >= 0).map(index => props.palette[index]))

const hex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`

function cellsOf(props: MapProps, tile: number): Array<{ x: number; y: number }> {
  return props.owners.flatMap((pairs, row) => {
    const found: Array<{ x: number; y: number }> = []
    let x = 0
    for (let i = 0; i < pairs.length; i += 2) {
      const count = pairs[i + 1] ?? 0
      if (pairs[i] === tile) for (let k = 0; k < count; k++) found.push({ x: x + k, y: row + 1 })
      x += count
    }
    return found
  })
}

function cellOf(props: MapProps, path: string): { x: number; y: number } {
  const found = cellsOf(props, props.tiles.findIndex(one => one.path === path))[0]
  if (found === undefined) throw new Error(`no cell of ${path} on the map`)
  return found
}

async function click(ui: Ui, at: { x: number; y: number }): Promise<void> {
  await ui.pointer({ type: 'move', ...at })
  await ui.pointer({ type: 'down', ...at, button: 'left' })
  await ui.pointer({ type: 'up', ...at, button: 'left' })
}

async function doubleClick(ui: Ui, at: { x: number; y: number }): Promise<void> {
  await click(ui, at)
  await click(ui, at)
}

const buttonsOf = async (ui: Drawn) => (await ui.findAll({ type: 'Button' })).map(button => String(button.key))

type Drawing = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

async function listRowOf(ui: Drawn, path: string): Promise<{ text: string; swatch: unknown }> {
  const rows = ((await ui.find({ type: 'Box', key: 'list' }))?.children ?? []) as Drawing[]
  const parts = (rows.find(row => (row.children as Drawing[]).some(part => part.props?.key === `open:${path}`))?.children ?? []) as Drawing[]
  const text = parts.map(part => (part.type === 'Button' ? String(part.props?.label) : (part.children ?? []).join(''))).join('')
  return { text, swatch: parts[0]?.props?.backgroundColor }
}

function hooksOfRegister(): Array<{ event: string; matcher: unknown; hook: (...args: unknown[]) => unknown }> {
  const hooks: Array<{ event: string; matcher: unknown; hook: (...args: unknown[]) => unknown }> = []
  const collect = (event: string, ...rest: unknown[]) => {
    hooks.push({ event, matcher: rest.length > 1 ? rest[0] : undefined, hook: rest[rest.length - 1] as (...args: unknown[]) => unknown })
    return { catch: () => {} }
  }
  register(collect as unknown as On, {})
  return hooks
}

const inSubagent = <T>(input: T): T => ({ ...input, agentId: 'agent-1' })

const closedByPerson = (key: string, written: Shaped<unknown>) => (key === 'isGitPaused' ? { shape: STATE_SHAPE, value: true } : written)

test('the command lists the files, takes the baseline in an index file and an object folder of its own, opens the pane and says what it drew', async ($, on) => {
  const git = repo()
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  const seen = world(on, git)
  const ran = await $.command.run({ command: PLUGIN, args: ' repo ', ...TYPED })
  expect(ran.text).toBe(`File map of ${ROOT}: 2 files.`)
  expect(seen.runs[0]?.argv).toEqual(['git', '--no-optional-locks', '-C', 'C:\\work/repo', 'rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir'])
  expect(seen.gitCalls()).toEqual(['rev-parse', 'grep', 'status', 'read-tree', 'update-index', 'write-tree'])
  expect(seen.runs.slice(2).map(run => run.argv.slice(4, 5 + CONFIG.length))).toEqual(['status', 'read-tree', 'update-index', 'write-tree'].map(name => [...CONFIG, name]))
  expect(seen.runs[2]?.env).toEqual({ GIT_OBJECT_DIRECTORY: OBJECTS, GIT_OPTIONAL_LOCKS: '0' })
  expect(seen.runs.slice(3).map(run => run.env)).toEqual(Array.from({ length: 3 }, () => ({ GIT_OBJECT_DIRECTORY: OBJECTS, GIT_INDEX_FILE: COMMAND_INDEX, GIT_OPTIONAL_LOCKS: '0' })))
  expect(seen.runs[4]?.stdin).toBe('src/a.ts\0')
  expect(seen.writes).toEqual([[slashed(`${FOLDER}/status`), 'open'], [slashed(ALTERNATES), `${COMMON}/objects\n`], [slashed(COMMAND_INDEX), '']])
  expect(seen.privates).toEqual([])
  expect(seen.repoWrites).toEqual([])
  expect(seen.opened).toEqual([{ id: PLUGIN, title: 'File map', columns: 64 }])
  expect(seen.state.map).toEqual({
    root: ROOT,
    repo: 'repo',
    commonDir: COMMON,
    files: [
      { p: 'src/a.ts', lines: 11 },
      { p: 'src/b.ts', lines: 3 },
    ],
    version: 1,
  })
  expect(seen.state.root).toBe(ROOT)
  const baseline = String(seen.state.changes?.baseline)
  expect(baseline).toMatch(/^t[0-9a-f]{8}$/)
  expect(seen.state.changes).toEqual({ root: ROOT, baseline, tree: baseline, files: {}, trees: [], folder: FOLDER, objects: OBJECTS, nested: [] })
  expect(seen.logged).toEqual([])
})

test('the files of the mod are in a folder of the session in the folder for temporary files: TEMP, else TMPDIR, else /tmp', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  const homes: Array<[Record<string, string>, string]> = [
    [{ TEMP, TMPDIR: '/tmp' }, FOLDER],
    [{ TMPDIR: '/var/folders/x/T/' }, '/var/folders/x/T/filemap-s1'],
    [{}, '/tmp/filemap-s1'],
  ]
  const driveless = (path: string) => slashed(path).replace(/^[A-Za-z]:/, '')
  for (const [env, folder] of homes) {
    git.env = env
    await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
    expect(seen.runs.at(-1)?.env).toEqual({ GIT_OBJECT_DIRECTORY: `${folder}/objects-${hashOf('c:/work/repo/.git')}`, GIT_INDEX_FILE: `${folder}/command-0.index`, GIT_OPTIONAL_LOCKS: '0' })
    expect(seen.writes.at(-1)?.map(driveless)).toEqual([driveless(`${folder}/command-0.index`), ''])
  }
})

test('a clean working tree needs no git update-index call', async ($, on) => {
  const seen = world(on, repo())
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(seen.gitCalls()).toEqual(['rev-parse', 'grep', 'status', 'read-tree', 'write-tree'])
  expect(seen.state.changes?.files).toEqual({})
})

test('the command says so when the surface does not draw the pane', async ($, on) => {
  const seen = world(on, { ...repo(), waits: 'no attached surface places panes' })
  const ran = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(ran.text).toBe(`File map of ${ROOT}: 2 files. The pane is not drawn yet: no attached surface places panes`)
  expect(seen.opened).toHaveLength(1)
  expect(seen.state.map?.files).toHaveLength(2)
})

test('the pane opens as wide as "Pane width" in /config, in whole columns', { options: { paneWidth: 90.6 } }, async ($, on) => {
  const seen = world(on, repo())
  const ran = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(ran.text).toBe(`File map of ${ROOT}: 2 files.`)
  expect(seen.opened).toEqual([{ id: PLUGIN, title: 'File map', columns: 91 }])
})

test('a docked pane narrower than "Pane width" says why in the row under the map while the pointer names nothing: a terminal too narrow, or a width dragged to the edge of a pane', { options: { paneWidth: 120 } }, async ($, on) => {
  const seen = world(on, withFolders())
  for (const columns of [140, 200]) {
    const ran = await $.command.run({ command: PLUGIN, args: ROOT, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns } })
    expect(ran.text).toBe(`File map of ${ROOT}: 5 files.`)
  }
  const conversation = (columns: number) => ({ columns, rows: 50, isFullscreen: true })
  const idleRow = async (over: Parameters<typeof mountPane>[1]) => {
    const ui = await mountPane($, over)
    const row = await hoverRow(ui)
    await ui.unmount()
    return row
  }
  expect(await idleRow({ bodyColumns: 115, viewport: conversation(24) })).toBe('Widen the terminal to 145 columns, or lower "Pane width" 120 in /config.')
  expect(await idleRow({ bodyColumns: 110, viewport: conversation(89) })).toBe(`Claude Code uses the width you dragged a pane's edge to, not "Pane width" 120. Drag the edge to change it.`)
  expect(await idleRow({ bodyColumns: 49, viewport: conversation(150) })).toBe('A dragged width replaces "Pane width" 120.')
  for (const bodyColumns of [120, 130]) expect(await idleRow({ bodyColumns, viewport: conversation(24) })).toBe(' ')
  expect(await idleRow({ bodyColumns: 49, placement: 'inline' })).toBe(' ')
  expect(await idleRow({ bodyColumns: 49, surface: 'desktop' })).toBe(' ')
  const ui = await mountPane($, { bodyColumns: 49, viewport: conversation(150) })
  await ui.pointer({ type: 'move', ...cellOf(await mapOf(ui), 'src/a.ts') })
  expect(await hoverRow(ui)).toBe('src/a.ts')
  await ui.pointer({ type: 'leave', x: 3, y: 3 })
  expect(await hoverRow(ui)).toBe('A dragged width replaces "Pane width" 120.')
  await ui.unmount()
  expect(seen.toasts).toEqual([])
  expect(seen.logged).toEqual([])
})

test('the command without a folder draws the loaded repository again, else the working folder', async ($, on) => {
  const seen = world(on, repo(), () => 'C:\\work\\repo')
  await $.command.run({ command: PLUGIN, args: '', ...TYPED })
  await $.command.run({ command: PLUGIN, args: '', ...TYPED })
  const folders = seen.runs.filter(run => nameOf(run.argv) === 'rev-parse').map(run => run.argv[3])
  expect(folders).toEqual(['C:\\work\\repo', ROOT])
  expect(seen.state.map?.version).toBe(2)
})

test('the command on a folder outside a repository refuses in plain words and opens nothing', async ($, on) => {
  const seen = world(on, repo())
  const ran = await $.command.run({ command: PLUGIN, args: 'C:\\elsewhere', ...TYPED })
  expect(ran.text).toBe('C:\\elsewhere is not inside a git repository, so there is no map to draw.')
  expect(seen.opened).toEqual([])
  expect(seen.state.map).toBeUndefined()
  expect(seen.runs).toHaveLength(1)
})

test('the command names the message of git when git refuses the repository, as it does one with dubious ownership, and opens nothing', async ($, on) => {
  const git = onLinux({ 'src/a.ts': A0 })
  git.exits = { 'rev-parse': 128 }
  git.stderr = { 'rev-parse': `fatal: detected dubious ownership in repository at '${LINUX_ROOT}'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory ${LINUX_ROOT}\n` }
  const seen = world(on, git, () => LINUX_HOME)
  const ran = await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
  expect(ran.text).toBe(`Git could not read ${LINUX_ROOT} as a repository: fatal: detected dubious ownership in repository at '${LINUX_ROOT}' To add an exception for this directory, call: git config --global --add safe.directory ${LINUX_ROOT}`)
  expect(seen.opened).toEqual([])
  expect(seen.state.map).toBeUndefined()
  git.stderr = { 'rev-parse': '' }
  expect((await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })).text).toBe(`Git could not read ${LINUX_ROOT} as a repository: git rev-parse ended with exit code 128`)
})

for (const [os, env, typed, folder] of [
  ['Linux', { HOME: LINUX_HOME, USERPROFILE: '/mnt/c/Users/alex', TMPDIR: '/tmp' }, "'~/repo'", LINUX_ROOT],
  ['Windows', { USERPROFILE: 'C:\\work', HOME: '/c/Users/other', TEMP }, '"~\\repo"', 'C:\\work\\repo'],
] as const) {
  test(`${os}: /filemap puts a folder that starts with ~ under the home folder, which is HOME before USERPROFILE except on Windows, and a read of a file there gets that key`, async ($, on) => {
    const git = os === 'Linux' ? onLinux({ 'src/a.ts': A0 }) : repo()
    git.env = { ...env }
    const seen = world(on, git, () => (os === 'Linux' ? LINUX_HOME : CWD))
    on('tool.call', () => ({ result: EDIT_RESULT }))
    const ran = await $.command.run({ command: PLUGIN, args: typed, ...TYPED })
    expect(seen.runs[0]?.argv[3]).toBe(folder)
    expect(ran.text).toBe(`File map of ${os === 'Linux' ? LINUX_ROOT : ROOT}: ${os === 'Linux' ? 1 : 2} files.`)
    await $.tool.call({ tool: 'Read', file_path: '~/repo/src/a.ts' })
    expect(Object.keys(seen.state.session?.reads ?? {})).toEqual([os === 'Linux' ? `${LINUX_ROOT}/src/a.ts` : KEY_A])
  })
}

test('the command says so in plain words when git does not run', async ($, on) => {
  const seen = world(on, { ...repo(), failure: 'git is not installed' })
  const ran = await $.command.run({ command: PLUGIN, args: '', ...TYPED })
  expect(ran.text).toMatch(/^The file map of C:\\work could not be drawn: /)
  expect(seen.opened).toEqual([])
  expect(seen.state.map).toBeUndefined()
})

const BROKEN_BASELINES: Array<[string, Partial<Git>, string]> = [
  ['git status fails', { exits: { status: 128 } }, 'git status ended with exit code 128'],
  ['the output of git status is cut at 4 MiB', { cut: ['status'] }, 'the output of git status is longer than 4 MiB'],
  ['a file is gone before git update-index reads it', { exits: { 'update-index': 128 } }, 'git update-index ended with exit code 128'],
  ['git write-tree fails', { exits: { 'write-tree': 128 } }, 'git write-tree ended with exit code 128'],
]

for (const [name, broken, reason] of BROKEN_BASELINES) {
  test(`the command draws the map and says that changes are not counted when ${name}`, async ($, on) => {
    const git = { ...repo(), ...broken }
    filesOf(git)['src/a.ts'] = `${A0}a11\n`
    const seen = world(on, git)
    on('tool.call', () => ({ result: SHELL_RESULT }))
    const ran = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
    expect(ran.text).toBe(`File map of ${ROOT}: 2 files.${NOT_COUNTED}`)
    expect(seen.state.map?.files).toHaveLength(2)
    expect(seen.state.changes).toBeNull()
    expect(seen.logged).toEqual([`Taking the baseline failed: ${reason}`])
    expect(seen.opened).toHaveLength(1)
    const loaded = seen.runs.length
    await $.tool.call({ tool: 'Bash', command: 'npm run format' })
    await seen.clock.advance(60_000)
    expect(seen.runs).toHaveLength(loaded)
    expect(seen.state.session).toBeUndefined()
  })
}

test('a listing that is cut at 4 MiB or ends with code 1 after output is refused', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  git.list = 'src/a.ts\u000010\nsrc/b.t'
  git.cut = ['grep']
  const cut = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(cut.text).toBe(`The file map of ${ROOT} could not be drawn: git could not list the files of ${ROOT} (the list is longer than 4 MiB)`)
  expect(seen.state.map?.version).toBe(1)
  expect(seen.state.map?.files).toHaveLength(2)
  expect(seen.state.isStale).toBe(true)
  git.list = 'src/a.ts\u000010\n'
  git.cut = []
  git.exits = { grep: 1 }
  const ended = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(ended.text).toBe(`The file map of ${ROOT} could not be drawn: git could not list the files of ${ROOT} (exit code 1)`)
  expect(seen.state.map?.version).toBe(1)
})

test('session.start registers the command and opens nothing', async ($, on) => {
  const seen = world(on, repo())
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  expect(seen.registered).toHaveLength(1)
  expect(seen.registered[0]).toMatchObject({ name: PLUGIN, argumentHint: '[folder]', immediate: true })
  expect(seen.opened).toEqual([])
})

test('no git command runs and no pane opens before the command has drawn a map', async ($, on) => {
  const seen = world(on, repo())
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => ({ result: e.tool === 'Edit' ? EDIT_RESULT : SHELL_RESULT }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't0' })
  await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await $.turn.complete(TURN)
  await seen.clock.advance(60_000)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: PLUGIN,
    viewport: VIEWPORT,
    props: PANE_PROPS,
  })
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  await ui.unmount()
  expect(seen.runs).toEqual([])
  expect(seen.opened).toEqual([])
  expect(seen.logged).toEqual([])
  expect(seen.state.session?.changedAt).toEqual({ [KEY_A]: 0 })
})

test('a Read call counts one read with its time, and runs no git command', async ($, on) => {
  const seen = world(on, repo())
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const listed = seen.runs.length
  await seen.clock.advance(1_000)
  const ran = await $.tool.call({ tool: 'Read', file_path: FILE_A })
  await seen.clock.settle()
  expect(ran.result).toEqual(EDIT_RESULT)
  expect(seen.runs).toHaveLength(listed)
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 1 })
  expect(seen.state.session?.readAt).toEqual({ [KEY_A]: 1_000 })
  expect(seen.state.session?.changedAt).toEqual({})
  expect(seen.logged).toEqual([])
})

test('a denied call and a failed call count nothing and reach the caller unchanged', async ($, on) => {
  const seen = world(on, repo())
  const answers = [{ deny: 'not allowed' }, { isError: true as const, result: 'no such file' }]
  on('tool.call', () => answers.shift() ?? { deny: 'no answer left' })
  const denied = await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' })
  const failed = await $.tool.call({ tool: 'Read', file_path: FILE_A })
  expect(denied.deny).toBe('not allowed')
  expect(failed.isError).toBe(true)
  expect(seen.state.session).toBeUndefined()
  expect(seen.logged).toEqual([])
})

test('a failure in the tracking is logged and leaves the tool call alone', async ($, on) => {
  const seen = world(on, repo(), () => {
    throw new Error('no working folder')
  })
  let calls = 0
  on('tool.call', () => {
    calls += 1
    return { result: { ...EDIT_RESULT, mode: 'files_with_matches', numFiles: 1, filenames: ['src\\a.ts'] } }
  })
  const edited = await $.tool.call({ tool: 'Edit', file_path: 'repo\\src\\a.ts', old_string: 'a', new_string: 'b' })
  const searched = await $.tool.call({ tool: 'Grep', pattern: 'a' })
  expect(edited.result).toMatchObject(EDIT_RESULT)
  expect(searched.deny).toBeUndefined()
  expect(calls).toBe(2)
  expect(seen.logged).toHaveLength(2)
  expect(seen.logged[0]).toMatch(/^Naming the files of a tool call failed: /)
  expect(seen.logged[1]).toMatch(/^Counting the files of a tool call failed: /)
  expect(seen.state.session).toBeUndefined()
})

test('two tool calls that overlap are both noted', async ($, on) => {
  const seen = world(on, repo())
  const held = gate()
  on('tool.call', async (_, e) => {
    if (e.tool === 'Read') await held.closed
    return { result: EDIT_RESULT }
  })
  const slow = $.tool.call({ tool: 'Read', file_path: FILE_A })
  await $.tool.call({ tool: 'Write', file_path: FILE_B, content: 'x' })
  held.open()
  await slow
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 1 })
  expect(seen.state.session?.changedAt).toEqual({ [KEY_B]: 0 })
  expect(seen.logged).toEqual([])
})

test('a call that names no file reads and writes no state, a shell call asks only for the folder it starts in, and a call that names an absolute path asks for no working folder', async ($, on) => {
  const seen = world(on, repo())
  on('tool.call', (_, e) =>
    e.tool === 'Bash' ? { result: SHELL_RESULT, isReadOnly: true as const } : { result: EDIT_RESULT },
  )
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  seen.calls.length = 0
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'TodoWrite', todos: [] })
  await $.tool.call({ tool: 'Glob', pattern: '**/*.ts' })
  expect(seen.calls).toEqual(['session.cwd'])
  seen.calls.length = 0
  await $.tool.call({ tool: 'Read', file_path: FILE_A })
  expect(seen.calls).toEqual(['state.get session', 'state.set session'])
  seen.calls.length = 0
  await $.tool.call({ tool: 'Read', file_path: 'repo\\src\\a.ts' })
  expect(seen.calls.filter(call => call === 'session.cwd')).toHaveLength(1)
  expect(seen.state.session?.reads[KEY_A]).toBe(2)
  seen.calls.length = 0
  await $.tool.call({ tool: 'Edit', file_path: FILE_B, old_string: 'a', new_string: 'b' })
  expect(seen.calls).toEqual(['state.get session', 'state.set session', 'state.set isStale'])
  seen.calls.length = 0
  await $.tool.call({ tool: 'PowerShell', command: 'npm run format' })
  expect(seen.calls).toEqual(['session.cwd'])
})

test('a Grep result counts the files it names as reads, and sets no read time', async ($, on) => {
  const seen = world(on, repo())
  on('tool.call', () => ({
    result: { mode: 'files_with_matches', numFiles: 2, filenames: ['repo/src/a.ts', 'repo/src/b.ts'] },
  }))
  await $.tool.call({ tool: 'Grep', pattern: 'layout' })
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 1, [KEY_B]: 1 })
  expect(seen.state.session?.readAt).toEqual({})
  expect(seen.state.session?.recent).toEqual([KEY_A, KEY_B])
  expect(seen.logged).toEqual([])
})

test('a Grep path is a read when it is a file on disk, whatever its name looks like', async ($, on) => {
  const seen = world(on, repo())
  const stats: string[] = []
  on('fs.stat', (_, e) => {
    stats.push(slashed(e.path))
    return e.path.endsWith('Makefile')
      ? { value: { kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false } }
      : e.path.endsWith('App.Tests')
        ? { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
        : { deny: 'ENOENT' }
  })
  let result: Record<string, unknown> = { mode: 'files_with_matches', numFiles: 0, filenames: [] }
  on('tool.call', () => ({ result }))
  await $.tool.call({ tool: 'Grep', pattern: 'x', path: 'C:\\work\\repo\\App.Tests' })
  expect(seen.state.session).toBeUndefined()
  await $.tool.call({ tool: 'Grep', pattern: 'x', path: 'C:\\work\\repo\\gone.ts' })
  expect(seen.state.session).toBeUndefined()
  await $.tool.call({ tool: 'Grep', pattern: 'x', path: 'C:\\work\\repo\\Makefile' })
  expect(seen.state.session?.reads).toEqual({ 'c:/work/repo/makefile': 1 })
  result = { mode: 'content', numFiles: 0, filenames: [], content: 'repo/src/a.ts:12:5 - error TS2322' }
  await $.tool.call({ tool: 'Grep', pattern: 'error', path: 'C:\\work\\repo\\Makefile', output_mode: 'content', '-n': false })
  expect(seen.state.session?.reads).toEqual({ 'c:/work/repo/makefile': 2 })
  await $.tool.call({ tool: 'Grep', pattern: 'error', path: 'C:\\work\\repo\\App.Tests', output_mode: 'content' })
  expect(seen.state.session?.reads).toEqual({ 'c:/work/repo/makefile': 2, [KEY_A]: 1 })
  expect(stats).toEqual([
    'C:/work/repo/App.Tests',
    'C:/work/repo/gone.ts',
    'C:/work/repo/Makefile',
    'C:/work/repo/Makefile',
    'C:/work/repo/App.Tests',
  ])
  expect(seen.logged).toEqual([])
})

function statsOfRepo(git: Git) {
  return (path: string) => {
    if (Object.keys(filesOf(git)).some(file => keyOf(`${ROOT}/${file}`) === keyOf(path))) return { value: { kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false } }
    if (keyOf(path) === keyOf(`${ROOT}/src`)) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    return { deny: `ENOENT: ${path}` }
  }
}

test('a Bash command that reads with cat or rg marks the files it names and prints as read, also when it fails, and a word or folder that is no file marks nothing', async ($, on) => {
  const git = repo()
  const seen = world(on, git, () => 'C:\\work\\repo')
  const stat = statsOfRepo(git)
  on('fs.stat', (_, e) => stat(e.path))
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash' && e.command.startsWith('cat')) return { isError: true as const, result: 'cat: missing.ts: No such file or directory' }
    return { result: { ...SHELL_RESULT, stdout: 'src/b.ts:3:b3\n' }, isReadOnly: true as const }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.advance(1_000)
  await $.tool.call({ tool: 'Bash', command: 'cat src/a.ts missing.ts' })
  await seen.clock.settle()
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 1 })
  await $.tool.call({ tool: 'Bash', command: 'rg -n b3 src' })
  await seen.clock.settle()
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 1, [KEY_B]: 1 })
  expect(seen.state.session?.readAt).toEqual({ [KEY_A]: 1_000, [KEY_B]: 1_000 })
  await seen.clock.settle()
  const ui = await mountPane($)
  expect(headerOf(await mapOf(ui))).toBe('repo  now: src  0 changed, 2 read')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a shell call that fails marks no file that a command after && names, since that command may not have run, and the same call that succeeds does', async ($, on) => {
  const git = repo()
  const seen = world(on, git, () => 'C:\\work\\repo')
  const stat = statsOfRepo(git)
  on('fs.stat', (_, e) => stat(e.path))
  let isFailing = true
  on('tool.call', () => (isFailing ? { isError: true as const, result: 'cd: src: No such file or directory' } : { result: SHELL_RESULT, isReadOnly: true as const }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Bash', command: 'cd src && cat a.ts' })
  await seen.clock.settle()
  expect(seen.state.session).toBeUndefined()
  isFailing = false
  await $.tool.call({ tool: 'Bash', command: 'cd src && cat a.ts' })
  await seen.clock.settle()
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 1 })
  expect(seen.logged).toEqual([])
})

test('a shell call names its files from the folder it started in, also when a cd in it moves the folder of the session before its files are looked up', async ($, on) => {
  const git = repo()
  let folder = 'C:\\work\\repo'
  const seen = world(on, git, () => folder)
  const stat = statsOfRepo(git)
  on('fs.stat', (_, e) => stat(e.path))
  on('tool.call', () => {
    folder = 'C:\\work\\repo\\src'
    return { result: SHELL_RESULT, isReadOnly: true as const }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  for (const command of ['cd src && cat a.ts', 'cd src; cat ../src/b.ts']) {
    folder = 'C:\\work\\repo'
    await $.tool.call({ tool: 'Bash', command })
    await seen.clock.settle()
  }
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 1, [KEY_B]: 1 })
  expect(seen.logged).toEqual([])
})

test('Windows: a PowerShell Get-Content and Select-String mark the files they name and print as read', async ($, on) => {
  const git = repo()
  const seen = world(on, git, () => 'C:\\work\\repo')
  const stat = statsOfRepo(git)
  on('fs.stat', (_, e) => stat(e.path))
  on('tool.call', () => ({ result: { ...SHELL_RESULT, stdout: '\r\nsrc\\a.ts:1:a1\r\n' }, isReadOnly: true as const }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'PowerShell', command: "Get-Content -Path 'C:\\work\\repo\\src\\b.ts' -TotalCount 3 | Out-Null; Get-ChildItem src | Select-String a1" })
  await seen.clock.settle()
  expect(seen.state.session?.reads).toEqual({ [KEY_B]: 1, [KEY_A]: 1 })
  expect(seen.state.session?.recent).toEqual([KEY_B, KEY_A])
  expect(seen.logged).toEqual([])
})

test('a path under the home folder and a Git Bash path get the key of the plain spelling', async ($, on) => {
  const git = { ...repo(), env: { TEMP, USERPROFILE: 'C:\\work' } }
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.tool.call({ tool: 'Read', file_path: '~/repo/src/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/c/work/repo/src/a.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '\\\\?\\C:\\work\\repo\\src\\a.ts', old_string: 'a', new_string: 'b' })
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 2 })
  expect(seen.state.session?.changedAt).toEqual({ [KEY_A]: 0 })
  expect(seen.logged).toEqual([])
})

test('a file reached through a junction is noted under the folder that git names', async ($, on) => {
  const git = repo()
  filesOf(git)['rules/git.md'] = numbered('r', 80)
  const seen = world(on, git)
  const stats: string[] = []
  on('fs.stat', (_, e) => {
    if (e.resolve) stats.push(`${slashed(e.path)} resolve`)
    const junction = 'c:/users/alex/.claude/rules'
    const realPath = slashed(e.path).toLowerCase().startsWith(junction) ? `C:\\work\\repo\\rules${slashed(e.path).slice(junction.length)}` : slashed(e.path)
    return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath } }
  })
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const viaJunction = 'C:\\Users\\Alex\\.claude\\rules\\git.md'
  const real = 'c:/work/repo/rules/git.md'
  await $.tool.call({ tool: 'Read', file_path: viaJunction })
  expect(seen.state.session?.reads).toEqual({ 'c:/users/alex/.claude/rules/git.md': 1 })
  await seen.clock.settle()
  expect(seen.state.session?.reads).toEqual({ [real]: 1 })
  expect(seen.state.session?.recent).toEqual([real])
  expect(stats).toEqual(['C:/Users/Alex/.claude/rules resolve'])
  await $.tool.call({ tool: 'Read', file_path: viaJunction.toUpperCase() })
  await $.tool.call({ tool: 'Read', file_path: 'C:\\elsewhere\\notes.md' })
  await $.tool.call({ tool: 'Read', file_path: FILE_A })
  await seen.clock.settle()
  expect(seen.state.session?.reads).toEqual({ [real]: 2, 'c:/elsewhere/notes.md': 1, [KEY_A]: 1 })
  expect(stats).toEqual(['C:/Users/Alex/.claude/rules resolve', 'C:/elsewhere resolve'])
  await $.tool.call({ tool: 'Read', file_path: 'C:\\notes.txt' })
  await seen.clock.settle()
  expect(stats).toHaveLength(2)
  expect(seen.state.session?.reads['c:/notes.txt']).toBe(1)
  expect(seen.logged).toEqual([])
})

test('a file named through a junction before the command ran is moved when the map is loaded', async ($, on) => {
  const git = repo()
  filesOf(git)['rules/git.md'] = numbered('r', 80)
  const seen = world(on, git)
  on('fs.stat', (_, e) => ({
    value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: slashed(e.path) === 'C:/Users/Alex/.claude/rules' ? 'C:\\work\\repo\\rules' : slashed(e.path) },
  }))
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.tool.call({ tool: 'Read', file_path: 'C:\\Users\\Alex\\.claude\\rules\\git.md' })
  await seen.clock.settle()
  expect(Object.keys(seen.state.session?.reads ?? {})).toEqual(['c:/users/alex/.claude/rules/git.md'])
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  expect(seen.state.session?.reads).toEqual({ 'c:/work/repo/rules/git.md': 1 })
  expect(seen.logged).toEqual([])
})

test('an Edit call is counted from git: the lines added and deleted since the baseline, by an index file of the jobs and the object folder of the counts, whose alternates name the object folder of the baseline', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git)['src/a.ts'] = A0.replace('a3\n', 'A3\nA3b\n')
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const listed = seen.runs.length
  await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a3', new_string: 'A3\nA3b' })
  expect(seen.runs).toHaveLength(listed)
  await seen.clock.settle()
  expect(seen.gitCalls().slice(listed)).toEqual(['status', 'read-tree', 'update-index', 'write-tree', 'diff-tree'])
  expect(seen.runs.slice(listed + 1, listed + 4).map(run => run.env)).toEqual(Array.from({ length: 3 }, () => ({ GIT_OBJECT_DIRECTORY: COUNT_OBJECTS, GIT_INDEX_FILE: JOB_INDEX, GIT_OPTIONAL_LOCKS: '0' })))
  expect(seen.runs[listed + 4]?.env).toEqual({ GIT_OBJECT_DIRECTORY: COUNT_OBJECTS, GIT_OPTIONAL_LOCKS: '0' })
  expect(seen.writes).toContainEqual([slashed(`${COUNT_OBJECTS}/info/alternates`), 'C:/Temp/filemap-s1/objects-7c080e50\n'])
  expect(seen.counted()).toEqual({ 'src/a.ts': '+2 -1' })
  expect(seen.state.session?.changedAt).toEqual({ [KEY_A]: 0 })
  expect(seen.state.session?.reads).toEqual({})
  expect(seen.writes.at(-1)).toEqual([slashed(JOB_INDEX), ''])
  expect(seen.logged).toEqual([])
})

test('a file put back as the baseline had it shows no change: after git restore, and after an edit that is undone', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', (_, e) => ({ result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'echo a11 >> src/a.ts' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  filesOf(git)['src/a.ts'] = A0
  await $.tool.call({ tool: 'Bash', command: 'git restore src/a.ts' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({})
  filesOf(git)['src/b.ts'] = 'b1\nB2\nb3\n'
  await $.tool.call({ tool: 'Edit', file_path: FILE_B, old_string: 'b2', new_string: 'B2' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -1' })
  filesOf(git)['src/b.ts'] = B0
  await $.tool.call({ tool: 'Edit', file_path: FILE_B, old_string: 'B2', new_string: 'b2' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({})
  expect(seen.logged).toEqual([])
})

test('a shell command that edits files and commits them in the same command shows those files as changed', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const listed = seen.runs.length
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  filesOf(git)['src/b.ts'] = 'b1\nB2\nb3\n'
  commitAll(git)
  await $.tool.call({ tool: 'Bash', command: "sed -i 's/b2/B2/' src/b.ts && echo a11 >> src/a.ts && git commit -am 'Rename'" })
  await seen.clock.settle()
  expect(seen.gitCalls().slice(listed)).toEqual(['status', 'read-tree', 'write-tree', 'diff-tree'])
  expect(seen.runs[listed + 1]?.argv.at(-1)).toBe('c1')
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0', 'src/b.ts': '+1 -1' })
  expect(seen.state.session?.changedAt).toEqual({ [KEY_A]: 0, [KEY_B]: 0 })
  expect(seen.logged).toEqual([])
})

test('a new untracked file counts all its lines as added', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const listed = seen.runs.length
  filesOf(git)['src/c.ts'] = numbered('c', 4)
  await $.tool.call({ tool: 'Bash', command: 'npm run generate' })
  await seen.clock.settle()
  expect(seen.runs[listed + 2]?.stdin).toBe('src/c.ts\0')
  expect(seen.counted()).toEqual({ 'src/c.ts': '+4 -0' })
  expect(seen.state.session?.recent).toEqual([KEY_C])
  expect(seen.logged).toEqual([])
})

test('a changed or untracked file over 32 MiB is left out of the count, so the temporary folder holds no copy of it', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  const big = new Set([`${ROOT}/data/big.csv`, `${ROOT}/src/b.ts`].map(path => path.toLowerCase()))
  on('fs.stat', (_, e) => (big.has(slashed(e.path).toLowerCase()) ? { value: { kind: 'file' as const, size: 32 * 1024 * 1024 + 1, mtimeMs: 0, isLink: false } } : { deny: `ENOENT: no such file, stat '${e.path}'` }))
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/c.ts'] = numbered('c', 4)
  filesOf(git)['data/big.csv'] = numbered('d', 5)
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run generate' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/c.ts': '+4 -0' })
  expect(seen.runs.filter(run => run.argv.includes('update-index') && (run.stdin ?? '').includes('big.csv'))).toEqual([])
  expect(seen.logged).toEqual([])
})

test('a file that another process changes between tool calls shows up within 30 seconds while the pane is open', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  await seen.clock.advance(29_999)
  expect(seen.counted()).toEqual({})
  await seen.clock.advance(1)
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -0' })
  expect(seen.state.session?.changedAt).toEqual({ [KEY_B]: 30_000 })
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await seen.clock.advance(29_999)
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -0' })
  await seen.clock.advance(1)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0', 'src/b.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test('a count that finds a new file of a mapped type or a file of the map that is gone lists the files again, once, with no tool call and no turn', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await seen.clock.advance(30_000)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  expect(seen.state.map?.version).toBe(2)
  filesOf(git)['src/c.ts'] = 'c1\nc2\n'
  delete filesOf(git)['src/b.ts']
  filesOf(git)['notes.txt'] = 'n1\n'
  await seen.clock.advance(30_000)
  expect(seen.state.map?.version).toBe(3)
  expect(seen.state.map?.files.map(file => file.p)).toEqual(['src/a.ts', 'src/c.ts'])
  expect((await mapOf(ui)).tiles.map(tile => tile.path)).toEqual(['src', 'src/a.ts', 'src/c.ts'])
  expect(seen.gitCalls().filter(name => name === 'grep')).toHaveLength(3)
  await seen.clock.advance(30_000)
  expect(seen.gitCalls().filter(name => name === 'grep')).toHaveLength(3)
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a save while the agent is idle gives the map the new length of the file at the timer count that finds it, and a timer count that finds nothing new lists nothing', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const lengthOfA = () => seen.state.map?.files.find(file => file.p === 'src/a.ts')?.lines
  const listings = () => seen.gitCalls().filter(name => name === 'grep').length
  await seen.clock.advance(30_000)
  expect([lengthOfA(), listings()]).toEqual([10, 1])
  filesOf(git)['src/a.ts'] = `${A0}${numbered('z', 10)}`
  await seen.clock.advance(30_000)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+10 -0' })
  expect([lengthOfA(), listings()]).toEqual([20, 2])
  await seen.clock.advance(300_000)
  expect(listings()).toBe(2)
  expect(seen.logged).toEqual([])
})

test('a file that was already changed when the pane opened shows no change until it changes again', async ($, on) => {
  const git = repo()
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({})
  expect(seen.state.session).toBeUndefined()
  filesOf(git)['src/a.ts'] = `${A0}a11\na12\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test('the git commands of the mod work while another git command holds .git/index.lock, and none of them takes it', async ($, on) => {
  const git = { ...repo(), isIndexLocked: true }
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  const ran = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(ran.text).toBe(`File map of ${ROOT}: 2 files.`)
  filesOf(git)['src/b.ts'] = 'only\n'
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -3' })
  expect(seen.lockTakers).toEqual([])
  for (const run of seen.runs) {
    const name = nameOf(run.argv)
    if (WRITES_INDEX.includes(name)) expect([COMMAND_INDEX, JOB_INDEX]).toContain(run.env?.GIT_INDEX_FILE)
    if (name === 'status') expect(run.argv).toContain('--no-optional-locks')
  }
  expect(seen.runGit(['git', '-C', ROOT, 'status'], {}, '').exitCode).toBe(128)
  expect(seen.runGit(['git', '-C', ROOT, 'read-tree', 'c0'], {}, '').exitCode).toBe(128)
  expect(seen.lockTakers).toEqual([['git', '-C', ROOT, 'status'], ['git', '-C', ROOT, 'read-tree', 'c0']])
  expect(seen.logged).toEqual([])
})

test('a count writes nothing into the git folder of the repository: its blobs and trees go to the object folder of its counts in the session folder, and Git LFS puts its copies there too, which the count deletes, since nothing reads them', async ($, on) => {
  const git = repo()
  git.commits.c0 = { ...git.commits.c0, 'report.pbix': 'PK\0v1' }
  filesOf(git)['report.pbix'] = 'PK\0v1'
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  filesOf(git)['src/c.ts'] = 'c1\n'
  filesOf(git)['report.pbix'] = 'PK\0v2'
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'report.pbix': 'binary', 'src/a.ts': '+1 -0', 'src/c.ts': '+1 -0' })
  expect(seen.repoWrites).toEqual([])
  expect(seen.removals.map(one => one.folders)).toEqual([[`${COUNTS}/lfs/objects`]])
  expect([...seen.temp.keys()].filter(key => key.includes('/lfs/'))).toEqual([])
  expect([...seen.temp.keys()].some(key => key.startsWith(`${tempKey(COUNT_OBJECTS)}/`) && !key.includes('/info/'))).toBe(true)
  expect(seen.logged).toEqual([])
})

test('the git commands of the mod run no hook of the repository: core.hooksPath names a folder of the session that holds none, so writing an index file runs no post-index-change hook', async ($, on) => {
  const git = repo()
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/b.ts'] = 'only\n'
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -3' })
  expect(seen.hooksRun).toEqual([])
  const writers = seen.runs.filter(run => WRITES_INDEX.includes(nameOf(run.argv)))
  expect(writers.map(run => run.argv.filter(part => part.startsWith('core.hooksPath=')))).toEqual(writers.map(() => [`core.hooksPath=${FOLDER}/hooks`]))
  expect(seen.logged).toEqual([])
})

for (const key of ['color.ui', 'color.grep']) {
  test(`a git config with ${key}=always, which colours the output of git grep also into a pipe, leaves the map whole: the listing asks for no colour`, async ($, on) => {
    const git = repo()
    git.config = { [key]: 'always' }
    const seen = world(on, git)
    const ran = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
    expect(ran.text).toBe(`File map of ${ROOT}: 2 files.`)
    expect(seen.state.map?.files.map(file => file.p)).toEqual(['src/a.ts', 'src/b.ts'])
  })
}

test('a git config with submodule.recurse=true, with which git grep refuses to list untracked files, leaves the map whole: the listing reads no submodule', async ($, on) => {
  const git = repo()
  git.config = { 'submodule.recurse': 'true' }
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  const ran = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(ran.text).toBe(`File map of ${ROOT}: 2 files.`)
  filesOf(git)['src/b.ts'] = 'only\n'
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -3' })
  expect(seen.logged).toEqual([])
})

test('a git config with core.splitIndex=true writes no shared index into the git folder of the repository: the git commands of the mod turn split indexes off for their own index files', async ($, on) => {
  const git = repo()
  git.config = { 'core.splitIndex': 'true' }
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/b.ts'] = 'only\n'
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -3' })
  expect(seen.repoWrites).toEqual([])
  expect(seen.logged).toEqual([])
})

test('a git config with core.safecrlf=true and line-ending conversion stops no baseline and no count of a file with LF endings: the git commands of the mod turn the check off', async ($, on) => {
  const git = repo()
  git.config = { 'core.autocrlf': 'true', 'core.safecrlf': 'true' }
  filesOf(git)['src/c.ts'] = 'c1\n'
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  const ran = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(ran.text).toBe(`File map of ${ROOT}: 3 files.`)
  filesOf(git)['src/d.ts'] = 'd1\nd2\n'
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/d.ts`, content: 'd1\nd2\n' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/d.ts': '+2 -0' })
  expect(seen.logged).toEqual([])
})

test('git update-index hashes a large file within the time limit of every other git command of the mod, 30 seconds, and writes its objects without compression, which made hashing 3.6 times slower', async ($, on) => {
  const git = repo()
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  const hashes = seen.runs.filter(run => nameOf(run.argv) === 'update-index')
  expect(hashes).toHaveLength(2)
  for (const run of hashes) {
    expect(run.timeoutMs).toBe(30_000)
    expect(run.argv).toContain('core.looseCompression=0')
  }
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -0' })
})

test('a git command stopped at its time limit leaves the lock of its index file and a part of an object, which the mod deletes with the objects of the counts, so the next count takes the same index file and 25 stopped counts in a row lock none', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  git.killed = ['update-index']
  for (let i = 0; i < 25; i++) {
    await $.tool.call({ tool: 'Bash', command: 'npm run format' })
    await seen.clock.settle()
  }
  expect(seen.counted()).toEqual({})
  expect(seen.logged).toHaveLength(25)
  for (const line of seen.logged) expect(line).toMatch(/^Counting the changed lines failed: .*git update-index was stopped at its time limit$/)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.removals.slice(0, 2).map(one => one.folders)).toEqual([[`${JOB_INDEX}.lock`], [COUNTS]])
  expect([...seen.temp.keys()].filter(key => key.endsWith('.lock') || key.includes('tmp_obj'))).toEqual([])
  expect(new Set(seen.runs.filter(run => nameOf(run.argv) === 'update-index').map(run => run.env?.GIT_INDEX_FILE))).toEqual(new Set([JOB_INDEX]))
  git.killed = []
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  expect(seen.runs.at(-2)?.env?.GIT_INDEX_FILE).toBe(JOB_INDEX)
  expect(seen.logged).toHaveLength(25)
})

const MIB = 2 ** 20
const big = (letter: string) => `PK\0${letter.repeat(10 * MIB)}`

function tempStats(on: On, seen: ReturnType<typeof world>): void {
  on('fs.stat', (_, e) => {
    const file = seen.temp.get(tempKey(e.path))
    return file === undefined ? { deny: `ENOENT: no such file, stat '${e.path}'` } : { value: { kind: 'file' as const, size: file.text.length, mtimeMs: file.at, isLink: false } }
  })
}

test('a count deletes the versions of the counted files that newer ones replaced once they add up to 16 MiB, and keeps the latest one and the baseline, also when a replaced version has the content of a file of the baseline or a file goes back to a replaced version', async ($, on) => {
  const git = repo()
  filesOf(git)['data/q.bin'] = big('x')
  const seen = world(on, git)
  tempStats(on, seen)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const save = async (path: string, content: string) => {
    filesOf(git)[path] = content
    await $.tool.call({ tool: 'Bash', command: 'npm run export' })
    await seen.clock.settle()
  }
  await save('data/p.bin', big('x'))
  await save('data/p.bin', big('y'))
  await save('data/p.bin', big('z'))
  await save('data/p.bin', big('y'))
  await save('data/r.txt', 'r1\n')
  expect(seen.removals).toEqual([])
  await save('data/p.bin', big('w'))
  expect(seen.removals.map(one => one.folders.filter(path => !isTreeObject(path)))).toEqual([[looseOf(COUNT_OBJECTS, blobOf(big('z'))), looseOf(COUNT_OBJECTS, blobOf(big('y')))]])
  expect(seen.temp.has(tempKey(looseOf(COUNT_OBJECTS, blobOf(big('w')))))).toBe(true)
  expect(seen.temp.has(tempKey(looseOf(OBJECTS, blobOf(big('x')))))).toBe(true)
  await save('data/q.bin', big('v'))
  expect(seen.counted()).toEqual({ 'data/p.bin': 'binary', 'data/q.bin': 'binary', 'data/r.txt': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test('a count deletes the trees of folders that newer ones replaced once they add up to 16 MiB, as the tree of a folder of many files that each change in it writes again, and keeps the trees of the latest count', async ($, on) => {
  const git = repo()
  const crowd = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`crowd/${i}-${'n'.repeat(700)}.txt`, 'x\n']))
  Object.assign(filesOf(git), crowd)
  git.commits.c0 = { ...filesOf(git) }
  const seen = world(on, git)
  tempStats(on, seen)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const first = Object.keys(crowd)[0] ?? ''
  const trees: string[] = []
  for (let k = 1; k <= 40 && seen.removals.length === 0; k++) {
    filesOf(git)[first] = `x${k}\n`
    await $.tool.call({ tool: 'Bash', command: 'npm run export' })
    await seen.clock.settle()
    trees.push(subtreesOf(filesOf(git)).get('crowd')?.id ?? '')
  }
  const sizes = trees.map(id => seen.temp.get(tempKey(looseOf(COUNT_OBJECTS, id)))?.text.length ?? 0)
  const deleted = seen.removals.flatMap(one => one.folders)
  expect(seen.removals).toHaveLength(1)
  expect(trees.filter(id => deleted.includes(looseOf(COUNT_OBJECTS, id)))).toEqual(trees.slice(0, -1))
  expect(sizes.slice(0, -1)).toEqual(trees.slice(0, -1).map(() => 0))
  expect((sizes.at(-1) ?? 0) * (trees.length - 1)).toBeGreaterThanOrEqual(16 * MIB)
  expect((sizes.at(-1) ?? 0) * (trees.length - 2)).toBeLessThan(16 * MIB)
  expect(seen.counted()).toEqual({ [first]: '+1 -1' })
  expect(seen.logged).toEqual([])
})

test('a file above core.bigFileThreshold, which git would stream into a pack that no count deletes, is hashed into a loose object like any other file, so its replaced versions are deleted too', async ($, on) => {
  const git = repo()
  git.config = { 'core.bigFileThreshold': '1m' }
  const seen = world(on, git)
  tempStats(on, seen)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  for (const letter of ['x', 'y', 'z']) {
    filesOf(git)['data/p.bin'] = big(letter)
    await $.tool.call({ tool: 'Bash', command: 'npm run export' })
    await seen.clock.settle()
  }
  expect([...seen.temp.keys()].filter(key => key.includes('/pack/'))).toEqual([])
  expect(seen.removals.map(one => one.folders.filter(path => !isTreeObject(path)))).toEqual([[looseOf(COUNT_OBJECTS, blobOf(big('x'))), looseOf(COUNT_OBJECTS, blobOf(big('y')))]])
  expect(seen.temp.has(tempKey(looseOf(COUNT_OBJECTS, blobOf(big('z')))))).toBe(true)
  expect(seen.counted()).toEqual({ 'data/p.bin': 'binary' })
  expect(seen.logged).toEqual([])
})

test('Linux: a count deletes many replaced versions with as many rm calls as keep the arguments of each within what Linux starts a program with', async ($, on) => {
  const git = { ...onLinux({ 'src/a.ts': A0 }), env: { TMPDIR: `/tmp/${'deep/'.repeat(600)}`, HOME: LINUX_HOME } }
  const seen = world(on, git, () => LINUX_HOME)
  tempStats(on, seen)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
  const paths = Array.from({ length: 8 }, (_, i) => `data/p${i}.bin`)
  for (let round = 0; round < 10; round++) {
    for (const path of paths) filesOf(git, LINUX_ROOT)[path] = `PK\0${path} ${round}`.padEnd(250_000, '.')
    await $.tool.call({ tool: 'Bash', command: 'npm run export' })
    await seen.clock.settle()
  }
  const deleted = seen.removals.flatMap(one => one.folders)
  expect(seen.removals.length).toBeGreaterThan(1)
  for (const one of seen.removals) expect(one.argv.reduce((size, part) => size + part.length + 1, 0)).toBeLessThanOrEqual(ARGUMENTS_MAX)
  expect(deleted.filter(path => !isTreeObject(path))).toHaveLength(72)
  expect(deleted.filter(path => seen.temp.has(tempKey(path)))).toEqual([])
  expect(seen.counted()).toEqual(Object.fromEntries(paths.map(path => [path, 'binary'])))
  expect(seen.logged).toEqual([])
})

test('a new baseline of the same repository, as /filemap again or a move into another worktree takes, leaves no version that the counts before it hashed: the first count after it deletes them', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['data/p.bin'] = big('y')
  await $.tool.call({ tool: 'Bash', command: 'npm run export' })
  await seen.clock.settle()
  expect(seen.temp.has(tempKey(looseOf(COUNT_OBJECTS, blobOf(big('y')))))).toBe(true)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  expect(seen.temp.has(tempKey(looseOf(OBJECTS, blobOf(big('y')))))).toBe(true)
  filesOf(git)['data/p.bin'] = big('z')
  await $.tool.call({ tool: 'Bash', command: 'npm run export' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'data/p.bin': 'binary' })
  expect(seen.removals.map(one => one.folders)).toEqual([[COUNTS]])
  expect(seen.temp.has(tempKey(looseOf(COUNT_OBJECTS, blobOf(big('y')))))).toBe(false)
  expect(seen.temp.has(tempKey(looseOf(COUNT_OBJECTS, blobOf(big('z')))))).toBe(true)
  await $.tool.call({ tool: 'Bash', command: 'npm run export' })
  await seen.clock.settle()
  expect(seen.removals).toHaveLength(1)
  expect(seen.logged).toEqual([])
})

test('a count that keeps failing shows one toast with the reason, and one again only after a count went through', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  git.exits = { status: 128 }
  git.stderr = { status: 'fatal: unable to read index file' }
  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'Bash', command: 'npm run format' })
    await seen.clock.settle()
  }
  expect(seen.logged).toHaveLength(3)
  expect(seen.toasts).toEqual(['Counting the changed lines failed: git status ended with exit code 128: fatal: unable to read index file'])
  git.exits = {}
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  git.exits = { status: 128 }
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.toasts).toHaveLength(2)
  expect(seen.logged).toHaveLength(4)
})

test('a git command that fails names the first line that git wrote to its error stream', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  git.exits = { 'read-tree': 128 }
  git.stderr = { 'read-tree': "\r\nfatal: Unable to create 'C:/Temp/filemap-s1/job-0.index.lock': File exists.\r\nmore detail\r\n" }
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.logged).toEqual(["Counting the changed lines failed: git read-tree ended with exit code 128: fatal: Unable to create 'C:/Temp/filemap-s1/job-0.index.lock': File exists."])
})

test('every git command of the mod turns optional locks off by its flag and by GIT_OPTIONAL_LOCKS, and every process it runs has a time limit', async ($, on) => {
  const git = withFeature()
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  filesOf(git, FEATURE)['src/b.ts'] = `${B0}b4\n`
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') Object.assign(filesOf(git, FEATURE), e.file_path.endsWith('b.ts') ? { 'src/b.ts': B0 } : { 'src/c.ts': 'c1\nc2\n' })
    return { result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/b.ts'] = 'only\n'
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  await $.turn.complete(TURN)
  await seen.clock.settle()
  git.sessionRoot = FEATURE
  await $.tool.call({ tool: 'EnterWorktree', name: 'feature' })
  await $.tool.call({ tool: 'Edit', file_path: `${FEATURE}/src/c.ts`, old_string: 'c1', new_string: 'c1\nc2' })
  await $.tool.call({ tool: 'Edit', file_path: `${FEATURE}/src/b.ts`, old_string: 'b4\n', new_string: '' })
  await seen.clock.settle()
  await $.tool.call({ tool: 'Read', file_path: `${FEATURE}/src/c.ts` })
  const ui = await mountPane($)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  await ui.press({ key: 'open:src/c.ts' })
  await ui.unmount()
  expect(new Set(seen.gitCalls())).toEqual(new Set(GIT_NAMES))
  for (const run of seen.runs) {
    expect(run.argv.slice(0, 3)).toEqual(['git', '--no-optional-locks', '-C'])
    expect(run.env?.GIT_OPTIONAL_LOCKS).toBe('0')
  }
  expect(seen.opens).toHaveLength(1)
  expect(seen.removals).toHaveLength(1)
  expect(seen.timeouts).toHaveLength(seen.runs.length + seen.removals.length + 1)
  expect(seen.timeouts.every(ms => ms !== undefined && ms <= 30_000)).toBe(true)
  expect(seen.logged).toEqual([])
})

test('at most one count runs and at most one waits: the calls that ask while a count runs share the one after it', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', (_, e) => ({ result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const listed = seen.runs.length
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  for (let i = 0; i < 10; i++) await $.tool.call({ tool: 'PowerShell', command: 'Get-Date' })
  await seen.clock.settle()
  expect(seen.gitCalls().slice(listed).filter(name => name === 'status')).toHaveLength(1)
  const held = gate()
  git.holds.status = [held]
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  const settled = seen.clock.settle()
  await held.reached
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  for (let i = 0; i < 5; i++) {
    await $.tool.call({ tool: 'PowerShell', command: 'Get-Date' })
    await $.tool.call({ tool: 'Edit', file_path: FILE_B, old_string: 'b', new_string: 'b' })
  }
  await seen.clock.settle()
  expect(seen.gitCalls().slice(listed).filter(name => name === 'status')).toHaveLength(2)
  held.open()
  await settled
  await seen.clock.settle()
  expect(seen.gitCalls().slice(listed).filter(name => name === 'status')).toHaveLength(3)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0', 'src/b.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test('a tool call waits for no git command, and a git that fails or hangs never fails the call', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', (_, e) => ({ result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const held = gate()
  git.holds.status = [held]
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  const settled = seen.clock.settle()
  await held.reached
  expect((await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' })).result).toEqual(EDIT_RESULT)
  expect((await $.tool.call({ tool: 'Read', file_path: FILE_B })).result).toEqual(EDIT_RESULT)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).result).toEqual(SHELL_RESULT)
  git.failure = 'git is gone'
  held.open()
  await settled
  await seen.clock.settle()
  expect((await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' })).result).toEqual(EDIT_RESULT)
  await seen.clock.settle()
  expect(seen.logged.length).toBeGreaterThan(1)
  for (const line of seen.logged) expect(line).toMatch(/^Counting the changed lines failed: /)
  expect(seen.state.session?.reads).toEqual({ [KEY_B]: 1 })
})

test('the command takes its baseline without waiting for a count that runs, and that count is dropped', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const held = gate()
  git.holds['write-tree'] = [held]
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  const settled = seen.clock.settle()
  await held.reached
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  const ran = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(ran.text).toBe(`File map of ${ROOT}: 2 files.`)
  expect(seen.state.map?.version).toBe(2)
  const baseline = seen.state.changes?.baseline
  held.open()
  await settled
  await seen.clock.settle()
  expect(seen.state.changes).toEqual({ root: ROOT, baseline, tree: baseline, files: {}, trees: [], folder: FOLDER, objects: OBJECTS, nested: [] })
  expect(seen.state.session).toBeUndefined()
  expect(seen.logged).toEqual([])
})

test('a count that fails keeps the changes that the pane shows and arms no 30-second timer, and the next turn and the next call that may have written count again', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  git.exits = { status: 128 }
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  expect(seen.logged).toEqual(['Counting the changed lines failed: git status ended with exit code 128'])
  const failed = seen.runs.length
  await seen.clock.advance(120_000)
  expect(seen.runs).toHaveLength(failed)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await seen.clock.settle()
  expect(seen.gitCalls().slice(failed)).toEqual(['status'])
  expect(seen.logged).toHaveLength(2)
  git.exits = {}
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0', 'src/b.ts': '+1 -0' })
  const counted = seen.runs.length
  await seen.clock.advance(30_000)
  expect(seen.runs.length).toBeGreaterThan(counted)
})

test('after a count that fails the timer counts again in five minutes, so a file that an editor saves while the agent is idle shows up once git works again', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  git.killed = ['update-index']
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await seen.clock.advance(30_000)
  expect(seen.logged).toHaveLength(1)
  git.killed = []
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  const failed = seen.runs.length
  await seen.clock.advance(299_999)
  expect(seen.runs).toHaveLength(failed)
  await seen.clock.advance(1)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0', 'src/b.ts': '+1 -0' })
  const counted = seen.runs.length
  await seen.clock.advance(30_000)
  expect(seen.runs.length).toBeGreaterThan(counted)
  expect(seen.logged).toHaveLength(1)
})

test('the timer counts once no count has run for 30 seconds, and stops while the person has the pane closed', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const statuses = () => seen.gitCalls().filter(name => name === 'status').length
  const listed = statuses()
  await seen.clock.advance(20_000)
  expect(statuses()).toBe(listed)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await seen.clock.settle()
  expect(statuses()).toBe(listed + 1)
  await seen.clock.advance(29_999)
  expect(statuses()).toBe(listed + 1)
  await seen.clock.advance(1)
  expect(statuses()).toBe(listed + 2)
  seen.kept.as = closedByPerson
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  seen.kept.as = (_, written) => written
  const closed = seen.runs.length
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await seen.clock.advance(300_000)
  expect(seen.runs).toHaveLength(closed)
  expect(seen.logged).toEqual([])
})

test('a shell call that is known to only read asks for no count, and every other shell call and the edit tools do', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', (_, e) =>
    e.tool === 'Bash' && e.command === 'ls' ? { result: SHELL_RESULT, isReadOnly: true as const } : { result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT },
  )
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const statuses = () => seen.gitCalls().filter(name => name === 'status').length
  const listed = statuses()
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await seen.clock.settle()
  expect(statuses()).toBe(listed)
  const calls = [
    { tool: 'Bash', command: 'npm run format' },
    { tool: 'PowerShell', command: 'Get-Date' },
    { tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' },
    { tool: 'Write', file_path: FILE_C, content: 'x' },
    { tool: 'NotebookEdit', notebook_path: 'C:\\work\\repo\\n.ipynb', new_source: 'x' },
  ] as const
  for (const [i, call] of calls.entries()) {
    await $.tool.call(call)
    await seen.clock.settle()
    expect(statuses()).toBe(listed + i + 1)
  }
  expect(seen.logged).toEqual([])
})

for (const tool of ['Bash', 'PowerShell'] as const) {
  test(`a ${tool} call that changes a file and ends with an error is counted, and a denied one is not`, async ($, on) => {
    const git = repo()
    const seen = world(on, git)
    const answers = [{ isError: true as const, result: 'Exit code 1' }, { deny: 'not allowed' }]
    on('tool.call', () => answers.shift() ?? { deny: 'no answer left' })
    await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
    filesOf(git)['src/b.ts'] = `${B0}b4\n`
    await $.tool.call({ tool, command: 'prettier --write src; exit 1' })
    await seen.clock.settle()
    expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -0' })
    const before = seen.runs.length
    await $.tool.call({ tool, command: 'npm run format' })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(before)
    expect(seen.logged).toEqual([])
  })
}

test('a shell call that is still running when the command takes the baseline is counted when it ends', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  const held = gate()
  const started = gate()
  on('tool.call', async () => {
    started.open()
    await held.closed
    return { result: SHELL_RESULT }
  })
  const call = $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await started.closed
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  held.open()
  await call
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

const NOTIFICATION = '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command "npm run build" completed (exit code 0)</summary>\n</task-notification>'

test('the end of a background task counts again: as a prompt of its own and delivered into a turn, and a typed prompt does not', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: { ...SHELL_RESULT, backgroundTaskId: 'b1' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Bash', command: 'npm run build', run_in_background: true })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({})
  const statuses = () => seen.gitCalls().filter(name => name === 'status').length
  const before = statuses()
  await $.prompt.submit({ text: 'what changed?', wait: false, origin: { kind: 'composer' } })
  await seen.clock.settle()
  expect(statuses()).toBe(before)
  filesOf(git)['dist/out.js'] = 'x\n'
  await $.prompt.submit({ text: NOTIFICATION, wait: false, origin: { kind: 'task-notification' } })
  await seen.clock.settle()
  expect(statuses()).toBe(before + 1)
  expect(seen.counted()).toEqual({ 'dist/out.js': '+1 -0' })
  await $.prompt.attachment({ type: 'queued_command', text: NOTIFICATION, origin: { kind: 'engine' } })
  await seen.clock.settle()
  expect(statuses()).toBe(before + 2)
  await $.prompt.attachment({ type: 'todo_reminder', text: 'Remember the todo list.', origin: { kind: 'engine' } })
  await seen.clock.settle()
  expect(statuses()).toBe(before + 2)
  expect(seen.logged).toEqual([])
})

test('the person coming back to the pane counts again, at most once in two seconds', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('ui.focus', () => ({}))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const statuses = () => seen.gitCalls().filter(name => name === 'status').length
  const before = statuses()
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.ui.focus({ component: 'Pane', requestId: PLUGIN, plugin: PLUGIN, element: 'refresh', origin: { kind: 'person' } })
  await seen.clock.settle()
  expect(statuses()).toBe(before + 1)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  await seen.clock.advance(1_000)
  await $.ui.focus({ component: 'Pane', requestId: PLUGIN, plugin: PLUGIN, element: 'refresh', origin: { kind: 'person' } })
  await seen.clock.settle()
  expect(statuses()).toBe(before + 1)
  await seen.clock.advance(1_000)
  await $.ui.focus({ component: 'Pane', requestId: PLUGIN, origin: { kind: 'person' } })
  await seen.clock.settle()
  expect(statuses()).toBe(before + 2)
  expect(seen.logged).toEqual([])
})

test('the session watches the index and HEAD of the git folder of its repository, also through the .git file of a worktree, and a change of either counts again', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('fs.stat', (_, e) => {
    const path = slashed(e.path)
    if (path === `${ROOT}/.git`) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    if (path === `${FEATURE}/.git`) return { value: { kind: 'file' as const, size: 40, mtimeMs: 0, isLink: false } }
    return { deny: `ENOENT: ${path}` }
  })
  on('classic.SessionStart', () => ({}))
  on('classic.FileChanged', () => ({}))
  seen.put(`${FEATURE}/.git`, 'gitdir: ../repo/.git/worktrees/repo-feature\n')
  const started = await $.classic.SessionStart({ source: 'startup', cwd: 'C:\\work\\repo\\src' })
  expect(started.watchPaths).toEqual([`${COMMON}/index`, `${COMMON}/HEAD`])
  const linked = await $.classic.SessionStart({ source: 'startup', cwd: 'C:\\work\\repo-feature' })
  expect(linked.watchPaths).toEqual([`${COMMON}/worktrees/repo-feature/index`, `${COMMON}/worktrees/repo-feature/HEAD`])
  const outside = await $.classic.SessionStart({ source: 'startup', cwd: 'D:\\notes' })
  expect(outside.watchPaths).toBeUndefined()
  expect(seen.runs).toEqual([])
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const statuses = () => seen.gitCalls().filter(name => name === 'status').length
  const before = statuses()
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  commitAll(git)
  await $.classic.FileChanged({ file_path: `${COMMON}/HEAD`, event: 'change' })
  await seen.clock.settle()
  expect(statuses()).toBe(before + 1)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  await $.classic.FileChanged({ file_path: 'C:/work/repo/notes/index.md', event: 'change' })
  await seen.clock.settle()
  expect(statuses()).toBe(before + 1)
  expect(seen.logged).toEqual([])
})

test('the pane moves to another worktree of the repository when the session moves into it, and back when it leaves', async ($, on) => {
  const git = { ...withFeature(), sessionRoot: 'C:\\work\\repo' }
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'EnterWorktree') git.sessionRoot = 'C:\\work\\repo-feature'
    if (e.tool === 'ExitWorktree') git.sessionRoot = 'C:\\work\\repo'
    return { result: isShellTool(e.tool) ? SHELL_RESULT : { worktreePath: FEATURE, message: 'entered' } }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const listed = seen.runs.length
  await $.tool.call({ tool: 'EnterWorktree', path: 'C:\\work\\repo-feature' })
  await seen.clock.settle()
  expect(seen.state.map).toMatchObject({ root: FEATURE, repo: 'repo-feature', commonDir: COMMON, version: 2 })
  expect(seen.state.map?.files).toHaveLength(3)
  expect(seen.state.root).toBe(FEATURE)
  expect(seen.state.changes).toMatchObject({ root: FEATURE, files: {} })
  expect(seen.gitCalls().slice(listed)).toEqual(['rev-parse', 'grep', 'status', 'read-tree', 'write-tree', 'status', 'read-tree', 'write-tree'])
  expect(seen.runs[listed]?.argv[3]).toBe('C:\\work\\repo-feature')
  filesOf(git, FEATURE)['src/c.ts'] = 'c1\nc2\n'
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/c.ts': '+1 -0' })
  await $.tool.call({ tool: 'ExitWorktree', action: 'keep' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(ROOT)
  expect(seen.state.changes).toMatchObject({ root: ROOT, files: {} })
  expect(seen.logged).toEqual([])
})

test('the pane moves when the project root of the session changes with no tool call, at the next count', async ($, on) => {
  const git = { ...withFeature(), sessionRoot: 'C:\\work\\repo' }
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  git.sessionRoot = 'C:\\work\\repo-feature\\src'
  await seen.clock.advance(30_000)
  expect(seen.state.map?.root).toBe(FEATURE)
  expect(seen.state.changes?.root).toBe(FEATURE)
  expect(seen.logged).toEqual([])
})

test('an Edit or Write call on a file in another worktree moves the pane there, and that edit counts as a change there', async ($, on) => {
  const git = withFeature()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Write') filesOf(git, FEATURE)['src/c.ts'] = 'c1\nnew\n'
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Write', file_path: 'C:\\work\\repo-feature\\src\\c.ts', content: 'c1\nnew\n' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(FEATURE)
  expect(seen.counted()).toEqual({ 'src/c.ts': '+1 -0' })
  expect(seen.state.session?.changedAt).toEqual({ 'c:/work/repo-feature/src/c.ts': 0 })
  expect(seen.logged).toEqual([])
})

test('a write of the main agent into a worktree that holds changes from before it counts only its own lines there: the baseline of that worktree takes each written file as it was before the first write', async ($, on) => {
  const git = withFeature()
  const old = `c1\n${numbered('old', 100)}`
  filesOf(git, FEATURE)['src/c.ts'] = old
  filesOf(git, FEATURE)['src/d.ts'] = 'd1\n'
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git, FEATURE)['src/c.ts'] = `${filesOf(git, FEATURE)['src/c.ts']}new\n`
    if (e.tool === 'Write') filesOf(git, FEATURE)['src/e.ts'] = 'e1\ne2\n'
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Edit', file_path: `${FEATURE}/src/c.ts`, old_string: 'old100', new_string: 'old100\nnew' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\work\\repo-feature\\src\\c.ts', old_string: 'new', new_string: 'new\nnew' })
  await $.tool.call({ tool: 'Write', file_path: `${FEATURE}/src/e.ts`, content: 'e1\ne2\n' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(FEATURE)
  expect(seen.counted()).toEqual({ 'src/c.ts': '+2 -0', 'src/e.ts': '+2 -0' })
  expect(seen.gitCalls().filter(name => name === 'hash-object')).toHaveLength(1)
  expect(seen.repoWrites).toEqual([])
  expect(seen.logged).toEqual([])
})

test('a write of the main agent that puts a file of another worktree back as its last commit had it counts the lines it deleted there, also when the path names the file in other capitals, and a written file that git ignores counts nothing', async ($, on) => {
  const git = { ...withFeature(), ignored: ['notes/'] }
  git.commits.c1 = { ...git.commits.c1, 'src/Upper.ts': 'u1\n' }
  Object.assign(filesOf(git, FEATURE), { 'src/c.ts': 'c1\nextra1\nextra2\n', 'src/Upper.ts': 'u1\nu2\n', 'notes/todo.md': 'todo1\n' })
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit' && e.file_path.endsWith('c.ts')) filesOf(git, FEATURE)['src/c.ts'] = 'c1\n'
    if (e.tool === 'Edit' && e.file_path.endsWith('upper.ts')) filesOf(git, FEATURE)['src/Upper.ts'] = 'u1\n'
    if (e.tool === 'Write') filesOf(git, FEATURE)['notes/todo.md'] = 'todo1\ntodo2\n'
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Write', file_path: `${FEATURE}/notes/todo.md`, content: 'todo1\ntodo2\n' })
  await $.tool.call({ tool: 'Edit', file_path: `${FEATURE}/src/upper.ts`, old_string: 'u2\n', new_string: '' })
  await $.tool.call({ tool: 'Edit', file_path: `${FEATURE}/src/c.ts`, old_string: 'extra1\nextra2\n', new_string: '' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(FEATURE)
  expect(seen.counted()).toEqual({ 'src/Upper.ts': '+0 -1', 'src/c.ts': '+0 -2' })
  expect(seen.repoWrites).toEqual([])
  expect(seen.logged).toEqual([])
})

test('in a SHA-256 repository the baseline of a followed worktree leaves out a file that the write made: the entry that takes it out has an id as long as the ids of that repository', async ($, on) => {
  const git = { ...withFeature(), idLength: 64 }
  const heads = ['a'.repeat(64), 'b'.repeat(64)]
  git.commits = Object.fromEntries(git.worktrees.map((one, i) => [heads[i] ?? '', { ...git.commits[one.head] }]))
  for (const [i, one] of git.worktrees.entries()) one.head = heads[i] ?? ''
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Write') filesOf(git, FEATURE)['src/d.ts'] = 'd1\nd2\n'
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Write', file_path: `${FEATURE}/src/d.ts`, content: 'd1\nd2\n' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(FEATURE)
  expect(seen.counted()).toEqual({ 'src/d.ts': '+2 -0' })
  expect(seen.runs.find(run => run.argv.includes('--index-info'))?.stdin).toBe(`0 ${'0'.repeat(64)}\tsrc/d.ts\0`)
  expect(seen.logged).toEqual([])
})

test('a write in a worktree nested in the loaded one (.claude/worktrees) moves the pane into it', async ($, on) => {
  const git = repo()
  git.worktrees.push({ root: NESTED, commonDir: COMMON, head: 'c0', files: { 'src/a.ts': A0, 'src/b.ts': B0 } })
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git, NESTED)['src/a.ts'] = `${A0}a11\n`
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\work\\repo\\.claude\\worktrees\\stage1\\src\\a.ts', old_string: 'a10', new_string: 'a10\na11' })
  await seen.clock.settle()
  expect(seen.exists.slice(0, 2)).toEqual([`${NESTED}/src/.git`, `${NESTED}/.git`])
  expect(seen.state.map?.root).toBe(NESTED)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  await $.tool.call({ tool: 'Edit', file_path: `${NESTED}/src/b.ts`, old_string: 'b', new_string: 'b' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(NESTED)
  expect(seen.logged).toEqual([])
})

test('an edit in a worktree nested in the loaded one that no count has seen yet, as git worktree add makes it just before, reads the text of the file before the write, so the pane that follows it counts only the lines of the write', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git, NESTED)['src/a.ts'] = `${A0}old\nnew\n`
    return { result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  git.worktrees.push({ root: NESTED, commonDir: COMMON, head: 'c0', files: { 'src/a.ts': `${A0}old\n`, 'src/b.ts': B0 } })
  await $.tool.call({ tool: 'Bash', command: 'git worktree add .claude/worktrees/stage1' })
  await $.tool.call({ tool: 'Edit', file_path: `${NESTED}/src/a.ts`, old_string: 'old', new_string: 'old\nnew' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(NESTED)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test('an edit in the worktree that the session moved into with no tool call counts as a change there, also when that edit is the call that moves the pane', async ($, on) => {
  const git = { ...withFeature(), sessionRoot: 'C:\\work\\repo' }
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git, FEATURE)['src/c.ts'] = 'c1\nnew\n'
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  git.sessionRoot = 'C:\\work\\repo-feature'
  await seen.clock.advance(5_000)
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\work\\repo-feature\\src\\c.ts', old_string: 'c1', new_string: 'c1\nnew' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(FEATURE)
  expect(seen.counted()).toEqual({ 'src/c.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test('the pane follows the main agent only: a subagent that edits in its worktree moves nothing, its files count as outside this repo, and the main worktree keeps its counts', async ($, on) => {
  const git = repo()
  const AGENT = 'C:/work/repo/.claude/worktrees/agent-1'
  git.worktrees.push({ root: AGENT, commonDir: COMMON, head: 'c0', files: { 'src/a.ts': A0, 'src/b.ts': B0 } })
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    const path = slashed(String(e.tool === 'Edit' ? e.file_path : ''))
    const tree = path.startsWith(AGENT) ? AGENT : ROOT
    if (path !== '') filesOf(git, tree)[path.slice(tree.length + 1)] = `${filesOf(git, tree)[path.slice(tree.length + 1)] ?? ''}x\n`
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' })
  await seen.clock.settle()
  await $.tool.call(inSubagent({ tool: 'Edit', file_path: `${AGENT}/src/a.ts`, old_string: 'a', new_string: 'b' }))
  await $.tool.call(inSubagent({ tool: 'Read', file_path: `${AGENT}/src/b.ts` }))
  await seen.clock.settle()
  await $.tool.call({ tool: 'Edit', file_path: FILE_B, old_string: 'b', new_string: 'c' })
  await seen.clock.settle()
  expect(seen.state.map).toMatchObject({ root: ROOT, version: 1 })
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0', 'src/b.ts': '+1 -0' })
  expect(seen.state.changes?.nested).toEqual(['.claude/worktrees/agent-1/'])
  const ui = await mountPane($)
  expect(headerOf(await mapOf(ui))).toBe('repo  now: src  2 changed, 0 read')
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text)).toContain('   +2 files outside this repo')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a worktree in a folder that git ignores, as an ignored .claude holds the worktrees of subagents, counts as outside this repo: git status does not name it, the worktrees of the git folder do', async ($, on) => {
  const git = { ...repo(), ignored: ['.claude/'] }
  const AGENT = 'C:/work/repo/.claude/worktrees/agent-1'
  git.worktrees.push({ root: AGENT, commonDir: COMMON, head: 'c0', files: { 'src/a.ts': A0, 'src/b.ts': B0 } })
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  expect(seen.state.changes?.nested).toEqual(['.claude/worktrees/agent-1/'])
  await $.tool.call(inSubagent({ tool: 'Read', file_path: `${AGENT}/src/a.ts` }))
  await $.tool.call(inSubagent({ tool: 'Edit', file_path: `${AGENT}/src/b.ts`, old_string: 'b', new_string: 'c' }))
  await seen.clock.settle()
  const ui = await mountPane($)
  expect(headerOf(await mapOf(ui))).toBe('repo  0 changed, 0 read')
  expect(await buttonsOf(ui)).toEqual(['refresh'])
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text)).toContain('   +2 files outside this repo')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a submodule counts as outside this repo, clean or changed: its folder comes from .gitmodules, so a read inside it is no read of this repo', async ($, on) => {
  const git = repo()
  const modules = '[submodule "lib"]\n\tpath = vendor/lib\n\turl = ../lib\n[submodule "two words"]\n\tpath = "vendor/two words"\n'
  git.commits.c0 = { ...git.commits.c0, '.gitmodules': modules }
  filesOf(git)['.gitmodules'] = modules
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(seen.state.changes?.nested).toEqual(['vendor/lib/', 'vendor/two words/'])
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/vendor/lib/inner.ts` })
  await $.tool.call({ tool: 'Read', file_path: FILE_A })
  const ui = await mountPane($)
  expect(headerOf(await mapOf(ui))).toBe('repo  now: src  0 changed, 1 read')
  expect((await ui.findAll({ type: 'Text', text: 'outside this repo' })).map(one => one.text)).toEqual(['   +1 file outside this repo'])
  expect(await buttonsOf(ui)).toEqual(['open:src/a.ts', 'refresh'])
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a submodule that .gitmodules names as git reads it, with a key in capitals or a comment after its folder, counts as outside this repo', async ($, on) => {
  const git = repo()
  const modules = '[submodule "lib"]\n\tPath = vendor/lib\n[submodule "two"]\n\tpath = vendor/two # checkout directory\n'
  git.commits.c0 = { ...git.commits.c0, '.gitmodules': modules }
  filesOf(git)['.gitmodules'] = modules
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(seen.state.changes?.nested).toEqual(['vendor/lib/', 'vendor/two/'])
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/vendor/lib/inner.ts` })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/vendor/two/inner.ts` })
  const ui = await mountPane($)
  expect(headerOf(await mapOf(ui))).toBe('repo  0 changed, 0 read')
  expect((await ui.findAll({ type: 'Text', text: 'outside this repo' })).map(one => one.text)).toEqual(['   +2 files outside this repo'])
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a worktree that a subagent makes after the pane opened counts as outside this repo from the next count, which finds no other change', async ($, on) => {
  const git = repo()
  const AGENT = 'C:/work/repo/.claude/worktrees/agent-2'
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const tree = seen.state.changes?.tree
  git.worktrees.push({ root: AGENT, commonDir: COMMON, head: 'c0', files: { 'src/a.ts': `${A0}x\n`, 'src/b.ts': B0 } })
  await $.tool.call(inSubagent({ tool: 'Edit', file_path: `${AGENT}/src/a.ts`, old_string: 'a', new_string: 'b' }))
  await seen.clock.settle()
  expect(seen.state.changes?.tree).toBe(tree)
  expect(seen.state.changes?.nested).toEqual(['.claude/worktrees/agent-2/'])
  const ui = await mountPane($)
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text)).toContain('   +1 file outside this repo')
  expect(headerOf(await mapOf(ui))).toBe('repo  0 changed, 0 read')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('the pane stays for a worktree of another repository, a session root outside any repository, and an edit outside any', async ($, on) => {
  const git = { ...repo(), sessionRoot: 'C:\\work\\repo' }
  git.commits.o1 = { 'x.ts': 'x\n' }
  git.worktrees.push({ root: OTHER, commonDir: `${OTHER}/.git`, head: 'o1', files: { 'x.ts': 'x\n' } })
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  git.sessionRoot = 'C:\\work\\other'
  await seen.clock.advance(30_000)
  expect(seen.state.map?.root).toBe(ROOT)
  git.sessionRoot = 'C:\\nowhere'
  await seen.clock.advance(30_000)
  expect(seen.state.map?.root).toBe(ROOT)
  await $.tool.call({ tool: 'Write', file_path: 'C:\\work\\other\\x.ts', content: 'y' })
  await $.tool.call({ tool: 'Write', file_path: 'D:\\notes\\plan.md', content: 'y' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(ROOT)
  expect(seen.state.map?.version).toBe(1)
  expect(seen.logged).toEqual([])
})

test('the command draws the worktree that the person names, and the pane does not move back to the project root of the session', async ($, on) => {
  const git = { ...withFeature(), sessionRoot: 'C:\\work\\repo' }
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: FEATURE, ...TYPED })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await seen.clock.advance(30_000)
  expect(seen.state.map?.root).toBe(FEATURE)
  expect(seen.state.map?.version).toBe(1)
  expect(seen.logged).toEqual([])
})

test('a change marks its file as changed now for five minutes, and the pane draws it again when the five minutes end', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const drawn = async () => mapColours(await mapOf(ui))
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'echo a11 >> src/a.ts' })
  await seen.clock.settle()
  expect((await drawn()).has(hex(FILLS.light.now))).toBe(true)
  expect((await drawn()).has(hex(FILLS.light.changed))).toBe(false)
  await seen.clock.advance(WINDOW_MS - 1)
  expect((await drawn()).has(hex(FILLS.light.now))).toBe(true)
  await seen.clock.advance(1)
  expect((await drawn()).has(hex(FILLS.light.now))).toBe(false)
  expect((await drawn()).has(hex(FILLS.light.changed))).toBe(true)
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a read never turns a file orange, and the header names the folder of the reads of the last five minutes', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const drawn = async () => mapColours(await mapOf(ui))
  const header = async () => headerOf(await mapOf(ui))
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  await seen.clock.settle()
  expect((await drawn()).has(hex(FILLS.light.read))).toBe(true)
  expect((await drawn()).has(hex(FILLS.light.now))).toBe(false)
  expect((await drawn()).has(hex(FILLS.light.changed))).toBe(false)
  expect(await header()).toBe('repo  now: src  0 changed, 1 read')
  expect((await ui.findAll({ in: 'map', type: 'Text' }))[0]?.text).toBe('repo  now: src  0 changed, 1 read')
  await seen.clock.advance(WINDOW_MS)
  expect(await header()).toBe('repo  0 changed, 1 read')
  expect((await drawn()).has(hex(FILLS.light.read))).toBe(true)
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('an Edit call marks the time of its change at once, and a count marks it again only for new content', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git)['src/a.ts'] = A0.replace('a3\n', 'A3\n')
    return { result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.advance(1_000)
  await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a3', new_string: 'A3' })
  expect(seen.state.session?.changedAt).toEqual({ [KEY_A]: 1_000 })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -1' })
  await seen.clock.advance(60_000)
  expect(seen.state.session?.changedAt).toEqual({ [KEY_A]: 1_000 })
  filesOf(git)['src/a.ts'] = A0.replace('a3\n', 'A3 again\n')
  await $.tool.call({ tool: 'Bash', command: "sed -i 's/A3/A3 again/' src/a.ts" })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -1' })
  expect(seen.state.session?.changedAt).toEqual({ [KEY_A]: 61_000 })
  expect(seen.logged).toEqual([])
})

test('the end of a main turn lists the files again after a change, and not after a subagent turn, and the baseline stays', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Write') filesOf(git)['src/a.ts'] = `${A0}a11\n`
    return { result: EDIT_RESULT }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const baseline = seen.state.changes?.baseline
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(seen.state.map?.version).toBe(1)
  await $.tool.call({ tool: 'Write', file_path: FILE_A, content: `${A0}a11\n` })
  await $.turn.complete({ ...TURN, agentId: 'agent-1' })
  await seen.clock.settle()
  expect(seen.state.map?.version).toBe(1)
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(seen.state.map?.version).toBe(2)
  expect(seen.state.map?.files).toEqual([{ p: 'src/a.ts', lines: 11 }, { p: 'src/b.ts', lines: 3 }])
  expect(seen.state.changes?.baseline).toBe(baseline)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(seen.state.map?.version).toBe(2)
  expect(seen.logged).toEqual([])
})

test('a listing that fails at the end of a turn keeps the map that is loaded', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  git.exits = { grep: 128 }
  await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' })
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(seen.state.map?.version).toBe(1)
  expect(seen.state.map?.files).toHaveLength(2)
  expect(seen.state.isStale).toBe(true)
  expect(seen.logged).toHaveLength(1)
  expect(seen.logged[0]).toMatch(/^Listing the files again failed: git could not list the files of /)
  git.exits = { grep: 1 }
  git.list = ''
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(seen.state.map?.version).toBe(2)
  expect(seen.state.map?.files).toEqual([])
})

test('a /clear and a resume empty the session marks and take a new baseline, and the end of the process does neither', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', (_, e) => ({ result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  await seen.clock.settle()
  const marked = seen.state.session
  const changes = seen.state.changes
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  for (const reason of ['prompt_input_exit', 'logout', 'other'] as const) {
    await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
    await seen.clock.settle()
    expect(seen.state.session).toBe(marked)
    expect(seen.state.changes).toBe(changes)
  }
  for (const reason of ['clear', 'resume'] as const) {
    filesOf(git)['src/b.ts'] = `${B0}${reason}\n`
    await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
    expect(seen.state.session).toEqual({ reads: {}, readAt: {}, changedAt: {}, labels: {}, recent: [] })
    await seen.clock.settle()
    expect(seen.counted()).toEqual({})
    expect(seen.state.changes?.baseline).not.toBe(changes?.baseline)
    expect(seen.state.map?.root).toBe(ROOT)
  }
  filesOf(git)['src/b.ts'] = B0
  await $.tool.call({ tool: 'Bash', command: 'git restore src/b.ts' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/b.ts': '+0 -1' })
  expect(seen.logged).toEqual([])
})

const REMOVE = 'foreach ($p in $env:FILEMAP_REMOVE.Split([char]10)) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }'
const DAY_MS = 24 * 60 * 60_000

test('Windows: the end of the session marks the folder of the mod as ended and deletes it with PowerShell, which gets the folder in an environment variable', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  expect(seen.removals).toEqual([])
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect(seen.writes.at(-1)).toEqual([slashed(`${FOLDER}/status`), 'ended'])
  expect(seen.removals).toEqual([{ argv: ['powershell', '-NoProfile', '-NonInteractive', '-Command', REMOVE], env: { FILEMAP_REMOVE: FOLDER }, timeoutMs: 1_000, folders: [FOLDER] }])
  expect(seen.temp.size).toBe(0)
  expect(seen.logged).toEqual([])
})

test('Linux: the end of the session deletes the folder of the mod with rm, and a session that never drew a map writes and runs nothing', async ($, on) => {
  const git = onLinux({ 'src/a.ts': A0 })
  const seen = world(on, git, () => LINUX_HOME)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  expect(seen.writes).toEqual([])
  expect(seen.removals).toEqual([])
  await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
  await seen.clock.settle()
  await $.session.end({ reason: 'logout', sessionId: 's1', resume: { id: 's1' } })
  expect(seen.removals).toEqual([{ argv: ['rm', '-rf', '--', '/tmp/filemap-s1'], timeoutMs: 1_000, folders: ['/tmp/filemap-s1'] }])
  expect(seen.temp.size).toBe(0)
  expect(seen.logged).toEqual([])
})

test('Linux and macOS: mkdir makes the folder of the session with mode 700 before the first write into it, so in a shared /tmp no other user reads the copies of the changed files; on Windows the folder for temporary files is the user\'s own', async ($, on) => {
  const git = onLinux({ 'src/a.ts': A0 })
  const seen = world(on, git, () => LINUX_HOME)
  await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
  expect(seen.privates).toEqual([
    { argv: ['mkdir', '-p', '-m', '700', '--', '/tmp/filemap-s1'], writes: 0 },
    { argv: ['chmod', '700', '--', '/tmp/filemap-s1'], writes: 0 },
  ])
  expect(seen.state.changes?.baseline).toMatch(/^t[0-9a-f]{8}$/)
  expect(seen.logged).toEqual([])
})

test('Linux and macOS: a folder of the session that another user made, which chmod cannot make private, takes no baseline and gets no file of the mod', async ($, on) => {
  const git = { ...onLinux({ 'src/a.ts': A0 }), foreign: '/tmp/filemap-s1' }
  const seen = world(on, git, () => LINUX_HOME)
  const ran = await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
  expect(ran.text).toBe(`File map of ${LINUX_ROOT}: 1 files.${NOT_COUNTED}`)
  expect(seen.writes.filter(([path]) => path.startsWith('/tmp/filemap-s1'))).toEqual([])
  expect(seen.logged).toEqual(["Taking the baseline failed: could not make /tmp/filemap-s1 private: chmod ended with exit code 1: chmod: changing permissions of '/tmp/filemap-s1': Operation not permitted"])
})

test('a count that git still runs when the session ends writes nothing into the folder that the end deleted, and a baseline taken later uses that folder again', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const held = gate()
  git.holds['read-tree'] = [held]
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  const counting = seen.clock.settle()
  await held.reached
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect(seen.removals.map(one => one.folders)).toEqual([[FOLDER]])
  held.open()
  await counting
  await seen.clock.settle()
  const inFolder = () => [...seen.temp.keys()].filter(key => key.startsWith(`${tempKey(FOLDER)}/`))
  expect(inFolder()).toEqual([])
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  expect(inFolder().filter(key => !key.startsWith(`${tempKey(OBJECTS)}/`) || key === tempKey(ALTERNATES)).sort()).toEqual([tempKey(COMMAND_INDEX), tempKey(ALTERNATES), tempKey(`${FOLDER}/status`)])
  expect(seen.temp.get(tempKey(COMMAND_INDEX))?.text).toBe('')
})

test('a count that waits while the session ends writes nothing into the folder that the end deleted: not the alternates of its counts, and no baseline of a worktree it follows', async ($, on) => {
  const git = withFeature()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git, FEATURE)['src/c.ts'] = 'c1\nnew\n'
    return { result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const inFolder = () => [...seen.temp.keys()].filter(key => key.startsWith(`${tempKey(FOLDER)}/`))
  const endWhile = async (reached: Promise<void>, open: () => void) => {
    const counting = seen.clock.settle()
    await reached
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
    expect(inFolder()).toEqual([])
    open()
    await counting
    await seen.clock.settle()
    expect(inFolder()).toEqual([])
  }
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const clearing = gate()
  git.removing = [clearing]
  filesOf(git)['src/a.ts'] = `${A0}a11\na12\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await endWhile(clearing.reached, clearing.open)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const naming = gate()
  git.holds['rev-parse'] = [naming]
  await $.tool.call({ tool: 'Edit', file_path: `${FEATURE}/src/c.ts`, old_string: 'c1', new_string: 'c1\nnew' })
  await endWhile(naming.reached, naming.open)
  expect(seen.logged).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('Linux: two files whose names differ only in case are two files: the read, the counts, the hover rows and the rows of the list keep them apart', async ($, on) => {
  const git = onLinux({ 'src/App.ts': A0, 'src/app.ts': B0 })
  const seen = world(on, git, () => LINUX_HOME)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
  await $.tool.call({ tool: 'Read', file_path: `${LINUX_ROOT}/src/App.ts` })
  expect(seen.state.session?.reads).toEqual({ [`${LINUX_ROOT}/src/App.ts`]: 1 })
  filesOf(git, LINUX_ROOT)['src/App.ts'] = `${A0}a11\n`
  filesOf(git, LINUX_ROOT)['src/app.ts'] = `${B0}b4\nb5\n`
  await $.tool.call({ tool: 'Edit', file_path: `${LINUX_ROOT}/src/app.ts`, old_string: 'b3', new_string: 'b3\nb4\nb5' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/App.ts': '+1 -0', 'src/app.ts': '+2 -0' })
  const ui = await mountPane($)
  const props = await mapOf(ui)
  expect(headerOf(props)).toBe('repo  now: src  2 changed, 0 read')
  await ui.pointer({ type: 'move', ...cellOf(props, 'src/App.ts') })
  expect(await hoverRow(ui)).toBe('src/App.ts  +1 -0')
  await ui.pointer({ type: 'move', ...cellOf(props, 'src/app.ts') })
  expect(await hoverRow(ui)).toBe('src/app.ts  +2 -0')
  expect((await buttonsOf(ui)).sort()).toEqual(['open:src/App.ts', 'open:src/app.ts', 'refresh'])
  expect((await listRowOf(ui, 'src/App.ts')).text).toBe(`   src/App.ts${' '.repeat(46)}+1 -0`)
  await ui.press({ key: 'open:src/App.ts' })
  expect(openedOf(seen.opens)).toEqual([`${LINUX_ROOT}/src/App.ts`])
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('Linux: a backslash in a file name stays part of the name in the session, on the map, in the list and in what opens it', async ($, on) => {
  const git = onLinux({ 'a\\b.ts': A0, 'src/c.ts': B0 })
  const seen = world(on, git, () => LINUX_HOME)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
  expect(seen.state.map?.files.map(file => file.p)).toEqual(['a\\b.ts', 'src/c.ts'])
  await $.tool.call({ tool: 'Read', file_path: `${LINUX_ROOT}/a\\b.ts` })
  expect(seen.state.session?.reads).toEqual({ [`${LINUX_ROOT}/a\\b.ts`]: 1 })
  expect(seen.state.session?.labels).toEqual({ [`${LINUX_ROOT}/a\\b.ts`]: `${LINUX_ROOT}/a\\b.ts` })
  const ui = await mountPane($)
  const props = await mapOf(ui)
  expect(props.tiles.map(tile => tile.path).sort()).toEqual(['a\\b.ts', 'src', 'src/c.ts'])
  await ui.pointer({ type: 'move', ...cellOf(props, 'a\\b.ts') })
  expect(await hoverRow(ui)).toBe('a\\b.ts  read')
  expect(await buttonsOf(ui)).toEqual(['open:a\\b.ts', 'refresh'])
  await ui.press({ key: 'open:a\\b.ts' })
  expect(seen.opens.map(open => open.argv)).toEqual([['setsid', '-f', 'sh', '-c', DEFAULT_APP_ON_LINUX, 'sh', `${LINUX_ROOT}/a\\b.ts`]])
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('Linux: a repository whose path differs from the loaded one only in case is another repository, and an edit there counts as outside this one', async ($, on) => {
  const git = onLinux({ 'src/a.ts': A0 })
  const other = '/home/alex/Repo'
  git.commits.o0 = { 'src/x.ts': 'x1\n' }
  git.worktrees.push({ root: other, commonDir: `${other}/.git`, head: 'o0', files: { 'src/x.ts': 'x1\n' } })
  const seen = world(on, git, () => LINUX_HOME)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
  filesOf(git, other)['src/x.ts'] = 'x1\nx2\n'
  await $.tool.call({ tool: 'Edit', file_path: `${other}/src/x.ts`, old_string: 'x1', new_string: 'x1\nx2' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(LINUX_ROOT)
  expect(Object.keys(seen.state.session?.changedAt ?? {})).toEqual([`${other}/src/x.ts`])
  const ui = await mountPane($)
  expect((await ui.findAll({ type: 'Text', text: 'outside this repo' })).map(text => text.text)).toEqual(['   +1 file outside this repo'])
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('/clear marks the folder of the ended conversation, takes the new baseline in a folder of the new one, and deletes the old folder after that', async ($, on) => {
  const [first, second] = ['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002']
  const folder = `${TEMP}/filemap-${first}`
  const git = { ...repo(), sessionId: first }
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  git.sessionId = second
  await $.session.end({ reason: 'clear', sessionId: first, resume: { id: first } })
  expect(seen.removals).toEqual([])
  expect(seen.temp.get(tempKey(`${folder}/status`))?.text).toBe('ended')
  await seen.clock.settle()
  expect(seen.state.changes?.folder).toBe(`${TEMP}/filemap-${second}`)
  expect(seen.removals.map(one => one.folders)).toEqual([[folder]])
  expect([...seen.temp.keys()].some(key => key.startsWith(tempKey(folder)))).toBe(false)
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test('a /clear that keeps the session id keeps the folder of the session, also while the pane is closed and no baseline is taken', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  seen.kept.as = closedByPerson
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  seen.kept.as = (_, written) => written
  await seen.clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await seen.clock.settle()
  expect(seen.removals).toEqual([])
  expect(seen.temp.get(tempKey(`${FOLDER}/status`))?.text).toBe('ended')
  expect(seen.logged).toEqual([])
})

const sessionFolderOf = (n: number) => `${TEMP}/filemap-0000000${n}-0000-4000-8000-00000000000${n}`

test('the sweep after /filemap deletes the folders of ended sessions and of sessions untouched for a week, and keeps its own, a live one and one that holds a file of something else', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  await seen.clock.set(30 * DAY_MS)
  const now = seen.clock.now()
  const [ended, old, live, other] = [1, 2, 3, 4].map(sessionFolderOf)
  seen.put(`${ended}/status`, 'ended', now)
  seen.put(`${ended}/job-0.index`, '', now)
  seen.put(`${old}/status`, 'open', now - 8 * DAY_MS)
  seen.put(`${old}/objects-0123abcd/info/alternates`, 'x', now - 8 * DAY_MS)
  seen.put(`${live}/status`, 'open', now - 8 * DAY_MS)
  seen.put(`${live}/job-0.index`, '', now - 60_000)
  seen.put(`${other}/status`, 'ended', now)
  seen.put(`${other}/notes.txt`, 'mine', now)
  seen.put(`${FOLDER}/status`, 'ended', now - 8 * DAY_MS)
  seen.put(`${TEMP}/filemap-notes.txt`, 'x', now - 8 * DAY_MS)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  expect(seen.removals.map(one => one.folders)).toEqual([[ended, old]])
  expect(seen.removals[0]?.timeoutMs).toBe(20_000)
  expect(seen.temp.get(tempKey(`${FOLDER}/status`))?.text).toBe('open')
  expect(seen.temp.has(tempKey(`${other}/notes.txt`))).toBe(true)
  expect(seen.temp.has(tempKey(`${TEMP}/filemap-notes.txt`))).toBe(true)
  expect(seen.logged).toEqual([])
})

test('the sweep deletes a folder of the mod that has no status file, as the delete at the end of a session leaves it when a git that still runs writes its index and objects after it, and keeps a live one with an empty status file', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  const now = seen.clock.now()
  const [cut, writing] = [5, 6].map(sessionFolderOf)
  seen.put(`${cut}/job-0.index`, '', now)
  seen.put(`${cut}/objects-0123abcd/ab/cdef01`, 'blob', now)
  seen.put(`${writing}/status`, '', now)
  seen.put(`${writing}/job-0.index`, '', now)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  expect(seen.removals.map(one => one.folders)).toEqual([[cut]])
  expect(seen.logged).toEqual([])
})

test('the sweep keeps a folder whose name starts with filemap- but is not a session id, whatever it holds', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  await seen.clock.set(30 * DAY_MS)
  const now = seen.clock.now()
  seen.put(`${TEMP}/filemap-export/lfs/data.bin`, 'x', now - 8 * DAY_MS)
  seen.put(`${TEMP}/filemap-backup/status`, 'ended', now)
  seen.put(`${TEMP}/filemap-backup/objects-0123abcd/ab/cdef01`, 'blob', now)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  expect(seen.removals).toEqual([])
  expect(seen.temp.has(tempKey(`${TEMP}/filemap-export/lfs/data.bin`))).toBe(true)
  expect(seen.logged).toEqual([])
})

test('a folder that the sweep cannot list, as the private folder of another user in a shared /tmp, is passed over and stops no other deletion', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  const now = seen.clock.now()
  const [hidden, ended] = [7, 8].map(sessionFolderOf)
  seen.put(`${hidden}/status`, 'open', now)
  git.unlistable = hidden
  seen.put(`${ended}/status`, 'ended', now)
  seen.put(`${ended}/job-0.index`, '', now)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  expect(seen.removals.map(one => one.folders)).toEqual([[ended]])
  expect(seen.logged).toEqual([])
})

const EMPTY = { reads: {}, readAt: {}, changedAt: {}, labels: {}, recent: [] }

test('a count that runs or waits while /clear empties the session writes nothing afterwards, and the new conversation starts with no marks', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const held = gate()
  git.holds.status = [held]
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  const settled = seen.clock.settle()
  await held.reached
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(seen.state.changes).toBeNull()
  held.open()
  await settled
  await seen.clock.settle()
  expect(seen.state.session).toEqual(EMPTY)
  expect(seen.counted()).toEqual({})
  const ui = await mountPane($)
  expect(headerOf(await mapOf(ui))).toBe('repo  0 changed, 0 read')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a count that follows a write of the main agent into another worktree and that /clear overtakes moves the pane nowhere: the new conversation keeps the worktree it started in', async ($, on) => {
  const git = withFeature()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Write') filesOf(git, FEATURE)['src/c.ts'] = 'c1\nnew\n'
    return { result: EDIT_RESULT }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const held = gate()
  git.holds.grep = [held]
  await $.tool.call({ tool: 'Write', file_path: 'C:\\work\\repo-feature\\src\\c.ts', content: 'c1\nnew\n' })
  const settled = seen.clock.settle()
  await held.reached
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  held.open()
  await settled
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(ROOT)
  expect(seen.state.changes?.root).toBe(ROOT)
  expect(seen.state.root).toBe(ROOT)
  expect(seen.counted()).toEqual({})
  expect(seen.state.session).toEqual(EMPTY)
  expect(seen.logged).toEqual([])
})

test('a write that the main agent made before /clear moves the pane nowhere after it, also when the count that would follow it starts after the /clear', async ($, on) => {
  const git = withFeature()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Write') filesOf(git, FEATURE)['src/c.ts'] = 'c1\nnew\n'
    return { result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const held = gate()
  git.holds.status = [held]
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  const settled = seen.clock.settle()
  await held.reached
  await $.tool.call({ tool: 'Write', file_path: 'C:/work/repo-feature/src/c.ts', content: 'c1\nnew\n' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  held.open()
  await settled
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(ROOT)
  expect(seen.state.root).toBe(ROOT)
  expect(seen.state.changes?.root).toBe(ROOT)
  expect(seen.logged).toEqual([])
})

test('a count whose lines are stored just before /clear empties the session writes no mark into the new session', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const held = gate()
  seen.stateHolds.session = [held]
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  const settled = seen.clock.settle()
  await held.reached
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  held.open()
  await settled
  await seen.clock.settle()
  expect(seen.state.session).toEqual(EMPTY)
  expect(seen.logged).toEqual([])
})

function heldStat(on: On, git: Git, key: string): Gate {
  const stat = statsOfRepo(git)
  const held = gate()
  on('fs.stat', async (_, e) => {
    if (keyOf(e.path) === key) {
      held.reach()
      await held.closed
    }
    return stat(e.path)
  })
  return held
}

test('a tool call that /clear overtakes writes no mark into the new session: a shell read whose file is still being looked up, and a Read whose note still waits for the stored session', async ($, on) => {
  const git = repo()
  const seen = world(on, git, () => 'C:\\work\\repo')
  const held = heldStat(on, git, KEY_A)
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: SHELL_RESULT, isReadOnly: true as const } : { result: EDIT_RESULT }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const shell = $.tool.call(inSubagent({ tool: 'Bash', command: 'cat src/a.ts' }))
  const settled = seen.clock.settle()
  await held.reached
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  held.open()
  await shell
  await settled
  await seen.clock.settle()
  expect(seen.state.session).toEqual(EMPTY)
  const noting = gate()
  seen.stateHolds.session = [noting]
  const read = $.tool.call({ tool: 'Read', file_path: FILE_B })
  await noting.reached
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  noting.open()
  await read
  await seen.clock.settle()
  expect(seen.state.session).toEqual(EMPTY)
  expect(seen.logged).toEqual([])
})

test('a shell call returns before the files it names are looked up on disk, so a look-up that hangs holds back no tool result', async ($, on) => {
  const git = repo()
  const seen = world(on, git, () => 'C:\\work\\repo')
  const held = heldStat(on, git, KEY_A)
  on('tool.call', () => ({ result: { ...SHELL_RESULT, stdout: 'a1' }, isReadOnly: true as const }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const call = $.tool.call({ tool: 'Bash', command: 'cat src/a.ts' })
  expect(await Promise.race([call.then(() => 'the result'), held.reached.then(() => 'the look-up')])).toBe('the result')
  expect((await call).result).toEqual({ ...SHELL_RESULT, stdout: 'a1' })
  const settled = seen.clock.settle()
  await held.reached
  expect(seen.state.session).toBeUndefined()
  held.open()
  await settled
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 1 })
  expect(seen.logged).toEqual([])
})

test('a count that runs while the mod reloads writes nothing, and the count that the reload asks for counts', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await seen.clock.settle()
  const [held, next] = [gate(), gate()]
  git.holds.status = [held, next]
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  const settled = seen.clock.settle()
  await held.reached
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  held.open()
  await next.reached
  expect(seen.counted()).toEqual({})
  expect(seen.state.session).toBeUndefined()
  next.open()
  await settled
  await seen.clock.settle()
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  expect(Object.keys(seen.state.session?.changedAt ?? {})).toEqual([KEY_A])
  expect(seen.logged).toEqual([])
})

test('a fresh module, as a reload starts one, reads the text of a file in another worktree before the first edit there, so the pane that follows that edit counts only its lines', async ($, on) => {
  const git = withFeature()
  filesOf(git, FEATURE)['src/c.ts'] = `c1\n${numbered('old', 3)}`
  const seen = world(on, git)
  Object.assign(seen.seeded, { map: { root: ROOT, repo: 'repo', commonDir: COMMON, files: [], version: 1 }, root: ROOT, changes: null })
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git, FEATURE)['src/c.ts'] = `c1\n${numbered('old', 3)}new\n`
    return { result: EDIT_RESULT }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: `${FEATURE}/src/c.ts`, old_string: 'old3', new_string: 'old3\nnew' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(FEATURE)
  expect(seen.counted()).toEqual({ 'src/c.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test('a fresh module, as a reload starts one, knows the worktrees nested in the map from the stored changes before the first count, so an edit in one of them counts only its lines', async ($, on) => {
  const git = repo()
  git.worktrees.push({ root: NESTED, commonDir: COMMON, head: 'c0', files: { 'src/a.ts': `${A0}old\n`, 'src/b.ts': B0 } })
  const seen = world(on, git)
  const stored: Changes = { root: ROOT, baseline: 't0', tree: 't0', files: {}, trees: [], folder: FOLDER, objects: OBJECTS, nested: ['.claude/worktrees/stage1/'] }
  Object.assign(seen.seeded, { map: { root: ROOT, repo: 'repo', commonDir: COMMON, files: [], version: 1 }, root: ROOT, changes: stored })
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git, NESTED)['src/a.ts'] = `${A0}old\nnew\n`
    return { result: EDIT_RESULT }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: `${NESTED}/src/a.ts`, old_string: 'old', new_string: 'old\nnew' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(NESTED)
  expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test('the pane on the terminal is the map region, the list, the legend and the buttons, which fill the body', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const client = await ui.find({ type: 'Client', key: 'map' })
  const props = client?.props.props as MapProps
  expect(client?.props).toMatchObject({ width: 64, height: 29 })
  expect(String(client?.props.module)).toMatch(/map-client\.tsx$/)
  expect(props.columns).toBe(64)
  expect(props.rows).toHaveLength(27)
  expect(mapRowsOf(props).every(row => row.length === 64)).toBe(true)
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(1)
  expect((await ui.find({ type: 'Box', key: 'list' }))?.props.height).toBe(9)
  expect((await ui.find({ type: 'Box', key: 'controls' }))?.props.flexDirection).toBe('row')
  expect(await buttonsOf(ui)).toEqual(['refresh'])
  const baseline = seen.state.changes?.baseline
  const gitCalls = seen.runs.length
  filesOf(git)['src/c.ts'] = 'c1\n'
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(seen.gitCalls().slice(gitCalls)).toEqual(['grep', 'status', 'read-tree', 'update-index', 'write-tree', 'diff-tree'])
  expect(seen.state.map?.version).toBe(2)
  expect(seen.state.changes?.baseline).toBe(baseline)
  expect(seen.counted()).toEqual({ 'src/c.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

function textOf(node: unknown): number {
  if (typeof node === 'string') return node.length
  if (typeof node !== 'object' || node === null) return 0
  const { type, props = {}, children = [] } = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (type === 'Client') return JSON.stringify(props.props).length
  const own = type === 'Button' ? String(props.label ?? '').length : type === 'Box' ? String(props.key ?? '').length : 0
  return children.reduce((sum: number, child) => sum + textOf(child), own)
}

function bigRepo(): Git {
  const git = repo()
  const files: Record<string, string> = {}
  for (let i = 0; i < 400; i++) files[`packages/package-${i % 8}/source/module-${i % 5}/a-long-file-name-${i}.ts`] = numbered('x', 20 + ((i * 37) % 300))
  git.worktrees[0] = { root: ROOT, commonDir: COMMON, head: 'g0', files: { ...files } }
  git.commits.g0 = { ...files }
  return git
}

test('a wide pane keeps the Client inside its bounds with the longest list, and a tiny one draws its top row alone', async ($, on) => {
  const git = bigRepo()
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  for (const path of Object.keys(filesOf(git)).slice(0, 60)) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/${path}` })
  const huge = await mountPane($, { bodyColumns: 600, bodyRows: 300 })
  const props = await mapOf(huge)
  expect(props.columns).toBe(600)
  expect(props.rows.length).toBeGreaterThan(0)
  expect(props.rows.length).toBeLessThan(222)
  expect(JSON.stringify(await huge.drawn({ in: 'map' })).length).toBeLessThan(100_000)
  expect(JSON.stringify(props).length).toBeLessThan(100_000)
  expect(textOf(await huge.drawn())).toBeLessThan(100_000)
  expect((await buttonsOf(huge)).filter(key => key.startsWith('open:'))).toHaveLength(50)
  await huge.unmount()
  const tiny = await mountPane($, { bodyColumns: 1, bodyRows: 1 })
  const small = await mapOf(tiny)
  expect(small.columns).toBe(1)
  expect(small.rows).toEqual([])
  expect((await tiny.find({ type: 'Client' }))?.props.height).toBe(1)
  expect(await tiny.findAll({ type: 'Button' })).toHaveLength(0)
  await tiny.unmount()
  expect(seen.logged).toEqual([])
})

test('a map that the budget of its props holds back still mounts beside the longest list', async ($, on) => {
  const git = repo()
  const deep = 'a-folder-with-a-long-name/'.repeat(7)
  const files: Record<string, string> = {}
  for (let i = 0; i < 200; i++) files[`${deep}group-${i % 4}/file-number-${i}.ts`] = numbered('x', 20 + ((i * 37) % 300))
  git.worktrees[0] = { root: ROOT, commonDir: COMMON, head: 'l0', files: { ...files } }
  git.commits.l0 = { ...files }
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  for (const path of Object.keys(files).slice(0, 60)) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/${path}` })
  const ui = await mountPane($, { bodyRows: 300 })
  const props = await mapOf(ui)
  expect(JSON.stringify(props).length).toBeGreaterThan(0.9 * PROPS_BUDGET)
  expect(JSON.stringify(props).length).toBeLessThanOrEqual(PROPS_BUDGET)
  expect(treeCost(props)).toBeLessThan(TREE_BUDGET)
  expect(textOf(await ui.drawn())).toBeLessThan(100_000)
  expect((await buttonsOf(ui)).filter(key => key.startsWith('open:'))).toHaveLength(50)
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a list of 50 long paths in a wide pane mounts beside a map that its budget holds back, since a row of the list has 160 columns at most', async ($, on) => {
  const git = repo()
  const deep = 'a-folder-with-a-long-name/'.repeat(16)
  const files: Record<string, string> = {}
  for (let i = 0; i < 60; i++) files[`${deep}group-${i % 4}/file-number-${i}.ts`] = numbered('x', 20 + ((i * 37) % 300))
  git.worktrees[0] = { root: ROOT, commonDir: COMMON, head: 'w0', files: { ...files } }
  git.commits.w0 = { ...files }
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  for (const path of Object.keys(files)) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/${path}` })
  for (const bodyColumns of [200, 400, 600]) {
    const ui = await mountPane($, { bodyColumns, bodyRows: 300 })
    expect(JSON.stringify(await mapOf(ui)).length).toBeGreaterThan(0.9 * PROPS_BUDGET)
    expect(textOf(await ui.drawn())).toBeLessThan(100_000)
    const row = await listRowOf(ui, `${deep}group-3/file-number-59.ts`)
    expect(row.text).toHaveLength(160)
    expect(row.text.startsWith('   ~')).toBe(true)
    await ui.unmount()
  }
  expect(seen.logged).toEqual([])
})

test('a map whose tiles carry too much text at one row is left out: one line in its place says why, and the list, the legend and the buttons stay', async ($, on) => {
  const git = repo()
  const deep = Array.from({ length: 5 }, (_, i) => `${i}${'d'.repeat(178)}`).join('/')
  const files: Record<string, string> = {}
  for (let i = 0; i < 100; i++) files[`${deep}/file-${i}.ts`] = numbered('x', 20 + ((i * 37) % 300))
  git.worktrees[0] = { root: ROOT, commonDir: COMMON, head: 'd0', files: { ...files } }
  git.commits.d0 = { ...files }
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  for (const path of Object.keys(files).slice(0, 3)) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/${path}` })
  const narrow = await mountPane($)
  await narrow.post({ kind: 'click', path: deep })
  expect(seen.state.zoom).toBe(deep)
  expect(await narrow.findAll({ type: 'Client' })).toHaveLength(1)
  await narrow.unmount()
  const wide = await mountPane($, { bodyColumns: 200, bodyRows: 100 })
  expect(await wide.findAll({ type: 'Client' })).toHaveLength(0)
  expect((await wide.find({ type: 'Box', key: 'map' }))?.props.height).toBe(74)
  expect((await wide.findAll({ type: 'Text', text: 'The map is not drawn' })).map(text => text.text)).toEqual([
    'The map is not drawn: this folder has too many long file paths to draw at this width. Make the pane narrower, or press up.',
  ])
  expect((await buttonsOf(wide)).filter(key => key.startsWith('open:'))).toHaveLength(3)
  expect(await buttonsOf(wide)).toContain('up')
  expect((await wide.findAll({ type: 'Text' })).map(text => text.text)).toContain('files    read     changed     last 5 min')
  expect(textOf(await wide.drawn())).toBeLessThan(100_000)
  expect(seen.logged).toEqual([])
  await wide.unmount()
})

test('the pane draws without a measured viewport', async ($, on) => {
  world(on, repo())
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PLUGIN, props: PANE_PROPS })
  expect((await mapOf(ui)).rows).toHaveLength(27)
  await ui.unmount()
})

test('the estimate of the Client tree is above the size of the tree it draws, and within a tenth of it', async ($, on) => {
  const git = bigRepo()
  world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  for (const path of Object.keys(filesOf(git)).slice(0, 30)) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/${path}` })
  for (const [bodyColumns, bodyRows] of [[64, 48], [100, 71], [200, 100], [600, 300]] as const) {
    const ui = await mountPane($, { bodyColumns, bodyRows })
    const props = await mapOf(ui)
    const drawn = JSON.stringify(await ui.drawn({ in: 'map' })).length
    expect(treeCost(props)).toBeGreaterThanOrEqual(drawn)
    expect(treeCost(props)).toBeLessThan(drawn * 1.1)
    expect(treeCost(props)).toBeLessThanOrEqual(TREE_BUDGET)
    await ui.unmount()
  }
})

test('the map the pane draws holds both half blocks, and the Client draws them', async ($, on) => {
  const git = repo()
  const paths = ['README.md', 'a.ts', 'b.ts', 'c.ts', 'docs/guide.md', 'docs/setup.md', 'src/app.ts', 'src/util/text.ts']
  git.list = paths.map((path, i) => `${path}\u0000${40 + 130 * i}\n`).join('')
  world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const rows = mapRowsOf(await mapOf(ui)).join('')
  const drawn = JSON.stringify(await ui.drawn({ in: 'map' }))
  for (const half of ['▀', '▄']) {
    expect(rows).toContain(half)
    expect(drawn).toContain(half)
  }
  await ui.unmount()
})

test('the tree the pane draws is never taller than the body', async ($, on) => {
  world(on, repo())
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  for (const bodyRows of [1, 2, 3, 4, 12, 40, 71, 256, 257, 300]) {
    const ui = await mountPane($, { bodyRows })
    const box = await ui.find({ type: 'Box' })
    const parts = (box?.children ?? []) as Array<{ type: string; props: Record<string, unknown> }>
    const used = parts.reduce((sum, part) => sum + (part.props.height === undefined ? 1 : Number(part.props.height)), 0)
    expect(box?.props.flexDirection).toBe('column')
    expect(parts.map(part => part.type)).toEqual(bodyRows >= 12 ? ['Client', 'Box', 'Text', 'Box'] : bodyRows > 1 ? ['Client', 'Box'] : ['Client'])
    expect(used).toBeLessThanOrEqual(bodyRows)
    if (bodyRows >= 4) expect(used).toBe(bodyRows)
    await ui.unmount()
  }
})

test('the pane with no map loaded says which command draws one', async ($, on) => {
  world(on, repo())
  const ui = await mountPane($)
  const props = await mapOf(ui)
  expect(headerOf(props)).toBe('no repository  0 changed, 0 read')
  expect(mapRowsOf(props)[0]?.trimEnd()).toBe('Run /filemap <folder> to draw a git repository here.')
  expect(props.tiles).toEqual([])
  expect(await ui.find({ type: 'Box', key: 'list' })).toBeUndefined()
  await ui.unmount()
})

test('the desktop app draws the same pane, and VS Code and mobile get one line of text', async ($, on) => {
  world(on, withFolders())
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const desktop = await mountPane($, { surface: 'desktop' })
  const props = await mapOf(desktop)
  expect(props.tiles.map(tile => tile.path)).toContain('src/a.ts')
  await desktop.pointer({ type: 'move', ...cellOf(props, 'src/a.ts') })
  expect(await hoverRow(desktop)).toBe('src/a.ts')
  expect(await buttonsOf(desktop)).toEqual(['refresh'])
  await desktop.unmount()
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: PANE_PROPS })
    expect(await ui.findAll({ type: 'Client' })).toHaveLength(0)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('The file map draws in the terminal and in the desktop app.')
    await ui.unmount()
  }
})

for (const [name, asAnotherBuild] of [
  ['under another tag', (written: Shaped<unknown>) => ({ shape: 'another build', value: written.value })],
  ['with no tag', (written: Shaped<unknown>) => written.value],
] as const) {
  test(`values that another build of the mod stored ${name} read as absent, and the tracking starts again from there`, async ($, on) => {
    const git = repo()
    const seen = world(on, git, () => 'C:\\work\\repo')
    on('tool.call', (_, e) => ({ result: e.tool === 'Bash' ? SHELL_RESULT : EDIT_RESULT }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    seen.kept.as = (_, written) => asAnotherBuild(written)
    await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
    await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' })
    await seen.clock.settle()
    expect(Object.keys(seen.tags).sort()).toEqual(['changes', 'isGitPaused', 'isStale', 'map', 'root', 'session', 'theme'])
    seen.kept.as = (_, written) => written
    const ui = await mountPane($)
    expect(mapRowsOf(await mapOf(ui)).join(' ')).toContain('Run /filemap <folder>')
    await ui.unmount()
    const gitCalls = seen.runs.length
    filesOf(git)['src/b.ts'] = `${B0}b4\n`
    await $.tool.call({ tool: 'Bash', command: 'npm run format' })
    await $.turn.complete(TURN)
    await seen.clock.advance(60_000)
    expect(seen.runs).toHaveLength(gitCalls)
    await $.tool.call({ tool: 'Read', file_path: FILE_B })
    expect(seen.state.session).toEqual({
      reads: { [KEY_B]: 1 },
      readAt: { [KEY_B]: 60_000 },
      changedAt: {},
      labels: { [KEY_B]: 'C:/work/repo/src/b.ts' },
      recent: [KEY_B],
    })
    const ran = await $.command.run({ command: PLUGIN, args: '', ...TYPED })
    expect(ran.text).toBe('File map of C:/work/repo: 2 files.')
    expect(seen.runs[gitCalls]?.argv).toEqual(['git', '--no-optional-locks', '-C', 'C:\\work\\repo', 'rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir'])
    expect(seen.state.map?.version).toBe(1)
    filesOf(git)['src/a.ts'] = `${A0}a11\n`
    await $.tool.call({ tool: 'Bash', command: 'npm run format' })
    await seen.clock.settle()
    expect(seen.counted()).toEqual({ 'src/a.ts': '+1 -0' })
    expect(new Set(Object.values(seen.tags))).toEqual(new Set([STATE_SHAPE]))
    expect(seen.logged).toEqual([])
  })
}

test('a drawing that fails is one line of text with the reason, and the failure is in the debug log', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  git.unreadable = 'session'
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PLUGIN, viewport: VIEWPORT, props: PANE_PROPS })
  expect(await ui.drawn()).toMatchObject({ type: 'Text' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('The file map could not be drawn: filemap: $.state.get: the state is gone')
  expect(await ui.findAll({})).toHaveLength(1)
  expect(seen.logged).toEqual(['Drawing the file map failed: filemap: $.state.get: the state is gone'])
  git.unreadable = undefined
  await ui.redraw()
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(1)
  await ui.unmount()
})

const STATE_FAILURE = 'filemap: $.state.get: '
const ODD_REASONS: Array<[name: string, reason: string, drawn: string]> = [
  ['an escape sequence', 'bad \u001b[31mred\u001b[0m', `${STATE_FAILURE}bad ?[31mred?[0m`],
  ['a NUL', 'nul\u0000inside', `${STATE_FAILURE}nul?inside`],
  ['a newline, a carriage return and a tab', 'first\r\nsecond\tthird', `${STATE_FAILURE}first second third`],
  ['more than 10,000 characters', 'x'.repeat(10_001), `${STATE_FAILURE}${'x'.repeat(200 - STATE_FAILURE.length)}`],
]

for (const [name, reason, drawn] of ODD_REASONS) {
  test(`a drawing that fails for a reason with ${name} is still one line of text, in plain characters and cut`, async ($, on) => {
    const git = repo()
    const seen = world(on, git)
    await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
    git.unreadable = 'session'
    git.unreadableReason = reason
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PLUGIN, viewport: VIEWPORT, props: PANE_PROPS })
    expect(await ui.drawn()).toMatchObject({ type: 'Text' })
    expect((await ui.find({ type: 'Text' }))?.text).toBe(`The file map could not be drawn: ${drawn}`)
    expect(await ui.findAll({})).toHaveLength(1)
    expect(seen.logged).toEqual([`Drawing the file map failed: ${STATE_FAILURE}${reason}`.slice(0, 4096)])
    await ui.unmount()
  })
}

test('a repository with no file of a mapped type draws a notice in place of an empty map, above the list and the legend', async ($, on) => {
  const git = repo()
  git.worktrees[0] = { root: ROOT, commonDir: COMMON, head: 'n0', files: { 'notes.txt': 'n1\nn2\nn3\nn4\n', 'logo.png': '\0png' } }
  git.commits.n0 = { ...git.worktrees[0].files }
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git)['notes.txt'] = 'n1\nN2\nn3\nn4\n'
    return { result: EDIT_RESULT }
  })
  const ran = await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(ran.text).toBe(`File map of ${ROOT}: 0 files.`)
  expect(seen.state.map?.files).toEqual([])
  await $.tool.call({ tool: 'Read', file_path: 'C:\\work\\repo\\notes.txt' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\work\\repo\\notes.txt', old_string: 'n2', new_string: 'N2' })
  await seen.clock.settle()
  const ui = await mountPane($)
  const props = await mapOf(ui)
  const rows = mapRowsOf(props)
  expect(headerOf(props)).toBe('repo  now: top level  1 changed, 0 read')
  expect(rows).toHaveLength(27)
  expect(rows[0]?.trimEnd()).toBe('No file of a mapped type in this repository.')
  expect(rows.slice(1).join('').trim()).toBe('')
  expect(props.tiles).toEqual([])
  expect((await listRowOf(ui, 'notes.txt')).text).toBe(`   notes.txt${' '.repeat(47)}+1 -1`)
  expect((await ui.find({ type: 'Box', key: 'list' }))?.children).toHaveLength(1)
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text)).toContain('files    read     changed     last 5 min')
  expect((await listRowOf(ui, 'notes.txt')).swatch).toBe(hex(FILLS.light.now))
  await ui.unmount()
})

type Due = { ms: number; run: () => void }

async function runDue(timers: Due[]): Promise<void> {
  for (let i = 0; i < 10 && timers.some(one => one.ms === 0); i++) {
    const due = timers.filter(one => one.ms === 0)
    timers.splice(0, timers.length, ...timers.filter(one => one.ms !== 0))
    for (const one of due) one.run()
    for (let k = 0; k < 200; k++) await Promise.resolve()
  }
}

test('a fresh module, as a reload starts one, arms the redraw for the end of the five minutes of a change that the older module stored: at the next turn, and at session.start', async () => {
  const hooks = hooksOfRegister()
  const hookOf = (event: string) => hooks.find(one => one.event === event)?.hook as (...args: unknown[]) => Promise<unknown>
  const stored: Record<string, unknown> = {
    map: { root: ROOT, repo: 'repo', commonDir: COMMON, files: [], version: 1 },
    session: { ...EMPTY, changedAt: { [KEY_A]: 1_000 } },
  }
  const timers: Due[] = []
  const invalidated: string[] = []
  const engine = {
    command: { register: async () => ({ command: PLUGIN }) },
    state: {
      get: async (ref: { key: string }) => ({ value: ref.key in stored ? { shape: STATE_SHAPE, value: stored[ref.key] } : undefined, version: 1 }),
      set: async (ref: { key: string }, written: { value: unknown }) => {
        stored[ref.key] = written.value
        return { isSet: true, version: 2 }
      },
    },
    clock: {
      now: async () => 2_000,
      after: (ms: number, run: () => void) => {
        timers.push({ ms, run })
        return { cancel: () => {} }
      },
    },
    session: { root: async () => ROOT },
    env: { get: async (name: string) => (name === 'OS' ? 'Windows_NT' : undefined) },
    ui: { invalidate: (event: string) => invalidated.push(event), log: () => {} },
  }
  await hookOf('turn.start')(engine, { text: 'go', turnId: 't1' }, async (passed: unknown) => passed)
  await runDue(timers)
  expect(timers.map(one => one.ms)).toEqual([WINDOW_MS - 1_000])
  timers.splice(0)[0]?.run()
  expect(invalidated).toEqual(['ui.render'])
  timers.length = 0
  await hookOf('session.start')(engine, { cwd: CWD }, async (passed: unknown) => passed)
  expect(stored.epoch).toBe(1)
  await runDue(timers)
  expect(timers.map(one => one.ms)).toEqual([WINDOW_MS - 1_000])
})

test('the hook on the close of the pane by the person stores the pause, after the close has gone through', async () => {
  const closes = hooksOfRegister().filter(one => one.event === 'ui.close')
  expect(closes.map(one => one.matcher)).toEqual([{ id: PLUGIN, origin: { kind: 'person' } }])
  const close = closes[0]?.hook as (...args: unknown[]) => Promise<unknown>
  const e = { id: PLUGIN, origin: { kind: 'person' } }
  const sets: unknown[] = []
  const logged: string[] = []
  let refuses = false
  const engine = {
    state: {
      set: async (...args: unknown[]) => {
        sets.push(args)
        if (refuses) throw new Error('the host is gone')
        return { isSet: true, version: 1 }
      },
    },
    ui: { log: (text: string) => logged.push(text) },
  }
  const order: string[] = []
  const closed = await close(engine, e, async (passed: unknown) => {
    order.push(`next ${JSON.stringify(passed)} after ${sets.length} writes`)
    return { value: undefined }
  })
  expect(closed).toEqual({ value: undefined })
  expect(order).toEqual([`next ${JSON.stringify(e)} after 0 writes`])
  expect(sets).toEqual([[PAUSED, { shape: STATE_SHAPE, value: true }]])
  expect(await close(engine, e, async () => ({ deny: 'the pane stays' }))).toEqual({ deny: 'the pane stays' })
  expect(sets).toHaveLength(1)
  refuses = true
  expect(await close(engine, e, async () => ({ value: undefined }))).toEqual({ value: undefined })
  expect(logged).toEqual(['Pausing the git work failed: the host is gone'])
})

test('while the person has the pane closed no git command runs and the reads and writes are noted, until the command runs again', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false } }))
  on('tool.call', (_, e) => {
    if (e.tool === 'Write') filesOf(git)['src/c.ts'] = 'c1\n'
    return {
      result: e.tool === 'Grep' ? { mode: 'files_with_matches', numFiles: 1, filenames: ['repo/src/b.ts'] } : isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT,
    }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(seen.state.isGitPaused).toBe(false)
  await seen.clock.settle()
  seen.kept.as = closedByPerson
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  seen.kept.as = (_, written) => written
  await seen.clock.settle()
  const gitCalls = seen.runs.length
  filesOf(git)['src/a.ts'] = `${A0}a11\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await $.tool.call({ tool: 'PowerShell', command: 'npm run format' })
  await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: FILE_C, content: 'c1\n' })
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: 'C:\\work\\repo\\n.ipynb', new_source: 'x' })
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  await $.tool.call({ tool: 'Grep', pattern: 'layout', path: FILE_A })
  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.turn.complete(TURN)
  await seen.clock.advance(60_000)
  expect(seen.runs).toHaveLength(gitCalls)
  expect(seen.state.isStale).toBe(true)
  expect(seen.state.map?.version).toBe(2)
  expect(seen.state.session?.reads).toEqual({ [KEY_A]: 1, [KEY_B]: 2 })
  expect(Object.keys(seen.state.session?.changedAt ?? {}).sort()).toEqual([KEY_A, KEY_C, 'c:/work/repo/n.ipynb'].sort())
  seen.calls.length = 0
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  expect(seen.calls).toEqual(['session.cwd'])
  await seen.clock.settle()
  expect(seen.calls).toEqual(['session.cwd', 'state.get isGitPaused'])
  await $.command.run({ command: PLUGIN, args: '', ...TYPED })
  expect(seen.state.isGitPaused).toBe(false)
  expect(seen.state.map?.files).toHaveLength(3)
  const listed = seen.runs.length
  filesOf(git)['src/b.ts'] = `${B0}b4\n`
  await $.tool.call({ tool: 'Bash', command: 'npm run format' })
  await seen.clock.settle()
  expect(seen.gitCalls().slice(listed)).toEqual(['status', 'read-tree', 'update-index', 'write-tree', 'diff-tree'])
  expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -0' })
  expect(seen.logged).toEqual([])
})

test(
  'a pane that a plugin closes keeps the git work going',
  {
    plugins: [
      {
        name: 'closer',
        tier: 'builtin',
        register(on) {
          on('command.run', { command: 'close-filemap' }, async $ => {
            await $.ui.close({ id: 'filemap' })
            return { text: 'closed' }
          })
        },
      },
    ],
  },
  async ($, on) => {
    const git = repo()
    const seen = world(on, git)
    const closed: unknown[] = []
    on('ui.close', (_, e) => {
      closed.push(e)
      return { value: undefined }
    })
    on('tool.call', () => ({ result: SHELL_RESULT }))
    await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
    await $.command.run({ command: 'close-filemap', args: '', ...TYPED })
    expect(closed).toEqual([{ id: PLUGIN, origin: { kind: 'plugin' } }])
    expect(seen.state.isGitPaused).toBe(false)
    filesOf(git)['src/b.ts'] = `${B0}b4\n`
    await $.tool.call({ tool: 'Bash', command: 'npm run format' })
    await seen.clock.settle()
    expect(seen.counted()).toEqual({ 'src/b.ts': '+1 -0' })
  },
)

test('the pane draws in the theme that the command read and that a change of the theme row sets, with no host call for the theme per drawing', async ($, on) => {
  const git = { ...repo(), theme: 'light-ansi' }
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(seen.state.theme).toBe('light')
  expect(seen.calls.filter(call => call === 'config.list')).toHaveLength(1)
  const ui = await mountPane($)
  const drawn = async () => mapColours(await mapOf(ui))
  expect((await drawn()).has(hex(FILLS.light.neutral))).toBe(true)
  expect((await drawn()).has(hex(FILLS.dark.neutral))).toBe(false)
  expect(await $.config.set(themeRow('dark', 'light-ansi'))).toEqual({ value: 'dark' })
  expect(seen.state.theme).toBe('dark')
  await ui.redraw()
  expect((await drawn()).has(hex(FILLS.dark.neutral))).toBe(true)
  expect((await drawn()).has(hex(FILLS.light.neutral))).toBe(false)
  await $.config.set(themeRow('light', 'dark'))
  expect(seen.state.theme).toBe('light')
  await $.config.set(themeRow('auto', 'light'))
  expect(seen.state.theme).toBe('dark')
  git.keepsTheme = 'the theme stays'
  expect(await $.config.set(themeRow('light', 'auto'))).toEqual({ deny: 'the theme stays' })
  expect(seen.state.theme).toBe('dark')
  await ui.redraw()
  expect(seen.calls.filter(call => call === 'config.list')).toHaveLength(1)
  expect(seen.calls.filter(call => call === 'state.get theme').length).toBeGreaterThanOrEqual(3)
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a theme row that changes with no config.set is drawn from the start of the next turn', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const rowReads = () => seen.calls.filter(call => call === 'config.list').length
  const themeWrites = () => seen.calls.filter(call => call === 'state.set theme').length
  expect(await $.turn.start({ text: 'go', turnId: 't0' })).toEqual({ turnId: 't0' })
  await seen.clock.settle()
  expect(rowReads()).toBe(0)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(seen.state.theme).toBe('light')
  const ui = await mountPane($)
  const drawn = async () => mapColours(await mapOf(ui))
  git.theme = 'dark'
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(rowReads()).toBe(1)
  await seen.clock.settle()
  expect(rowReads()).toBe(2)
  expect(seen.state.theme).toBe('dark')
  await ui.redraw()
  expect((await drawn()).has(hex(FILLS.dark.neutral))).toBe(true)
  expect((await drawn()).has(hex(FILLS.light.neutral))).toBe(false)
  const written = themeWrites()
  await $.turn.start({ text: 'go', turnId: 't2' })
  await seen.clock.settle()
  expect(rowReads()).toBe(3)
  expect(themeWrites()).toBe(written)
  seen.kept.as = closedByPerson
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  seen.kept.as = (_, stored) => stored
  const whileClosed = rowReads()
  git.theme = 'light'
  await $.turn.start({ text: 'go', turnId: 't3' })
  await seen.clock.settle()
  expect(rowReads()).toBe(whileClosed)
  expect(seen.state.theme).toBe('dark')
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(seen.state.theme).toBe('light')
  expect(seen.logged).toEqual([])
  git.rowsFail = 'the settings are being written'
  git.theme = 'dark'
  await $.turn.start({ text: 'go', turnId: 't4' })
  await seen.clock.settle()
  expect(seen.state.theme).toBe('light')
  expect(seen.logged).toEqual(['Reading the theme failed: filemap: $.config.list: the settings are being written'])
  expect(seen.toasts).toEqual([])
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  expect(seen.state.theme).toBe('dark')
  expect(seen.logged).toHaveLength(2)
  expect(seen.logged[1]).toBe(seen.logged[0])
  await ui.unmount()
})

test('a call that the hooks beneath reject reaches the caller with that rejection, and is noted nowhere', async ($, on) => {
  const seen = world(on, repo())
  let breaks = false
  on('tool.call', (_, e) => {
    if (breaks) throw new Error('the tool blew up')
    return { result: isShellTool(e.tool) ? SHELL_RESULT : EDIT_RESULT }
  })
  const outcome = (call: Promise<unknown>) =>
    call.then(
      () => 'resolved',
      error => `rejected: ${String(error)}`,
    )
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  breaks = true
  const untouched = await outcome($.tool.call({ tool: 'Glob', pattern: '**/*.ts' }))
  expect(untouched).toMatch(/^rejected: /)
  const edited = await outcome($.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a', new_string: 'b' }))
  expect(edited).toBe(untouched)
  expect(seen.state.session?.reads).toEqual({ [KEY_B]: 1 })
  expect(seen.state.session?.changedAt).toEqual({})
  expect(seen.logged).toEqual([])
})

test('a call that names no file and is denied, fails or is rejected reads and writes no state', async ($, on) => {
  const seen = world(on, repo())
  let answer: { deny: string } | { isError: true; result: string } | undefined
  on('tool.call', () => {
    if (answer === undefined) throw new Error('the tool blew up')
    return answer
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  seen.calls.length = 0
  for (const given of [{ deny: 'not allowed' }, { isError: true as const, result: 'no such file' }, undefined]) {
    answer = given
    await $.tool.call({ tool: 'Glob', pattern: '**/*.ts' }).catch(() => undefined)
    await $.tool.call({ tool: 'TodoWrite', todos: [] }).catch(() => undefined)
    await $.tool.call({ tool: 'Grep', pattern: 'layout' }).catch(() => undefined)
  }
  expect(seen.calls).toEqual([])
  expect(seen.state.session).toBeUndefined()
  expect(seen.logged).toEqual([])
})

test('hover names the file or folder under the pointer with its status, leave clears the row, and no hook of the mod runs for it', async ($, on) => {
  const git = withFolders()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git)['src/a.ts'] = A0.replace('a3\n', 'A3\nA3b\n')
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a3', new_string: 'A3\nA3b' })
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  await seen.clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, { surface })
    const props = await mapOf(ui)
    expect(await hoverRow(ui)).toBe(' ')
    const calls = seen.calls.length
    const runs = seen.runs.length
    await ui.pointer({ type: 'move', ...cellOf(props, 'src/a.ts') })
    expect(await hoverRow(ui)).toBe('src/a.ts  +2 -1')
    await ui.pointer({ type: 'move', ...cellOf(props, 'src/b.ts') })
    expect(await hoverRow(ui)).toBe('src/b.ts  read')
    await ui.pointer({ type: 'move', ...cellOf(props, 'src/lib/c.ts') })
    expect(await hoverRow(ui)).toBe('src/lib/c.ts')
    await ui.pointer({ type: 'move', ...cellOf(props, 'src') })
    expect(await hoverRow(ui)).toBe('src/  3 files, 1 changed, 1 read')
    await ui.pointer({ type: 'move', x: 1, y: 0 })
    expect(await hoverRow(ui)).toBe(' ')
    await ui.pointer({ type: 'move', ...cellOf(props, 'src/a.ts') })
    await ui.pointer({ type: 'leave', x: 3, y: 3 })
    expect(await hoverRow(ui)).toBe(' ')
    expect(seen.calls).toHaveLength(calls)
    expect(seen.runs).toHaveLength(runs)
    await ui.unmount()
  }
  expect(seen.logged).toEqual([])
})

test('Windows: a double click on a file opens it in its default app: PowerShell Invoke-Item gets the path with backslashes in an environment variable, once the file is found on disk', async ($, on) => {
  const seen = world(on, withFolders())
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  await doubleClick(ui, cellOf(await mapOf(ui), 'src/lib/c.ts'))
  expect(seen.exists).toEqual(['C:/work/repo/src/lib/c.ts'])
  expect(seen.opens).toEqual([{ argv: DEFAULT_APP_ON_WINDOWS, env: { FILEMAP_OPEN: 'C:\\work\\repo\\src\\lib\\c.ts' }, timeoutMs: OPEN_MS }])
  expect(seen.toasts).toEqual([])
  expect(seen.state.zoom).toBeUndefined()
  expect((await mapOf(ui)).top).toBe('repo')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('Windows: a double click on a file of a repository on a network location, as a UNC path, opens it, although the engine looks up no file there, and an opener that finds no file gives a toast', async ($, on) => {
  const git = repo()
  const share = '//server/share/repo'
  git.worktrees = [{ root: share, commonDir: `${share}/.git`, head: 'c0', files: { 'src/a.ts': A0, 'src/b.ts': B0 } }]
  git.network = '//server/share'
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: '\\\\server\\share\\repo', ...TYPED })
  expect(seen.state.map?.root).toBe(share)
  const ui = await mountPane($)
  const at = cellOf(await mapOf(ui), 'src/a.ts')
  await doubleClick(ui, at)
  expect(seen.opens).toEqual([{ argv: DEFAULT_APP_ON_WINDOWS, env: { FILEMAP_OPEN: '\\\\server\\share\\repo\\src\\a.ts' }, timeoutMs: OPEN_MS }])
  expect(seen.toasts).toEqual([])
  git.opener = { exitCode: 1, stderr: 'Invoke-Item : Cannot find path because it does not exist.\r\n' }
  await doubleClick(ui, at)
  expect(seen.toasts).toEqual(['Could not open src/a.ts with its default app: exit code 1: Invoke-Item : Cannot find path because it does not exist.'])
  expect(seen.logged.filter(line => line.startsWith('Answering a click'))).toEqual([])
  await ui.unmount()
})

test('a single click on a file shows it in the row under the map and keeps it there until the pointer moves to another tile, and opens nothing', async ($, on) => {
  const seen = world(on, withFolders())
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, { surface })
    const props = await mapOf(ui)
    await click(ui, cellOf(props, 'src/b.ts'))
    expect(await hoverRow(ui)).toBe('src/b.ts  read')
    await ui.pointer({ type: 'leave', x: 0, y: 0 })
    expect(await hoverRow(ui)).toBe('src/b.ts  read')
    await ui.pointer({ type: 'move', ...(cellsOf(props, -1)[0] ?? { x: 0, y: 1 }) })
    expect(await hoverRow(ui)).toBe('src/b.ts  read')
    await ui.pointer({ type: 'move', ...cellOf(props, 'src/b.ts') })
    await ui.pointer({ type: 'leave', x: 0, y: 0 })
    expect(await hoverRow(ui)).toBe('src/b.ts  read')
    await ui.pointer({ type: 'move', ...cellOf(props, 'src/a.ts') })
    expect(await hoverRow(ui)).toBe('src/a.ts')
    await ui.pointer({ type: 'leave', x: 0, y: 0 })
    expect(await hoverRow(ui)).toBe(' ')
    await ui.unmount()
    await seen.clock.advance(DOUBLE_MS)
  }
  expect(seen.opens).toEqual([])
  expect(seen.exists).toEqual([])
  expect(seen.logged).toEqual([])
})

test('a double click opens a file once: two clicks on it within 450 ms open it, a third opens nothing more, and clicks 450 ms apart or on two files open nothing', async ($, on) => {
  const seen = world(on, withFolders())
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const props = await mapOf(ui)
  const a = cellOf(props, 'src/a.ts')
  await click(ui, a)
  await seen.clock.advance(DOUBLE_MS - 1)
  await click(ui, a)
  expect(openedOf(seen.opens)).toEqual(['C:\\work\\repo\\src\\a.ts'])
  await click(ui, a)
  await seen.clock.advance(DOUBLE_MS)
  await click(ui, a)
  await click(ui, cellOf(props, 'src/b.ts'))
  await click(ui, a)
  expect(seen.opens).toHaveLength(1)
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a press and a release on one cell open nothing when a redraw between them put another file under it: a click is known by the path of its tile', async ($, on) => {
  const git = repo()
  const seen = world(on, git)
  const relist = async (ui: Ui, lines: number) => {
    filesOf(git)['src/b.ts'] = numbered('b', lines)
    await ui.press({ key: 'refresh' })
    await seen.clock.settle()
  }
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const before = await mapOf(ui)
  await relist(ui, 40)
  const after = await mapOf(ui)
  await relist(ui, 3)
  expect((await mapOf(ui)).owners).toEqual(before.owners)
  const wasB = cellsOf(before, before.tiles.findIndex(tile => tile.path === 'src/b.ts'))
  const isA = cellsOf(after, after.tiles.findIndex(tile => tile.path === 'src/a.ts'))
  const cell = wasB.find(one => isA.some(other => other.x === one.x && other.y === one.y))
  if (cell === undefined) throw new Error('no cell of src/b.ts that src/a.ts takes after the redraw')
  await ui.pointer({ type: 'move', ...cell })
  await ui.pointer({ type: 'down', ...cell, button: 'left' })
  await relist(ui, 40)
  expect(await hoverRow(ui)).toBe('src/a.ts')
  await ui.pointer({ type: 'up', ...cell, button: 'left' })
  await click(ui, cell)
  expect(seen.opens).toEqual([])
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a click on a folder shows that folder; the header and the list keep the whole repository; up and the top row show the folder around it', async ($, on) => {
  const git = withFolders()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git)['README.md'] = `${numbered('r', 6)}r7\n`
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\work\\repo\\README.md', old_string: 'r6', new_string: 'r6\nr7' })
  await seen.clock.settle()
  const ui = await mountPane($)
  const whole = await mapOf(ui)
  const rows = await buttonsOf(ui)
  expect(headerOf(whole)).toBe('repo  now: src, top level  1 changed, 1 read')
  expect(rows).toEqual(['open:README.md', 'open:src/b.ts', 'refresh'])
  await click(ui, cellOf(whole, 'src'))
  expect(seen.state.zoom).toBe('src')
  const src = await mapOf(ui)
  expect(src.top).toBe('repo/src')
  expect(src.summary).toBe(whole.summary)
  expect(src.tiles.map(tile => tile.path).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/lib', 'src/lib/c.ts'])
  expect(src.upHint).toBe('Click to show repo again.')
  const top = (await ui.findAll({ in: 'map', type: 'Text' }))[0]
  expect(top?.text).toBe('repo/src  now: src, top level  1 changed, 1 read')
  expect(top?.children[0]).toMatchObject({ type: 'Text', props: { underline: true } })
  expect(await buttonsOf(ui)).toEqual([...rows, 'up'])
  await click(ui, cellOf(src, 'src/lib'))
  expect(seen.state.zoom).toBe('src/lib')
  expect((await mapOf(ui)).upHint).toBe('Click to show src again.')
  await ui.press({ key: 'up' })
  expect(seen.state.zoom).toBe('src')
  await ui.pointer({ type: 'move', x: 2, y: 0 })
  expect(await hoverRow(ui)).toBe('Click to show repo again.')
  await click(ui, { x: 2, y: 0 })
  expect(seen.state.zoom).toBe('')
  expect((await mapOf(ui)).top).toBe('repo')
  expect(JSON.stringify((await ui.findAll({ in: 'map', type: 'Text' }))[0])).not.toContain('underline')
  expect(await buttonsOf(ui)).toEqual(rows)
  expect(seen.opens).toEqual([])
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a click on a folder drawn as one box shows that folder with its files', async ($, on) => {
  const git = repo()
  git.list = Array.from({ length: 360 }, (_, i) => `mod-${Math.floor(i / 30)}/part-${i % 30}.ts\u000020\n`).join('')
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const whole = await mapOf(ui)
  expect(whole.tiles.find(tile => tile.path === 'mod-0')?.hover).toBe('mod-0/  30 files')
  expect(whole.tiles.some(tile => tile.path.startsWith('mod-0/'))).toBe(false)
  await click(ui, cellOf(whole, 'mod-0'))
  expect(seen.state.zoom).toBe('mod-0')
  expect((await mapOf(ui)).tiles.map(tile => tile.path).filter(path => path.startsWith('mod-0/part-'))).toHaveLength(30)
  expect(seen.opens).toEqual([])
  await ui.unmount()
})

test('the map shows the whole repository again when /filemap loads another repository, and when its folder leaves the file list', async ($, on) => {
  const git = withFolders()
  git.commits.o1 = { 'src/x.ts': 'x\n', 'tools/y.ts': 'y\n' }
  git.worktrees.push({ root: OTHER, commonDir: `${OTHER}/.git`, head: 'o1', files: { ...git.commits.o1 } })
  const seen = world(on, git)
  on('tool.call', () => ({ result: SHELL_RESULT }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  await click(ui, cellOf(await mapOf(ui), 'src'))
  expect(seen.state.zoom).toBe('src')
  await $.command.run({ command: PLUGIN, args: '', ...TYPED })
  expect(seen.state.zoom).toBe('src')
  expect((await mapOf(ui)).top).toBe('repo/src')
  await $.command.run({ command: PLUGIN, args: OTHER, ...TYPED })
  expect(seen.state.zoom).toBe('')
  expect((await mapOf(ui)).top).toBe('other')
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await click(ui, cellOf(await mapOf(ui), 'src'))
  await click(ui, cellOf(await mapOf(ui), 'src/lib'))
  expect(seen.state.zoom).toBe('src/lib')
  delete filesOf(git)['src/lib/c.ts']
  await $.tool.call({ tool: 'Bash', command: 'rm -r src/lib' })
  await seen.clock.settle()
  expect(seen.state.zoom).toBe('')
  expect((await mapOf(ui)).top).toBe('repo')
  expect(await buttonsOf(ui)).not.toContain('up')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('the pane that follows the session into another worktree keeps the folder it shows, which that worktree has too', async ($, on) => {
  const git = { ...withFeature(), sessionRoot: 'C:\\work\\repo' }
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'EnterWorktree') git.sessionRoot = 'C:\\work\\repo-feature'
    return { result: { worktreePath: FEATURE, message: 'entered' } }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  await click(ui, cellOf(await mapOf(ui), 'src'))
  await $.tool.call({ tool: 'EnterWorktree', path: 'C:\\work\\repo-feature' })
  await seen.clock.settle()
  expect(seen.state.map?.root).toBe(FEATURE)
  expect(seen.state.zoom).toBe('src')
  expect((await mapOf(ui)).top).toBe('repo-feature/src')
  expect((await mapOf(ui)).tiles.map(tile => tile.path)).toContain('src/c.ts')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a stored folder that has no file in the list draws the whole repository, and up clears it', async ($, on) => {
  const seen = world(on, withFolders())
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  seen.kept.as = (key, written) => (key === 'zoom' ? { shape: STATE_SHAPE, value: 'gone' } : written)
  await click(ui, cellOf(await mapOf(ui), 'src'))
  seen.kept.as = (_, written) => written
  expect((await mapOf(ui)).top).toBe('repo')
  expect((await mapOf(ui)).upHint).toBe('')
  expect(await buttonsOf(ui)).not.toContain('up')
  await ui.post({ kind: 'up' })
  expect(seen.state.zoom).toBe('')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a press on a row of the list opens its file; the rows are Buttons of the pane, which its focus walks, and none is in the map', async ($, on) => {
  const git = withFolders()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git)['src/a.ts'] = `${A0}a11\n`
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a10', new_string: 'a10\na11' })
  await seen.clock.settle()
  const ui = await mountPane($)
  expect(await buttonsOf(ui)).toEqual(['open:src/a.ts', 'open:src/b.ts', 'refresh'])
  const row = await ui.find({ type: 'Button', key: 'open:src/a.ts' })
  expect(row?.props).toMatchObject({ label: 'src/a.ts', plain: true, dimColor: true })
  expect(row?.props.hotkey).toBeUndefined()
  expect(await listRowOf(ui, 'src/a.ts')).toEqual({ text: `   src/a.ts${' '.repeat(48)}+1 -0`, swatch: hex(FILLS.light.now) })
  expect(await ui.find({ in: 'map', type: 'Button' })).toBeUndefined()
  await ui.press({ key: 'open:src/b.ts' })
  expect(seen.opens).toEqual([{ argv: DEFAULT_APP_ON_WINDOWS, env: { FILEMAP_OPEN: 'C:\\work\\repo\\src\\b.ts' }, timeoutMs: OPEN_MS }])
  await ui.press({ key: 'open:src/a.ts' })
  expect(openedOf(seen.opens)).toEqual(['C:\\work\\repo\\src\\b.ts', 'C:\\work\\repo\\src\\a.ts'])
  expect(seen.toasts).toEqual([])
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

const RUNS_AS_TEXT = ['build.cmd', 'tool.bat', 'tools/.cmd', 'web/app.js', 'tools/run.py', "tools/run&calc&%USERNAME% 'q'.py", 'scripts/setup.sh', 'build.ps1', 'tools/build.au3', 'tools/app.pyw', 'src/Module/Module.psd1', 'deploy.vbs', 'fix.reg', 'script.tcl']
const REFUSED = ['setup.exe', 'run.vbe', 'install.msi', 'Tool.LNK', 'dist/tool.pyz', 'dist/tool.a3x', 'updates/kb.msu', 'addin/calc.xll']
const SHOWN = ['notes.txt', 'src/a.ts', 'web/app.mjs', 'docs/guide.md']
const AS_TEXT_CALL = "[FilemapText]::Open($env:FILEMAP_OPEN, '.txt')"

for (const program of ['', 'code']) {
  test(`Windows: ${program === '' ? 'a row of a text type that Windows runs, as .cmd, .bat, .js, .py, .pyw, .ps1, .psd1, .sh, .vbs, .reg or a .tcl that PATHEXT names, opens in the app of .txt files, and a row of another type that Windows runs, as .exe, .msi, .lnk, an encoded .vbe or a compiled .a3x, opens nothing and gives a short toast that names the setting' : 'a row of a type that Windows runs opens in the program of the setting'}, and a type that Windows shows opens in its default app`, { options: { opener: program } }, async ($, on) => {
    const git = { ...repo(), env: { TEMP, PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.TCL' } }
    const all = [...RUNS_AS_TEXT, ...REFUSED, ...SHOWN]
    for (const path of all) filesOf(git)[path] = 'x\n'
    const seen = world(on, git)
    on('tool.call', () => ({ result: EDIT_RESULT }))
    await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
    for (const path of all) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/${path}` })
    const ui = await mountPane($, { bodyRows: 200 })
    for (const path of all) await ui.press({ key: `open:${path}` })
    await ui.unmount()
    const how = (one: { argv: readonly string[]; env?: Record<string, string> }) =>
      one.env?.FILEMAP_PROGRAM !== undefined ? 'program' : one.argv.at(-1) === DEFAULT_APP_ON_WINDOWS.at(-1) ? 'default app' : one.argv.at(-1)?.includes(AS_TEXT_CALL) ? 'text' : 'other'
    const windowsPath = (path: string) => `C:\\work\\repo\\${path.replace(/\//g, '\\')}`
    expect(seen.opens.map(one => [one.env?.FILEMAP_OPEN, how(one)])).toEqual(
      program === '' ? [...RUNS_AS_TEXT.map(path => [windowsPath(path), 'text']), ...SHOWN.map(path => [windowsPath(path), 'default app'])] : all.map(path => [windowsPath(path), 'program']),
    )
    expect(seen.opens.every(one => one.argv.slice(0, POWERSHELL.length).join(' ') === POWERSHELL.join(' ') && !one.argv.some(arg => arg.includes('run&calc')))).toBe(true)
    expect(seen.toasts).toEqual(program === '' ? REFUSED.map(path => `${path} was not opened: Windows would run it. See "Open files with" in /config.`) : [])
    expect(seen.logged).toEqual([])
  })
}

test('Windows: a text opener that fails gives a toast that names the default text editor and what Windows answered', async ($, on) => {
  const git = { ...repo(), opener: { exitCode: 1, stderr: 'The system cannot find the file specified.\r\n' } }
  filesOf(git)['tools/run.py'] = 'x\n'
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/tools/run.py` })
  const ui = await mountPane($)
  await ui.press({ key: 'open:tools/run.py' })
  await ui.unmount()
  expect(seen.opens.map(one => one.argv.at(-1)?.includes(AS_TEXT_CALL))).toEqual([true])
  expect(seen.toasts).toEqual(['Could not open tools/run.py with the default text editor: exit code 1: The system cannot find the file specified.'])
})

test('Windows: a toast about opening a file holds 200 characters at most and stays 50 ms for each of them, and 4 seconds at least, so that a long path or a long error can be read in full', async ($, on) => {
  const long = 'src/Modules/ExampleModule.Automation/ExampleModule.Automation.exe'
  const paths = [long, 'tools/run.py', 'x.exe']
  const error = 'The text editor could not start. '.repeat(10).trim()
  const git = { ...repo(), opener: { exitCode: 1, stderr: `${error}\r\n` } }
  for (const path of paths) filesOf(git)[path] = 'x\n'
  const seen = world(on, git)
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  for (const path of paths) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/${path}` })
  const ui = await mountPane($)
  for (const path of paths) await ui.press({ key: `open:${path}` })
  await ui.unmount()
  expect(seen.toasts).toEqual([
    `${long} was not opened: Windows would run it. See "Open files with" in /config.`,
    `Could not open tools/run.py with the default text editor: exit code 1: ${error}`.slice(0, 200),
    'x.exe was not opened: Windows would run it. See "Open files with" in /config.',
  ])
  expect(seen.toasts.map(text => text.length)).toEqual([137, 200, 77])
  expect(seen.toastMs).toEqual([6_850, 10_000, 4_000])
})

const AS_TEXT_ON_MAC = ['tools/run.py', "tools/run b&c $(x) 'y'.py", 'tools/app.pyw', 'run.command', 'bin/x.tool']
const REFUSED_ON_MAC = ['Basic.terminal', 'setup.pkg', 'site.webloc', 'gradlew', 'tools/configure']
const SHOWN_ON_MAC = ['scripts/setup.sh', 'src/a.ts', 'build.cmd', 'LICENSE']

for (const program of ['', 'code']) {
  test(`macOS: ${program === '' ? 'a row of a text type that macOS runs, as a .py file that Python Launcher runs or a .command or .tool file that Terminal runs, opens with open -t in the default text editor, and a row of another type that macOS runs, as a .terminal, .pkg or .webloc file or an executable file with no extension, opens nothing and gives a short toast that names the setting' : 'a row of a type that macOS runs opens in the program of the setting'}, and a type that macOS shows opens, as a file with no extension that is not executable`, { options: { opener: program } }, async ($, on) => {
    const all = [...AS_TEXT_ON_MAC, ...REFUSED_ON_MAC, ...SHOWN_ON_MAC]
    const git = { ...onLinux(Object.fromEntries(all.map(path => [path, 'x\n']))), os: 'darwin' as const, executables: [`${LINUX_ROOT}/gradlew`, `${LINUX_ROOT}/tools/configure`, `${LINUX_ROOT}/scripts/setup.sh`] }
    const seen = world(on, git, () => LINUX_HOME)
    on('tool.call', () => ({ result: EDIT_RESULT }))
    await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
    for (const path of all) await $.tool.call({ tool: 'Read', file_path: `${LINUX_ROOT}/${path}` })
    const ui = await mountPane($, { bodyRows: 80 })
    for (const path of all) await ui.press({ key: `open:${path}` })
    await ui.unmount()
    const full = (path: string) => `${LINUX_ROOT}/${path}`
    expect(seen.opens.map(one => one.argv)).toEqual(
      program === '' ? [...AS_TEXT_ON_MAC.map(path => ['open', '-t', full(path)]), ...SHOWN_ON_MAC.map(path => ['open', full(path)])] : all.map(path => ['sh', '-c', PROGRAM_ON_MAC, 'sh', 'code', full(path)]),
    )
    expect(seen.toasts).toEqual(program === '' ? REFUSED_ON_MAC.map(path => `${path} was not opened: macOS would run it. See "Open files with" in /config.`) : [])
    expect(seen.logged).toEqual([])
  })
}

const AS_TEXT_ON_LINUX_ROWS = ['scripts/setup.sh', 'tools/run.py', 'apps/x.desktop']
const REFUSED_ON_LINUX = ['gradlew', 'build/app.bin', 'tool.jar', 'pkg.deb']
const SHOWN_ON_LINUX = ['src/a.ts', 'docs/guide.md', 'tools/other.py']

for (const program of ['', 'code']) {
  test(`Linux: ${program === '' ? 'a text file with the execute bit, as a .sh or .py script, and a .desktop launcher open in the app that xdg-mime names for text/plain, and another file with the execute bit, as gradlew or a built binary, or a type that a desktop runs or installs, as .jar or .deb, opens nothing and gives a short toast that names the setting' : 'a row of a type that Linux runs opens in the program of the setting'}, and a file without the execute bit opens in the default app of its type`, { options: { opener: program } }, async ($, on) => {
    const all = [...AS_TEXT_ON_LINUX_ROWS, ...REFUSED_ON_LINUX, ...SHOWN_ON_LINUX]
    const git = { ...onLinux(Object.fromEntries(all.map(path => [path, 'x\n']))), executables: ['scripts/setup.sh', 'tools/run.py', 'gradlew', 'build/app.bin'].map(path => `${LINUX_ROOT}/${path}`) }
    const seen = world(on, git, () => LINUX_HOME)
    on('tool.call', () => ({ result: EDIT_RESULT }))
    await $.command.run({ command: PLUGIN, args: LINUX_ROOT, ...TYPED })
    for (const path of all) await $.tool.call({ tool: 'Read', file_path: `${LINUX_ROOT}/${path}` })
    const ui = await mountPane($, { bodyRows: 80 })
    for (const path of all) await ui.press({ key: `open:${path}` })
    await ui.unmount()
    const full = (path: string) => `${LINUX_ROOT}/${path}`
    const how = (argv: readonly string[]) => (argv[0] === 'setsid' ? 'default app' : argv[2]?.startsWith(AS_TEXT_ON_LINUX_START) ? 'text' : argv[2] === PROGRAM_ON_LINUX ? 'program' : 'other')
    expect(seen.opens.map(one => [how(one.argv), one.argv.at(-1)])).toEqual(
      program === '' ? [...AS_TEXT_ON_LINUX_ROWS.map(path => ['text', full(path)]), ...SHOWN_ON_LINUX.map(path => ['default app', full(path)])] : all.map(path => ['program', full(path)]),
    )
    expect(seen.toasts).toEqual(program === '' ? REFUSED_ON_LINUX.map(path => `${path} was not opened: Linux would run it. See "Open files with" in /config.`) : [])
    expect(seen.logged).toEqual([])
  })
}

test('a pointer outside every tile, a press that ends on another tile, and a right click open nothing and zoom nowhere', async ($, on) => {
  const seen = world(on, withFolders())
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const props = await mapOf(ui)
  const gap = cellsOf(props, -1)[0]
  expect(gap).toBeDefined()
  for (const at of [gap as { x: number; y: number }, { x: 2, y: 0 }, { x: 2, y: props.rows.length + 1 }, { x: 500, y: 3 }, { x: -4, y: 3 }, { x: 3, y: -1 }]) {
    await click(ui, at)
    expect(await hoverRow(ui)).toBe(' ')
  }
  const one = cellOf(props, 'src/a.ts')
  const other = cellOf(props, 'src/b.ts')
  await ui.pointer({ type: 'down', ...one, button: 'left' })
  await ui.pointer({ type: 'move', ...other, button: 'left' })
  await ui.pointer({ type: 'up', ...other, button: 'left' })
  await ui.pointer({ type: 'down', ...one, button: 'right' })
  await ui.pointer({ type: 'up', ...one, button: 'right' })
  await ui.pointer({ type: 'down', ...cellOf(props, 'src'), button: 'left' })
  await ui.pointer({ type: 'up', ...one, button: 'left' })
  expect(seen.opens).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(seen.state.zoom).toBeUndefined()
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a message from the map with a path that is not a string, or no file or folder of the map, is dropped', async ($, on) => {
  const seen = world(on, withFolders())
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const junk: JsonValue[] = [
    'src',
    42,
    null,
    [1, 2],
    { kind: 'click' },
    { kind: 'click', path: 42 },
    { kind: 'click', path: ['src'] },
    { kind: 'click', path: '' },
    { kind: 'click', path: 'nope/x.ts' },
    { kind: 'click', path: 'src/a' },
    { kind: 'click', path: 'SRC/A.TS' },
    { kind: 'click', path: '../outside.ts' },
    { kind: 'open', path: 'src/a.ts' },
  ]
  for (const data of junk) await ui.post(data)
  expect(seen.opens).toEqual([])
  expect(seen.exists).toEqual([])
  expect(seen.state.zoom).toBeUndefined()
  expect(seen.toasts).toEqual([])
  await ui.post({ kind: 'click', path: 'src/a.ts' })
  await ui.post({ kind: 'click', path: 'src/a.ts' })
  expect(openedOf(seen.opens)).toEqual(['C:\\work\\repo\\src\\a.ts'])
  await ui.post({ kind: 'click', path: 'docs' })
  expect(seen.state.zoom).toBe('docs')
  await ui.post({ kind: 'up' })
  expect(seen.state.zoom).toBe('')
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

test('a file that is gone, and an opener that fails or cannot start, each give a toast that says so', async ($, on) => {
  const git = withFolders()
  const seen = world(on, git)
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  const ui = await mountPane($)
  const at = cellOf(await mapOf(ui), 'src/a.ts')
  delete filesOf(git)['src/a.ts']
  await doubleClick(ui, at)
  expect(seen.toasts).toEqual(['src/a.ts is not on disk.'])
  expect(seen.toastMs).toEqual([4_000])
  expect(seen.opens).toEqual([])
  filesOf(git)['src/a.ts'] = A0
  git.opener = { exitCode: 1, stderr: '\r\nInvoke-Item : Cannot find path because it does not exist.\r\nAt line:1 char:1\r\n' }
  await doubleClick(ui, at)
  expect(seen.toasts[1]).toBe('Could not open src/a.ts with its default app: exit code 1: Invoke-Item : Cannot find path because it does not exist.')
  git.opener = { failure: 'powershell was not found on PATH' }
  await doubleClick(ui, at)
  expect(seen.toasts[2]?.startsWith('Could not open src/a.ts with its default app: ')).toBe(true)
  expect(seen.toasts[2]?.endsWith('powershell was not found on PATH')).toBe(true)
  expect(seen.opens).toHaveLength(2)
  expect(seen.logged).toEqual([])
  await ui.unmount()
})

const HOSTILE = "src/a&calc&%USERNAME% $(id) 'q'.ts"

function withHostileName(os: Os): Git {
  if (os !== 'win32') return { ...onLinux({ [HOSTILE]: A0 }), os }
  const git = repo()
  filesOf(git)[HOSTILE] = A0
  git.commits.c0 = { ...git.commits.c0, [HOSTILE]: A0 }
  return git
}

function openerFor(os: Os, program: string): { argv: readonly string[]; env?: Record<string, string> } {
  const path = os === 'win32' ? `C:\\work\\repo\\${HOSTILE.replace(/\//g, '\\')}` : `${LINUX_ROOT}/${HOSTILE}`
  if (os === 'win32') return program === '' ? { argv: DEFAULT_APP_ON_WINDOWS, env: { FILEMAP_OPEN: path } } : { argv: POWERSHELL, env: { FILEMAP_OPEN: path, FILEMAP_PROGRAM: program } }
  if (os === 'darwin') return { argv: program === '' ? ['open', path] : ['sh', '-c', PROGRAM_ON_MAC, 'sh', program, path] }
  return { argv: program === '' ? ['setsid', '-f', 'sh', '-c', DEFAULT_APP_ON_LINUX, 'sh', path] : ['sh', '-c', PROGRAM_ON_LINUX, 'sh', program, path] }
}

async function openFromList($: Engine, on: On, os: Os, opener: Git['opener'] = { exitCode: 0, stderr: '' }): Promise<ReturnType<typeof world>> {
  const seen = world(on, { ...withHostileName(os), opener }, () => (os === 'win32' ? CWD : LINUX_HOME))
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.command.run({ command: PLUGIN, args: os === 'win32' ? ROOT : LINUX_ROOT, ...TYPED })
  await $.tool.call({ tool: 'Read', file_path: `${os === 'win32' ? ROOT : LINUX_ROOT}/${HOSTILE}` })
  const ui = await mountPane($)
  await ui.press({ key: `open:${HOSTILE}` })
  await ui.unmount()
  return seen
}

for (const [os, label] of [['win32', 'Windows'], ['linux', 'Linux'], ['darwin', 'macOS']] as const) {
  for (const program of ['', 'code']) {
    test(`${label}: ${program === '' ? 'with the setting empty a file opens in the default app of its type' : 'the setting names one program that opens every file'}, started detached with the path as data that no shell reads`, { options: { opener: program === '' ? '' : ` ${program} ` } }, async ($, on) => {
      const seen = await openFromList($, on, os)
      const expected = openerFor(os, program)
      expect(seen.opens).toHaveLength(1)
      expect(seen.opens[0]?.argv.slice(0, expected.argv.length)).toEqual(expected.argv)
      expect(seen.opens[0]?.env).toEqual(expected.env)
      expect(seen.opens[0]?.timeoutMs).toBe(OPEN_MS)
      if (os === 'win32' && program !== '') expect(seen.opens[0]?.argv.at(-1)).toMatch(/^try \{ \$c = Get-Command -Name \$env:FILEMAP_PROGRAM .*; Start-Process -FilePath \$c\.Path -ArgumentList \('"' \+ \$env:FILEMAP_OPEN \+ '"'\)/)
      expect(seen.toasts).toEqual([])
      expect(seen.logged).toEqual([])
    })
  }
}

for (const [os, label, failure, said] of [
  ['linux', 'Linux', { exitCode: 127, stderr: 'code is not a program on PATH\n' }, 'exit code 127: code is not a program on PATH'],
  ['win32', 'Windows', { exitCode: 2, stderr: 'code.cmd runs through cmd.exe, which changes a % in the path; name the .exe of the program in /config\r\n' }, 'exit code 2: code.cmd runs through cmd.exe, which changes a % in the path; name the .exe of the program in /config'],
] as const) {
  test(`${label}: a program of the setting that fails gives a toast that names the program and what it wrote`, { options: { opener: 'code' } }, async ($, on) => {
    const seen = await openFromList($, on, os, { ...failure })
    expect(seen.toasts).toEqual([`Could not open ${HOSTILE} with code: ${said}`])
  })
}

test('without a pointer the pane shows what it shows with one: the header, the marks, the list, the legend and an empty hover row', async ($, on) => {
  const git = withFolders()
  const seen = world(on, git)
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') filesOf(git)['src/a.ts'] = `${A0}a11\n`
    return { result: EDIT_RESULT }
  })
  await $.command.run({ command: PLUGIN, args: ROOT, ...TYPED })
  await $.tool.call({ tool: 'Read', file_path: FILE_B })
  await $.tool.call({ tool: 'Edit', file_path: FILE_A, old_string: 'a10', new_string: 'a10\na11' })
  await seen.clock.settle()
  const ui = await mountPane($)
  const props = await mapOf(ui)
  expect(headerOf(props)).toBe('repo  now: src  1 changed, 1 read')
  expect(mapColours(props).has(hex(FILLS.light.now))).toBe(true)
  expect(mapColours(props).has(hex(FILLS.light.read))).toBe(true)
  expect(mapRowsOf(props).join('\n')).toContain(' a.ts')
  const region = (await ui.drawn({ in: 'map' })) as { children: unknown[] }
  expect(region.children).toHaveLength(props.rows.length + 2)
  expect(JSON.stringify(region)).toContain(' a.ts')
  expect((await listRowOf(ui, 'src/a.ts')).text).toBe(`   src/a.ts${' '.repeat(48)}+1 -0`)
  expect(await listRowOf(ui, 'src/b.ts')).toEqual({ text: `   src/b.ts${' '.repeat(49)}read`, swatch: hex(FILLS.light.read) })
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text)).toContain('files    read     changed     last 5 min')
  expect(await hoverRow(ui)).toBe(' ')
  const before = JSON.stringify(await ui.drawn())
  await ui.pointer({ type: 'move', ...cellOf(props, 'src/a.ts') })
  await ui.pointer({ type: 'leave', x: 0, y: 0 })
  expect(JSON.stringify(await ui.drawn())).toBe(before)
  expect(seen.logged).toEqual([])
  await ui.unmount()
})
