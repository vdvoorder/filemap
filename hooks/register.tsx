import { atom, type ConfigValue, type EngineInterface, type ProcessRunInit, read, type Register, type Shaped, type Timer, type ToolCallResult, update } from 'claude-code'

import type { Changes, MapFile, RepoMap, Session, Theme } from '../types'
import { fitMap } from './map'
import type { MapMessage, MapProps } from './map-client'
import { hasFolder, legendOf, listOf, mapDrawing, paneFrame, plainText, type Span, zoomOut } from './screen'
import { shellReads } from './shell'
import {
  absolute,
  alternatesOf,
  batchesOf,
  countsOf,
  type Counted,
  diffArgs,
  EMPTY_SESSION,
  fold,
  folderOf,
  foldersOutside,
  GIT_ENV,
  gitArgv,
  hashArgs,
  INDEX_INFO_ARGS,
  indexInfo,
  isExtensionless,
  isRooted,
  isShell,
  isText,
  LIST_ARGS,
  looseObjectOf,
  moveFolders,
  needsListing,
  nestedIn,
  newlyChanged,
  nextExpiry,
  noteChanges,
  noteTouches,
  objectsOf,
  openerOf,
  type Os,
  parseDiff,
  parseFileList,
  parseModules,
  parseStatus,
  parseTop,
  pathsStdin,
  readTreeArgs,
  runsWhenOpened,
  screenInput,
  sessionArgs,
  setsReadTime,
  staleObjects,
  STATE_SHAPE,
  STATUS_ARGS,
  type Temp,
  tempOf,
  toKey,
  TOP_ARGS,
  touchesFromInput,
  touchesFromResult,
  type ToolTouch,
  trackedArgs,
  treesOf,
  UPDATE_INDEX_ARGS,
  useWindows,
  WRITE_TREE_ARGS,
} from './track'

const PANE = 'filemap'
const NOTICE = 'Run /filemap <folder> to draw a git repository here.'
const NOT_COUNTED = ' Changes are not counted: git could not describe the working tree.'
const NO_MAP: RepoMap = { root: '', repo: 'no repository', commonDir: '', files: [], version: 0 }
const OPEN_TIMEOUT_MS = 10_000
const UNAME_TIMEOUT_MS = 3_000
const DOUBLE_MS = 450
const TOAST_MS = 4_000
const TOAST_MS_PER_CHARACTER = 50
const GIT_TIMEOUT_MS = 30_000
const COUNT_AFTER_MS = 30_000
const RETRY_AFTER_MS = 5 * 60_000
const INDEX_LIMIT = 20
const WORKTREE_LIMIT = 200
const REMOVE_TIMEOUT_MS = 20_000
const PRIVATE_TIMEOUT_MS = 10_000
const PRUNE_LIMIT = 16 * 2 ** 20
const ARGUMENT_LIMIT = 64 * 2 ** 10
const END_TIMEOUT_MS = 1_000
const STALE_AFTER_MS = 7 * 24 * 60 * 60_000
const REFOCUS_MS = 2_000
const GIT_DIR_DEPTH = 64
const PANE_COLUMNS = 64
const CONVERSATION_COLUMNS = 24
const EDGE_COLUMNS = 1
const TASK_ENDED = '<task-notification>'
const ENDED = 'the session ended'
const STATUS_FILE = 'status'
const OURS = /^(status|(command|job)-\d+\.index(\.lock)?|(objects|counts)-[0-9a-f]{8}|lfs)$/
const SESSION_FOLDER = /^filemap-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REMOVE_ON_WINDOWS = 'foreach ($p in $env:FILEMAP_REMOVE.Split([char]10)) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }'
const LOG_LIMIT = 4096
const REASON_LIMIT = 200
const WORKTREE_TOOLS = new Set(['EnterWorktree', 'ExitWorktree'])
const OS_NAMES: Record<Os, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
const FILE_LIMIT = 32 * 1024 * 1024
const COUNTING = 'Counting the changed lines'
const LISTING = 'Listing the files again'
const RESOLVING = 'Resolving the folders of the touched files'
const TIMING = 'Timing the next drawing of the pane'
const TAKING = 'Taking the baseline'
const READING_THEME = 'Reading the theme'
const CLEANING = 'Deleting the folders of ended sessions'
const NOTING = 'Counting the files of a tool call'
const TOASTED_STEPS = new Set([COUNTING, LISTING, TAKING])
const MAP = { plugin: 'filemap', key: 'map' } as const
const SESSION = { plugin: 'filemap', key: 'session' } as const
const CHANGES = { plugin: 'filemap', key: 'changes' } as const
const STALE = { plugin: 'filemap', key: 'isStale' } as const
const ROOT = { plugin: 'filemap', key: 'root' } as const
const PAUSED = { plugin: 'filemap', key: 'isGitPaused' } as const
const THEME = { plugin: 'filemap', key: 'theme' } as const
const ZOOM = { plugin: 'filemap', key: 'zoom' } as const
const EPOCH = { plugin: 'filemap', key: 'epoch' } as const
const SHAPE = { shape: STATE_SHAPE }
const map = atom(MAP, null, SHAPE)
const session = atom(SESSION, EMPTY_SESSION, SHAPE)
const changes = atom(CHANGES, null, SHAPE)
const isStale = atom(STALE, false, SHAPE)
const rootFolder = atom(ROOT, '', SHAPE)
const isGitPaused = atom(PAUSED, false, SHAPE)
const theme = atom(THEME, 'dark', SHAPE)
const zoom = atom(ZOOM, '', SHAPE)
const epoch = atom(EPOCH, 0, SHAPE)

let platform: Promise<Os> | null = null
let program = ''
let paneColumns = PANE_COLUMNS
let lastClick = { path: '', at: 0 }
let lastJob: Promise<unknown> = Promise.resolve()
let rootPrefix: string | undefined
let seenRoot: string | undefined
let countTimer: Timer | null = null
let windowTimer: { at: number; timer: Timer } | null = null
let generation = 0
let focusedAt = -Infinity
const asked = new Map<string, number>()
const begun = new Map<string, number>()
const realFolders = new Map<string, string>()
const removed = new Set<string>()
const inUse = new Set<string>()
const stale = new Map<string, number>()
const written: Written[] = []
const failing = new Set<string>()
let nestedPrefixes: string[] = []

