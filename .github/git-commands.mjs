import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  GIT_ENV,
  INDEX_INFO_ARGS,
  LIST_ARGS,
  STATUS_ARGS,
  TOP_ARGS,
  UPDATE_INDEX_ARGS,
  WRITE_TREE_ARGS,
  absolute,
  alternatesOf,
  countsOf,
  diffArgs,
  fold,
  folderOf,
  gitArgv,
  hashArgs,
  indexInfo,
  nestedIn,
  objectsOf,
  parseDiff,
  parseFileList,
  parseModules,
  parseStatus,
  parseTop,
  pathsStdin,
  readTreeArgs,
  sessionArgs,
  tempOf,
  trackedArgs,
  treesOf,
  useWindows,
} from '../hooks/track.ts'

useWindows(process.platform === 'win32')
for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('GIT_')) delete process.env[key]

function run(argv, cwd, input) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, input, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${argv.join(' ')} ended with exit code ${r.status}: ${r.stderr}`)
  return r.stdout
}

function git(root, args, env = {}, input) {
  const [command = '', ...rest] = gitArgv(root, args)
  const r = spawnSync(command, rest, { input, encoding: 'utf8', env: { ...process.env, ...env, ...GIT_ENV } })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} ended with exit code ${r.status}: ${r.stderr}`)
  return r.stdout
}

function check(isTrue, what) {
  if (!isTrue) throw new Error(`failed: ${what}`)
  console.log(`ok: ${what}`)
}

function filesUnder(folder) {
  if (!fs.existsSync(folder)) return []
  return fs.readdirSync(folder, { recursive: true }).map(String).sort()
}

function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}

function treeOf(top, temp, user, kept = new Map()) {
  const objects = { GIT_OBJECT_DIRECTORY: temp.objects }
  const config = sessionArgs(temp)
  const list = parseStatus(git(top.root, [...config, ...STATUS_ARGS], objects))
  const env = { ...objects, GIT_INDEX_FILE: `${temp.folder}/${user}-0.index` }
  git(top.root, [...config, ...readTreeArgs(list.head)], env)
  const paths = list.paths.filter(one => !kept.has(fold(one)))
  if (paths.length > 0) git(top.root, [...config, ...UPDATE_INDEX_ARGS], env, pathsStdin(paths))
  const listed = new Set(list.paths.map(fold))
  const unlisted = [...kept.keys()].filter(one => !listed.has(one))
  const clean = unlisted.length === 0 ? [] : git(top.root, [...config, ...trackedArgs(unlisted)], env).split('\0').filter(one => one !== '')
  const entries = [...list.paths.filter(one => kept.has(fold(one))), ...clean].flatMap(one => {
    const before = kept.get(fold(one)) ?? null
    if (before !== null) return [indexInfo(one, git(top.root, [...config, ...hashArgs(one)], objects, before).trim(), list.head)]
    return list.head === '' ? [] : [indexInfo(one, null, list.head)]
  })
  if (entries.length > 0) git(top.root, [...config, ...INDEX_INFO_ARGS], env, entries.join(''))
  return { tree: git(top.root, [...config, ...WRITE_TREE_ARGS], env).trim(), nested: list.nested }
}

function statsUnder(folder) {
  return filesUnder(folder).map(file => {
    const stat = fs.statSync(path.join(folder, file))
    return `${file} ${stat.size} ${stat.mtimeMs}`
  })
}

function countLines(files) {
  return Object.entries(files).map(([p, c]) => `${p}:+${c.added}-${c.deleted}${c.isBinary ? ':binary' : ''}`).sort()
}

const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'filemap-ci-')))
const repo = path.join(base, 'repo')
process.on('exit', () => fs.rmSync(base, { recursive: true, force: true }))
const hasLfs = spawnSync('git', ['lfs', 'version']).status === 0
console.log(`OS=${process.env.OS ?? 'unset'} platform=${process.platform} ${run(['git', '--version']).trim()} lfs=${hasLfs}`)

