import { isOnWindows } from './track'

const READERS = new Set(['cat', 'head', 'tail', 'bat', 'less', 'more', 'nl', 'wc', 'sort', 'uniq', 'cut', 'diff', 'cmp', 'sed', 'awk', 'jq', 'rg', 'grep', 'egrep', 'fgrep'])
const PATTERN_FIRST = new Set(['sed', 'awk', 'jq', 'rg', 'grep', 'egrep', 'fgrep'])
const GREP_FLAGS = { values: 'efmdDABC', lists: 'lL', isRecursive: (letters: string) => /[rR]/.test(letters) }
const SEARCH_FLAGS: Record<string, typeof GREP_FLAGS> = { grep: GREP_FLAGS, egrep: GREP_FLAGS, fgrep: GREP_FLAGS, rg: { values: 'efEmjgdtTABCMr', lists: 'l', isRecursive: () => false } }
const PREFIXES = new Set(['env', 'sudo', 'time', 'command', 'nohup', 'exec', 'builtin'])
const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'while', 'until', 'do', '!', 'fi', 'done', 'esac'])
const MOVES = new Set(['cd', 'set-location', 'sl'])
const PUSHES = new Set(['pushd', 'push-location'])
const POPS = new Set(['popd', 'pop-location'])
const CONTENT_READERS = new Set(['get-content', 'gc', 'cat', 'type'])
const STRING_SEARCHERS = new Set(['select-string', 'sls'])
const CMDLET_ALIASES = new Set(['diff', 'sort'])
const FILE_LISTERS = new Set(['get-childitem', 'gci', 'dir', 'ls', 'get-item', 'gi'])
const PASSES = new Set(['head', 'tail', 'sort', 'uniq', 'where-object', 'where', '?', 'sort-object', 'select-object', 'select'])
const QUIET = new Set(['', 'cd', 'set-location', 'sl', 'push-location', 'pop-location', 'true', 'false', ':', 'test', '[', '[[', 'export', 'unset', 'out-null', 'out-file', 'set-content', 'add-content'])
const VALUE_FLAGS = /^-(e|f|g|t|T|m|A|B|C|-glob|-type|-max-count|-regexp|-file|-context|-after-context|-before-context)$/
const PATTERN_FLAGS = /^-(e|f|-regexp|-file)$/
const LONG_PATTERN = /^--(regexp|file)(=|$)/
const LONG_LIST = /^--(files-with-matches|files-without-match)$/
const LONG_RECURSIVE = /^--(dereference-)?recursive$/
const PATH_PARAMETERS = new Set(['path', 'literalpath', 'pspath', 'lp'])
const VALUE_PARAMETERS = new Set(['pattern', 'totalcount', 'head', 'first', 'tail', 'last', 'readcount', 'encoding', 'delimiter', 'stream', 'filter', 'include', 'exclude', 'credential', 'context', 'culture'])
const WRITE_REDIRECT = /^(\d*|&)>>?$|^\d*>&$|^<<<?$/
const ATTACHED_REDIRECT = /^(\d*|&)>|^<</
const STDOUT_REDIRECT = /^(1|&|\*)?>/
const LINE_LIMIT = 400
const READ_LIMIT = 60
const BLOCK_OPENERS = new Set(['if', 'while', 'until', 'for', 'case', 'select'])
const BLOCK_CLOSERS = new Set(['fi', 'done', 'esac'])
const RANKS = ['surely', 'ifDone', 'perhaps'] as const

type Found = { paths: string[]; operands: string[]; isSearch: boolean; isListing: boolean }
type Ran = (typeof RANKS)[number]
type Joint = 'and' | 'or' | 'pipe' | 'list' | 'background'
type Segment = { words: string[]; ran: Ran; isPiped: boolean; isShown: boolean; enters: number; leaves: number; isBroken: boolean; isBackground: boolean; isTail: boolean }
type Outer = { words: string[]; word: string; isPiped: boolean; isOpen: boolean; quote: string }
type Group = { kind: string; ran: Ran; joint: Ran; from: number; inner: number; isShell: boolean; isExited: boolean; outer?: Outer }
type Body = { end: string; isTabbed: boolean }

function worse(a: Ran, b: Ran): Ran {
  return RANKS.indexOf(a) > RANKS.indexOf(b) ? a : b
}

function delimiterAt(command: string, at: number): Body {
  let i = at + 2
  const isTabbed = command[i] === '-'
  if (isTabbed) i++
  while (command[i] === ' ' || command[i] === '\t') i++
  let end = ''
  let quote = ''
  for (; i < command.length; i++) {
    const ch = command[i] ?? ''
    if (quote === '' && /[\s;&|<>()]/.test(ch)) break
    if (quote === '' && (ch === '"' || ch === "'")) quote = ch
    else if (ch === quote) quote = ''
    else if (quote === '' && ch === '\\') end += command[++i] ?? ''
    else end += ch
  }
  return { end, isTabbed }
}