type Top = { root: string; commonDir: string }
type Since = { generation: number; epoch: number }
type Written = { path: string; before?: string | null }
type Before = { named: ToolTouch[]; isGrepOfOneFile: boolean; texts: Map<string, string | null>; cwd?: string }

function osName($: EngineInterface): Promise<Os> {
  platform ??= (async (): Promise<Os> => {
    if ((await $.env.get('OS')) === 'Windows_NT') return 'win32'
    try {
      return (await $.process.run(['uname', '-s'], { timeoutMs: UNAME_TIMEOUT_MS })).stdout.trim() === 'Darwin' ? 'darwin' : 'linux'
    } catch {
      return 'linux'
    }
  })().then(
    os => {
      useWindows(os === 'win32')
      return os
    },
    error => {
      platform = null
      throw error
    },
  )
  return platform
}

function inOrder<T>(job: () => Promise<T>): Promise<T> {
  const ran = lastJob.then(job)
  lastJob = ran.catch(() => undefined)
  return ran
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function logFailure($: EngineInterface, step: string, error: unknown): void {
  try {
    $.ui.log(`${step} failed: ${reasonOf(error)}`.slice(0, LOG_LIMIT), { to: 'debug' })
  } catch {
    return
  }
}

function failed($: EngineInterface, step: string, error: unknown): void {
  logFailure($, step, error)
  if (!TOASTED_STEPS.has(step) || failing.has(step)) return
  failing.add(step)
  try {
    $.ui.toast(plainText(`${step} failed: ${reasonOf(error)}`.replace(/\s+/g, ' ')).slice(0, REASON_LIMIT))
  } catch {
    return
  }
}

function later($: EngineInterface, step: string, job: () => Promise<void>): void {
  asked.set(step, (asked.get(step) ?? 0) + 1)
  $.clock.after(0, () => {
    inOrder(async () => {
      if (begun.get(step) === asked.get(step)) return
      begun.set(step, asked.get(step) ?? 0)
      await osName($)
      await job()
      failing.delete(step)
    }).catch(error => failed($, step, error))
  })
}

async function detach($: EngineInterface, step: string, job: () => Promise<void>): Promise<void> {
  $.clock.after(0, () => void job().catch(error => logFailure($, step, error)))
}

function shaped<T>(value: T): Shaped<T> {
  return { shape: STATE_SHAPE, value }
}

function ofThisShape<T>(stored: Shaped<T> | undefined): T | undefined {
  return stored?.shape === STATE_SHAPE ? stored.value : undefined
}

function unquote(text: string): string {
  return text.length > 1 && (text.startsWith('"') || text.startsWith("'")) && text.endsWith(text.charAt(0)) ? text.slice(1, -1) : text
}

function resolveFolder(folder: string, cwd: string, home: string, os: Os): string {
  const ends = os === 'win32' ? /[\\/]+$/ : /\/+$/
  if (home !== '' && (os === 'win32' ? /^~([\\/]|$)/ : /^~(\/|$)/).test(folder)) return `${home.replace(ends, '')}${folder.slice(1)}`
  return (os === 'win32' ? /^([A-Za-z]:[\\/]|[\\/])/ : /^\//).test(folder) ? folder : `${cwd.replace(ends, '')}/${folder}`
}

async function homeOf($: EngineInterface): Promise<string> {
  if ((await osName($)) === 'win32') return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(part => part !== '').pop() ?? path
}

async function changeSession($: EngineInterface, change: (cur: Session) => Session): Promise<void> {
  for (;;) {
    const stored = await $.state.get(SESSION)
    const cur = ofThisShape(stored.value) ?? EMPTY_SESSION
    const next = change(cur)
    if (next === cur || (await $.state.set(SESSION, shaped(next), { ifVersion: stored.version })).isSet) return
  }
}

function inRealFolder(path: string): string {
  const folder = folderOf(path)
  const real = realFolders.get(fold(folder))
  return real === undefined ? path : real + path.slice(folder.length)
}

function isUnplaced(path: string): boolean {
  const key = fold(path)
  const folder = folderOf(key)
  const isInside = rootPrefix !== undefined && key.startsWith(rootPrefix)
  return rootPrefix !== '' && folder !== '' && !isInside && !realFolders.has(folder)
}

async function locate($: EngineInterface, touches: ToolTouch[], from?: string): Promise<ToolTouch[]> {
  if (touches.length === 0) return touches
  await osName($)
  const cwd = touches.every(one => isRooted(one.path)) ? '' : (from ?? (await $.session.cwd()))
  const isHomeNamed = touches.some(one => one.path.startsWith('~'))
  const home = isHomeNamed ? await homeOf($) : ''
  return touches.map(one => ({ ...one, path: inRealFolder(absolute(one.path, cwd, home)) }))
}

async function nestedRootOf($: EngineInterface, rootLength: number, folder: string): Promise<string> {
  for (let inside = folder; inside.length > rootLength; inside = folderOf(inside)) if (await $.fs.exists(`${inside}/.git`)) return inside
  return ''
}

async function mayBeElsewhere($: EngineInterface, path: string): Promise<boolean> {
  const key = fold(path)
  if (rootPrefix === undefined || rootPrefix === '') return false
  if (!key.startsWith(rootPrefix) || nestedPrefixes.some(folder => key.startsWith(folder))) return true
  return (await nestedRootOf($, rootPrefix.length - 1, folderOf(path)).catch(() => '')) !== ''
}

async function knowRoot($: EngineInterface): Promise<void> {
  if (rootPrefix !== undefined) return
  await osName($)
  const root = await read($, rootFolder)
  const held = await read($, changes)
  if (rootPrefix !== undefined) return
  const prefix = root === '' ? '' : `${toKey(root, root)}/`
  rootPrefix = prefix
  if (held !== null && held.root === root) nestedPrefixes = held.nested.map(folder => prefix + fold(folder))
}

async function textsBefore($: EngineInterface, touches: ToolTouch[]): Promise<Map<string, string | null>> {
  const texts = new Map<string, string | null>()
  if (touches.some(touch => touch.kind === 'edit')) await knowRoot($)
  for (const one of touches.filter(touch => touch.kind === 'edit')) {
    if (!(await mayBeElsewhere($, one.path))) continue
    const text = await $.fs.read(one.path).catch(() => $.fs.exists(one.path).then(isThere => (isThere ? undefined : null), () => undefined))
    if (text !== undefined) texts.set(one.path, text)
  }
  return texts
}

async function inputTouches($: EngineInterface, e: Record<string, unknown>): Promise<{ touches: ToolTouch[]; isGrepOfOneFile: boolean }> {
  const touches = await locate($, touchesFromInput(e))
  const searched = e.tool === 'Grep' ? touches[0]?.path : undefined
  if (searched === undefined) return { touches, isGrepOfOneFile: false }
  const isGrepOfOneFile = await $.fs.stat(searched).then(
    stat => stat.kind === 'file',
    () => false,
  )
  return { touches: isGrepOfOneFile ? touches : [], isGrepOfOneFile }
}

function git($: EngineInterface, root: string, args: string[], init: ProcessRunInit = {}) {
  return $.process.run(gitArgv(root, args), { timeoutMs: GIT_TIMEOUT_MS, ...init, env: { ...init.env, ...GIT_ENV } })
}

function withStderr(stderr: string): string {
  const line = firstLine(stderr)
  return line === '' ? '' : `: ${line}`
}

async function runGit($: EngineInterface, root: string, args: string[], init?: ProcessRunInit): Promise<string> {
  const name = `git ${args.find((arg, i) => arg !== '-c' && args[i - 1] !== '-c') ?? ''}`
  const run = await git($, root, args, init)
  if (run.exitCode !== 0) throw new Error(`${name} ended with exit code ${run.exitCode}${withStderr(run.stderr)}`)
  if (run.isStdoutTruncated) throw new Error(`the output of ${name} is longer than 4 MiB`)
  return run.stdout
}

async function listFiles($: EngineInterface, root: string): Promise<MapFile[]> {
  const run = await git($, root, LIST_ARGS)
  const isEmpty = run.exitCode === 1 && run.stdout === ''
  if (run.exitCode !== 0 && !isEmpty) throw new Error(`git could not list the files of ${root} (exit code ${run.exitCode})${withStderr(run.stderr)}`)
  if (run.isStdoutTruncated) throw new Error(`git could not list the files of ${root} (the list is longer than 4 MiB)`)
  return parseFileList(run.stdout)
}

async function repoOf($: EngineInterface, folder: string): Promise<Top | string> {
  const run = await git($, folder, TOP_ARGS)
  if (run.exitCode === 0) return parseTop(run.stdout)
  if (/not a git repository/i.test(run.stderr)) return ''
  const said = run.stderr.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '').join(' ')
  return said === '' ? `git rev-parse ended with exit code ${run.exitCode}` : said
}

async function topOf($: EngineInterface, folder: string): Promise<Top | null> {
  const found = await repoOf($, folder)
  return typeof found === 'string' ? null : found
}

async function tempFolder($: EngineInterface): Promise<string> {
  const folder = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
  return folder.replace(/[\\/]+$/, '')
}

async function sessionFolder($: EngineInterface, id?: string): Promise<string> {
  return `${await tempFolder($)}/filemap-${id ?? (await $.session.id())}`
}

function stopIfEnded(folder: string): void {
  if (removed.has(folder)) throw new Error(ENDED)
}

async function writeLive($: EngineInterface, folder: string, path: string, text: string): Promise<void> {
  stopIfEnded(folder)
  await $.fs.write(path, text)
}

async function makePrivate($: EngineInterface, folder: string): Promise<void> {
  for (const argv of [['mkdir', '-p', '-m', '700', '--', folder], ['chmod', '700', '--', folder]]) {
    stopIfEnded(folder)
    const run = await $.process.run(argv, { timeoutMs: PRIVATE_TIMEOUT_MS })
    if (run.exitCode !== 0) throw new Error(`could not make ${folder} private: ${argv[0]} ended with exit code ${run.exitCode}${withStderr(run.stderr)}`)
  }
}

async function prepare($: EngineInterface, top: Top, isFollowing: boolean): Promise<Temp> {
  const temp = tempOf(await sessionFolder($), top.commonDir)
  if (!isFollowing) removed.delete(temp.folder)
  if ((await osName($)) !== 'win32') await makePrivate($, temp.folder)
  await writeLive($, temp.folder, `${temp.folder}/${STATUS_FILE}`, 'open')
  await writeLive($, temp.folder, `${temp.objects}/info/alternates`, alternatesOf(`${top.commonDir}/objects`))
  return temp
}

async function remove($: EngineInterface, folders: string[], timeoutMs: number): Promise<void> {
  const run =
    (await osName($)) === 'win32'
      ? await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', REMOVE_ON_WINDOWS], { env: { FILEMAP_REMOVE: folders.join('\n') }, timeoutMs })
      : await removeInBatches($, folders, timeoutMs)
  if (run.exitCode !== 0) throw new Error(`could not delete ${folders.join(', ')}: exit code ${run.exitCode}${withStderr(run.stderr)}`)
}

async function removeInBatches($: EngineInterface, folders: string[], timeoutMs: number): Promise<{ exitCode: number; stderr: string }> {
  for (const batch of batchesOf(folders, ARGUMENT_LIMIT)) {
    const run = await $.process.run(['rm', '-rf', '--', ...batch], { timeoutMs })
    if (run.exitCode !== 0) return run
  }
  return { exitCode: 0, stderr: '' }
}

async function isOver($: EngineInterface, folder: string, now: number): Promise<boolean> {
  const inside = await $.fs.list(folder)
  if (!inside.every(one => OURS.test(one.name))) return false
  if (!inside.some(one => one.name === STATUS_FILE)) return true
  return (await $.fs.read(`${folder}/${STATUS_FILE}`)) === 'ended' || now - Math.max(...inside.map(one => one.mtimeMs)) > STALE_AFTER_MS
}

async function sweep($: EngineInterface): Promise<void> {
  const temp = await tempFolder($)
  const own = `filemap-${await $.session.id()}`
  const now = await $.clock.now()
  const over: string[] = []
  for (const entry of await $.fs.list(temp)) if (entry.kind === 'dir' && SESSION_FOLDER.test(entry.name) && entry.name !== own && (await isOver($, `${temp}/${entry.name}`, now).catch(() => false))) over.push(`${temp}/${entry.name}`)
  if (over.length > 0) await remove($, over, REMOVE_TIMEOUT_MS)
}

async function endFolder($: EngineInterface, id: string, isGoingOn: boolean): Promise<void> {
  const folder = await sessionFolder($, id)
  if (!(await $.fs.exists(folder))) return
  await $.fs.write(`${folder}/${STATUS_FILE}`, 'ended')
  if (isGoingOn) return later($, CLEANING, () => sweep($))
  removed.add(folder)
  await remove($, [folder], END_TIMEOUT_MS)
}

async function freeIndex($: EngineInterface, folder: string, user: 'command' | 'job'): Promise<string> {
  for (let n = 0; n < INDEX_LIMIT; n++) {
    const index = `${folder}/${user}-${n}.index`
    if ((await $.fs.exists(`${index}.lock`)) || inUse.has(index)) continue
    inUse.add(index)
    return index
  }
  throw new Error(`every index file of the mod in ${folder} is locked`)
}

async function worktreesIn($: EngineInterface, top: Top): Promise<string[]> {
  const folder = `${absolute(top.commonDir, '')}/worktrees`
  const ids = await $.fs.list(folder).catch(() => [])
  const gitDirs = await Promise.all(ids.filter(one => one.kind === 'dir').slice(0, WORKTREE_LIMIT).map(one => $.fs.read(`${folder}/${one.name}/gitdir`).then(text => absolute(text.trim(), `${folder}/${one.name}`), () => '')))
  return nestedIn(top.root, gitDirs.filter(one => one !== '').map(folderOf))
}

async function modulesIn($: EngineInterface, top: Top): Promise<string[]> {
  return parseModules(await $.fs.read(`${top.root}/.gitmodules`).catch(() => ''))
}

async function withinLimit($: EngineInterface, root: string, paths: string[]): Promise<string[]> {
  const sizes = await Promise.all(paths.map(path => $.fs.stat(`${root}/${path}`).then(stat => (stat.kind === 'file' ? stat.size : 0), () => 0)))
  return paths.filter((_, i) => (sizes[i] ?? 0) <= FILE_LIMIT)
}

async function treeOfWorkingTree($: EngineInterface, top: Top, temp: Temp, user: 'command' | 'job', kept: Map<string, string | null>): Promise<{ tree: string; nested: string[] }> {
  const objects = { GIT_OBJECT_DIRECTORY: temp.objects }
  const config = sessionArgs(temp)
  const step = async (args: string[], init: ProcessRunInit) => {
    stopIfEnded(temp.folder)
    return runGit($, top.root, [...config, ...args], init)
  }
  const list = parseStatus(await step(STATUS_ARGS, { env: objects }))
  const nested = [...new Set([...list.nested, ...(await worktreesIn($, top)), ...(await modulesIn($, top))])]
  const paths = await withinLimit($, top.root, list.paths.filter(path => !kept.has(fold(path))))
  const index = await freeIndex($, temp.folder, user)
  const env = { ...objects, GIT_INDEX_FILE: index }
  try {
    await step(readTreeArgs(list.head), { env })
    if (paths.length > 0) await step(UPDATE_INDEX_ARGS, { env, stdin: pathsStdin(paths) })
    const listed = new Set(list.paths.map(fold))
    const unlisted = [...kept.keys()].filter(path => !listed.has(path))
    const clean = unlisted.length === 0 ? [] : (await step(trackedArgs(unlisted), { env })).split('\0').filter(path => path !== '')
    const entries: string[] = []
    for (const path of [...list.paths.filter(one => kept.has(fold(one))), ...clean]) {
      const before = kept.get(fold(path)) ?? null
      if (before !== null) entries.push(indexInfo(path, (await step(hashArgs(path), { env: objects, stdin: before })).trim(), list.head))
      else if (list.head !== '') entries.push(indexInfo(path, null, list.head))
    }
    if (entries.length > 0) await step(INDEX_INFO_ARGS, { env, stdin: entries.join('') })
    return { tree: (await step(WRITE_TREE_ARGS, { env })).trim(), nested }
  } finally {
    await freeAgain($, temp.folder, index).catch(error => logFailure($, 'Freeing the index file of the mod', error))
    inUse.delete(index)
  }
}

async function freeAgain($: EngineInterface, folder: string, index: string): Promise<void> {
  if (!removed.has(folder) && (await $.fs.exists(`${index}.lock`))) await remove($, [`${index}.lock`], REMOVE_TIMEOUT_MS)
  if (!removed.has(folder)) await $.fs.write(index, '')
}

async function treeOfCounts($: EngineInterface, loaded: RepoMap, before: Changes, counts: Temp): Promise<{ tree: string; nested: string[] }> {
  const alternates = `${counts.objects}/info/alternates`
  if (!(await $.fs.exists(alternates))) await writeLive($, counts.folder, alternates, alternatesOf(before.objects))
  return treeOfWorkingTree($, loaded, counts, 'job', new Map()).catch(async (error: unknown) => {
    stale.clear()
    if (!removed.has(counts.folder)) await remove($, [folderOf(counts.objects)], REMOVE_TIMEOUT_MS).catch(failure => logFailure($, 'Deleting the objects of a failed count', failure))
    throw error
  })
}

async function clearCounts($: EngineInterface, counts: Temp): Promise<void> {
  const inside = await $.fs.list(counts.objects).catch(() => [])
  if (inside.every(one => one.name === 'info')) return
  stale.clear()
  await remove($, [folderOf(counts.objects)], REMOVE_TIMEOUT_MS)
}

async function prune($: EngineInterface, counts: Temp, before: Counted, after: Counted): Promise<void> {
  for (const id of staleObjects(before, after)) {
    const path = looseObjectOf(counts.objects, id)
    await $.fs.stat(path).then(
      stat => stale.set(path, stat.size),
      () => undefined,
    )
  }
  for (const id of objectsOf(after)) stale.delete(looseObjectOf(counts.objects, id))
  const lfs = `${counts.lfs}/objects`
  const hasLfs = await $.fs.exists(lfs)
  if (!hasLfs && [...stale.values()].reduce((sum, size) => sum + size, 0) < PRUNE_LIMIT) return
  await remove($, [...stale.keys(), ...(hasLfs ? [lfs] : [])], REMOVE_TIMEOUT_MS)
  stale.clear()
}

async function load($: EngineInterface, top: Top, user: 'command' | 'job', kept: Map<string, string | null>, from?: RepoMap, since?: Since): Promise<{ files: MapFile[]; isCounted: boolean }> {
  await $.state.set(STALE, shaped(false))
  const files = await listFiles($, top.root).catch(async error => {
    await $.state.set(STALE, shaped(true))
    throw error
  })
  const taken = await prepare($, top, since !== undefined)
    .then(async temp => ({ ...temp, ...(await treeOfWorkingTree($, top, temp, user, kept)) }))
    .catch((error: unknown) => {
      if (reasonOf(error) !== ENDED) logFailure($, TAKING, error)
      return null
    })
  const isLive = since === undefined || (await read($, epoch)) === since.epoch
  let isStored = false
  await update($, map, cur => {
    isStored = isLive && (since === undefined || since.generation === generation) && (from === undefined || cur?.version === from.version)
    return isStored ? { root: top.root, repo: lastSegment(top.root), commonDir: top.commonDir, files, version: (cur?.version ?? 0) + 1 } : cur
  })
  if (isStored) {
    const prefix = `${toKey(top.root, top.root)}/`
    nestedPrefixes = (taken?.nested ?? []).map(folder => prefix + fold(folder))
    await keepZoom($, files)
    await $.state.set(CHANGES, shaped(taken === null ? null : { root: top.root, baseline: taken.tree, tree: taken.tree, files: {}, trees: [], folder: taken.folder, objects: taken.objects, nested: taken.nested }))
    await $.state.set(ROOT, shaped(top.root))
    if (rootPrefix !== prefix) {
      rootPrefix = prefix
      later($, RESOLVING, () => resolveFolders($))
    }
    if (taken !== null) countLater($)
  }
  return { files, isCounted: taken !== null }
}

async function relist($: EngineInterface, isOnlyWhenStale: boolean): Promise<void> {
  if (isOnlyWhenStale && ((await read($, isGitPaused)) || !(await read($, isStale)))) return
  const root = await read($, rootFolder)
  if (root === '') return
  await $.state.set(STALE, shaped(false))
  const files = await listFiles($, root).catch(async error => {
    await $.state.set(STALE, shaped(true))
    throw error
  })
  let isStored = false
  await update($, map, cur => {
    isStored = cur !== null && cur.root === root
    return cur === null || !isStored ? cur : { ...cur, files, version: cur.version + 1 }
  })
  if (isStored) await keepZoom($, files)
}

async function keepZoom($: EngineInterface, files: MapFile[]): Promise<void> {
  if (!hasFolder(files, await read($, zoom))) await $.state.set(ZOOM, shaped(''))
}

async function retake($: EngineInterface): Promise<void> {
  const loaded = await read($, map)
  if (loaded !== null && !(await read($, isGitPaused))) await load($, loaded, 'job', new Map(), loaded)
}

async function gitDirOf($: EngineInterface, cwd: string): Promise<string> {
  await osName($)
  for (let dir = absolute(cwd, ''), depth = 0; dir !== '' && depth < GIT_DIR_DEPTH; dir = folderOf(dir), depth++) {
    const stat = await $.fs.stat(`${dir}/.git`).catch(() => null)
    if (stat?.kind === 'dir') return `${dir}/.git`
    if (stat?.kind !== 'file') continue
    const named = /^gitdir:\s*(.+)$/m.exec(await $.fs.read(`${dir}/.git`))?.[1]?.trim()
    return named === undefined ? '' : absolute(named, dir)
  }
  return ''
}

async function refocus($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (now - focusedAt < REFOCUS_MS) return
  focusedAt = now
  later($, COUNTING, () => count($))
}

function countLater($: EngineInterface, afterMs = COUNT_AFTER_MS): void {
  countTimer?.cancel()
  countTimer = $.clock.after(afterMs, () => {
    countTimer = null
    later($, COUNTING, () => count($))
    later($, LISTING, () => relist($, true))
  })
}

async function worktreeOfWrite($: EngineInterface, loaded: RepoMap, path: string | undefined): Promise<Top | null> {
  const root = toKey(loaded.root, loaded.root)
  const folder = path === undefined ? '' : folderOf(absolute(path, ''))
  if (folder === '') return null
  if (!fold(folder).startsWith(`${root}/`) && fold(folder) !== root) return topOf($, folder)
  const inside = await nestedRootOf($, root.length, folder)
  return inside === '' ? null : topOf($, inside)
}

async function follow($: EngineInterface, loaded: RepoMap, wrote: Written[], since: Since): Promise<boolean> {
  const root = await $.session.root()
  const hasMoved = seenRoot !== undefined && toKey(root, '') !== toKey(seenRoot, '')
  const target = hasMoved ? await topOf($, root) : await worktreeOfWrite($, loaded, wrote.at(-1)?.path)
  if (target === null || toKey(target.commonDir, '') !== toKey(loaded.commonDir, '') || toKey(target.root, '') === toKey(loaded.root, '')) {
    seenRoot = root
    return false
  }
  const prefix = `${toKey(target.root, '')}/`
  const kept = new Map<string, string | null>()
  for (const one of wrote.toReversed()) {
    const key = toKey(one.path, '')
    if (!key.startsWith(prefix)) continue
    if (one.before === undefined) kept.delete(key.slice(prefix.length))
    else kept.set(key.slice(prefix.length), one.before)
  }
  await load($, target, 'job', kept, loaded, since)
  seenRoot = root
  return true
}

async function count($: EngineInterface): Promise<void> {
  countTimer?.cancel()
  countTimer = null
  await countOnce($).catch((error: unknown) => {
    if (reasonOf(error) === ENDED) return
    countLater($, RETRY_AFTER_MS)
    throw error
  })
}

async function countOnce($: EngineInterface): Promise<void> {
  const mine = generation
  const wrote = written.splice(0)
  if (await read($, isGitPaused)) return
  const loaded = await read($, map)
  if (loaded === null) return
  const since = { generation: mine, epoch: await read($, epoch) }
  if (await follow($, loaded, wrote, since)) {
    later($, COUNTING, () => count($))
    return
  }
  const held = await $.state.get(CHANGES)
  const before = ofThisShape(held.value) ?? null
  if (before === null || before.root !== loaded.root || removed.has(before.folder)) return
  const counts = countsOf(before.folder, loaded.commonDir)
  if (before.tree === before.baseline) await clearCounts($, counts).catch(error => logFailure($, 'Deleting the versions that the counts of an older baseline left', error))
  const { tree, nested } = await treeOfCounts($, loaded, before, counts)
  stopIfEnded(before.folder)
  const diff = tree === before.tree ? null : await runGit($, before.root, diffArgs(before.baseline, tree), { env: { GIT_OBJECT_DIRECTORY: counts.objects } })
  const after = diff === null ? before : { files: parseDiff(diff), trees: [tree, ...treesOf(diff)] }
  if (mine !== generation || (await read($, epoch)) !== since.epoch) return
  const isSame = tree === before.tree && nested.join('\0') === before.nested.join('\0')
  if (!isSame && !(await $.state.set(CHANGES, shaped({ ...before, tree, files: after.files, trees: after.trees, nested }), { ifVersion: held.version })).isSet) return
  nestedPrefixes = nested.map(folder => `${toKey(loaded.root, loaded.root)}/${fold(folder)}`)
  const found = newlyChanged(before.files, after.files)
  if (found.length > 0) {
    const now = await $.clock.now()
    await changeSession($, cur => (mine === generation ? noteChanges(cur, before.root, found, now) : cur))
    await $.state.set(STALE, shaped(true))
    later($, TIMING, () => timeWindow($))
    if (needsListing(loaded.files, after.files, found)) later($, LISTING, () => relist($, false))
  }
  if (diff !== null && !removed.has(before.folder)) await prune($, counts, before, after).catch(error => logFailure($, 'Deleting the old versions of the counted files', error))
  countLater($)
}

async function timeWindow($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const end = nextExpiry(await read($, session), now)
  if (end === null || (windowTimer !== null && windowTimer.at <= end)) return
  windowTimer?.timer.cancel()
  windowTimer = {
    at: end,
    timer: $.clock.after(end - now, () => {
      windowTimer = null
      $.ui.invalidate('ui.render')
      later($, TIMING, () => timeWindow($))
    }),
  }
}

async function resolveFolders($: EngineInterface): Promise<void> {
  const root = await read($, rootFolder)
  rootPrefix = root === '' ? '' : `${toKey(root, root)}/`
  if (root === '') return
  const moves: Array<[string, string]> = []
  for (const folder of foldersOutside(await read($, session), root)) {
    const key = fold(folder)
    if (realFolders.has(key)) continue
    const real = await $.fs.stat(folder, { resolve: true }).then(
      stat => (stat.realPath === undefined ? folder : absolute(stat.realPath, '')),
      () => folder,
    )
    realFolders.set(key, real)
    if (fold(real) !== key) moves.push([key, real])
  }
  if (moves.length > 0) await changeSession($, cur => moveFolders(cur, moves))
}

async function noteCall($: EngineInterface, tool: string, touches: ToolTouch[], isMain: boolean, mine: number, texts: Map<string, string | null>): Promise<void> {
  const now = await $.clock.now()
  let isNoted = false
  await changeSession($, cur => {
    isNoted = mine === generation
    return isNoted ? noteTouches(cur, touches, '', now, setsReadTime(tool)) : cur
  })
  if (!isNoted) return
  const edits = touches.filter(one => one.kind === 'edit')
  if (edits.length > 0) {
    if (isMain) written.push(...edits.map(one => (texts.has(one.path) ? { path: one.path, before: texts.get(one.path) ?? null } : { path: one.path })))
    await $.state.set(STALE, shaped(true))
    later($, COUNTING, () => count($))
  }
  if (touches.some(one => isUnplaced(one.path))) later($, RESOLVING, () => resolveFolders($))
  if (edits.length > 0 || setsReadTime(tool)) later($, TIMING, () => timeWindow($))
}

async function shellTouches($: EngineInterface, e: Record<string, unknown>, ran: ToolCallResult, cwd: string | undefined): Promise<ToolTouch[]> {
  const printed = ran.isError !== true && typeof ran.result === 'object' && ran.result !== null ? (ran.result as { stdout?: unknown }).stdout : ''
  const reads = shellReads(String(e.tool), typeof e.command === 'string' ? e.command : '', typeof printed === 'string' ? printed : '', ran.isError !== true)
  const named = await locate($, reads.map((path): ToolTouch => ({ path, kind: 'read' })), cwd)
  const isFile = await Promise.all(named.map(one => $.fs.stat(one.path).then(stat => stat.kind === 'file', () => false)))
  return named.filter((_, i) => isFile[i])
}

async function afterCall($: EngineInterface, e: Record<string, unknown>, ran: ToolCallResult, before: Before, mine: number): Promise<void> {
  if (ran.deny !== undefined) return
  const tool = String(e.tool)
  const touches = isShell(tool) ? await shellTouches($, e, ran, before.cwd) : ran.isError === true ? [] : [...before.named, ...(await locate($, touchesFromResult(e, ran.result, before.isGrepOfOneFile)))]
  if (touches.length > 0) await noteCall($, tool, touches, e.agentId === undefined, mine, before.texts)
  if ((isShell(tool) && ran.isReadOnly !== true) || (WORKTREE_TOOLS.has(tool) && ran.isError !== true)) later($, COUNTING, () => count($))
}

function toTheme(value: ConfigValue | undefined): Theme {
  return String(value).startsWith('light') ? 'light' : 'dark'
}

async function readTheme($: EngineInterface): Promise<Theme> {
  return toTheme((await $.config.list()).find(one => one.key === 'theme')?.value)
}

async function followTheme($: EngineInterface): Promise<void> {
  if ((await read($, rootFolder)) === '' || (await read($, isGitPaused))) return
  const row = await readTheme($)
  if (row !== (await read($, theme))) await $.state.set(THEME, shaped(row))
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find(line => line.trim() !== '')?.trim() ?? ''
}

function toastReadable($: EngineInterface, text: string): void {
  const shown = plainText(text).slice(0, REASON_LIMIT)
  $.ui.toast(shown, { timeoutMs: Math.max(TOAST_MS, shown.length * TOAST_MS_PER_CHARACTER) })
}

async function isExecutable($: EngineInterface, file: string): Promise<boolean> {
  return $.process.run(['test', '-x', file], { timeoutMs: OPEN_TIMEOUT_MS }).then(
    run => run.exitCode === 0,
    () => true,
  )
}

async function openFile($: EngineInterface, root: string, path: string): Promise<void> {
  const file = `${root.replace(/\/+$/, '')}/${path}`
  const os = await osName($)
  if (!(await $.fs.exists(file).catch(() => true))) {
    toastReadable($, `${path} is not on disk.`)
    return
  }
  const pathext = os === 'win32' ? ((await $.env.get('PATHEXT')) ?? '') : ''
  const runs = program === '' && (runsWhenOpened(os, path, pathext) || ((os === 'linux' || (os === 'darwin' && isExtensionless(path))) && (await isExecutable($, file))))
  if (runs && !isText(path)) {
    toastReadable($, `${path} was not opened: ${OS_NAMES[os]} would run it. See "Open files with" in /config.`)
    return
  }
  const opener = openerOf(os, program, file, runs)
  const reason = await $.process.run(opener.argv, { timeoutMs: OPEN_TIMEOUT_MS, ...(opener.env === undefined ? {} : { env: opener.env }) }).then(
    run => (run.exitCode === 0 ? null : `exit code ${run.exitCode}${withStderr(run.stderr)}`),
    reasonOf,
  )
  if (reason !== null) toastReadable($, `Could not open ${path} with ${program !== '' ? program : runs ? 'the default text editor' : 'its default app'}: ${reason}`)
}

function parseMessage(data: unknown): MapMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const { kind, path } = data as { kind?: unknown; path?: unknown }
  if (kind === 'up') return { kind: 'up' }
  return kind === 'click' && typeof path === 'string' ? { kind: 'click', path } : null
}

