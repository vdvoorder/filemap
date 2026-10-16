import { expect } from 'claude-code/testing'

import type { Changes, FileChange, RepoMap, Session } from '../types'
import {
  EMPTY_SESSION,
  WINDOW_MS,
  absolute,
  alternatesOf,
  batchesOf,
  countsOf,
  diffArgs,
  folderOf,
  foldersOutside,
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
  STATUS_ARGS,
  tempOf,
  toKey,
  TOP_ARGS,
  touchesFromInput,
  touchesFromResult,
  trackedArgs,
  treesOf,
  UPDATE_INDEX_ARGS,
  WRITE_TREE_ARGS,
  type ToolTouch,
  useWindows,
} from '../hooks/track'
import { test } from './limit'

useWindows(true)

const CWD = 'C:\\git\\src\\x'
const ROOT = 'C:/git/src/x'
const A = 'c:/git/src/x/a.ts'
const B = 'c:/git/src/x/src/b.ts'
const C = 'c:/git/src/x/c.ts'
const edit = (path: string): ToolTouch => ({ path, kind: 'edit' })
const read = (path: string): ToolTouch => ({ path, kind: 'read' })
const change = (blob: string, added = 1, deleted = 0, isBinary = false): FileChange => ({ added, deleted, isBinary, blob })

function onLinux(body: () => void): void {
  useWindows(false)
  try {
    body()
  } finally {
    useWindows(true)
  }
}

function frozen(s: Session): Session {
  Object.freeze(s.reads)
  Object.freeze(s.readAt)
  Object.freeze(s.changedAt)
  Object.freeze(s.labels)
  Object.freeze(s.recent)
  return Object.freeze(s)
}

test('toKey gives one key for every spelling of a Windows path', () => {
  expect(toKey('C:\\git\\src\\x\\a.ts', CWD)).toBe(A)
  expect(toKey('c:/git/src/x/A.ts', CWD)).toBe(A)
  expect(toKey('C:/git/src\\x/./src/..//a.ts', 'D:\\elsewhere')).toBe(A)
  expect(toKey('C:\\git\\src\\x\\', CWD)).toBe('c:/git/src/x')
})

test('toKey gives the same key for the Git Bash spelling and for the long-path prefix', () => {
  expect(toKey('/c/git/src/x/a.ts', CWD)).toBe(A)
  expect(toKey('/C/git/src/x/a.ts', 'D:\\elsewhere')).toBe(A)
  expect(toKey('\\\\?\\C:\\git\\src\\x\\a.ts', CWD)).toBe(A)
  expect(toKey('/c', CWD)).toBe('c:/')
  expect(toKey('/code/a.ts', CWD)).toBe('/code/a.ts')
  expect(toKey('/c/git/a.py', '/home/alex')).toBe('/c/git/a.py')
})

test('absolute puts a path that starts with ~ under the home folder', () => {
  const home = 'C:\\Users\\Alex'
  expect(absolute('~/x/a.ts', CWD, home)).toBe('C:/Users/Alex/x/a.ts')
  expect(absolute('~\\x\\a.ts', CWD, home)).toBe('C:/Users/Alex/x/a.ts')
  expect(absolute('~', CWD, home)).toBe('C:/Users/Alex')
  expect(absolute('~/a.py', '/tmp', '/home/alex')).toBe('/home/alex/a.py')
  expect(absolute('~draft.md', CWD, home)).toBe('C:/git/src/x/~draft.md')
})

test('isRooted is true for a path that needs no working folder to be placed: one with a drive on Windows, one that starts with / elsewhere', () => {
  expect(isRooted('C:\\git\\a.ts')).toBe(true)
  expect(isRooted('c:/git/a.ts')).toBe(true)
  expect(isRooted('a.ts')).toBe(false)
  expect(isRooted('/c/git/a.ts')).toBe(false)
  expect(isRooted('~/a.ts')).toBe(false)
  expect(isRooted('C:a.ts')).toBe(false)
  onLinux(() => {
    expect(isRooted('/home/alex/a.ts')).toBe(true)
    expect(isRooted('C:/git/a.ts')).toBe(false)
    expect(isRooted('a.ts')).toBe(false)
    expect(isRooted('~/a.ts')).toBe(false)
  })
})

test('toKey resolves a relative path against cwd', () => {
  expect(toKey('a.ts', CWD)).toBe(A)
  expect(toKey('.\\src\\b.ts', CWD)).toBe(B)
  expect(toKey('../x/src/../a.ts', 'c:/git/src/x/')).toBe(A)
  expect(toKey('..\\..\\bikeapp\\map.js', CWD)).toBe('c:/git/bikeapp/map.js')
})

test('toKey on Windows folds the case of a POSIX path too', () => {
  expect(toKey('/home/alex/Proj/A.py', '/tmp')).toBe('/home/alex/proj/a.py')
})

test('Linux: toKey keeps a path as git spells it: its case, a backslash in a name, and a drive-like first folder', () => {
  onLinux(() => {
    expect(toKey('/home/alex/Proj/A.py', '/tmp')).toBe('/home/alex/Proj/A.py')
    expect(toKey('src/./a.py', '/home/alex/proj/')).toBe('/home/alex/proj/src/a.py')
    expect(toKey('../b.py', '/home/alex/proj')).toBe('/home/alex/b.py')
    expect(toKey('/home/alex/proj/a\\b.ts', '/tmp')).toBe('/home/alex/proj/a\\b.ts')
    expect(toKey('C:/a.ts', '/home/alex')).toBe('/home/alex/C:/a.ts')
    expect(toKey('/c/git/a.py', '/home/alex')).toBe('/c/git/a.py')
    expect(absolute('~/Proj/a.py', '/tmp', '/home/alex')).toBe('/home/alex/Proj/a.py')
    expect(absolute('~\\a.py', '/tmp', '/home/alex')).toBe('/tmp/~\\a.py')
    expect(absolute('//?/x.py', '/tmp')).toBe('/?/x.py')
  })
})

test('Linux: two files whose names differ only in case keep two keys in the session and on the screen', () => {
  onLinux(() => {
    const root = '/home/alex/proj'
    const map: RepoMap = { root, repo: 'proj', commonDir: `${root}/.git`, files: [{ p: 'src/App.ts', lines: 10 }, { p: 'src/app.ts', lines: 20 }], version: 1 }
    const read1 = noteTouches(EMPTY_SESSION, [read(`${root}/src/App.ts`)], '', NOW)
    expect(read1.reads).toEqual({ [`${root}/src/App.ts`]: 1 })
    const both = noteChanges(read1, root, ['src/App.ts', 'src/app.ts'], NOW)
    expect(Object.keys(both.changedAt).sort()).toEqual([`${root}/src/App.ts`, `${root}/src/app.ts`])
    const changes: Changes = { root, baseline: 't0', tree: 't1', files: { 'src/App.ts': change('aa', 2, 1), 'src/app.ts': change('bb', 7, 3) }, trees: ['t1'], folder: '/tmp/f', objects: '/tmp/f/o', nested: [] }
    const input = screenInput(map, both, changes, { columns: 40, rows: 20 }, 'dark', NOW)
    expect(input.changedCount).toBe(2)
    expect(Object.keys(input.marks).sort()).toEqual(['src/App.ts', 'src/app.ts'])
    expect(input.marks['src/App.ts']?.change?.added).toBe(2)
    expect(input.marks['src/App.ts']?.isRead).toBe(true)
    expect(input.marks['src/app.ts']?.isRead).toBe(false)
    expect(input.recent.map(row => row.label).sort()).toEqual(['src/App.ts', 'src/app.ts'])
  })
})

test('touchesFromInput names the file of Read, Edit, Write and NotebookEdit', () => {
  expect(touchesFromInput({ tool: 'Read', file_path: 'C:\\git\\src\\x\\a.ts', tool_use_id: 't1' })).toEqual([
    read('C:\\git\\src\\x\\a.ts'),
  ])
  expect(touchesFromInput({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })).toEqual([edit('a.ts')])
  expect(touchesFromInput({ tool: 'Write', file_path: 'a.ts', content: '' })).toEqual([edit('a.ts')])
  expect(touchesFromInput({ tool: 'NotebookEdit', notebook_path: 'n.ipynb', new_source: '' })).toEqual([edit('n.ipynb')])
})

test('touchesFromInput names the path of a Grep call, whatever its name looks like', () => {
  expect(touchesFromInput({ tool: 'Grep', pattern: 'x', path: 'C:/git/src/x/src/b.ts' })).toEqual([read('C:/git/src/x/src/b.ts')])
  expect(touchesFromInput({ tool: 'Grep', pattern: 'x', path: 'C:/git/src/x/Makefile' })).toEqual([read('C:/git/src/x/Makefile')])
  expect(touchesFromInput({ tool: 'Grep', pattern: 'x', path: 'C:/git/src/x/Core.Tests' })).toEqual([read('C:/git/src/x/Core.Tests')])
  expect(touchesFromInput({ tool: 'Grep', pattern: 'x' })).toEqual([])
})