function afterBodies(command: string, from: number, bodies: Body[]): number {
  let at = from
  for (const { end, isTabbed } of bodies) {
    while (at < command.length) {
      const stop = command.indexOf('\n', at + 1)
      const next = stop === -1 ? command.length : stop
      const line = command.slice(at + 1, next).replace(/\r$/, '')
      at = next
      if ((isTabbed ? line.replace(/^\t+/, '') : line) === end) break
    }
  }
  return at
}

function closingParen(command: string, from: number): number {
  let depth = 0
  for (let i = from; i < command.length; i++) {
    if (command[i] === '(') depth++
    else if (command[i] === ')' && --depth === 0) return i
  }
  return command.length
}

function isFunctionHead(words: string[]): boolean {
  return (words.length === 1 && /^[\w.:-]+$/.test(words[0] ?? '')) || (words.length === 2 && words[0] === 'function')
}

function endsShell(words: string[], isPowerShell: boolean): boolean {
  const [head = '', ...rest] = withoutRedirects(words).words
  return isPowerShell ? /^(exit|return)$/i.test(head) : head === 'exit' || (head === 'exec' && rest.length > 0)
}

function segmentsOf(command: string, isPowerShell: boolean): Segment[] {
  const escape = isPowerShell ? '`' : '\\'
  const out: Segment[] = []
  const groups: Group[] = []
  const bodies: Body[] = []
  let joint: Ran = 'surely'
  let words: string[] = []
  let word = ''
  let quote = ''
  let isWord = false
  let isOpen = false
  let isPiped = false
  let isBroken = false
  let isFunctionNext = false
  let isExited = false
  let closedFrom: number | undefined
  let enters = 0
  let leaves = 0
  const top = () => groups.at(-1)?.ran ?? 'surely'
  const hasExited = () => groups.findLast(group => group.isShell)?.isExited ?? isExited
  const endWord = () => {
    const text = word
    const isBody = isFunctionNext || (words.length === 2 && words[0] === 'function')
    const isCommand = words.every(one => KEYWORDS.has(one))
    const hasWord = isWord
    word = ''
    isWord = false
    if (!hasWord) return
    if (!isPowerShell && text === '{' && (isBody || isCommand)) {
      open('{', isBody)
      isFunctionNext = false
    } else if (!isPowerShell && text === '}' && isCommand) close('{')
    else {
      words.push(text)
      isFunctionNext = false
    }
  }
  const endSegment = (next: Ran, kind?: Joint) => {
    endWord()
    const head = isPowerShell ? '' : (words[0] ?? '')
    const lead = words.findIndex(one => !KEYWORDS.has(one))
    const isEmpty = words.length === 0
    if (BLOCK_CLOSERS.has(head) && groups.at(-1)?.kind === 'block') groups.pop()
    if (!isEmpty) out.push({ words, ran: hasExited() ? 'perhaps' : worse(top(), joint), isPiped, isShown: kind !== 'pipe', enters, leaves, isBroken, isBackground: kind === 'background', isTail: false })
    if (!isEmpty && !isPiped && kind !== 'pipe' && kind !== 'background' && endsShell(words.slice(lead === -1 ? words.length : lead), isPowerShell)) {
      const shell = groups.findLast(group => group.isShell)
      if (shell === undefined) isExited = true
      else shell.isExited = true
    }
    if (isEmpty && kind === 'pipe') for (const segment of out.slice(closedFrom ?? out.length)) segment.isShown = false
    if (!isEmpty || kind !== undefined) closedFrom = undefined
    if (!isEmpty) isFunctionNext = !isPowerShell && words.length === 2 && words[0] === 'function'
    for (const one of isPowerShell ? [] : words.slice(0, lead === -1 ? words.length : lead + 1)) {
      if (BLOCK_OPENERS.has(one)) groups.push({ kind: 'block', ran: 'perhaps', joint, from: out.length, inner: out.length, isShell: false, isExited: false })
    }
    if (!isEmpty) [isPiped, isBroken, enters, leaves] = [false, false, 0, 0]
    isBroken ||= kind === 'or' || ((kind === 'list' || kind === 'background') && !(isEmpty && isOpen))
    isPiped ||= kind === 'pipe'
    joint = isEmpty && isOpen ? worse(joint, next) : next
    isOpen = kind === 'and' || kind === 'or' || kind === 'pipe' || (isEmpty && isOpen)
    words = []
  }
  const open = (kind: string, isBody: boolean, outerQuote = '') => {
    if (!isPowerShell && kind === '(' && /[$<>]$/.test(word)) {
      groups.push({ kind, ran: worse(top(), joint), joint, from: out.length, inner: out.length, isShell: true, isExited: hasExited(), outer: { words, word, isPiped, isOpen, quote: outerQuote } })
      words = []
      word = ''
      isWord = false
      isPiped = false
      isOpen = false
      joint = 'surely'
      enters++
      return
    }
    const from = out.length
    endSegment(joint)
    const isFunctionBody = isBody || (kind === '(' && isFunctionNext)
    isFunctionNext = false
    const owner = out.length > from ? out.at(-1)?.words : undefined
    const isShell = isPowerShell ? /^(function|filter)$/i.test(owner?.[0] ?? '') : kind === '(' || isFunctionBody
    groups.push({ kind, ran: isFunctionBody ? 'perhaps' : worse(top(), joint), joint, from, inner: out.length, isShell, isExited: hasExited() })
    joint = 'surely'
    if (kind === '(' && !isPowerShell) enters++
  }
  const close = (kind: string) => {
    endSegment(joint)
    const group = groups.at(-1)
    if (group?.kind !== kind) return
    groups.pop()
    joint = group.joint
    isOpen = false
    closedFrom = group.from
    isFunctionNext = !isPowerShell && kind === '(' && out.length === group.inner && group.from < group.inner && isFunctionHead(out[group.from]?.words ?? [])
    if (kind === '(' && !isPowerShell) [enters, leaves] = enters > 0 ? [enters - 1, leaves] : [enters, leaves + 1]
    if (group.outer === undefined) return
    for (const segment of out.slice(group.inner)) segment.isShown = false
    words = group.outer.words
    word = group.outer.word
    isWord = true
    isPiped = group.outer.isPiped
    isOpen = group.outer.isOpen
    quote = group.outer.quote
    closedFrom = undefined
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? ''
    const next = command[i + 1] ?? ''
    const isEscaped = next !== '' && ch === escape && (quote === '' || (quote === '"' && (isPowerShell || '$`"\\\n'.includes(next))))
    if (isEscaped) {
      word += command[++i]
      isWord = true
    } else if (quote === "'" && isPowerShell && ch === "'" && next === "'") word += command[++i]
    else if (!isPowerShell && quote === '"' && ch === '$' && next === '(' && command[i + 2] !== '(') {
      word += ch
      quote = ''
      open(command[++i] ?? '', false, '"')
    } else if (quote !== '' && ch === quote) quote = ''
    else if (quote !== '') word += ch
    else if (isPowerShell && ch === '@' && (next === "'" || next === '"') && /^[ \t]*\r?\n/.test(command.slice(i + 2))) {
      const start = command.indexOf('\n', i) + 1
      const end = command.indexOf(`\n${next}@`, start - 1)
      word += command.slice(start, end === -1 ? command.length : end)
      isWord = true
      i = end === -1 ? command.length : end + 2
    } else if (ch === '"' || ch === "'") {
      quote = ch
      isWord = true
    } else if (ch === '#' && !isWord) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++
    } else if (ch === ' ' || ch === '\t' || ch === '\r' || (isPowerShell && ch === ',')) endWord()
    else if (!isPowerShell && ch === '(' && next === '(') {
      const end = closingParen(command, i)
      word += command.slice(i, end + 1)
      isWord = true
      i = end
    } else if (ch === '(' || (isPowerShell && ch === '{')) open(ch, ch === '{')
    else if (ch === ')') close('(')
    else if (isPowerShell && ch === '}') close('{')
    else if ((ch === '|' || ch === '&') && next === ch) {
      i++
      endSegment(ch === '|' ? 'perhaps' : 'ifDone', ch === '|' ? 'or' : 'and')
    } else if (ch === '|') endSegment(joint, 'pipe')
    else if (ch === '\n' || ch === ';' || (isPowerShell && ch === '&')) {
      endSegment('surely', 'list')
      if (ch === '\n' && bodies.length > 0) i = afterBodies(command, i, bodies.splice(0))
    } else if (ch === '&' && command[i - 1] !== '>' && next !== '>') endSegment('surely', 'background')
    else {
      if (!isPowerShell && ch === '<' && next === '<' && command[i + 2] !== '<' && command[i - 1] !== '<') bodies.push(delimiterAt(command, i))
      word += ch
      isWord = true
    }
  }
  endSegment('surely', 'list')
  let isTail = true
  for (const segment of [...out].reverse()) {
    if (segment.isBackground) isTail = false
    segment.isTail = isTail
    if (segment.isBroken) isTail = false
  }
  return out
}