async function answer($: EngineInterface, message: MapMessage): Promise<void> {
  const loaded = await read($, map)
  if (loaded === null) return
  const now = await $.clock.now()
  const isFile = message.kind === 'click' && loaded.files.some(file => file.p === message.path)
  const isDouble = isFile && lastClick.path === message.path && now - lastClick.at < DOUBLE_MS
  lastClick = { path: isFile && !isDouble ? message.path : '', at: now }
  if (isFile) {
    if (isDouble) await openFile($, loaded.root, message.path)
    return
  }
  const shown = await read($, zoom)
  const next = message.kind === 'up' ? zoomOut(loaded.files, hasFolder(loaded.files, shown) ? shown : '') : message.path
  const isFolder = message.kind === 'up' || (next !== '' && hasFolder(loaded.files, next))
  if (isFolder && next !== shown) await $.state.set(ZOOM, shaped(next))
}

function narrowerLine(placement: 'dock' | 'inline', columns: number, conversation: number | undefined): string {
  if (placement !== 'dock' || columns >= paneColumns) return ''
  if (conversation === undefined || conversation <= CONVERSATION_COLUMNS) return `Widen the terminal to ${paneColumns + CONVERSATION_COLUMNS + EDGE_COLUMNS} columns, or lower "Pane width" ${paneColumns} in /config.`
  const dragged = `Claude Code uses the width you dragged a pane's edge to, not "Pane width" ${paneColumns}. Drag the edge to change it.`
  return dragged.length <= columns ? dragged : `A dragged width replaces "Pane width" ${paneColumns}.`
}