test('touchesFromInput gives nothing for other tools and for a missing path', () => {
  expect(touchesFromInput({ tool: 'Glob', pattern: '**/*.ts', path: 'C:/git/src/x/a.ts' })).toEqual([])
  expect(touchesFromInput({ tool: 'Bash', command: 'cat a.ts' })).toEqual([])
  expect(touchesFromInput({ tool: 'PowerShell', command: 'Get-Content a.ts' })).toEqual([])
  expect(touchesFromInput({ tool: 'mcp__server__read', file_path: 'a.ts' })).toEqual([])
  expect(touchesFromInput({ tool: 'Read' })).toEqual([])
  expect(touchesFromInput({ tool: 'Read', file_path: 7 })).toEqual([])
  expect(touchesFromInput({})).toEqual([])
})

test('touchesFromResult reads the filenames of a Grep result', () => {
  const result = { mode: 'files_with_matches', filenames: ['src\\b.ts', 'C:\\other\\c.py'], numFiles: 2, totalFiles: 2 }
  expect(touchesFromResult({ tool: 'Grep', pattern: 'x' }, result)).toEqual([read('src\\b.ts'), read('C:\\other\\c.py')])
  expect(touchesFromResult({ tool: 'Grep', pattern: 'x', path: 'src\\b.ts' }, result, true)).toEqual([read('src\\b.ts'), read('C:\\other\\c.py')])
  expect(touchesFromResult({ tool: 'Glob', pattern: '*' }, result)).toEqual([])
  expect(touchesFromResult({ tool: 'Grep', pattern: 'x' }, { filenames: 'src\\b.ts' })).toEqual([])
  expect(touchesFromResult({ tool: 'Grep', pattern: 'x' }, undefined)).toEqual([])
  expect(touchesFromResult({ tool: 'Grep', pattern: 'x' }, null)).toEqual([])
  expect(touchesFromResult({ tool: 'Grep', pattern: 'x' }, 'src\\b.ts')).toEqual([])
})

test('touchesFromResult reads the paths of content and count output, where filenames is empty', () => {
  const content = [
    'src\\b.ts:12:const a = 1',
    'src\\b.ts-13-const context = 2',
    'src\\b.ts:14:const a = 3',
    '--',
    'C:\\other\\c.py:3:a = "x:1:y"',
    'docs/read me.md:7:a',
    'Makefile:5:a file with no extension',
    '.gitignore:2:a',
  ].join('\n')
  expect(touchesFromResult({ tool: 'Grep', pattern: 'a' }, { mode: 'content', filenames: [], numFiles: 0, content, numLines: 8 })).toEqual([
    read('src\\b.ts'),
    read('C:\\other\\c.py'),
    read('docs/read me.md'),
    read('Makefile'),
    read('.gitignore'),
  ])
  const counts = 'src\\b.ts:2\nC:\\other\\c.py:11\nMakefile:3\n\nFound 16 total occurrences across 3 files.'
  expect(touchesFromResult({ tool: 'Grep', pattern: 'a' }, { mode: 'count', filenames: [], numFiles: 3, content: counts, numMatches: 16 })).toEqual([
    read('src\\b.ts'),
    read('C:\\other\\c.py'),
    read('Makefile'),
  ])
})

test('touchesFromResult takes a context line for no file, also when its text holds a time or a compiler location', () => {
  const F = 'C:\\work\\grep-fixture'
  const content = [
    `${F}\\docs\\log.md-1-build started at 10:30:00`,
    `${F}\\docs\\log.md:2:needle here`,
    `${F}\\docs\\log.md-3-src/app.ts:12:5 - error TS2322`,
    '--',
    `${F}\\b.ts:1:const needle = 1`,
    '--',
    `${F}\\App.Tests\\Makefile:1:needle: true`,
  ].join('\n')
  expect(touchesFromResult({ tool: 'Grep', pattern: 'needle', path: F, '-C': 1 }, { mode: 'content', filenames: [], numFiles: 0, content })).toEqual([
    read(`${F}\\docs\\log.md`),
    read(`${F}\\b.ts`),
    read(`${F}\\App.Tests\\Makefile`),
  ])
})

test('touchesFromResult reads no path from the lines of a search of one file', () => {
  const numbered = ['1-build started at 10:30:00', '2:needle here', '3-src/app.ts:12:5 - error TS2322'].join('\n')
  const plain = ['build started at 10:30:00', 'needle here', 'src/app.ts:12:5 - error TS2322'].join('\n')
  const e = { tool: 'Grep', pattern: 'needle', path: 'docs/log.md', '-C': 1 }
  expect(touchesFromResult(e, { mode: 'content', filenames: [], numFiles: 0, content: numbered }, true)).toEqual([])
  expect(touchesFromResult({ ...e, '-n': false }, { mode: 'content', filenames: [], numFiles: 0, content: plain }, true)).toEqual([])
  expect(touchesFromResult(e, { mode: 'count', filenames: [], numFiles: 0, content: '1' }, true)).toEqual([])
})

test('touchesFromResult reads the paths of content output that has no line numbers', () => {
  const F = 'C:\\work\\grep-fixture'
  const content = [
    `${F}\\b.ts:const needle = 1`,
    `${F}\\App.Tests\\Makefile:needle: true`,
    `${F}\\docs\\log.md-build started at 10:30:00`,
    `${F}\\docs\\log.md:needle here`,
    '--',
    'src/rel.ts:needle',
  ].join('\n')
  const result = { mode: 'content', filenames: [], numFiles: 0, content }
  expect(touchesFromResult({ tool: 'Grep', pattern: 'needle', path: F, '-n': false, '-C': 1 }, result)).toEqual([
    read(`${F}\\b.ts`),
    read(`${F}\\App.Tests\\Makefile`),
    read(`${F}\\docs\\log.md`),
    read('src/rel.ts'),
  ])
  const plain = { mode: 'content', filenames: [], numFiles: 0, content: 'src/rel.ts:needle\nMakefile:needle: true' }
  expect(touchesFromResult({ tool: 'Grep', pattern: 'needle', path: F }, plain)).toEqual([])
  expect(touchesFromResult({ tool: 'Grep', pattern: 'needle', path: F, '-n': false }, plain)).toEqual([read('src/rel.ts'), read('Makefile')])
})

test('isShell is true for Bash and PowerShell only', () => {
  expect(isShell('Bash')).toBe(true)
  expect(isShell('PowerShell')).toBe(true)
  expect(isShell('Read')).toBe(false)
  expect(isShell('bash')).toBe(false)
})

test('noteTouches counts the reads of a call under one key per file, with the time of the last read', () => {
  let s = frozen(noteTouches(EMPTY_SESSION, [read('C:\\git\\src\\x\\a.ts')], CWD, 100))
  s = frozen(noteTouches(s, [read('c:/git/src/x/A.ts')], CWD, 200))
  s = frozen(noteTouches(s, [read('src/b.ts')], CWD, 300))
  expect(s.reads).toEqual({ [A]: 2, [B]: 1 })
  expect(s.readAt).toEqual({ [A]: 200, [B]: 300 })
  expect(s.changedAt).toEqual({})
  expect(s.labels).toEqual({ [A]: 'C:/git/src/x/a.ts', [B]: 'C:/git/src/x/src/b.ts' })
  expect(s.recent).toEqual([B, A])
  expect(EMPTY_SESSION).toEqual({ reads: {}, readAt: {}, changedAt: {}, labels: {}, recent: [] })
})

test('a search counts its reads and sets no read time, and only Grep is a search', () => {
  const searched = frozen(noteTouches(EMPTY_SESSION, [read('a.ts'), read('src/b.ts')], CWD, 500, setsReadTime('Grep')))
  expect(searched.reads).toEqual({ [A]: 1, [B]: 1 })
  expect(searched.readAt).toEqual({})
  expect(searched.recent).toEqual([A, B])
  expect(setsReadTime('Grep')).toBe(false)
  expect(setsReadTime('Read')).toBe(true)
  expect(setsReadTime('Edit')).toBe(true)
  const later = noteTouches(noteTouches(searched, [read('a.ts')], CWD, 600), [read('a.ts')], CWD, 700, false)
  expect(later.readAt).toEqual({ [A]: 600 })
  expect(later.reads[A]).toBe(3)
})

test('noteTouches marks the files that an edit tool wrote as changed at that time, and counts no read for them', () => {
  const s = noteTouches(EMPTY_SESSION, [edit('a.ts'), edit('A.TS'), read('src/b.ts')], CWD, 42)
  expect(s.changedAt).toEqual({ [A]: 42 })
  expect(s.reads).toEqual({ [B]: 1 })
  expect(s.readAt).toEqual({ [B]: 42 })
  expect(s.recent).toEqual([A, B])
})