function isAbsolutePath(path: string): boolean {
  return (isOnWindows() ? /^([A-Za-z]:[\\/]|[\\/]|~)/ : /^[/~]/).test(path)
}

function joined(base: string | null, path: string): string | null {
  if (isAbsolutePath(path) || base === '') return path
  return base === null ? null : `${base}/${path}`
}

function isPathLike(word: string): boolean {
  return word !== '' && word !== '-' && !/[*?<>|$`{}]/.test(word) && !word.includes('://')
}

function comparable(path: string): string {
  return isOnWindows() ? path.replace(/\\/g, '/').replace(/^\/([A-Za-z])(?=\/|$)/, '$1:').toLowerCase() : path
}

function isUnder(name: string, operand: string): boolean {
  const wild = operand.search(/[*?[{$`~]/)
  const named = comparable(name)
  if (wild !== -1) return named.startsWith(comparable(operand.slice(0, wild).replace(/[^\\/]*$/, '')))
  const folder = comparable(operand).replace(/[\\/]+$/, '')
  const isMounted = isOnWindows() && /^\/[^/]/.test(folder) && /^[a-z]:\//.test(named)
  return named === folder || named.startsWith(`${folder}/`) || named.startsWith(`${folder}\\`) || (isMounted && `${named}/`.includes(`${folder.replace(/^\/[^/]*/, '')}/`))
}

