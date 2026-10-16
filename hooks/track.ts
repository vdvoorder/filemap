import type { Changes, FileChange, MapFile, RepoMap, Session, Theme } from '../types'

export type ToolTouch = { path: string; kind: 'edit' | 'read' }
export type Mark = { changed: number; change: FileChange | null; isRead: boolean; isNow: boolean }
export type RecentRow = { label: string; change: FileChange | null; isNow: boolean }
export type ScreenInput = {
  repo: string
  files: MapFile[]
  filesVersion: number
  marks: Record<string, Mark>
  recent: RecentRow[]
  outside: number
  busy: string[]
  changedCount: number
  readCount: number
  windowMinutes: number
  zoom: string
  columns: number
  rows: number
  theme: Theme
  notice?: string
  idle?: string
}

export type Os = 'win32' | 'darwin' | 'linux'
export type Opener = { argv: string[]; env?: Record<string, string> }

export const EMPTY_SESSION: Session = { reads: {}, readAt: {}, changedAt: {}, labels: {}, recent: [] }
export const STATE_SHAPE = 'filemap-5'
export const WINDOW_MS = 5 * 60_000
const RECENT_LIMIT = 200
const ROW_LIMIT = 50
const BUSY_LIMIT = 3
const BUSY_DEPTH = 2
const TOP_LEVEL = 'top level'
const POWERSHELL = ['powershell', '-NoProfile', '-NonInteractive', '-Command']
const INVOKE = 'Invoke-Item -LiteralPath $env:FILEMAP_OPEN'
const START = [
  'try { $c = Get-Command -Name $env:FILEMAP_PROGRAM -CommandType Application -ErrorAction Stop | Where-Object Extension | Select-Object -First 1',
  "$isScript = $c.Path -match '\\.(cmd|bat)$'",
  "if ($isScript -and $env:FILEMAP_OPEN.Contains('%')) { [Console]::Error.WriteLine($c.Name + ' runs through cmd.exe, which changes a % in the path; name the .exe of the program in /config'); exit 2 }",
  `Start-Process -FilePath $c.Path -ArgumentList ('"' + $env:FILEMAP_OPEN + '"') -WindowStyle $(if ($isScript) { 'Hidden' } else { 'Normal' }) -ErrorAction Stop } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
].join('; ')
const AS_TEXT = [
  `if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { try { Start-Process -FilePath notepad.exe -ArgumentList ('"' + $env:FILEMAP_OPEN + '"') -ErrorAction Stop; exit 0 } catch { throw $_.Exception.Message } }`,
  [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FilemapText {",
    '[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Info { public int Size; public uint Mask; public IntPtr Window; public string Verb; public string File; public string Parameters; public string Directory; public int Show; public IntPtr Instance; public IntPtr IdList; public string Class; public IntPtr ClassKey; public uint HotKey; public IntPtr Icon; public IntPtr Process; }',
    '[DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ShellExecuteExW(ref Info info);',
    'const uint ClassName = 0x1, NoAsync = 0x100, NoUi = 0x400;',
    "public static int Open(string file, string type) { var info = new Info { Mask = ClassName | NoAsync | NoUi, File = file, Class = type, Show = 1 }; info.Size = Marshal.SizeOf(info); return ShellExecuteExW(ref info) ? 0 : Marshal.GetLastWin32Error(); } }'",
  ].join(' '),
  "$code = [FilemapText]::Open($env:FILEMAP_OPEN, '.txt')",
  'if ($code -ne 0) { [Console]::Error.WriteLine((New-Object ComponentModel.Win32Exception $code).Message); exit 1 }',
].join('; ')
const DEFAULT_APP = 'if command -v gio >/dev/null; then exec gio open "$1"; else exec xdg-open "$1"; fi </dev/null >/dev/null 2>&1'
const PROGRAM = 'command -v "$1" >/dev/null 2>&1 || { echo "$1 is not a program on PATH" >&2; exit 127; }; exec setsid -f "$1" "$2" </dev/null >/dev/null 2>&1'
const AS_TEXT_ON_LINUX = [
  'app=$(xdg-mime query default text/plain 2>/dev/null)',
  '[ -n "$app" ] || { echo "xdg-mime names no app for text/plain" >&2; exit 3; }',
  'if command -v gtk-launch >/dev/null 2>&1; then exec setsid -f gtk-launch "$app" "$1" </dev/null >/dev/null 2>&1; fi',
  'for d in "${XDG_DATA_HOME:-$HOME/.local/share}" $(printf %s "${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" | tr : " "); do [ -f "$d/applications/$app" ] && exec setsid -f gio launch "$d/applications/$app" "$1" </dev/null >/dev/null 2>&1; done',
  'echo "found no way to start $app" >&2; exit 3',
].join('; ')
const PROGRAM_ON_MAC = [
  'if { [ -f "$1" ] && [ -x "$1" ]; } || { case "$1" in */*) false ;; *) command -v "$1" >/dev/null 2>&1 ;; esac; }; then "$1" "$2" </dev/null >/dev/null 2>&1 & exit 0; fi',
  'exec open -a "$1" "$2"',
].join('; ')

let windows = false

export function useWindows(on: boolean): void {
  windows = on
}

export function isOnWindows(): boolean {
  return windows
}

export function fold(path: string): string {
  return windows ? path.toLowerCase() : path
}

export function isRooted(path: string): boolean {
  return windows ? /^[a-zA-Z]:[\\/]/.test(path) : path.startsWith('/')
}

export function absolute(path: string, cwd: string, home = ''): string {
  const slashed = (text: string) => (windows ? text.replace(/\\/g, '/') : text)
  const base = slashed(cwd)
  let given = windows ? slashed(path).replace(/^\/\/\?\//, '') : path
  if (home !== '' && /^~(\/|$)/.test(given)) given = slashed(home) + given.slice(1)
  if (windows && /^[a-zA-Z]:/.test(base)) given = given.replace(/^\/([a-zA-Z])(\/|$)/, '$1:/')
  const full = (windows ? /^([a-zA-Z]:)?\// : /^\//).test(given) ? given : `${base}/${given}`
  const drive = windows ? (/^[a-zA-Z]:/.exec(full)?.[0] ?? '') : ''
  const segments: string[] = []
  for (const segment of full.slice(drive.length).split('/')) {
    if (segment === '..') segments.pop()
    else if (segment !== '' && segment !== '.') segments.push(segment)
  }
  return `${drive}/${segments.join('/')}`
}

export function toKey(path: string, cwd: string): string {
  return fold(absolute(path, cwd))
}

function touch(path: unknown, kind: ToolTouch['kind']): ToolTouch[] {
  return typeof path === 'string' && path !== '' ? [{ path, kind }] : []
}

export function touchesFromInput(e: Record<string, unknown>): ToolTouch[] {
  switch (e.tool) {
    case 'Read':
      return touch(e.file_path, 'read')
    case 'Grep':
      return touch(e.path, 'read')
    case 'Edit':
    case 'Write':
      return touch(e.file_path, 'edit')
    case 'NotebookEdit':
      return touch(e.notebook_path, 'edit')
    default:
      return []
  }
}

const NUMBERED_LINE = /^((?:[a-zA-Z]:)?[^:\n]+):\d+:/gm
const PLAIN_LINE = /^((?:[a-zA-Z]:)?[^:\n]+):/gm
const COUNT_LINE = /^((?:[a-zA-Z]:)?[^:\n]+):\d+$/gm

function isContextLine(found: string, paths: Set<string>, mark: RegExp): boolean {
  for (const dash of found.matchAll(mark)) if (paths.has(found.slice(0, dash.index))) return true
  return false
}

function pathsInContent(content: string, isNumbered: boolean): string[] {
  const found = new Set<string>()
  for (const [, path = ''] of content.matchAll(isNumbered ? NUMBERED_LINE : PLAIN_LINE)) found.add(path)
  return [...found].filter(path => !isContextLine(path, found, isNumbered ? /-\d+-/g : /-/g))
}

export function touchesFromResult(e: Record<string, unknown>, result: unknown, isGrepOfOneFile = false): ToolTouch[] {
  if (e.tool !== 'Grep' || typeof result !== 'object' || result === null) return []
  const { filenames, mode, content } = result as Record<string, unknown>
  const paths: string[] = []
  if (Array.isArray(filenames)) for (const name of filenames) if (typeof name === 'string') paths.push(name)
  if (typeof content === 'string' && !isGrepOfOneFile) {
    if (mode === 'content') paths.push(...pathsInContent(content, e['-n'] !== false))
    if (mode === 'count') for (const [, path = ''] of content.matchAll(COUNT_LINE)) paths.push(path)
  }
  return [...new Set(paths)].flatMap(path => touch(path, 'read'))
}

export function isShell(tool: string): boolean {
  return tool === 'Bash' || tool === 'PowerShell'
}

export function setsReadTime(tool: string): boolean {
  return tool !== 'Grep'
}

function toFront(s: Session, named: Map<string, string>): Pick<Session, 'labels' | 'recent'> {
  const recent = [...named.keys(), ...s.recent.filter(key => !named.has(key))].slice(0, RECENT_LIMIT)
  const labels = Object.fromEntries(recent.map(key => [key, s.labels[key] ?? named.get(key) ?? key]))
  return { labels, recent }
}

export function noteTouches(s: Session, touches: ToolTouch[], cwd: string, now: number, isTimed = true): Session {
  if (touches.length === 0) return s
  const reads = { ...s.reads }
  const readAt = { ...s.readAt }
  const changedAt = { ...s.changedAt }
  const named = new Map<string, string>()
  const counted = new Set<string>()
  for (const { path, kind } of touches) {
    const label = absolute(path, cwd)
    const key = fold(label)
    if (!named.has(key)) named.set(key, label)
    if (counted.has(`${kind} ${key}`)) continue
    counted.add(`${kind} ${key}`)
    if (kind === 'edit') changedAt[key] = now
    else {
      reads[key] = (reads[key] ?? 0) + 1
      if (isTimed) readAt[key] = now
    }
  }
  return { ...s, reads, readAt, changedAt, ...toFront(s, named) }
}

export function noteChanges(s: Session, root: string, paths: string[], now: number): Session {
  if (paths.length === 0) return s
  const named = new Map(paths.map(path => absolute(path, root)).map((label): [string, string] => [fold(label), label]))
  const changedAt = { ...s.changedAt }
  for (const key of named.keys()) changedAt[key] = now
  return { ...s, changedAt, ...toFront(s, named) }
}

export function nextExpiry(s: Session, now: number): number | null {
  let next: number | null = null
  for (const at of [...Object.values(s.readAt), ...Object.values(s.changedAt)]) {
    const end = at + WINDOW_MS
    if (end > now && (next === null || end < next)) next = end
  }
  return next
}

export function folderOf(path: string): string {
  const folder = path.slice(0, path.lastIndexOf('/'))
  return /^([a-zA-Z]:)?$/.test(folder) ? '' : folder
}

export function foldersOutside(s: Session, root: string): string[] {
  const prefix = `${toKey(root, root)}/`
  const folders = new Map<string, string>()
  for (const key of s.recent) {
    const folder = folderOf(key)
    if (folder !== '' && !key.startsWith(prefix) && !folders.has(folder)) folders.set(folder, folderOf(s.labels[key] ?? key))
  }
  return [...folders.values()]
}

export function moveFolders(s: Session, moves: Array<[from: string, to: string]>): Session {
  const moved = (label: string): string => {
    const key = fold(label)
    for (const [from, to] of moves) if (key.startsWith(`${from}/`)) return to + label.slice(from.length)
    return label
  }
  const keyOf = (key: string) => fold(moved(key))
  const reads: Record<string, number> = {}
  for (const [key, count] of Object.entries(s.reads)) reads[keyOf(key)] = (reads[keyOf(key)] ?? 0) + count
  const latest = (times: Record<string, number>) => {
    const out: Record<string, number> = {}
    for (const [key, at] of Object.entries(times)) out[keyOf(key)] = Math.max(out[keyOf(key)] ?? at, at)
    return out
  }
  return {
    reads,
    readAt: latest(s.readAt),
    changedAt: latest(s.changedAt),
    labels: Object.fromEntries(Object.entries(s.labels).map(([key, label]) => [keyOf(key), moved(label)])),
    recent: [...new Set(s.recent.map(keyOf))],
  }
}

const INCLUDED = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.sh', '.bash', '.zsh', '.fish',
  '.py', '.ps1', '.psm1', '.cs', '.csx', '.rs', '.go', '.java', '.zig', '.swift',
  '.c', '.h', '.cpp', '.cc', '.hpp', '.tmdl', '.dax',
  '.md', '.mdx',
  '.css', '.scss', '.html', '.json', '.toml', '.yaml', '.yml', '.sql', '.pbir', '.pbism', '.pbip',
])
const SKIP_NAMES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'uv.lock', 'poetry.lock', 'Cargo.lock',
])
const NEVER_SOURCE = new Set(['node_modules', '.venv', 'venv', '__pycache__'])
const RUNS_ON: Record<Os, string> = {
  win32: [
    '.ade;.adp;.apk;.app;.appcontent-ms;.application;.appref-ms;.appx;.asp;.aspx;.asx;.bas;.bat;.bgi;.cab;.cdxml;.cer;.chm;.cmd;.cnt;.com;.cpl;.crt;.csh;.der;.diagcab;.exe;.fxp;.gadget;.grp;.hlp;.hpj;.hta;.htc;.img;.inf;.ins;.iso;.isp;.its;.jar;.jnlp;.js;.jse;.ksh',
    '.library-ms;.lnk;.mad;.maf;.mag;.mam;.maq;.mar;.mas;.mat;.mau;.mav;.maw;.mcf;.mda;.mdb;.mde;.mdt;.mdw;.mdz;.msc;.mht;.mhtml;.msh;.msh1;.msh2;.mshxml;.msh1xml;.msh2xml;.msi;.msp;.mst;.msu;.ops;.osd;.pcd;.pif;.pl;.plg;.prf;.prg;.printerexport',
    '.ps1;.ps1xml;.ps2;.ps2xml;.psc1;.psc2;.psd1;.psdm1;.pssc;.pst;.py;.pyc;.pyo;.pyw;.pyz;.pyzw;.reg;.scf;.scr;.sct;.search-ms;.settingcontent-ms;.shb;.shs;.theme;.tmp;.udl;.url;.vb;.vbe;.vbp;.vbs;.vhd;.vhdx;.vsmacros;.vsw;.webpnp;.website;.ws;.wsb;.wsc;.wsf;.wsh;.xbap;.xll;.xnk',
    '.sh;.bash;.rb;.rbw;.ahk;.au3;.a3x;.psm1;.appxbundle;.msix;.msixbundle;.appinstaller;.vsix;.ppkg;.searchconnector-ms;.xla;.xlam;.ppam;.accde;.accdb;.rdp;.themepack;.deskthemepack',
  ].join(';'),
  darwin: '.command;.tool;.terminal;.app;.pkg;.mpkg;.dmg;.workflow;.action;.prefpane;.saver;.mobileconfig;.shortcut;.webloc;.inetloc;.fileloc;.jar;.jnlp;.py;.pyw;.pyc;.pyo',
  linux: '.jar;.jnlp;.desktop;.deb;.rpm;.snap;.flatpakref;.flatpakrepo;.appimage;.run',
}
const TEXT = new Set([
  ...INCLUDED,
  ...'.bat;.cmd;.pyw;.vbs;.vb;.vbp;.bas;.ws;.wsf;.wsc;.wsh;.sct;.hta;.htc;.asp;.aspx;.pl;.rb;.rbw;.ahk;.au3;.tcl;.csh;.ksh;.msh;.msh1;.msh2;.ps2;.psd1;.psdm1;.pssc;.command;.tool'.split(';'),
  ...'.ps1xml;.ps2xml;.psc1;.psc2;.cdxml;.mshxml;.msh1xml;.msh2xml;.msc;.application;.appinstaller;.jnlp;.asx;.osd;.wsb;.library-ms;.search-ms;.searchconnector-ms;.settingcontent-ms;.appcontent-ms'.split(';'),
  ...'.reg;.inf;.ins;.isp;.url;.website;.scf;.theme;.udl;.appref-ms;.cnt;.hpj;.prf;.plg;.mht;.mhtml;.desktop'.split(';'),
])

function isIncluded(path: string): boolean {
  const folders = path.split('/')
  const name = folders.pop() ?? ''
  if (SKIP_NAMES.has(name) || name.endsWith('.min.js') || folders.some(folder => NEVER_SOURCE.has(folder))) return false
  const dot = name.lastIndexOf('.')
  return dot > 0 && INCLUDED.has(name.slice(dot).toLowerCase())
}

export function isExtensionless(path: string): boolean {
  return (path.split('/').pop() ?? '').lastIndexOf('.') <= 0
}

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

export function runsWhenOpened(os: Os, path: string, pathext: string): boolean {
  const extension = extensionOf(path)
  return extension !== '' && `${pathext};${RUNS_ON[os]}`.toLowerCase().split(';').includes(extension)
}

export function isText(path: string): boolean {
  return TEXT.has(extensionOf(path))
}

export function gitArgv(root: string, args: string[]): string[] {
  return ['git', '--no-optional-locks', '-C', root, ...args]
}

export const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0' }

export const LIST_ARGS = ['grep', '--no-color', '--no-recurse-submodules', '-I', '-c', '--untracked', '-z', '-e', '']

export function parseFileList(stdout: string): MapFile[] {
  const files: MapFile[] = []
  for (const [, p = '', lines = ''] of stdout.matchAll(/([^\0]+)\0(\d+)\n/g)) if (isIncluded(p)) files.push({ p, lines: Number(lines) })
  return files.sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0))
}

export const TOP_ARGS = ['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir']

export function parseTop(stdout: string): { root: string; commonDir: string } {
  const [root = '', commonDir = ''] = stdout.split('\n').map(line => line.trim())
  return { root, commonDir }
}

export const STATUS_ARGS = ['status', '--porcelain=v2', '--branch', '--no-ahead-behind', '--untracked-files=all', '--no-renames', '-z']

export function readTreeArgs(head: string): string[] {
  return ['read-tree', head === '' ? '--empty' : head]
}

export const UPDATE_INDEX_ARGS = ['update-index', '--add', '--remove', '-z', '--stdin']
export const INDEX_INFO_ARGS = ['update-index', '-z', '--index-info']
export const WRITE_TREE_ARGS = ['write-tree']

export function hashArgs(path: string): string[] {
  return ['hash-object', '-w', '--stdin', `--path=${path}`]
}

export function indexInfo(path: string, blob: string | null, head: string): string {
  return blob === null ? `0 ${'0'.repeat(head.length)}\t${path}\0` : `100644 ${blob}\t${path}\0`
}

export function trackedArgs(paths: string[]): string[] {
  return ['ls-files', '-z', '--', ...paths.map(path => `:(literal${windows ? ',icase' : ''})${path}`)]
}

export function hashOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

export type Temp = { folder: string; objects: string; lfs: string }

export function tempOf(folder: string, commonDir: string): Temp {
  return { folder, objects: `${folder}/objects-${hashOf(toKey(commonDir, ''))}`, lfs: `${folder}/lfs` }
}

export function countsOf(folder: string, commonDir: string): Temp {
  const counts = `${folder}/counts-${hashOf(toKey(commonDir, ''))}`
  return { folder, objects: `${counts}/objects`, lfs: `${counts}/lfs` }
}

export function alternatesOf(objects: string): string {
  return `${absolute(objects, '')}\n`
}

export function looseObjectOf(objects: string, id: string): string {
  return `${objects}/${id.slice(0, 2)}/${id.slice(2)}`
}

export type Counted = { files: Record<string, FileChange>; trees: string[] }

export function objectsOf(counted: Counted): string[] {
  return [...new Set([...Object.values(counted.files).map(change => change.blob), ...counted.trees])].filter(id => !/^0*$/.test(id))
}

export function staleObjects(before: Counted, after: Counted): string[] {
  const kept = new Set(objectsOf(after))
  return objectsOf(before).filter(id => !kept.has(id))
}

const SESSION_CONFIG = ['core.looseCompression=0', 'core.safecrlf=false', 'core.splitIndex=false', 'core.bigFileThreshold=4095m']

export function sessionArgs(temp: Temp): string[] {
  return [`lfs.storage=${temp.lfs}`, `core.hooksPath=${temp.folder}/hooks`, ...SESSION_CONFIG].flatMap(setting => ['-c', setting])
}

export function batchesOf(paths: string[], limit: number): string[][] {
  const batches: string[][] = []
  let size = limit
  for (const path of paths) {
    if (size + path.length + 1 > limit) {
      batches.push([])
      size = 0
    }
    batches.at(-1)?.push(path)
    size += path.length + 1
  }
  return batches
}

export function needsListing(files: MapFile[], changed: Record<string, FileChange>, found: string[]): boolean {
  const listed = new Set(files.map(file => file.p))
  return found.some(path => {
    const change = changed[path]
    if (change === undefined || /^0+$/.test(change.blob)) return listed.has(path)
    return !listed.has(path) && !change.isBinary && isIncluded(path)
  })
}

export function pathsStdin(paths: string[]): string {
  return paths.map(path => `${path}\0`).join('')
}

export function diffArgs(from: string, to: string): string[] {
  return ['diff-tree', '-r', '-t', '-z', '--no-renames', '--raw', '--numstat', from, to]
}

export type StatusList = { head: string; paths: string[]; nested: string[] }

const FIELDS_BEFORE_PATH: Record<string, number> = { '1': 8, u: 10 }
const TREE_MODE = '040000'

export function parseStatus(stdout: string): StatusList {
  const list: StatusList = { head: '', paths: [], nested: [] }
  for (const entry of stdout.split('\0')) {
    const fields = entry.split(' ')
    const [type = '', state = '', sub = ''] = fields
    if (type === '#' && state === 'branch.oid' && sub !== '(initial)') list.head = sub
    if (type === '?') (entry.endsWith('/') ? list.nested : list.paths).push(entry.slice(2))
    const before = FIELDS_BEFORE_PATH[type]
    const path = before === undefined ? undefined : fields.slice(before).join(' ')
    if (path !== undefined && sub.startsWith('S')) list.nested.push(`${path}/`)
    else if (path !== undefined) list.paths.push(path)
  }
  return { head: list.head, paths: [...new Set(list.paths)], nested: list.nested }
}

function configValue(text: string): string {
  let value = ''
  let spaces = ''
  let isQuoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (!isQuoted && (ch === '#' || ch === ';')) break
    if (!isQuoted && /\s/.test(ch)) {
      if (value !== '') spaces += ' '
      continue
    }
    value += spaces
    spaces = ''
    if (ch === '"') isQuoted = !isQuoted
    else if (ch !== '\\') value += ch
    else {
      const next = text.charAt(++i)
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'b' ? '\b' : next
    }
  }
  return value
}

export function parseModules(text: string): string[] {
  const folders: string[] = []
  let isModule = false
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[\s*([^\s\]"]+)\s*(?:"(?:[^"\\]|\\.)*"\s*)?\]/.exec(line)
    if (header !== null) isModule = (header[1] ?? '').split('.')[0]?.toLowerCase() === 'submodule'
    const setting = isModule ? /^\s*path\s*(?:=(.*))?$/i.exec(line.slice(header?.[0].length ?? 0)) : null
    const path = configValue(setting?.[1] ?? '').replace(/\/+$/, '')
    if (path !== '') folders.push(`${path}/`)
  }
  return folders
}

export function nestedIn(root: string, roots: string[]): string[] {
  const prefix = `${toKey(root, '')}/`
  return roots
    .map(one => absolute(one, ''))
    .filter(one => fold(one).startsWith(prefix))
    .map(one => `${one.slice(prefix.length)}/`)
    .sort()
}

function isTreeEntry(token: string): boolean {
  const [from = '', to = ''] = token.slice(1).split(' ')
  return from === TREE_MODE || to === TREE_MODE
}

export function treesOf(stdout: string): string[] {
  const tokens = stdout.split('\0')
  const trees: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    if (!token.startsWith(':')) continue
    const id = token.split(' ')[3] ?? ''
    if (isTreeEntry(token) && !/^0*$/.test(id)) trees.push(id)
    i++
  }
  return trees
}

export function parseDiff(stdout: string): Record<string, FileChange> {
  const tokens = stdout.split('\0')
  const blobs = new Map<string, string>()
  const files: Array<[string, FileChange]> = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    if (token.startsWith(':')) {
      if (!isTreeEntry(token)) blobs.set(tokens[i + 1] ?? '', token.split(' ')[3] ?? '')
      i++
      continue
    }
    const numstat = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(token)
    if (numstat === null) continue
    const [, added = '', deleted = '', path = ''] = numstat
    const isBinary = added === '-'
    if (!isBinary && added === '0' && deleted === '0') continue
    files.push([path, { added: isBinary ? 0 : Number(added), deleted: isBinary ? 0 : Number(deleted), isBinary, blob: blobs.get(path) ?? '' }])
  }
  return Object.fromEntries(files)
}

export function newlyChanged(before: Record<string, FileChange>, after: Record<string, FileChange>): string[] {
  const paths = Object.keys(after).filter(path => !Object.hasOwn(before, path) || before[path]?.blob !== after[path]?.blob)
  for (const path of Object.keys(before)) if (!Object.hasOwn(after, path)) paths.push(path)
  return paths.sort()
}

const changedLines = (change: FileChange, lines: number) => (change.isBinary ? lines : Math.max(change.added, change.deleted))

export function openerOf(os: Os, program: string, file: string, asText: boolean): Opener {
  if (os === 'win32') {
    const env = { FILEMAP_OPEN: file.replace(/\//g, '\\') }
    return program === '' ? { argv: [...POWERSHELL, asText ? AS_TEXT : INVOKE], env } : { argv: [...POWERSHELL, START], env: { ...env, FILEMAP_PROGRAM: program } }
  }
  if (os === 'darwin') return { argv: program === '' ? ['open', ...(asText ? ['-t'] : []), file] : ['sh', '-c', PROGRAM_ON_MAC, 'sh', program, file] }
  if (program !== '') return { argv: ['sh', '-c', PROGRAM, 'sh', program, file] }
  return { argv: asText ? ['sh', '-c', AS_TEXT_ON_LINUX, 'sh', file] : ['setsid', '-f', 'sh', '-c', DEFAULT_APP, 'sh', file] }
}

export function screenInput(
  map: RepoMap,
  s: Session,
  changes: Changes | null,
  view: { columns: number; rows: number; zoom?: string },
  theme: Theme,
  now: number,
  notice?: string,
): ScreenInput {
  const root = toKey(map.root, map.root)
  const prefix = root.endsWith('/') ? root : `${root}/`
  const depth = prefix.split('/').length - 1
  const counted = changes !== null && changes.root === map.root ? Object.entries(changes.files) : []
  const nested = changes !== null && changes.root === map.root ? changes.nested.map(folder => prefix + fold(folder)) : []
  const inRoot = (key: string) => map.root !== '' && key.startsWith(prefix) && !nested.some(folder => key.startsWith(folder))
  const onMap = new Map(map.files.map(file => [fold(file.p), file]))
  const changed = new Map(counted.map(([path, change]) => [fold(path), change]))
  const isNow = (at: number | undefined) => at !== undefined && now - at < WINDOW_MS
  const isRead = (key: string) => Object.hasOwn(s.reads, key)
  const spelled = (key: string) => onMap.get(key.slice(prefix.length))?.p ?? (s.labels[key] ?? key).split('/').slice(depth).join('/')
  const marks: Record<string, Mark> = {}
  for (const file of map.files) {
    const path = fold(file.p)
    const key = prefix + path
    const change = changed.get(path)
    if (change === undefined && !isRead(key)) continue
    marks[path] = {
      changed: change === undefined ? 0 : changedLines(change, file.lines),
      change: change ?? null,
      isRead: isRead(key),
      isNow: change !== undefined && isNow(s.changedAt[key]),
    }
  }
  const recent: RecentRow[] = []
  for (const key of s.recent) {
    if (recent.length === ROW_LIMIT) break
    const change = inRoot(key) ? (changed.get(key.slice(prefix.length)) ?? null) : null
    if (inRoot(key) && (change !== null || isRead(key))) recent.push({ label: spelled(key), change, isNow: change !== null && isNow(s.changedAt[key]) })
  }
  const touched = new Set([...Object.keys(s.reads), ...Object.keys(s.changedAt)])
  const busy = new Map<string, { name: string; files: number; last: number }>()
  for (const key of new Set([...Object.keys(s.readAt), ...Object.keys(s.changedAt)])) {
    const last = Math.max(s.readAt[key] ?? -Infinity, s.changedAt[key] ?? -Infinity)
    if (!inRoot(key) || !isNow(last)) continue
    const name = spelled(key).split('/').slice(0, -1).slice(0, BUSY_DEPTH).join('/') || TOP_LEVEL
    const held = busy.get(fold(name)) ?? { name, files: 0, last }
    busy.set(fold(name), { name: held.name, files: held.files + 1, last: Math.max(held.last, last) })
  }
  const busiest = [...busy.values()].sort((a, b) => b.files - a.files || b.last - a.last || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return {
    repo: map.repo,
    files: map.files,
    filesVersion: map.version,
    marks,
    recent,
    outside: [...touched].filter(key => !inRoot(key)).length,
    busy: busiest.slice(0, BUSY_LIMIT).map(folder => folder.name),
    changedCount: changed.size,
    readCount: Object.keys(s.reads).filter(key => inRoot(key) && !changed.has(key.slice(prefix.length))).length,
    windowMinutes: WINDOW_MS / 60_000,
    zoom: view.zoom ?? '',
    columns: view.columns,
    rows: view.rows,
    theme,
    ...(notice === undefined ? {} : { notice }),
  }
}