test('noteTouches gives back the same session when a tool call names no file', () => {
  const before = frozen(noteTouches(EMPTY_SESSION, [edit('a.ts')], CWD, 1))
  expect(noteTouches(before, [], CWD, 2)).toBe(before)
})

test('noteTouches counts a file once for one tool call', () => {
  const e = { tool: 'Grep', pattern: 'a', path: 'C:\\git\\src\\x\\a.ts', output_mode: 'files_with_matches' }
  const touches = [...touchesFromInput(e), ...touchesFromResult(e, { mode: 'files_with_matches', filenames: ['a.ts'], numFiles: 1 }, true)]
  expect(touches).toHaveLength(2)
  const s = noteTouches(EMPTY_SESSION, touches, CWD, 1, false)
  expect(s.reads).toEqual({ [A]: 1 })
  expect(s.recent).toEqual([A])
})

test('recent moves a file to the front and stops at 200 files, and a label is kept for those files only', () => {
  let s = EMPTY_SESSION
  for (let i = 0; i < 205; i++) s = noteTouches(s, [read(`F${i}.ts`)], CWD, i)
  expect(s.recent).toHaveLength(200)
  expect(s.recent[0]).toBe('c:/git/src/x/f204.ts')
  expect(s.recent[199]).toBe('c:/git/src/x/f5.ts')
  expect(Object.keys(s.reads)).toHaveLength(205)
  expect(Object.keys(s.labels).sort()).toEqual([...s.recent].sort())
  expect(s.labels['c:/git/src/x/f204.ts']).toBe('C:/git/src/x/F204.ts')
  s = noteTouches(s, [read('f100.ts'), read('f5.ts')], CWD, 300)
  expect(s.recent).toHaveLength(200)
  expect(s.recent.slice(0, 3)).toEqual(['c:/git/src/x/f100.ts', 'c:/git/src/x/f5.ts', 'c:/git/src/x/f204.ts'])
  expect(s.recent.filter(key => key === 'c:/git/src/x/f100.ts')).toHaveLength(1)
  expect(s.labels['c:/git/src/x/f100.ts']).toBe('C:/git/src/x/F100.ts')
  const many = Array.from({ length: 300 }, (_, i) => read(`g${i}.ts`))
  const full = noteTouches(s, many, CWD, 400)
  expect(full.recent).toHaveLength(200)
  expect(Object.keys(full.labels)).toHaveLength(200)
})

test('noteChanges marks the paths that a count found as changed at that time, at the front of the list', () => {
  const s = frozen(noteChanges(noteTouches(EMPTY_SESSION, [read('c.ts')], CWD, 1), ROOT, ['src/b.ts', 'a.ts'], 9))
  expect(s.changedAt).toEqual({ [B]: 9, [A]: 9 })
  expect(s.recent).toEqual([B, A, C])
  expect(s.labels[B]).toBe('C:/git/src/x/src/b.ts')
  expect(s.reads).toEqual({ [C]: 1 })
  expect(s.readAt).toEqual({ [C]: 1 })
  expect(noteChanges(s, ROOT, [], 10)).toBe(s)
})

test('nextExpiry is the end of the first read or change that is still in the last five minutes', () => {
  const s: Session = { ...EMPTY_SESSION, readAt: { [A]: 1_000, [B]: 50_000 }, changedAt: { [C]: 20_000 } }
  expect(WINDOW_MS).toBe(300_000)
  expect(nextExpiry(s, 0)).toBe(1_000 + WINDOW_MS)
  expect(nextExpiry(s, 1_000 + WINDOW_MS)).toBe(20_000 + WINDOW_MS)
  expect(nextExpiry(s, 20_000 + WINDOW_MS)).toBe(50_000 + WINDOW_MS)
  expect(nextExpiry(s, 50_000 + WINDOW_MS)).toBeNull()
  expect(nextExpiry(EMPTY_SESSION, 0)).toBeNull()
})

test('foldersOutside names the folders of the listed files that lie outside the repository', () => {
  let s = noteTouches(EMPTY_SESSION, [read('a.ts'), read('C:\\Users\\Alex\\.claude\\Rules\\git.md'), read('C:\\Users\\Alex\\.claude\\rules\\tools.md')], CWD, 1)
  s = noteTouches(s, [read('C:\\git\\src\\x2\\b.ts')], CWD, 2)
  expect(foldersOutside(s, ROOT)).toEqual(['C:/git/src/x2', 'C:/Users/Alex/.claude/Rules'])
  expect(foldersOutside(EMPTY_SESSION, ROOT)).toEqual([])
  const top = noteTouches(EMPTY_SESSION, [read('C:\\notes.txt'), read('/hosts')], CWD, 1)
  expect(Object.keys(top.reads)).toEqual(['c:/notes.txt', '/hosts'])
  expect(foldersOutside(top, ROOT)).toEqual([])
  expect(folderOf('C:/notes.txt')).toBe('')
  expect(folderOf('/hosts')).toBe('')
  expect(folderOf('C:/git/src/x/a.ts')).toBe('C:/git/src/x')
})

test('moveFolders puts the files of a junction under the folder it leads to, adds up their reads and keeps their latest times', () => {
  const junction = 'C:\\Users\\Alex\\.claude\\rules'
  let s = noteTouches(EMPTY_SESSION, [read('C:\\git\\src\\x\\rules\\git.md')], CWD, 10)
  s = noteTouches(s, [read('C:\\other\\notes.md')], CWD, 20)
  s = noteTouches(s, [read(`${junction}\\Git.md`), read(`${junction}\\sub\\tools.md`)], CWD, 30)
  s = frozen(noteTouches(s, [edit(`${junction}\\Git.md`)], CWD, 40))
  const moved = moveFolders(s, [['c:/users/alex/.claude/rules', 'C:/git/src/x/rules']])
  expect(moved.reads).toEqual({ 'c:/git/src/x/rules/git.md': 2, 'c:/other/notes.md': 1, 'c:/git/src/x/rules/sub/tools.md': 1 })
  expect(moved.readAt).toEqual({ 'c:/git/src/x/rules/git.md': 30, 'c:/other/notes.md': 20, 'c:/git/src/x/rules/sub/tools.md': 30 })
  expect(moved.changedAt).toEqual({ 'c:/git/src/x/rules/git.md': 40 })
  expect(moved.recent).toEqual(['c:/git/src/x/rules/git.md', 'c:/git/src/x/rules/sub/tools.md', 'c:/other/notes.md'])
  expect(moved.labels['c:/git/src/x/rules/sub/tools.md']).toBe('C:/git/src/x/rules/sub/tools.md')
  expect(moved.labels['c:/other/notes.md']).toBe('C:/other/notes.md')
  const map: RepoMap = { root: ROOT, repo: 'x', commonDir: `${ROOT}/.git`, files: [{ p: 'rules/git.md', lines: 80 }], version: 1 }
  expect(screenInput(map, s, null, { columns: 48, rows: 30 }, 'dark', 50).marks).toEqual({ 'rules/git.md': { changed: 0, change: null, isRead: true, isNow: false } })
  const input = screenInput(map, moved, null, { columns: 48, rows: 30 }, 'dark', 50)
  expect(input.readCount).toBe(2)
  expect(input.recent.map(row => row.label)).toEqual(['rules/git.md', 'rules/sub/tools.md'])
  expect(input.outside).toBe(1)
})

test('LIST_ARGS is the one git call that lists files with line counts, without submodules, which git refuses to list with untracked files', () => {
  expect(LIST_ARGS).toEqual(['grep', '--no-color', '--no-recurse-submodules', '-I', '-c', '--untracked', '-z', '-e', ''])
})

test('parseFileList keeps the source and text file types, sorted by path', () => {
  const stdout = [
    'ünï/çafé déjà.md\x003\n',
    '.gitignore\x001\n',
    'a b.ts\x003\n',
    'lib.min.js\x001\n',
    'node_modules/dep/index.js\x001\n',
    'notes.txt\x001\n',
    'package-lock.json\x001\n',
    'sub/crlf.ts\x002\n',
    'sub/x.py\x002\n',
    'sub/venv/y.py\x004\n',
    'sub/venv.py\x005\n',
    'Cargo.lock\x009\n',
    'SHOUT.JSON\x001200\n',
    'Makefile\x0010\n',
  ].join('')
  expect(parseFileList(stdout)).toEqual([
    { p: 'SHOUT.JSON', lines: 1200 },
    { p: 'a b.ts', lines: 3 },
    { p: 'sub/crlf.ts', lines: 2 },
    { p: 'sub/venv.py', lines: 5 },
    { p: 'sub/x.py', lines: 2 },
    { p: 'ünï/çafé déjà.md', lines: 3 },
  ])
  expect(parseFileList('')).toEqual([])
})

const SAMPLE = 'C:/Users/R/AppData/Local/Temp/samples-repo'