function withoutRedirects(words: string[]): { words: string[]; inputs: string[] } {
  const kept: string[] = []
  const inputs: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? ''
    if (word === '<') inputs.push(words[++i] ?? '')
    else if (WRITE_REDIRECT.test(word)) i++
    else if (/^<[^<]/.test(word)) inputs.push(word.slice(1))
    else if (!ATTACHED_REDIRECT.test(word)) kept.push(word)
  }
  return { words: kept, inputs }
}

function headOf(words: string[]): { head: string; args: string[] } {
  let at = 0
  while (at < words.length && (PREFIXES.has(words[at] ?? '') || KEYWORDS.has(words[at] ?? '') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at] ?? ''))) at++
  const name = (words[at] ?? '').split(/[\\/]/).pop() ?? ''
  return { head: name.toLowerCase().replace(/\.exe$/, ''), args: words.slice(at + 1) }
}

function shortFlags(arg: string, values: string): { letters: string; takesNext: boolean } {
  const at = [...arg.slice(1)].findIndex(letter => values.includes(letter))
  return at === -1 ? { letters: arg.slice(1), takesNext: false } : { letters: arg.slice(1, at + 2), takesNext: at + 2 === arg.length }
}

function toolReads(head: string, args: string[], isFed: boolean, found: Found): void {
  const options = args.includes('--') ? args.slice(0, args.indexOf('--')) : args
  if ((head === 'sed' && options.some(arg => /^(-i|--in-place)/.test(arg))) || (head === 'rg' && options.includes('--files'))) return
  const search = SEARCH_FLAGS[head]
  const flagOf = (arg: string) =>
    search === undefined || arg.startsWith('--') ? { letters: '', takesNext: VALUE_FLAGS.test(arg) || ((head === 'head' || head === 'tail') && /^-[nc]$/.test(arg)) } : shortFlags(arg, search.values)
  const isFlag = (arg: string) => arg.startsWith('-') && arg !== '-'
  const isGiven = (arg: string) => (search === undefined ? PATTERN_FLAGS.test(arg) : LONG_PATTERN.test(arg) || /[ef]/.test(flagOf(arg).letters))
  let isPatternNext = PATTERN_FIRST.has(head) && !options.some(arg => isFlag(arg) && isGiven(arg))
  let isLiteral = false
  let isRecursive = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--' && !isLiteral) isLiteral = true
    else if (isFlag(arg) && !isLiteral) {
      const { letters, takesNext } = flagOf(arg)
      if (takesNext) i++
      found.isListing ||= search !== undefined && (LONG_LIST.test(arg) || [...letters].some(letter => search.lists.includes(letter)))
      isRecursive ||= search !== undefined && (LONG_RECURSIVE.test(arg) || search.isRecursive(letters))
    } else if (isPatternNext) isPatternNext = false
    else {
      found.operands.push(arg)
      if (isPathLike(arg)) found.paths.push(arg)
    }
  }
  found.isSearch = search !== undefined && !(isFed && found.operands.length === 0 && !isRecursive)
}