function coloursOf(span: Span): { color?: string; backgroundColor?: string } {
  return { ...(span.ink === undefined ? {} : { color: span.ink }), ...(span.fill === undefined ? {} : { backgroundColor: span.fill }) }
}

export const register: Register = (on, options) => {
  program = typeof options?.opener === 'string' ? options.opener.trim() : ''
  paneColumns = typeof options?.paneWidth === 'number' ? Math.round(options.paneWidth) : PANE_COLUMNS
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PANE,
      description: 'Draw a git repository as a map in a side pane that marks the files Claude reads and the lines that change.',
      argumentHint: '[folder]',
      immediate: true,
    })
    if ((await read($, map)) !== null) {
      await update($, epoch, n => n + 1)
      later($, COUNTING, () => count($))
      later($, TIMING, () => timeWindow($))
    }
    return next(e)
  })

  on('command.run', { command: PANE }, async ($, e) => {
    const os = await osName($)
    const cwd = await $.session.cwd()
    const typed = unquote(e.args.trim())
    const shownRoot = await read($, rootFolder)
    const folder = typed === '' ? shownRoot || cwd : resolveFolder(typed, cwd, typed.startsWith('~') ? await homeOf($) : '', os)
    try {
      const top = await repoOf($, folder)
      if (top === '') return { text: `${folder} is not inside a git repository, so there is no map to draw.` }
      if (typeof top === 'string') return { text: `Git could not read ${folder} as a repository: ${top}` }
      seenRoot = await $.session.root()
      const loaded = await load($, top, 'command', new Map())
      later($, CLEANING, () => sweep($))
      if (toKey(top.root, '') !== toKey(shownRoot, '') && (await read($, zoom)) !== '') await $.state.set(ZOOM, shaped(''))
      const row = await readTheme($).catch((error): Theme => {
        logFailure($, READING_THEME, error)
        return 'dark'
      })
      await $.state.set(THEME, shaped(row))
      await $.state.set(PAUSED, shaped(false))
      const opened = await $.ui.open({ id: PANE, title: 'File map', columns: paneColumns })
      const counts = loaded.isCounted ? '' : NOT_COUNTED
      const waits = opened.isPlaced ? '' : ` The pane is not drawn yet: ${opened.reason}`
      return { text: `File map of ${top.root}: ${loaded.files.length} files.${counts}${waits}` }
    } catch (error) {
      return { text: `The file map of ${folder} could not be drawn: ${reasonOf(error)}` }
    }
  })

  on('tool.call', async ($, e, next) => {
    const mine = generation
    const isShellCall = isShell(String(e.tool))
    const before: Before = { named: [], isGrepOfOneFile: false, texts: new Map() }
    try {
      if (isShellCall) before.cwd = await $.session.cwd()
      const input = await inputTouches($, e)
      before.named = input.touches
      before.isGrepOfOneFile = input.isGrepOfOneFile
      if (e.agentId === undefined) before.texts = await textsBefore($, before.named)
    } catch (error) {
      logFailure($, 'Naming the files of a tool call', error)
    }
    const ran = await next(e)
    const note = () => afterCall($, e, ran, before, mine)
    await (isShellCall ? detach($, NOTING, note) : note()).catch(error => logFailure($, NOTING, error))
    return ran
  })

  on('turn.start', ($, e, next) => {
    later($, READING_THEME, () => followTheme($))
    if (countTimer === null || failing.has(COUNTING)) later($, COUNTING, () => count($))
    if (windowTimer === null) later($, TIMING, () => timeWindow($))
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) later($, LISTING, () => relist($, true))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const isGoingOn = e.reason === 'clear' || e.reason === 'resume'
    if (isGoingOn) {
      generation += 1
      written.length = 0
      await $.state.set(SESSION, shaped(EMPTY_SESSION))
      await $.state.set(CHANGES, shaped(null))
      await update($, epoch, n => n + 1)
      later($, TAKING, () => retake($))
    }
    await endFolder($, e.sessionId, isGoingOn).catch(error => logFailure($, 'Deleting the folder of the session', error))
    return next(e)
  })

  on('ui.close', { id: PANE, origin: { kind: 'person' } }, async ($, e, next) => {
    const closed = await next(e)
    if (closed.deny === undefined) await $.state.set(PAUSED, shaped(true)).catch(error => logFailure($, 'Pausing the git work', error))
    return closed
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const changed = await next(e)
    if (changed.deny === undefined) await $.state.set(THEME, shaped(toTheme(changed.value))).catch(error => logFailure($, 'Storing the theme', error))
    return changed
  })

  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind === 'task-notification' || e.text.includes(TASK_ENDED)) later($, COUNTING, () => count($))
    return next(e)
  })

  on('prompt.attachment', ($, e, next) => {
    if (e.text.includes(TASK_ENDED)) later($, COUNTING, () => count($))
    return next(e)
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const focused = await next(e)
    await refocus($).catch(error => logFailure($, 'Counting when the pane gets the focus', error))
    return focused
  })

  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    const gitDir = await gitDirOf($, e.cwd).catch(() => '')
    return gitDir === '' ? started : { ...started, watchPaths: [...(started.watchPaths ?? []), `${gitDir}/index`, `${gitDir}/HEAD`] }
  })

  on('classic.FileChanged', async ($, e, next) => {
    const changed = await next(e)
    if (/[\\/](index|HEAD)$/.test(e.file_path)) later($, COUNTING, () => count($))
    return changed
  })

  on('ui.message', { requestId: PANE, element: 'map' }, async ($, e, next) => {
    const message = parseMessage(e.data)
    if (message !== null) await answer($, message).catch(error => logFailure($, 'Answering a click on the map', error))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>The file map draws in the terminal and in the desktop app.</Text>
    }
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    try {
      await osName($)
      const held = await read($, map)
      const loaded = held ?? NO_MAP
      const shown = await read($, zoom)
      const view = {
        columns: Math.max(1, Math.floor(e.props.bodyColumns)),
        rows: Math.max(1, Math.floor(e.props.scroll?.bodyRows ?? (e.viewport?.rows ?? 24) - 4)),
        zoom: hasFolder(loaded.files, shown) ? shown : '',
      }
      const idle = e.surface === 'terminal' ? narrowerLine(e.props.placement, view.columns, e.viewport?.columns) : ''
      const input = { ...screenInput(loaded, await read($, session), await read($, changes), view, await read($, theme), await $.clock.now(), held === null ? NOTICE : undefined), idle }
      const frame = paneFrame(input)
      const props = fitMap(rows => mapDrawing(input, rows), frame.mapRows)
      const list = listOf(input, frame)
      const regionRows = props === null ? frame.mapRows + 2 : 1 + props.rows.length + (props.rows.length > 0 ? 1 : 0)
      const drawSpan = (span: Span) => <Text {...coloursOf(span)}>{span.text}</Text>
      const tooLong = `The map is not drawn: ${view.zoom === '' ? 'this repository' : 'this folder'} has too many long file paths to draw at this width. Make the pane narrower${view.zoom === '' ? '' : ', or press up'}.`
      return (
        <Box flexDirection="column">
          {props === null ? (
            <Box key="map" height={regionRows}>
              <Text>{tooLong}</Text>
            </Box>
          ) : (
            <Client key="map" module="./map-client.tsx" props={props satisfies MapProps} width={view.columns} height={regionRows} />
          )}
          {frame.listRows > 0 ? (
            <Box key="list" flexDirection="column" height={frame.listRows}>
              {list.rows.map(row => (
                <Box flexDirection="row">
                  <Text backgroundColor={row.swatch}>{'  '}</Text>
                  <Text> </Text>
                  <Button key={`open:${row.path}`} label={row.label} plain dimColor onPress={() => void openFile($, loaded.root, row.path).catch(error => logFailure($, 'Opening a file of the list', error))} />
                  <Text wrap="truncate" {...coloursOf(row.rest)}>
                    {row.rest.text}
                  </Text>
                </Box>
              ))}
              {list.outside === null ? null : (
                <Text wrap="truncate" {...coloursOf(list.outside)}>
                  {list.outside.text}
                </Text>
              )}
            </Box>
          ) : null}
          {frame.hasLegend ? <Text wrap="truncate">{legendOf(input).map(drawSpan)}</Text> : null}
          {frame.hasControls ? (
            <Box key="controls" flexDirection="row" gap={1}>
              <Button
                key="refresh"
                label="refresh"
                onPress={() => {
                  inOrder(() => relist($, false)).catch(error => logFailure($, LISTING, error))
                  later($, COUNTING, () => count($))
                }}
              />
              {view.zoom === '' ? null : <Button key="up" label="up" onPress={() => void answer($, { kind: 'up' }).catch(error => logFailure($, 'Showing the folder around the map', error))} />}
            </Box>
          ) : null}
        </Box>
      )
    } catch (error) {
      logFailure($, 'Drawing the file map', error)
      const reason = plainText(reasonOf(error).replace(/\s+/g, ' ')).slice(0, REASON_LIMIT)
      return <Text>{`The file map could not be drawn: ${reason}`}</Text>
    }
  })
}