test('TOP_ARGS asks git for the top folder of a worktree and the git folder that the worktrees of its repository share', () => {
  expect(TOP_ARGS).toEqual(['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir'])
  expect(parseTop(`${SAMPLE}\n${SAMPLE}/.git\n`)).toEqual({ root: SAMPLE, commonDir: `${SAMPLE}/.git` })
  expect(parseTop(`${SAMPLE}/x-feature\n${SAMPLE}/.git\n`)).toEqual({ root: `${SAMPLE}/x-feature`, commonDir: `${SAMPLE}/.git` })
  expect(parseTop(`${SAMPLE}/vendor/sub\n${SAMPLE}/.git/modules/vendor/sub\n`).commonDir).toBe(`${SAMPLE}/.git/modules/vendor/sub`)
})

test('the commands that build a tree of the working tree, and the one that compares two trees', () => {
  expect(STATUS_ARGS).toEqual(['status', '--porcelain=v2', '--branch', '--no-ahead-behind', '--untracked-files=all', '--no-renames', '-z'])
  expect(readTreeArgs(HEAD)).toEqual(['read-tree', HEAD])
  expect(readTreeArgs('')).toEqual(['read-tree', '--empty'])
  expect(UPDATE_INDEX_ARGS).toEqual(['update-index', '--add', '--remove', '-z', '--stdin'])
  expect(WRITE_TREE_ARGS).toEqual(['write-tree'])
  expect(hashArgs('src/new name.ts')).toEqual(['hash-object', '-w', '--stdin', '--path=src/new name.ts'])
  expect(INDEX_INFO_ARGS).toEqual(['update-index', '-z', '--index-info'])
  expect(indexInfo('src/a.ts', H('4'), HEAD)).toBe(`100644 ${H('4')}\tsrc/a.ts\0`)
  expect(indexInfo('src/new name.ts', null, HEAD)).toBe(`0 ${H('0')}\tsrc/new name.ts\0`)
  expect(indexInfo('src/new name.ts', null, 'a'.repeat(64))).toBe(`0 ${'0'.repeat(64)}\tsrc/new name.ts\0`)
  expect(trackedArgs(['src/a.ts', 'docs/*.md'])).toEqual(['ls-files', '-z', '--', ':(literal,icase)src/a.ts', ':(literal,icase)docs/*.md'])
  onLinux(() => expect(trackedArgs(['src/A.ts'])).toEqual(['ls-files', '-z', '--', ':(literal)src/A.ts']))
  expect(pathsStdin(['a.ts', 'new name.ts', 'ünï new.py'])).toBe('a.ts\0new name.ts\0ünï new.py\0')
  expect(pathsStdin([])).toBe('')
  expect(diffArgs('base', 'now')).toEqual(['diff-tree', '-r', '-t', '-z', '--no-renames', '--raw', '--numstat', 'base', 'now'])
})

test('the session folder holds one object folder per repository, whose alternates name the objects of that repository, the LFS storage, and a hooks folder that holds no hook; the git commands write no shared index, and put no big file into a pack', () => {
  const temp = tempOf('C:\\Temp/filemap-s1', 'C:/work/repo/.git')
  expect(temp).toEqual({ folder: 'C:\\Temp/filemap-s1', objects: 'C:\\Temp/filemap-s1/objects-7c080e50', lfs: 'C:\\Temp/filemap-s1/lfs' })
  expect(tempOf('C:\\Temp/filemap-s1', 'C:\\Work\\Repo\\.git\\')).toEqual(temp)
  expect(tempOf('C:\\Temp/filemap-s1', 'C:/work/other/.git').objects).not.toBe(temp.objects)
  expect(alternatesOf('C:\\work\\repo\\.git\\objects')).toBe('C:/work/repo/.git/objects\n')
  expect(alternatesOf('/home/me/repo/.git/objects')).toBe('/home/me/repo/.git/objects\n')
  expect(sessionArgs({ folder: '/tmp/filemap-s1', objects: '/tmp/filemap-s1/objects-x', lfs: '/tmp/filemap-s1/lfs' })).toEqual([
    ...['-c', 'lfs.storage=/tmp/filemap-s1/lfs', '-c', 'core.hooksPath=/tmp/filemap-s1/hooks', '-c', 'core.looseCompression=0', '-c', 'core.safecrlf=false'],
    ...['-c', 'core.splitIndex=false', '-c', 'core.bigFileThreshold=4095m'],
  ])
})

test('the counts of a repository hash into a folder of their own beside the object folder of its baseline, with their own LFS storage and the hooks folder of the session', () => {
  const counts = countsOf('C:\\Temp/filemap-s1', 'C:/work/repo/.git')
  expect(counts).toEqual({ folder: 'C:\\Temp/filemap-s1', objects: 'C:\\Temp/filemap-s1/counts-7c080e50/objects', lfs: 'C:\\Temp/filemap-s1/counts-7c080e50/lfs' })
  expect(alternatesOf(tempOf('C:\\Temp/filemap-s1', 'C:/work/repo/.git').objects)).toBe('C:/Temp/filemap-s1/objects-7c080e50\n')
  expect(sessionArgs(counts).slice(0, 4)).toEqual(['-c', 'lfs.storage=C:\\Temp/filemap-s1/counts-7c080e50/lfs', '-c', 'core.hooksPath=C:\\Temp/filemap-s1/hooks'])
  expect(looseObjectOf(counts.objects, '4cb29ea38f70d7c61b2a3a25b02e3bdf44905402')).toBe('C:\\Temp/filemap-s1/counts-7c080e50/objects/4c/b29ea38f70d7c61b2a3a25b02e3bdf44905402')
})

test('staleObjects names each version of a file and each tree of a folder that a count replaced or undid and that the latest count has no more, once, and never the empty id', () => {
  const zero = '0'.repeat(40)
  const before = { files: { 'a.ts': change('a1'), 'b.ts': change('b1'), 'c.ts': change('c1'), 'copy.ts': change('a1'), 'gone.ts': change(zero) }, trees: ['root1', 'src1', 'lib1'] }
  const after = { files: { 'a.ts': change('a2'), 'b.ts': change('b1'), 'd.ts': change('c1') }, trees: ['root2', 'src2', 'lib1'] }
  expect(staleObjects(before, after)).toEqual(['a1', 'root1', 'src1'])
  expect(staleObjects({ files: { 'a.ts': change('a1'), 'b.ts': change('b1') }, trees: ['root1'] }, { files: {}, trees: ['base'] })).toEqual(['a1', 'b1', 'root1'])
  expect(staleObjects({ files: {}, trees: [] }, after)).toEqual([])
  expect(objectsOf(after)).toEqual(['a2', 'b1', 'c1', 'root2', 'src2', 'lib1'])
})

test('needsListing is true for a new file of a mapped type that the map lacks, and for a file of the map that is gone', () => {
  const files = [{ p: 'src/a.ts', lines: 10 }]
  const zero = '0'.repeat(40)
  expect(needsListing(files, { 'src/c.ts': change('c') }, ['src/c.ts'])).toBe(true)
  expect(needsListing(files, { 'src/a.ts': change(zero, 0, 10) }, ['src/a.ts'])).toBe(true)
  expect(needsListing(files, {}, ['src/a.ts'])).toBe(true)
  expect(needsListing(files, { 'src/a.ts': change('a') }, ['src/a.ts'])).toBe(false)
  expect(needsListing(files, { 'notes.txt': change('n'), 'logo.ts': change('l', 0, 0, true) }, ['logo.ts', 'notes.txt'])).toBe(false)
  expect(needsListing(files, { 'src/c.ts': change('c') }, [])).toBe(false)
})

const H = (digit: string) => digit.repeat(40)
const HEAD = 'cd2c678023c80b64d82c71113b6b2fff2c16ba1e'

const STATUS = [
  `# branch.oid ${HEAD}`,
  '# branch.head main',
  `1 .M N... 100644 100644 100644 ${H('2')} ${H('2')} a.ts`,
  `1 M. N... 100644 100644 100644 ${H('c')} ${H('9')} b.ts`,
  `1 D. N... 100644 000000 000000 ${H('a')} ${H('0')} cached.ts`,
  `1 .D N... 100644 100644 000000 ${H('a')} ${H('a')} gone.ts`,
  `1 .M N... 100644 100644 100644 ${H('b')} ${H('b')} logo.bin`,
  `1 A. N... 000000 100644 100644 ${H('0')} ${H('3')} new name.ts`,
  `1 D. N... 100644 000000 000000 ${H('3')} ${H('0')} old name.ts`,
  `1 .M SC.. 160000 160000 160000 ${H('c')} ${H('c')} vendor/sub`,
  `u UU N... 100644 100644 100644 100644 ${H('d')} ${H('b')} ${H('9')} both changed.ts`,
  '? cached.ts',
  '? vendor/lib/',
  '? x-feature/',
  '? ünï new.py',
  '',
].join('\0')