function cmdletReads(head: string, args: string[], isText: boolean, found: Found): void {
  let isPatternNext = STRING_SEARCHERS.has(head) && !args.some(arg => /^-pattern(:|$)/i.test(arg))
  let isNamed = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    const [, name, attached] = /^-([A-Za-z]+)(?::(.*))?$/.exec(arg) ?? []
    const key = name?.toLowerCase() ?? ''
    const value = name === undefined ? arg : (attached ?? (PATH_PARAMETERS.has(key) || VALUE_PARAMETERS.has(key) ? args[++i] : undefined))
    if (name === undefined && isPatternNext) isPatternNext = false
    else if ((name === undefined || PATH_PARAMETERS.has(key)) && value !== undefined) {
      isNamed = true
      if (isPathLike(value)) found.paths.push(value)
    }
  }
  found.isSearch = STRING_SEARCHERS.has(head) && (isNamed || !isText)
}

function printedPaths(stdout: string, isListing: boolean, operands: string[] | null): string[] {
  const printed: string[] = []
  for (const line of stdout.split(/\r?\n/).slice(0, LINE_LIMIT)) {
    const named = /^((?:[A-Za-z]:)?[^:\0]+?):\d+[:-]/.exec(line)?.[1] ?? (isListing ? line : /^((?:[A-Za-z]:)?[^:\0]+?):/.exec(line)?.[1])
    if (named !== undefined && named === named.trim() && isPathLike(named) && (operands === null || operands.some(operand => isUnder(named, operand)))) printed.push(named)
  }
  return printed
}

export function shellReads(tool: string, command: string, stdout: string, hasSucceeded = true): string[] {
  const isPowerShell = tool === 'PowerShell'
  const paths: Array<string | null> = []
  const outer: Array<string | null> = []
  const pushed: Array<string | null> = []
  let base: string | null = ''
  let previous: string | null = null
  let printBase: string | null | undefined
  let operands: string[] | null = []
  let isListing = false
  let isFiles = false
  let isFromSearch = false
  let isMixed = false
  for (const { words: all, ran, isPiped, isShown, enters, leaves, isTail } of segmentsOf(command, isPowerShell)) {
    for (let n = 0; n < leaves; n++) base = outer.pop() ?? base
    for (let n = 0; n < enters; n++) outer.push(base)
    const { words, inputs } = withoutRedirects(all)
    const { head, args } = headOf(words)
    const isProgram = isPowerShell && READERS.has(head) && !CONTENT_READERS.has(head)
    const hasRun = (ran === 'surely' || (ran === 'ifDone' && hasSucceeded && isTail)) && (!isProgram || (hasSucceeded && isTail))
    const target = args.find(arg => !/^-./.test(arg))
    const found: Found = { paths: inputs.filter(isPathLike), operands: [], isSearch: false, isListing: false }
    const isText = isPiped && !isFiles
    isFiles = isPiped ? isFiles && PASSES.has(head) : FILE_LISTERS.has(head)
    const place: string | null = target === undefined || target === '-' || !isPathLike(target) ? null : joined(base, target)
    if (MOVES.has(head)) [base, previous] = hasRun ? [target === '-' ? previous : place, base] : [null, null]
    else if (PUSHES.has(head)) {
      pushed.push(hasRun ? base : null)
      base = hasRun ? place : null
    } else if (POPS.has(head)) base = hasRun ? (pushed.pop() ?? null) : null
    else if (isPowerShell && (CONTENT_READERS.has(head) || STRING_SEARCHERS.has(head))) cmdletReads(head, args, isText, found)
    else if (READERS.has(head) && !(isPowerShell && CMDLET_ALIASES.has(head))) toolReads(head, args, isPiped || inputs.length > 0 || all.some(word => word.startsWith('<<')), found)
    isFromSearch = (hasRun && found.isSearch) || (isPiped && isFromSearch && PASSES.has(head))
    if (isShown && !all.some(word => STDOUT_REDIRECT.test(word)) && !isFromSearch && (!QUIET.has(head) || (head === 'cd' && target === '-'))) isMixed = true
    if (!hasRun) continue
    paths.push(...found.paths.map(path => joined(base, path)))
    if (found.isSearch) {
      printBase = printBase === undefined || printBase === base ? base : null
      operands = operands === null || found.operands.length === 0 ? null : [...operands, ...found.operands]
    }
    isListing ||= found.isListing
  }
  const at = isMixed ? undefined : printBase
  const printed = at === undefined ? [] : printedPaths(stdout, isListing, operands).map(path => joined(at, path))
  return [...new Set([...paths, ...printed])].filter(path => path !== null).slice(0, READ_LIMIT)
}