const lib = path.join(base, 'lib')
fs.mkdirSync(lib)
run(['git', 'init', '-q', '-b', 'main'], lib)
write(lib, 'inner.ts', 'export const inner = 1\n')
run(['git', 'add', '-A'], lib)
run(['git', '-c', 'user.name=filemap', '-c', 'user.email=filemap@example.invalid', 'commit', '-q', '-m', 'lib'], lib)
fs.mkdirSync(repo)
run(['git', 'init', '-q', '-b', 'main'], repo)
if (path.resolve(repo, run(['git', 'rev-parse', '--git-dir'], repo).trim()) !== path.join(repo, '.git')) throw new Error(`git in ${repo} works on another repository`)
run(['git', 'config', 'user.name', 'filemap'], repo)
run(['git', 'config', 'user.email', 'filemap@example.invalid'], repo)
write(repo, 'a.md', 'one\ntwo\nthree\n')
write(repo, 'sub/b.ts', 'export const b = 1\n')
write(repo, 'sub/name with space & %USERNAME%.md', 'x\n')
write(repo, 'f.md', 'f\n')
write(repo, 'Cap.md', 'cap\n')
write(repo, '.gitattributes', `*.dat binary\n${hasLfs ? '*.bin filter=lfs diff=lfs merge=lfs -text\n' : ''}`)
fs.writeFileSync(path.join(repo, 'model.dat'), crypto.randomBytes(300_000))
if (hasLfs) {
  run(['git', 'lfs', 'install', '--local', '--skip-repo'], repo)
  write(repo, 'big.bin', 'first version\n')
}
write(repo, '.gitignore', '.claude/\n')
run(['git', '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'vendor/lib'], repo)
run(['git', 'add', '-A'], repo)
run(['git', 'commit', '-q', '-m', 'start'], repo)
run(['git', 'config', 'core.autocrlf', 'true'], repo)
run(['git', 'config', 'core.safecrlf', 'true'], repo)
write(repo, 'u.md', 'untracked before the baseline\n')
fs.mkdirSync(path.join(repo, 'nested'))
run(['git', 'init', '-q'], path.join(repo, 'nested'))
write(repo, 'nested/inner.txt', 'inner\n')
run(['git', 'worktree', 'add', '-q', '-b', 'agent-1', '.claude/worktrees/agent-1'], repo)
run(['git', '-c', 'worktree.useRelativePaths=true', 'worktree', 'add', '-q', '-b', 'agent-2', '.claude/worktrees/agent-2'], repo)

const top = parseTop(git(repo, TOP_ARGS))
check(fs.realpathSync.native(top.root) === repo, `rev-parse names the root ${top.root}`)
const worktrees = `${absolute(top.commonDir, '')}/worktrees`
const gitDirs = fs.readdirSync(worktrees).map(id => absolute(fs.readFileSync(`${worktrees}/${id}/gitdir`, 'utf8').trim(), `${worktrees}/${id}`))
const inIgnored = nestedIn(top.root, gitDirs.map(folderOf))
check(inIgnored.join(' ') === '.claude/worktrees/agent-1/ .claude/worktrees/agent-2/', `the gitdir files of the git folder name the worktrees in the ignored .claude, with an absolute and a relative path: ${inIgnored.join(', ')}`)
const listed = parseFileList(git(top.root, LIST_ARGS)).map(file => `${file.p}:${file.lines}`)
check(listed.includes('a.md:3') && listed.includes('sub/b.ts:1') && listed.includes('sub/name with space & %USERNAME%.md:1'), `grep lists the files with their lines: ${listed.join(', ')}`)
const coloured = parseFileList(git(top.root, ['-c', 'color.ui=always', ...LIST_ARGS])).map(file => `${file.p}:${file.lines}`)
check(coloured.join(' ') === listed.join(' '), 'grep lists the same files when color.ui=always colours its output')

const temp = tempOf(path.join(base, 'filemap-session').replace(/\\/g, '/'), top.commonDir)
fs.mkdirSync(path.join(temp.objects, 'info'), { recursive: true })
fs.writeFileSync(path.join(temp.objects, 'info', 'alternates'), alternatesOf(`${top.commonDir}/objects`))
const counts = countsOf(temp.folder, top.commonDir)
fs.mkdirSync(path.join(counts.objects, 'info'), { recursive: true })
fs.writeFileSync(path.join(counts.objects, 'info', 'alternates'), alternatesOf(temp.objects))

const dotGit = path.join(repo, '.git')
const hookRan = path.join(dotGit, 'hook-ran')
write(repo, '.git/hooks/post-index-change', '#!/bin/sh\necho "$*" >> "$(git rev-parse --git-dir)/hook-ran"\n')
fs.chmodSync(path.join(dotGit, 'hooks', 'post-index-change'), 0o755)
git(repo, ['read-tree', 'HEAD'], { GIT_INDEX_FILE: path.join(base, 'control.index') })
check(fs.existsSync(hookRan), 'the post-index-change hook of the repository runs when a plain git read-tree writes an index file')
fs.rmSync(hookRan)
for (const [key, value] of [['submodule.recurse', 'true'], ['core.splitIndex', 'true'], ['core.bigFileThreshold', '100k']]) run(['git', 'config', key, value], repo)
const unrecursed = spawnSync('git', ['-C', top.root, ...LIST_ARGS.filter(arg => arg !== '--no-recurse-submodules')], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
check(unrecursed.status === 128 && /--untracked not supported with --recurse-submodules/.test(unrecursed.stderr), 'with submodule.recurse=true git grep refuses to list untracked files unless it is told not to read submodules')
const recursing = parseFileList(git(top.root, LIST_ARGS)).map(file => `${file.p}:${file.lines}`)
check(recursing.join(' ') === listed.join(' '), 'with submodule.recurse=true grep lists the same files')
const sharedIndexes = () => fs.readdirSync(dotGit).filter(name => name.startsWith('sharedindex.')).sort()
const modules = statsUnder(path.join(dotGit, 'modules'))
const later = new Date(Date.now() + 60_000)
fs.utimesSync(path.join(repo, 'a.md'), later, later)
const before = { objects: filesUnder(path.join(dotGit, 'objects')), lfs: filesUnder(path.join(dotGit, 'lfs', 'objects')), index: fs.readFileSync(path.join(dotGit, 'index')) }

const baseline = treeOf(top, temp, 'command')
check(baseline.nested.join(' ') === 'nested/', `status names the nested repository and no worktree in the ignored .claude: ${baseline.nested.join(', ')}`)
check(fs.readFileSync(path.join(dotGit, 'index')).equals(before.index), 'status left the index of the repository as it was, with a file whose time changed')
fs.writeFileSync(path.join(dotGit, 'index.lock'), '')

write(repo, 'a.md', 'one\nTWO\nthree\nfour\n')
write(repo, 'c.md', 'new\nfile\n')
fs.rmSync(path.join(repo, 'sub', 'b.ts'))
if (hasLfs) write(repo, 'big.bin', 'second version, which LFS would copy into .git/lfs/objects\n')
write(repo, 'vendor/lib/inner.ts', 'changed inside the submodule\n')
fs.writeFileSync(path.join(repo, 'model.dat'), crypto.randomBytes(300_000))

const now = treeOf(top, counts, 'job')
check(parseModules(fs.readFileSync(path.join(repo, '.gitmodules'), 'utf8')).join(' ') === 'vendor/lib/', 'the .gitmodules file that git submodule add writes names the folder of the submodule')
check(now.nested.join(' ') === 'vendor/lib/ nested/', `status names the changed submodule and the nested repository: ${now.nested.join(', ')}`)
const diff = git(top.root, diffArgs(baseline.tree, now.tree), { GIT_OBJECT_DIRECTORY: counts.objects })
const files = parseDiff(diff)
const lines = countLines(files)
const expected = ['a.md:+2-1', 'c.md:+2-0', 'model.dat:+0-0:binary', 'sub/b.ts:+0-1', ...(hasLfs ? ['big.bin:+2-2'] : [])].sort()
check(lines.join(' ') === expected.join(' '), `with core.autocrlf=true and core.safecrlf=true diff-tree counts the lines changed: ${lines.join(', ')}`)
const loose = folder => filesUnder(folder).map(file => file.replace(/\\/g, '/')).filter(file => /^[0-9a-f]{2}\/[0-9a-f]{38}$/.test(file))
const inBaseline = loose(temp.objects)
const inCounts = loose(counts.objects)
check(inBaseline.length > 0 && inCounts.length > 0 && inCounts.every(file => !inBaseline.includes(file)), `the count wrote ${inCounts.length} objects into a folder of its own and none of the ${inBaseline.length} that the baseline holds`)
const named = new Set(objectsOf({ files, trees: [now.tree, ...treesOf(diff)] }))
const unnamed = inCounts.map(file => file.replace('/', '')).filter(id => !named.has(id))
check(treesOf(diff).length > 0 && unnamed.length === 0, `each object that the count wrote is the content of a counted file, its tree or the tree of a folder that diff-tree -t names, so a later count can delete it once a newer one replaces it: ${unnamed.join(', ') || 'none other'}`)
if (hasLfs) check(filesUnder(path.join(counts.lfs, 'objects')).some(file => /[0-9a-f]{64}$/.test(file)), 'Git LFS put its copy of the counted version into the storage of the counts')

check(filesUnder(path.join(dotGit, 'objects')).join('\n') === before.objects.join('\n'), 'nothing was written into .git/objects')
check(filesUnder(path.join(dotGit, 'lfs', 'objects')).join('\n') === before.lfs.join('\n'), 'nothing was written into .git/lfs/objects')
check(fs.readFileSync(path.join(dotGit, 'index')).equals(before.index), 'the index of the repository is unchanged')
check(!fs.existsSync(hookRan), 'no hook of the repository ran during the counts')
check(fs.existsSync(path.join(dotGit, 'index.lock')), 'the second count ran while another git held .git/index.lock')
check(sharedIndexes().length === 0, `with core.splitIndex=true no shared index was written into the git folder: ${sharedIndexes().join(', ') || 'none'}`)
check(statsUnder(path.join(dotGit, 'modules')).join('\n') === modules.join('\n'), 'with submodule.recurse=true nothing in the git folder of the submodule changed')
const model = files['model.dat']?.blob ?? ''
check(filesUnder(path.join(counts.objects, 'pack')).length === 0 && fs.existsSync(path.join(counts.objects, model.slice(0, 2), model.slice(2))), 'with core.bigFileThreshold=100k the new version of a 300 KB binary file is a loose object of the counts, which a count can delete, and no pack')

const dirty = `f\n${Array.from({ length: 100 }, (_, i) => `old ${i}`).join('\n')}\n`
write(repo, 'f.md', `${dirty}new\n`)
write(repo, 'g.md', 'g1\ng2\n')
const kept = treeOf(top, temp, 'command', new Map([['f.md', dirty], ['g.md', null]]))
const followed = treeOf(top, counts, 'job')
const since = countLines(parseDiff(git(top.root, diffArgs(kept.tree, followed.tree), { GIT_OBJECT_DIRECTORY: counts.objects })))
check(since.includes('f.md:+1-0') && since.includes('g.md:+2-0'), `a baseline that takes a written file as it was before the write counts only the lines of the write, and all lines of a file the write made: ${since.join(', ')}`)
write(repo, 'f.md', 'f\n')
write(repo, '.claude/notes.md', 'after\n')
const restored = treeOf(top, temp, 'command', new Map([[fold('f.md'), `${dirty}new\n`], [fold('Cap.md'), 'cap\nold\n'], [fold('.claude/notes.md'), 'before\n']]))
const unchanged = treeOf(top, counts, 'job')
const back = countLines(parseDiff(git(top.root, diffArgs(restored.tree, unchanged.tree), { GIT_OBJECT_DIRECTORY: counts.objects })))
check(back.join(' ') === 'Cap.md:+0-1 f.md:+0-101', `a write that puts a file back as its last commit had it, which git status then leaves out, counts the lines it deleted, and a written file that git ignores counts nothing: ${back.join(', ')}`)

const shaRepo = path.join(base, 'sha256')
fs.mkdirSync(shaRepo)
run(['git', 'init', '-q', '-b', 'main', '--object-format=sha256'], shaRepo)
write(shaRepo, 'a.ts', 'a\n')
run(['git', 'add', '-A'], shaRepo)
run(['git', '-c', 'user.name=filemap', '-c', 'user.email=filemap@example.invalid', 'commit', '-q', '-m', 'start'], shaRepo)
run(['git', 'worktree', 'add', '-q', '-b', 'side', '../sha256-side'], shaRepo)
const shaTop = parseTop(git(path.join(base, 'sha256-side'), TOP_ARGS))
const shaTemp = tempOf(path.join(base, 'filemap-sha256').replace(/\\/g, '/'), shaTop.commonDir)
fs.mkdirSync(path.join(shaTemp.objects, 'info'), { recursive: true })
fs.writeFileSync(path.join(shaTemp.objects, 'info', 'alternates'), alternatesOf(`${shaTop.commonDir}/objects`))
const shaCounts = countsOf(shaTemp.folder, shaTop.commonDir)
fs.mkdirSync(path.join(shaCounts.objects, 'info'), { recursive: true })
fs.writeFileSync(path.join(shaCounts.objects, 'info', 'alternates'), alternatesOf(shaTemp.objects))
write(shaTop.root, 'a.ts', 'a\nnew\n')
write(shaTop.root, 'b.ts', 'b1\nb2\n')
const shaKept = treeOf(shaTop, shaTemp, 'command', new Map([[fold('a.ts'), null], [fold('b.ts'), null]]))
const shaCount = treeOf(shaTop, shaCounts, 'job')
const shaLines = countLines(parseDiff(git(shaTop.root, diffArgs(shaKept.tree, shaCount.tree), { GIT_OBJECT_DIRECTORY: shaCounts.objects })))
check(shaLines.join(' ') === 'a.ts:+2-0 b.ts:+2-0', `in a SHA-256 repository a baseline leaves out the files that a write made, also one that its last commit has: ${shaLines.join(', ')}`)

const variants = ['[submodule "a"]\n\tPath = vendor/a\n', '[submodule "b"]\n\tpath = vendor/b # checkout directory\n', '[submodule "c"]\n\tpath = "vendor/#c d" ; quoted\n', '[submodule "d"] path = vendor/d\n', '[submodule.e]\n\tPATH=vendor/e;\n']
const asGit = variants.map((text, i) => {
  const file = path.join(base, `modules-${i}`)
  fs.writeFileSync(file, text)
  return run(['git', 'config', '--file', file, '--get-regexp', '^submodule\\..*\\.path$'], base).trim().replace(/^\S+ /, '')
})
check(variants.map(text => parseModules(text).join(' ')).join('|') === asGit.map(folder => `${folder}/`).join('|'), `parseModules reads the folder of a submodule as git config does: ${asGit.join(', ')}`)
const strict = spawnSync('git', ['-C', top.root, '-c', `core.hooksPath=${temp.folder}/hooks`, 'update-index', '--add', '-z', '--stdin'], { input: 'c.md\0', encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: path.join(base, 'strict.index'), GIT_OBJECT_DIRECTORY: counts.objects } })
check(strict.status === 128 && /LF would be replaced by CRLF/.test(strict.stderr), 'without the setting of the mod, core.safecrlf=true stops update-index on a file with LF endings')