test('parseStatus reads the head and every path that may differ from it, each once, and the submodules, repositories and worktrees nested in it apart', () => {
  expect(parseStatus(STATUS)).toEqual({
    head: HEAD,
    paths: ['a.ts', 'b.ts', 'cached.ts', 'gone.ts', 'logo.bin', 'new name.ts', 'old name.ts', 'both changed.ts', 'ünï new.py'],
    nested: ['vendor/sub/', 'vendor/lib/', 'x-feature/'],
  })
  expect(parseStatus('')).toEqual({ head: '', paths: [], nested: [] })
})

test('parseStatus reads a repository with no commit', () => {
  const stdout = ['# branch.oid (initial)', '# branch.head main', `1 A. N... 000000 100644 100644 ${H('0')} ${H('b')} staged.ts`, '? a.ts', ''].join('\0')
  expect(parseStatus(stdout)).toEqual({ head: '', paths: ['staged.ts', 'a.ts'], nested: [] })
})

test('parseModules names the folder of each submodule in a .gitmodules file, with or without quotes, and nothing else', () => {
  const modules = ['[submodule "lib"]', '\tpath = vendor/lib', '\turl = https://example.invalid/lib.git', '[submodule "two"]', '  path="vendor/two words/" ', '; path = commented/out', '[core]', '\tpathspec = no', ''].join('\n')
  expect(parseModules(modules)).toEqual(['vendor/lib/', 'vendor/two words/'])
  expect(parseModules('[submodule "w"]\r\n\tpath = win/lib\r\n')).toEqual(['win/lib/'])
  expect(parseModules('')).toEqual([])
})

test('parseModules reads a .gitmodules file as git reads its config: a key in any case, a comment after the value, escapes, and a section header with a key after it or a dot', () => {
  expect(parseModules('[submodule "lib"]\n\tPath = vendor/lib\n')).toEqual(['vendor/lib/'])
  expect(parseModules('[Submodule "lib"]\n\tPATH=vendor/lib\n')).toEqual(['vendor/lib/'])
  expect(parseModules('[submodule "lib"]\n\tpath = vendor/lib # checkout directory\n')).toEqual(['vendor/lib/'])
  expect(parseModules('[submodule "lib"]\n\tpath = vendor/lib;old\n')).toEqual(['vendor/lib/'])
  expect(parseModules('[submodule "lib"]\n\tpath = "vendor/#1 lib" ; quoted\n')).toEqual(['vendor/#1 lib/'])
  expect(parseModules('[submodule "lib"]\n\tpath = vendor/\\"q\\" \\\\x\n')).toEqual(['vendor/"q" \\x/'])
  expect(parseModules('[submodule "lib"]\tpath = vendor/lib\n[submodule.two]\n\tpath = vendor/two\n')).toEqual(['vendor/lib/', 'vendor/two/'])
  expect(parseModules('[submodule "a]b"]\n\tpath = vendor/ab\n[core]\n\tpath = no\n\tpath\n')).toEqual(['vendor/ab/'])
})

test('nestedIn names the worktrees inside the root as git status names a nested repository, sorted, and none outside it or at the root itself', () => {
  const roots = ['C:/work/repo/.claude/worktrees/agent-2', 'C:\\Work\\Repo\\.claude\\worktrees\\agent-1', 'C:/work/repo', 'C:/work/repo-feature', 'C:/work/other/x']
  expect(nestedIn('C:/work/repo', roots)).toEqual(['.claude/worktrees/agent-1/', '.claude/worktrees/agent-2/'])
  expect(nestedIn('C:/work/repo', [])).toEqual([])
})

const DIFF = [
  `:000000 100644 ${H('0')} d997920e511039094997b6c121ae01dff1ab0595 A`, 'assets.bin',
  `:040000 000000 f5f729e82ad59ecad64d2e862500aab3604d2649 ${H('0')} D`, 'docs',
  `:100644 000000 ea64ffa6c9f064a584f4d932198e79dd7608ec1d ${H('0')} D`, 'docs/charts.md',
  ':040000 040000 c5d1394b97e64311067cb4185038d4ea6002e323 fc6ffe570442ae1e71fa262531583e1fd920bffb M', 'src',
  ':040000 040000 dc150ba1b9287b7ec4f59986dc488c59705c0402 297ebf43a10ab83c8b8d7e73354882a1f01431a4 M', 'src/lib',
  ':100644 100644 88bee7d2f022e202eb8d8efcc9e5bb50619188b7 4effaecfd6d35dd6f3bea4ada0720479336f0748 M', 'src/lib/dates.ts',
  ':100644 100644 c24dbdb97abe387cf023b7c9e75e4aaf0ab196d4 e2a0fdd828e67016bbeb7e9a3f1df0e456310bd0 M', 'src/lib/geo.ts',
  ':100644 100644 9067351d8acf9c6f321bc5843149b82c00e8032f ad3eb8be1efe556634efd4ba30938c8759a8cd24 M', 'src/lib/scales.ts',
  `:000000 100644 ${H('0')} 422c2b7ab3b3c668038da977e4e93a5fc623169c A`, 'src/new name.ts',
  '-\t-\tassets.bin', '0\t387\tdocs/charts.md', '1\t0\tsrc/lib/dates.ts', '1\t0\tsrc/lib/geo.ts', '0\t3\tsrc/lib/scales.ts', '2\t0\tsrc/new name.ts',
  '',
].join('\0')
const MODE = [
  ':100644 100644 88bee7d2f022e202eb8d8efcc9e5bb50619188b7 433b160a7828337c8c5ca5c2885bb56e1412c395 M', 'src/lib/dates.ts',
  ':100644 100755 c24dbdb97abe387cf023b7c9e75e4aaf0ab196d4 c24dbdb97abe387cf023b7c9e75e4aaf0ab196d4 M', 'src/lib/geo.ts',
  '1\t0\tsrc/lib/dates.ts', '0\t0\tsrc/lib/geo.ts',
  '',
].join('\0')

test('parseDiff reads the lines added and deleted and the new content of each file, a binary file, and no change of mode alone', () => {
  expect(parseDiff(DIFF)).toEqual({
    'assets.bin': { added: 0, deleted: 0, isBinary: true, blob: 'd997920e511039094997b6c121ae01dff1ab0595' },
    'docs/charts.md': { added: 0, deleted: 387, isBinary: false, blob: H('0') },
    'src/lib/dates.ts': { added: 1, deleted: 0, isBinary: false, blob: '4effaecfd6d35dd6f3bea4ada0720479336f0748' },
    'src/lib/geo.ts': { added: 1, deleted: 0, isBinary: false, blob: 'e2a0fdd828e67016bbeb7e9a3f1df0e456310bd0' },
    'src/lib/scales.ts': { added: 0, deleted: 3, isBinary: false, blob: 'ad3eb8be1efe556634efd4ba30938c8759a8cd24' },
    'src/new name.ts': { added: 2, deleted: 0, isBinary: false, blob: '422c2b7ab3b3c668038da977e4e93a5fc623169c' },
  })
  expect(parseDiff(MODE)).toEqual({ 'src/lib/dates.ts': { added: 1, deleted: 0, isBinary: false, blob: '433b160a7828337c8c5ca5c2885bb56e1412c395' } })
  expect(parseDiff('')).toEqual({})
  expect(Object.keys(parseDiff([`:000000 100644 ${H('0')} ${H('1')} A`, '__proto__', '1\t0\t__proto__', ''].join('\0')))).toEqual(['__proto__'])
})

test('treesOf names the new tree of each folder that changed or came, and parseDiff takes no tree as the content of a file of the same name', () => {
  expect(treesOf(DIFF)).toEqual(['fc6ffe570442ae1e71fa262531583e1fd920bffb', '297ebf43a10ab83c8b8d7e73354882a1f01431a4'])
  const typeChange = [`:100644 000000 ${H('a')} ${H('0')} D`, 'x', `:000000 040000 ${H('0')} ${H('b')} A`, 'x', `:000000 100644 ${H('0')} ${H('c')} A`, 'x/y.ts', '0\t1\tx', '1\t0\tx/y.ts', ''].join('\0')
  expect(treesOf(typeChange)).toEqual([H('b')])
  expect(parseDiff(typeChange)).toEqual({ x: { added: 0, deleted: 1, isBinary: false, blob: H('0') }, 'x/y.ts': { added: 1, deleted: 0, isBinary: false, blob: H('c') } })
  expect(treesOf([`:100644 100644 ${H('1')} ${H('2')} M`, ':040000 040000 x', '1\t0\t:040000 040000 x', ''].join('\0'))).toEqual([])
  expect(treesOf('')).toEqual([])
})

test('newlyChanged lists a new change, a further change and a file back as the baseline had it, and no file the last count had as it is', () => {
  const before = { 'a.ts': change('a1'), 'b.ts': change('b1'), 'gone.ts': change('g1', 0, 2) }
  const after = { 'a.ts': change('a1'), 'b.ts': change('b2'), 'new.ts': change('n1', 4) }
  expect(newlyChanged(before, after)).toEqual(['b.ts', 'gone.ts', 'new.ts'])
  expect(newlyChanged(after, after)).toEqual([])
  expect(newlyChanged({ 'a.ts': change('a1', 1, 1) }, { 'a.ts': change('a2', 1, 1) })).toEqual(['a.ts'])
  expect(newlyChanged({}, { constructor: change('c1') })).toEqual(['constructor'])
  expect(newlyChanged({ toString: change('t1') }, {})).toEqual(['toString'])
})

const MAP: RepoMap = {
  root: 'c:\\GIT\\src\\X\\',
  repo: 'x',
  commonDir: 'c:/git/src/x/.git',
  files: [
    { p: 'a.ts', lines: 10 },
    { p: 'Src/B.ts', lines: 20 },
    { p: 'c.ts', lines: 5 },
  ],
  version: 3,
}
const NOW = 1_000_000
const counted = (files: Record<string, FileChange>, root = MAP.root): Changes => ({ root, baseline: 'base', tree: 'now', files, trees: ['now'], folder:'C:/Temp/filemap-s1', objects: 'C:/Temp/filemap-s1/objects-1', nested: [] })

test('screenInput marks each file of the map with its changed lines, its reads and whether it changed in the last five minutes', () => {
  let s = noteTouches(EMPTY_SESSION, [read('a.ts')], CWD, NOW - 10)
  s = noteChanges(s, ROOT, ['Src/B.ts'], NOW - 1_000)
  s = noteChanges(s, ROOT, ['c.ts'], NOW - WINDOW_MS)
  const changes = counted({ 'Src/B.ts': change('b1', 3, 5), 'c.ts': change('c1', 1, 0), 'notes.txt': change('n1', 2), 'logo.png': change('l1', 0, 0, true) })
  const input = screenInput(MAP, s, changes, { columns: 48, rows: 30 }, 'dark', NOW)
  expect(input.repo).toBe('x')
  expect(input.files).toEqual(MAP.files)
  expect(input.filesVersion).toBe(3)
  expect(input.columns).toBe(48)
  expect(input.rows).toBe(30)
  expect(input.theme).toBe('dark')
  expect(input.notice).toBeUndefined()
  expect(input.windowMinutes).toBe(5)
  expect(input.marks).toEqual({
    'a.ts': { changed: 0, change: null, isRead: true, isNow: false },
    'src/b.ts': { changed: 5, change: change('b1', 3, 5), isRead: false, isNow: true },
    'c.ts': { changed: 1, change: change('c1', 1, 0), isRead: false, isNow: false },
  })
  expect(input.changedCount).toBe(4)
  expect(input.readCount).toBe(1)
  const binary = screenInput({ ...MAP, files: [{ p: 'c.ts', lines: 5 }] }, s, counted({ 'c.ts': change('c2', 0, 0, true) }), { columns: 48, rows: 30 }, 'dark', NOW)
  expect(binary.marks['c.ts']?.changed).toBe(5)
})

test('screenInput lists the files most recent first: a changed file with its counts, a file only read as read, and no file that is neither', () => {
  let s = noteTouches(EMPTY_SESSION, [read('docs\\Guide.md')], CWD, 1)
  s = noteTouches(s, [read('c.ts')], CWD, 2)
  s = noteTouches(s, [edit('a.ts')], CWD, 3)
  s = noteChanges(s, ROOT, ['Src/B.ts', 'gone.ts'], NOW - 5)
  const changes = counted({ 'Src/B.ts': change('b1', 3, 5), 'docs/Guide.md': change('g1', 0, 4) })
  const input = screenInput(MAP, s, changes, { columns: 48, rows: 30 }, 'dark', NOW)
  expect(input.recent).toEqual([
    { label: 'Src/B.ts', change: change('b1', 3, 5), isNow: true },
    { label: 'c.ts', change: null, isNow: false },
    { label: 'docs/Guide.md', change: change('g1', 0, 4), isNow: false },
  ])
})

test('screenInput counts the files outside the repository as one number and lists none of them', () => {
  let s = noteTouches(EMPTY_SESSION, [read('C:\\Users\\alex\\Notes.md')], CWD, 1)
  s = noteTouches(s, [edit('C:\\git\\src\\other\\d.ts')], CWD, 2)
  s = noteTouches(s, [read('C:\\git\\src\\x2\\a.ts'), read('a.ts')], CWD, 3)
  const input = screenInput(MAP, s, null, { columns: 48, rows: 30 }, 'dark', NOW)
  expect(input.outside).toBe(3)
  expect(input.recent.map(row => row.label)).toEqual(['a.ts'])
  expect(input.readCount).toBe(1)
  expect(input.changedCount).toBe(0)
})

test('screenInput counts the files of a worktree or repository nested in the root as outside it, as the last count found them', () => {
  let s = noteTouches(EMPTY_SESSION, [edit('.claude\\worktrees\\agent-1\\a.ts'), read('.claude\\worktrees\\agent-1\\Src\\B.ts')], CWD, NOW - 10)
  s = noteTouches(s, [read('a.ts'), read('.claude\\other.md')], CWD, NOW - 5)
  const input = screenInput(MAP, s, { ...counted({}), nested: ['.claude/worktrees/Agent-1/'] }, { columns: 48, rows: 30 }, 'dark', NOW)
  expect(input.outside).toBe(2)
  expect(input.readCount).toBe(2)
  expect(input.busy).toEqual(['.claude', 'top level'])
  expect(screenInput(MAP, s, counted({}), { columns: 48, rows: 30 }, 'dark', NOW).outside).toBe(0)
})

test('screenInput names up to three busy folders of the last five minutes, two levels deep at most, from reads and changes and no search', () => {
  const map: RepoMap = { ...MAP, files: [] }
  let s = noteTouches(EMPTY_SESSION, ['src/charts/shared/axis.ts', 'src/charts/bar.ts', 'src/charts/line.ts'].map(read), CWD, NOW - 10)
  s = noteChanges(s, ROOT, ['tests/b.test.ts', 'tests/c.test.ts', 'README.md'], NOW - 5)
  s = noteChanges(s, ROOT, ['sql/old.sql', 'sql/older.sql', 'sql/oldest.sql', 'sql/oldest-2.sql'], NOW - WINDOW_MS)
  s = noteTouches(s, ['docs/a.md', 'docs/b.md', 'docs/c.md', 'docs/d.md'].map(read), CWD, NOW - 1, false)
  const busy = (session: Session) => screenInput(map, session, null, { columns: 48, rows: 30 }, 'dark', NOW).busy
  expect(busy(s)).toEqual(['src/charts', 'tests', 'top level'])
  expect(busy(noteTouches(s, [read('src/lib/x.ts'), read('src/lib/y.ts')], CWD, NOW))).toEqual(['src/charts', 'src/lib', 'tests'])
  expect(busy(EMPTY_SESSION)).toEqual([])
  expect(busy(noteTouches(EMPTY_SESSION, [read('C:\\elsewhere\\a.ts')], CWD, NOW))).toEqual([])
})

test('screenInput names a file on the map as git spells it, whatever spelling the tool call used', () => {
  let s = noteTouches(EMPTY_SESSION, [read('C:\\GIT\\SRC\\X\\DOCS\\GUIDE.MD')], CWD, 1)
  s = noteTouches(s, [read('C:\\GIT\\SRC\\X\\SRC\\B.TS')], CWD, 2)
  s = noteTouches(s, [read('/c/git/src/x/a.ts')], CWD, 3)
  const input = screenInput(MAP, s, null, { columns: 48, rows: 30 }, 'dark', NOW)
  expect(input.recent.map(row => row.label)).toEqual(['a.ts', 'Src/B.ts', 'DOCS/GUIDE.MD'])
  expect(Object.keys(input.marks).sort()).toEqual(['a.ts', 'src/b.ts'])
})

test('screenInput does not take a sibling folder for the root', () => {
  const s = noteTouches(EMPTY_SESSION, [read('C:\\git\\src\\x2\\a.ts')], CWD, 1)
  const input = screenInput(MAP, s, null, { columns: 40, rows: 20 }, 'light', NOW, 'Not a git repository')
  expect(input.marks).toEqual({})
  expect(input.recent).toEqual([])
  expect(input.outside).toBe(1)
  expect(input.theme).toBe('light')
  expect(input.notice).toBe('Not a git repository')
})

test('screenInput lists the first 50 rows and counts the whole session', () => {
  let s = EMPTY_SESSION
  for (let i = 0; i < 60; i++) s = noteTouches(s, [read(`f${i}.ts`)], CWD, i)
  const input = screenInput(MAP, s, null, { columns: 40, rows: 20 }, 'dark', NOW)
  expect(input.recent).toHaveLength(50)
  expect(input.recent[0]?.label).toBe('f59.ts')
  expect(input.recent[49]?.label).toBe('f10.ts')
  expect(input.readCount).toBe(60)
})

test('a count made in another worktree than the one on the map marks no file and lists no change', () => {
  const s = noteChanges(EMPTY_SESSION, ROOT, ['a.ts'], NOW)
  const input = screenInput(MAP, s, counted({ 'a.ts': change('a1', 2, 0) }, 'C:/git/src/x-feature'), { columns: 40, rows: 20 }, 'dark', NOW)
  expect(input.marks).toEqual({})
  expect(input.recent).toEqual([])
  expect(input.changedCount).toBe(0)
})

test('screenInput with an empty root puts no file inside it', () => {
  const none: RepoMap = { root: '', repo: '', commonDir: '', files: [], version: 0 }
  const windows = noteTouches(EMPTY_SESSION, [edit('a.ts')], CWD, 1)
  const posix = noteTouches(EMPTY_SESSION, [read('a.py')], '/home/alex/Proj', 1)
  expect(screenInput(none, windows, null, { columns: 40, rows: 20 }, 'dark', NOW).marks).toEqual({})
  expect(screenInput(none, windows, null, { columns: 40, rows: 20 }, 'dark', NOW).outside).toBe(1)
  expect(screenInput(none, posix, null, { columns: 40, rows: 20 }, 'dark', NOW).recent).toEqual([])
  expect(screenInput(none, posix, null, { columns: 40, rows: 20 }, 'dark', NOW).readCount).toBe(0)
})

test('screenInput works for a POSIX root', () => {
  const map: RepoMap = { root: '/home/alex/Proj', repo: 'Proj', commonDir: '/home/alex/Proj/.git', files: [{ p: 'src/a.py', lines: 5 }], version: 1 }
  const s = noteTouches(EMPTY_SESSION, [read('src/a.py'), read('/etc/hosts')], '/home/alex/Proj', NOW)
  const input = screenInput(map, s, counted({ 'src/a.py': change('a1', 1, 1) }, '/home/alex/Proj'), { columns: 40, rows: 20 }, 'dark', NOW)
  expect(input.marks).toEqual({ 'src/a.py': { changed: 1, change: change('a1', 1, 1), isRead: true, isNow: false } })
  expect(input.recent).toEqual([{ label: 'src/a.py', change: change('a1', 1, 1), isNow: false }])
  expect(input.outside).toBe(1)
  expect(input.busy).toEqual(['src'])
})

test('screenInput takes the folder that the map shows, and the whole repository when it is given none', () => {
  const s = noteTouches(EMPTY_SESSION, [read('Src/B.ts')], CWD, NOW)
  expect(screenInput(MAP, s, null, { columns: 40, rows: 20, zoom: 'Src' }, 'dark', NOW).zoom).toBe('Src')
  expect(screenInput(MAP, s, null, { columns: 40, rows: 20 }, 'dark', NOW).zoom).toBe('')
  const zoomed = screenInput(MAP, s, null, { columns: 40, rows: 20, zoom: 'Src' }, 'dark', NOW)
  const whole = screenInput(MAP, s, null, { columns: 40, rows: 20 }, 'dark', NOW)
  expect({ ...zoomed, zoom: '' }).toEqual(whole)
})

const POWERSHELL = ['powershell', '-NoProfile', '-NonInteractive', '-Command']
const START =
  "try { $c = Get-Command -Name $env:FILEMAP_PROGRAM -CommandType Application -ErrorAction Stop | Where-Object Extension | Select-Object -First 1; " +
  "$isScript = $c.Path -match '\\.(cmd|bat)$'; " +
  "if ($isScript -and $env:FILEMAP_OPEN.Contains('%')) { [Console]::Error.WriteLine($c.Name + ' runs through cmd.exe, which changes a % in the path; name the .exe of the program in /config'); exit 2 }; " +
  "Start-Process -FilePath $c.Path -ArgumentList ('\"' + $env:FILEMAP_OPEN + '\"') -WindowStyle $(if ($isScript) { 'Hidden' } else { 'Normal' }) -ErrorAction Stop } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"

test('Windows: openerOf hands the path to PowerShell in an environment variable with backslashes: Invoke-Item opens the default app, Start-Process the program of the setting', () => {
  expect(openerOf('win32', '', 'C:\\work\\repo/src/a&calc&%USERNAME%.ts', false)).toEqual({ argv: [...POWERSHELL, 'Invoke-Item -LiteralPath $env:FILEMAP_OPEN'], env: { FILEMAP_OPEN: 'C:\\work\\repo\\src\\a&calc&%USERNAME%.ts' } })
  expect(openerOf('win32', 'C:\\Program Files\\Notepad++\\notepad++.exe', 'C:/git/src/x/a.ts', false)).toEqual({
    argv: [...POWERSHELL, START],
    env: { FILEMAP_OPEN: 'C:\\git\\src\\x\\a.ts', FILEMAP_PROGRAM: 'C:\\Program Files\\Notepad++\\notepad++.exe' },
  })
})

const AS_TEXT =
  "if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { try { Start-Process -FilePath notepad.exe -ArgumentList ('\"' + $env:FILEMAP_OPEN + '\"') -ErrorAction Stop; exit 0 } catch { throw $_.Exception.Message } }; " +
  "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FilemapText { " +
  '[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Info { public int Size; public uint Mask; public IntPtr Window; public string Verb; public string File; public string Parameters; public string Directory; public int Show; public IntPtr Instance; public IntPtr IdList; public string Class; public IntPtr ClassKey; public uint HotKey; public IntPtr Icon; public IntPtr Process; } ' +
  '[DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ShellExecuteExW(ref Info info); ' +
  'const uint ClassName = 0x1, NoAsync = 0x100, NoUi = 0x400; ' +
  "public static int Open(string file, string type) { var info = new Info { Mask = ClassName | NoAsync | NoUi, File = file, Class = type, Show = 1 }; info.Size = Marshal.SizeOf(info); return ShellExecuteExW(ref info) ? 0 : Marshal.GetLastWin32Error(); } }'; " +
  "$code = [FilemapText]::Open($env:FILEMAP_OPEN, '.txt'); " +
  'if ($code -ne 0) { [Console]::Error.WriteLine((New-Object ComponentModel.Win32Exception $code).Message); exit 1 }'

test('Windows: openerOf for a text file that Windows runs hands the path in an environment variable to ShellExecuteEx with the class .txt, so the app of .txt files shows it, or to Notepad where PowerShell runs in a language mode that refuses Add-Type; the program of the setting still opens it', () => {
  expect(openerOf('win32', '', "C:\\work\\repo/tools/run&calc&%USERNAME% 'q'.py", true)).toEqual({ argv: [...POWERSHELL, AS_TEXT], env: { FILEMAP_OPEN: "C:\\work\\repo\\tools\\run&calc&%USERNAME% 'q'.py" } })
  expect(openerOf('win32', 'code', 'C:/work/repo/tools/run.py', true)).toEqual({ argv: [...POWERSHELL, START], env: { FILEMAP_OPEN: 'C:\\work\\repo\\tools\\run.py', FILEMAP_PROGRAM: 'code' } })
})

const PROGRAM_ON_MAC =
  'if { [ -f "$1" ] && [ -x "$1" ]; } || { case "$1" in */*) false ;; *) command -v "$1" >/dev/null 2>&1 ;; esac; }; then "$1" "$2" </dev/null >/dev/null 2>&1 & exit 0; fi; exec open -a "$1" "$2"'
const AS_TEXT_ON_LINUX =
  'app=$(xdg-mime query default text/plain 2>/dev/null); ' +
  '[ -n "$app" ] || { echo "xdg-mime names no app for text/plain" >&2; exit 3; }; ' +
  'if command -v gtk-launch >/dev/null 2>&1; then exec setsid -f gtk-launch "$app" "$1" </dev/null >/dev/null 2>&1; fi; ' +
  'for d in "${XDG_DATA_HOME:-$HOME/.local/share}" $(printf %s "${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" | tr : " "); do [ -f "$d/applications/$app" ] && exec setsid -f gio launch "$d/applications/$app" "$1" </dev/null >/dev/null 2>&1; done; ' +
  'echo "found no way to start $app" >&2; exit 3'

test('Linux and macOS: openerOf passes the path and the program as arguments that no shell reads, and the Linux opener leaves on its own session with /dev/null for its streams', () => {
  const path = "/home/me/repo/a b&c %HOME% $(x) 'y' a\\b.ts"
  expect(openerOf('linux', '', path, false)).toEqual({ argv: ['setsid', '-f', 'sh', '-c', 'if command -v gio >/dev/null; then exec gio open "$1"; else exec xdg-open "$1"; fi </dev/null >/dev/null 2>&1', 'sh', path] })
  expect(openerOf('linux', 'code', path, false)).toEqual({
    argv: ['sh', '-c', 'command -v "$1" >/dev/null 2>&1 || { echo "$1 is not a program on PATH" >&2; exit 127; }; exec setsid -f "$1" "$2" </dev/null >/dev/null 2>&1', 'sh', 'code', path],
  })
  expect(openerOf('darwin', '', path, false)).toEqual({ argv: ['open', path] })
  expect(openerOf('darwin', 'Visual Studio Code', path, false)).toEqual({ argv: ['sh', '-c', PROGRAM_ON_MAC, 'sh', 'Visual Studio Code', path] })
  expect(openerOf('darwin', 'code', path, false)).toEqual({ argv: ['sh', '-c', PROGRAM_ON_MAC, 'sh', 'code', path] })
})

test('openerOf opens a text file that the system would run in the default text editor, unless the setting names a program: on macOS with open -t, on Linux in the app that xdg-mime names for text/plain', () => {
  const path = "/home/me/repo/tools/run b&c $(x) 'y'.py"
  expect(openerOf('darwin', '', path, true)).toEqual({ argv: ['open', '-t', path] })
  expect(openerOf('darwin', 'Visual Studio Code', path, true)).toEqual({ argv: ['sh', '-c', PROGRAM_ON_MAC, 'sh', 'Visual Studio Code', path] })
  expect(openerOf('linux', '', path, true)).toEqual({ argv: ['sh', '-c', AS_TEXT_ON_LINUX, 'sh', path] })
  expect(openerOf('linux', 'code', path, true)).toEqual(openerOf('linux', 'code', path, false))
})

test('isText is true for a type whose files are plain text, in any case: the types that the map draws, and the scripts and the settings written as XML or plain text that Windows or macOS would run; it is false for a type that is not plain text, as .exe, .msi, .lnk, .xll, an encoded or compiled script, and for a name with no extension', () => {
  for (const path of ['tools/run.py', 'web/app.js', 'scripts/setup.sh', 'scripts/setup.bash', 'build.ps1', 'mod.psm1', 'src/a.ts', 'docs/a.md', 'build.cmd', 'a/b/tool.BAT', 'tools/.cmd', 'Run.PY', 'tools/build.au3']) expect(isText(path)).toBe(true)
  for (const path of ['tools/app.pyw', 'src/Module/Module.psd1', 'deploy.vbs', 'x.pl', 'x.rb', 'x.rbw', 'keys.ahk', 'x.ksh', 'x.csh', 'script.tcl', 'Form.bas', 'App.vb', 'job.wsf', 'page.hta', 'site.aspx', 'run.command', 'bin/x.tool']) expect(isText(path)).toBe(true)
  for (const path of ['Types.ps1xml', 'shell.psc1', 'Cmdlets.cdxml', 'session.pssc', 'app.application', 'app.appinstaller', 'app.jnlp', 'box.wsb', 'docs.library-ms', 'console.msc']) expect(isText(path)).toBe(true)
  for (const path of ['fix.reg', 'driver.inf', 'site.url', 'site.website', 'dark.theme', 'db.udl', 'desktop.scf', 'page.mht']) expect(isText(path)).toBe(true)
  for (const path of ['setup.exe', 'install.msi', 'Tool.LNK', 'addin/calc.xll', 'updates/kb.msu', 'dist/tool.a3x', 'run.vbe', 'run.jse', 'cache/x.pyc', 'dist/tool.pyz', 'cert.cer', 'help.chm', 'Basic.terminal', 'site.webloc', 'gradlew', 'notes.', 'a.py/run']) expect(isText(path)).toBe(false)
})

test('Windows: runsWhenOpened is true for a type that Windows runs, installs or applies instead of showing: one PATHEXT names, in any case, and the types beside it, also a type that the map draws', () => {
  for (const path of ['build.cmd', 'a/b/tool.BAT', 'setup.exe', 'run.vbs', 'install.msi', 'Tool.LNK', 'tools/.cmd', 'site.url', 'fix.reg', 'page.hta']) expect(runsWhenOpened('win32', path, '')).toBe(true)
  for (const path of ['tools/app.pyw', 'dist/tool.pyz', 'dist/tool.pyzw', 'cache/x.pyc', 'cache/x.pyo', 'updates/kb.msu', 'addin/calc.xll', 'addin/macros.xla', 'addin/macros.xlam', 'addin/deck.ppam', 'shell.psc1', 'fix.diagcab', 'dark.theme', 'dark.themepack', 'dark.deskthemepack', 'app.mde', 'app.accde']) expect(runsWhenOpened('win32', path, '')).toBe(true)
  for (const path of ['web/app.js', 'tools/run.py', 'scripts/setup.sh', 'scripts/setup.bash', 'build.ps1', 'mod.psm1', 'mod.psd1', 'tool.pl', 'tool.rb', 'keys.ahk', 'tools/build.au3', 'dist/tool.a3x', 'app.jnlp', 'ext.vsix', 'App.msix', 'disk.iso', 'disk.vhdx', 'open.settingcontent-ms', 'box.wsb', 'page.mht', 'x.inf']) expect(runsWhenOpened('win32', path, '')).toBe(true)
  expect(runsWhenOpened('win32', 'script.tcl', '.COM;.EXE;.TCL')).toBe(true)
  expect(runsWhenOpened('win32', 'script.tcl', '')).toBe(false)
  for (const path of ['notes.txt', 'report.pdf', 'logo.png', 'src/a.ts', 'src/b.tsx', 'web/app.mjs', 'docs/a.md', 'data.json', 'page.html', 'model.tmdl', 'report.pbix', 'Makefile', 'cmd', 'x.']) expect(runsWhenOpened('win32', path, '.COM;.EXE;.BAT;.CMD;.JS;.PY;.PS1')).toBe(false)
})

test('a name with no extension, as gradlew, configure or .zshrc, is extensionless, and one with an extension after its first letter is not', () => {
  for (const path of ['gradlew', 'tools/configure', 'LICENSE', '.zshrc', 'a.b/run']) expect(isExtensionless(path)).toBe(true)
  for (const path of ['src/a.ts', 'run.command', '.github/x.yml', 'x.']) expect(isExtensionless(path)).toBe(false)
})

test('macOS: runsWhenOpened is true for a type that macOS runs, installs or mounts instead of showing, as Terminal runs a .command or .tool file and Python Launcher a .py file', () => {
  for (const path of ['run.command', 'bin/x.tool', 'Basic.terminal', 'Tool.app', 'setup.pkg', 'setup.mpkg', 'disk.dmg', 'flow.workflow', 'x.action', 'pane.prefPane', 'x.saver', 'profile.mobileconfig', 'x.shortcut', 'site.webloc', 'site.inetloc', 'x.fileloc', 'tool.jar', 'app.jnlp', 'tools/run.py', 'tools/app.pyw', 'cache/x.pyc']) expect(runsWhenOpened('darwin', path, '')).toBe(true)
  for (const path of ['src/a.ts', 'scripts/setup.sh', 'notes.txt', 'build.cmd', 'setup.exe']) expect(runsWhenOpened('darwin', path, '')).toBe(false)
})

test('Linux: runsWhenOpened is true for a type that a desktop runs or installs without the execute bit, as a .jar, a .desktop launcher or a package; a script runs only with the execute bit, which the opener checks on its own', () => {
  for (const path of ['tool.jar', 'app.jnlp', 'apps/x.desktop', 'pkg.deb', 'pkg.rpm', 'app.snap', 'app.flatpakref', 'repo.flatpakrepo', 'Tool.AppImage', 'setup.run']) expect(runsWhenOpened('linux', path, '')).toBe(true)
  for (const path of ['run.command', 'build.cmd', 'setup.exe', 'scripts/setup.sh', 'tools/run.py', 'src/a.ts', 'gradlew']) expect(runsWhenOpened('linux', path, '')).toBe(false)
  expect(isText('apps/x.desktop')).toBe(true)
})

test('batchesOf splits the paths in their order into batches whose arguments add up to the limit at most, and gives a path longer than the limit a batch of its own', () => {
  const paths = ['/tmp/a1', '/tmp/a2', '/tmp/a3', '/tmp/a4', '/tmp/a5']
  expect(batchesOf(paths, 16)).toEqual([['/tmp/a1', '/tmp/a2'], ['/tmp/a3', '/tmp/a4'], ['/tmp/a5']])
  expect(batchesOf(paths, 1000)).toEqual([paths])
  expect(batchesOf(['/tmp/a1', `/tmp/${'x'.repeat(20)}`, '/tmp/a2'], 16)).toEqual([['/tmp/a1'], [`/tmp/${'x'.repeat(20)}`], ['/tmp/a2']])
  expect(batchesOf([], 16)).toEqual([])
  const many = Array.from({ length: 20_000 }, (_, i) => `/tmp/filemap-${'s'.repeat(36)}/counts-7c080e50/objects/${String(i).padStart(40, '0').slice(0, 2)}/${String(i).padStart(38, '0')}`)
  const batches = batchesOf(many, 64 * 1024)
  expect(batches.flat()).toEqual(many)
  for (const batch of batches) expect(batch.reduce((size, path) => size + path.length + 1, 0)).toBeLessThanOrEqual(64 * 1024)
})
