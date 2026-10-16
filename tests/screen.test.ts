import { expect } from 'claude-code/testing'

import type { FileChange, MapFile, Theme } from '../types'
import { hasFolder, layoutOf, legendOf, type ListRow, listOf, type MapDrawing, mapDrawing, type MapLayout, type MapRect, paneFrame, plainText, zoomOut } from '../hooks/screen'
import { type Mark, type RecentRow, type ScreenInput, useWindows } from '../hooks/track'
import { test } from './limit'

useWindows(true)

const DEFAULT = 0x01000000
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const FILLS = {
  dark: { folder: 0x2a2722, neutral: 0x37342d, read: 0x454238, changed: 0x4f7bab, now: 0xdc7236 },
  light: { folder: 0xe8e2d4, neutral: 0xd3ccbc, read: 0xbeb6a5, changed: 0x6a90bc, now: 0xd8692e },
}
const INKS = { dark: { light: 0xece6d8, dark: 0x1b1915, read: 0xece6d8, quiet: 0xb8b1a2 }, light: { light: 0xfaf8f2, dark: 0x26282c, read: 0x26282c, quiet: 0x56585c } }
const hex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`

let lastVersion = 0

function sampleFiles(icons = 60): MapFile[] {
  const files: MapFile[] = [
    { p: 'README.md', lines: 120 },
    { p: 'package.json', lines: 40 },
    { p: 'src/app.ts', lines: 900 },
    { p: 'src/layout.ts', lines: 600 },
    { p: 'src/colour.ts', lines: 300 },
    { p: 'src/notes.md', lines: 250 },
    { p: 'src/util/text.ts', lines: 150 },
    { p: 'src/util/path.ts', lines: 90 },
    { p: 'docs/guide/intro.md', lines: 200 },
    { p: 'docs/guide/setup.md', lines: 180 },
  ]
  for (let i = 0; i < icons; i++) files.push({ p: `assets/icons/set-${i % 6}/Icon-${i}.json`, lines: 20 })
  return files
}

function makeInput(over: Partial<ScreenInput> = {}): ScreenInput {
  return {
    repo: 'sample',
    files: sampleFiles(),
    filesVersion: ++lastVersion,
    marks: {},
    recent: [],
    outside: 0,
    busy: [],
    changedCount: 0,
    readCount: 0,
    windowMinutes: 5,
    zoom: '',
    columns: 64,
    rows: 48,
    theme: 'dark',
    ...over,
  }
}

const crowdedInput = () => makeInput({ files: sampleFiles(600) })
const changeOf = (added: number, deleted: number, isBinary = false): FileChange => ({ added, deleted, isBinary, blob: 'b1' })
const mark = (changed: number, over: Partial<Mark> = {}): Mark => ({ changed, change: changed > 0 ? changeOf(changed, 0) : null, isRead: false, isNow: false, ...over })
const recentRow = (label: string, over: Partial<RecentRow> = {}): RecentRow => ({ label, change: null, isNow: false, ...over })
const drawingOf = (input: ScreenInput): MapDrawing => mapDrawing(input, paneFrame(input).mapRows)

const areaOf = (layout: MapLayout, key: string) => {
  const rect = layout.rects[indexOfKey(layout, key)] as MapRect
  return rect.kind === 'file' ? (rect.x1 - rect.x0) * (rect.y1 - rect.y0) : 0
}

const wordAt = (grid: Uint32Array, at: number) => grid[at] as number

function rowText(grid: Uint32Array, columns: number, row: number): string {
  let text = ''
  for (let x = 0; x < columns; x++) text += String.fromCharCode(wordAt(grid, (row * columns + x) * 3))
  return text
}

function pixelColor(grid: Uint32Array, layout: MapLayout, x: number, y: number): number {
  const at = ((y >> 1) * layout.width + x) * 3
  const glyph = wordAt(grid, at)
  const fore = wordAt(grid, at + 1)
  const back = wordAt(grid, at + 2)
  if (glyph === UPPER_HALF) return y % 2 === 0 ? fore : back
  if (glyph === LOWER_HALF) return y % 2 === 0 ? back : fore
  return back
}

function colorsOf(grid: Uint32Array, layout: MapLayout, index: number): number[] {
  const colors = new Set<number>()
  layout.owner.forEach((owner, pixel) => {
    if (owner === index) colors.add(pixelColor(grid, layout, pixel % layout.width, Math.floor(pixel / layout.width)))
  })
  return [...colors]
}

function rowsOf(grid: Uint32Array, layout: MapLayout, rect: MapRect): number[][] {
  const rows: number[][] = []
  for (let y = rect.y0; y < rect.y1; y++) {
    const colors = new Set<number>()
    for (let x = rect.x0; x < rect.x1; x++) colors.add(pixelColor(grid, layout, x, y))
    rows.push([...colors])
  }
  return rows
}

function layoutFrom(input: ScreenInput): MapLayout {
  const layout = layoutOf(input, paneFrame(input).mapRows)
  if (!layout) throw new Error('no map was laid out')
  return layout
}

const gridOf = (input: ScreenInput) => drawingOf(input).grid

function indexOfKey(layout: MapLayout, key: string): number {
  const index = layout.byKey.get(key)
  if (index === undefined) throw new Error(key + ' is not on the map')
  return index
}

function firstBox(layout: MapLayout): { rect: MapRect; index: number } {
  const index = layout.rects.findIndex(r => r.kind === 'box' && r.keys.length > 3)
  const rect = layout.rects[index]
  if (!rect) throw new Error('the sample has no collapsed folder at this size')
  return { rect, index }
}

const geometry = (layout: MapLayout) => layout.rects.map(r => [r.kind, r.name, r.x0, r.y0, r.x1, r.y1, r.label])
const lineOf = (row: ListRow | undefined) => (row === undefined ? '' : `   ${row.label}${row.rest.text}`)
const listOfInput = (input: ScreenInput) => listOf(input, paneFrame(input))

test('the region holds exactly columns times rows cells at every size, and the frame fills the body', () => {
  const sizes = [
    [64, 48], [100, 60], [200, 50], [20, 9], [19, 9], [64, 8], [12, 30], [5, 4], [5, 3], [1, 1], [3, 2], [40, 1], [0, 10], [10, 0],
  ] as const
  const recent = [recentRow('src/app.ts', { change: changeOf(3, 1), isNow: true }), recentRow('docs/guide/intro.md')]
  const variants: Array<Partial<ScreenInput>> = [
    {},
    { recent, marks: { 'src/app.ts': mark(3, { isNow: true }) }, outside: 2, busy: ['src', 'docs/guide'], changedCount: 1, readCount: 1 },
    { notice: 'This folder is not a git repository, so there is no map to draw.' },
    { files: [] },
    { zoom: 'src' },
  ]
  for (const [columns, rows] of sizes) {
    for (const variant of variants) {
      for (const theme of ['dark', 'light'] as const) {
        const input = makeInput({ ...variant, columns, rows, theme })
        const frame = paneFrame(input)
        const drawing = mapDrawing(input, frame.mapRows)
        expect(drawing.rows).toBe(frame.mapRows)
        expect(drawing.grid.length).toBe(columns * frame.mapRows * 3)
        expect(drawing.owner.length).toBe(columns * 2 * frame.mapRows)
        const region = 1 + frame.mapRows + (frame.mapRows > 0 ? 1 : 0)
        const used = region + frame.listRows + (frame.hasLegend ? 1 : 0) + (frame.hasControls ? 1 : 0)
        expect(used).toBeLessThanOrEqual(Math.max(1, rows))
        if (rows >= 4) expect(used).toBe(rows)
      }
    }
  }
})

test('every code point and every text is printable and narrow: Latin, Greek, Cyrillic, Armenian and Georgian letters show, and wide, joined, right-to-left and invisible characters show as ?', () => {
  const files = [
    ...sampleFiles(),
    { p: 'src/中文文件.ts', lines: 2000 },
    { p: 'src/smile-\u{1F600}.md', lines: 1500 },
    { p: 'src/café.py', lines: 2500 },
    { p: 'src/é​\ttab.ts', lines: 1800 },
    { p: 'src/отчёт.py', lines: 2400 },
    { p: 'src/تقرير.md', lines: 1700 },
  ]
  const recent = [recentRow('src/中文文件.ts'), recentRow('wide\t\u{1F4A9}/café.py', { change: changeOf(1, 0) }), recentRow('docs/Ελληνικά.md')]
  const isPlain = (text: string) => [...text].every(ch => {
    const cp = ch.codePointAt(0) as number
    return cp >= 0x20 && cp <= 0xffff && cp !== 0xa0 && !/[\p{C}\p{M}\p{Zl}\p{Zp}\p{Emoji_Presentation}\p{Script=Han}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)
  })
  const inputs = [
    makeInput({ repo: 'répo\t\u{1F600}', files, recent, busy: ['src/中文', 'wide\t\u{1F4A9}'] }),
    makeInput({ repo: 'répo\t\u{1F600}', files, recent, zoom: 'src' }),
    makeInput({ repo: '中文', files, notice: 'No map:\n\u{1F600} the folder has​no git repository 中文' }),
  ]
  for (const input of inputs) {
    const drawing = drawingOf(input)
    for (let at = 0; at < drawing.grid.length; at += 3) {
      const cp = wordAt(drawing.grid, at)
      expect(isPlain(String.fromCodePoint(cp)) || cp === UPPER_HALF || cp === LOWER_HALF).toBe(true)
    }
    const list = listOfInput(input)
    const texts = [
      drawing.top,
      drawing.summary,
      drawing.upHint,
      ...drawing.tiles.map(tile => tile.hover),
      ...list.rows.flatMap(row => [row.label, row.rest.text]),
      ...legendOf(input).map(span => span.text),
    ]
    for (const text of texts) expect(isPlain(text)).toBe(true)
  }
  const layout = layoutFrom(inputs[0] as ScreenInput)
  expect(layout.rects.map(r => r.label?.text)).toContain('café.py')
  expect(layout.rects.map(r => r.label?.text)).toContain('отчёт.py')
  const tiles = drawingOf(inputs[0] as ScreenInput).tiles
  expect(tiles.find(one => one.path === 'src/é​\ttab.ts')?.hover.startsWith('src/é??tab.ts')).toBe(true)
  expect(tiles.find(one => one.path === 'src/中文文件.ts')?.hover.startsWith('src/????.ts')).toBe(true)
  expect(tiles.find(one => one.path === 'src/تقرير.md')?.hover.startsWith('src/?????.md')).toBe(true)
  expect(listOfInput(inputs[0] as ScreenInput).rows.map(row => row.label)).toContain('docs/Ελληνικά.md')
  expect(plainText('Café ක')).toBe('Café ?')
})

const headerOf = (over: Partial<ScreenInput>) => {
  const drawing = drawingOf(makeInput(over))
  return drawing.top + drawing.summary
}

test('the header names the repository, the busy folders after now:, and the counts of changed and read files', () => {
  const busy = ['src/lib', 'tests', 'src/data']
  expect(headerOf({ repo: 'harbour-bikes', busy, changedCount: 13, readCount: 2 })).toBe('harbour-bikes  now: src/lib, tests, src/data  13 changed, 2 read')
  expect(headerOf({ repo: 'bikeapp', changedCount: 3, readCount: 12 })).toBe('bikeapp  3 changed, 12 read')
  expect(drawingOf(makeInput({ repo: 'bikeapp', busy })).upHint).toBe('')
})

test('a header that is wider than the pane leaves out whole folders and the counts, and cuts only the name of the repository', () => {
  const over = { repo: 'harbour-bikes', busy: ['src/lib', 'tests', 'src/data'], changedCount: 13, readCount: 2 }
  expect(headerOf({ ...over, columns: 63 })).toBe('harbour-bikes  now: src/lib, tests, src/data')
  expect(headerOf({ ...over, columns: 40 })).toBe('harbour-bikes  now: src/lib, tests')
  expect(headerOf({ ...over, columns: 26 })).toBe('harbour-bikes')
  expect(headerOf({ ...over, columns: 8, rows: 6 })).toBe('harbour-')
  expect(headerOf({ repo: 'bikeapp', busy: ['src/a-very-long-folder-name'], changedCount: 3, readCount: 12, columns: 40 })).toBe('bikeapp  3 changed, 12 read')
})

test('while the map shows a folder, the top row names the repository and the folder, and the rest of the header is the whole repository', () => {
  const over = { repo: 'harbour-bikes', busy: ['src/lib', 'tests'], changedCount: 13, readCount: 2 }
  const zoomed = drawingOf(makeInput({ ...over, zoom: 'src/util' }))
  expect(zoomed.top).toBe('harbour-bikes/src/util')
  expect(zoomed.summary).toBe('  now: src/lib, tests  13 changed, 2 read')
  expect(zoomed.upHint).toBe('Click to show src again.')
  expect(drawingOf(makeInput({ ...over, zoom: 'src' })).upHint).toBe('Click to show harbour-bikes again.')
  expect(drawingOf(makeInput({ ...over, zoom: 'src/util', columns: 12, rows: 9 })).top).toBe('~es/src/util')
  expect(headerOf({ ...over, zoom: 'src/util', columns: 12, rows: 9 })).toBe('~es/src/util')
  expect(drawingOf(makeInput({ ...over, zoom: 'src/util', columns: 12, rows: 9 })).upHint).toBe('Click to sho')
})

function legendAt(columns: number, theme: Theme = 'dark', windowMinutes = 5): { text: string; backs: Array<string | undefined> } {
  const spans = legendOf(makeInput({ columns, theme, windowMinutes }))
  return { text: spans.map(span => span.text).join(''), backs: spans.flatMap(span => [...span.text].map(() => span.fill)) }
}

test('the legend has a swatch and a word for read, changed and changed in the last five minutes', () => {
  for (const columns of [40, 64, 100]) {
    const legend = legendAt(columns)
    expect(legend.text).toBe('files    read     changed     last 5 min')
    expect([6, 7, 15, 16, 27, 28].map(column => legend.backs[column])).toEqual(
      [FILLS.dark.read, FILLS.dark.read, FILLS.dark.changed, FILLS.dark.changed, FILLS.dark.now, FILLS.dark.now].map(hex),
    )
    expect(legend.backs.filter(back => back !== undefined)).toHaveLength(6)
  }
  expect([6, 15, 27].map(column => legendAt(64, 'light').backs[column])).toEqual([FILLS.light.read, FILLS.light.changed, FILLS.light.now].map(hex))
  expect(legendOf(makeInput()).filter(span => span.ink !== undefined).every(span => span.ink === hex(INKS.dark.quiet))).toBe(true)
  expect(legendAt(64, 'dark', 10).text).toBe('files    read     changed     last 10 min')
})

test('a legend that does not fit drops words from the right, and its first swatch is never under the swatches of the list', () => {
  for (const columns of [25, 39]) expect(legendAt(columns).text).toBe('files    read     changed')
  for (const columns of [20, 24]) expect(legendAt(columns).text).toBe('files    read')
  for (let columns = 20; columns <= 70; columns++) {
    const legend = legendAt(columns)
    expect(legend.text.startsWith('files ')).toBe(true)
    expect(legend.text.length).toBeLessThanOrEqual(columns)
    expect(legend.backs.slice(0, 6)).toEqual(Array.from({ length: 6 }, () => undefined))
  }
})

test('a pane under 20 columns or 9 rows shows the header and the map only', () => {
  const recent = [recentRow('src/app.ts'), recentRow('src/layout.ts', { change: changeOf(1, 1) })]
  for (const [columns, rows] of [[19, 12], [64, 8], [64, 7]] as const) {
    const input = makeInput({ columns, rows, recent, outside: 2 })
    const frame = paneFrame(input)
    expect(frame).toEqual({ mapRows: rows - 3, listRows: 0, hasLegend: false, hasControls: true })
    expect(drawingOf(input).top).toBe('sample')
    expect(layoutFrom(input).height).toBe(2 * (rows - 3))
    expect(listOfInput(input)).toEqual({ rows: [], outside: null })
    expect(layoutFrom(input).rects.length).toBeGreaterThan(2)
  }
  expect(paneFrame(makeInput({ rows: 9 })).listRows).toBe(2)
})

test('a small file next to a far larger one is still drawn', () => {
  const files = [
    { p: 'lib/huge.ts', lines: 40000 },
    { p: 'lib/tiny.ts', lines: 20 },
    { p: 'main.ts', lines: 20 },
    { p: 'other/a.ts', lines: 9000 },
    { p: 'other/b.ts', lines: 20 },
  ]
  const layout = layoutFrom(makeInput({ files }))
  for (const key of ['lib/tiny.ts', 'main.ts', 'other/b.ts']) {
    const rect = layout.rects[indexOfKey(layout, key)] as MapRect
    expect(rect.kind).toBe('file')
    expect(rect.x1 - rect.x0).toBeGreaterThanOrEqual(2)
    expect(rect.y1 - rect.y0).toBeGreaterThanOrEqual(2)
  }
  const uneven = [21, 931, 105, 2189, 97, 51, 253].map((lines, i) => ({ p: `m/f${i}.ts`, lines }))
  const sameRow = layoutFrom(makeInput({ files: [...uneven, { p: 'big.ts', lines: 12588 }] }))
  expect(sameRow.rects.map(r => r.kind).sort().join()).toBe('file,file,file,file,file,file,file,file,folder')
})

test('a rectangle has an area in proportion to the square root of the lines of its files, and keeps their lines for the changed part', () => {
  const ratio = (layout: MapLayout, key: string, other: string) => areaOf(layout, key) / areaOf(layout, other)
  const files = layoutFrom(makeInput({ files: [{ p: 'short.tmdl', lines: 400 }, { p: 'long.json', lines: 6400 }] }))
  expect(ratio(files, 'long.json', 'short.tmdl')).toBeGreaterThan(3.5)
  expect(ratio(files, 'long.json', 'short.tmdl')).toBeLessThan(4.6)
  expect(files.rects.map(r => r.lines).sort((a, b) => a - b)).toEqual([400, 6400])
  const parts = Array.from({ length: 4 }, (_, i) => ({ p: `model/part-${i}.tmdl`, lines: 1600 }))
  const folder = layoutFrom(makeInput({ files: [...parts, { p: 'report.json', lines: 25600 }] }))
  const model = folder.rects.find(r => r.name === 'model') as MapRect
  expect(model.kind).toBe('folder')
  expect(model.lines).toBe(6400)
  const share = ((model.x1 - model.x0) * (model.y1 - model.y0)) / areaOf(folder, 'report.json')
  expect(share).toBeGreaterThan(0.9)
  expect(share).toBeLessThan(1.4)
  const icons = Array.from({ length: 300 }, (_, i) => ({ p: `icons/f${i}.json`, lines: 20 }))
  const boxed = layoutFrom(makeInput({ files: [...icons, { p: 'big.ts', lines: 300 * 300 * 20 }] }))
  const box = boxed.rects[indexOfKey(boxed, 'icons/f0.json')] as MapRect
  expect(box.kind).toBe('box')
  expect(box.lines).toBe(300 * 20)
  const boxShare = ((box.x1 - box.x0) * (box.y1 - box.y0)) / areaOf(boxed, 'big.ts')
  expect(boxShare).toBeGreaterThan(0.8)
  expect(boxShare).toBeLessThan(1.25)
})

test('a list row has the swatch, the label and the lines added and deleted, or read; a path that is too long is cut at its start', () => {
  const recent = [
    recentRow('src/app.ts', { change: changeOf(12, 3), isNow: true }),
    recentRow('a/very/long/folder/path/that/does/not/fit/in/the/row/at/all/src/layout.ts', { change: changeOf(140, 0) }),
    recentRow('docs/guide/intro.md'),
    recentRow('assets/logo.png', { change: changeOf(0, 0, true) }),
  ]
  const rows = listOfInput(makeInput({ recent })).rows
  expect(lineOf(rows[0])).toBe('   src/app.ts' + ' '.repeat(45) + '+12 -3')
  expect(lineOf(rows[0])).toHaveLength(64)
  expect(lineOf(rows[1])).toBe('   ~h/that/does/not/fit/in/the/row/at/all/src/layout.ts' + ' '.repeat(2) + '+140 -0')
  expect(lineOf(rows[2])).toBe('   docs/guide/intro.md' + ' '.repeat(38) + 'read')
  expect(lineOf(rows[3]).endsWith('   binary')).toBe(true)
  expect(rows.map(row => row.label)).toEqual(['src/app.ts', '~h/that/does/not/fit/in/the/row/at/all/src/layout.ts', 'docs/guide/intro.md', 'assets/logo.png'])
  expect(rows.map(row => row.path)).toEqual(recent.map(row => row.label))
  expect(rows.map(row => row.swatch)).toEqual([FILLS.dark.now, FILLS.dark.changed, FILLS.dark.read, FILLS.dark.changed].map(hex))
  expect(rows.every(row => row.rest.ink === hex(INKS.dark.quiet))).toBe(true)
  const narrow = listOfInput(makeInput({ columns: 20, rows: 9, recent: [recentRow('src/a-very-long-file-name.ts')] })).rows
  expect(lineOf(narrow[0])).toBe('   ~le-name.ts  read')
})

test('a list label keeps the part that tells two files apart: the cut falls inside the folder name', () => {
  const counts = { change: changeOf(3, 2) }
  const recent = [
    recentRow('skills/alpha-reviewer/SKILL.md', counts),
    recentRow('skills/beta-reviewer/SKILL.md', counts),
    recentRow('docs/setup-guide.md', counts),
  ]
  const rows = listOfInput(makeInput({ columns: 32, recent })).rows
  expect(lineOf(rows[0])).toBe('   ~pha-reviewer/SKILL.md  +3 -2')
  expect(lineOf(rows[1])).toBe('   ~eta-reviewer/SKILL.md  +3 -2')
  expect(lineOf(rows[2])).toBe('   docs/setup-guide.md' + ' '.repeat(5) + '+3 -2')
})

test('in a pane wider than 64 columns the counts of the list end at column 64, or as far right as the longest label needs, up to column 160', () => {
  const short = recentRow('src/app.ts', { change: changeOf(3, 2) })
  const long = recentRow('a/' + 'long-folder-name/'.repeat(4) + 'layout.ts', { change: changeOf(12, 0) })
  const linesAt = (columns: number, recent: RecentRow[]) => listOfInput(makeInput({ columns, recent })).rows.map(lineOf)
  for (const columns of [64, 120, 200]) expect(linesAt(columns, [short])).toEqual(['   src/app.ts' + ' '.repeat(46) + '+3 -2'])
  expect(linesAt(64, [short, long])).toEqual(['   src/app.ts' + ' '.repeat(46) + '+3 -2', '   ~der-name/long-folder-name/long-folder-name/layout.ts  +12 -0'])
  expect(linesAt(80, [short, long])).toEqual(['   src/app.ts' + ' '.repeat(62) + '+3 -2', '   ~er-name/long-folder-name/long-folder-name/long-folder-name/layout.ts  +12 -0'])
  for (const columns of [90, 120, 200]) {
    expect(linesAt(columns, [short, long])).toEqual(['   src/app.ts' + ' '.repeat(72) + '+3 -2', '   a/long-folder-name/long-folder-name/long-folder-name/long-folder-name/layout.ts  +12 -0'])
  }
  const deep = linesAt(200, [short, recentRow('d/'.repeat(100) + 'deep.ts', { change: changeOf(1, 0) })])
  expect(deep.map(line => line.length)).toEqual([160, 160])
  expect(deep[1]).toBe(`   ~${'d/'.repeat(71)}deep.ts  +1 -0`)
})

test('the files outside the repository are one row under the files of the list, which keeps its last row for it', () => {
  const two = listOfInput(makeInput({ recent: [recentRow('src/app.ts'), recentRow('README.md')], outside: 3 }))
  expect(two.rows).toHaveLength(2)
  expect(two.outside).toEqual({ text: '   +3 files outside this repo', ink: hex(INKS.dark.quiet) })
  expect(listOfInput(makeInput({ outside: 1 })).outside?.text).toBe('   +1 file outside this repo')
  expect(listOfInput(makeInput()).outside).toBeNull()
  const many = Array.from({ length: 40 }, (_, i) => recentRow(`src/file-${i}.ts`))
  const full = listOfInput(makeInput({ recent: many, outside: 2 }))
  expect(paneFrame(makeInput()).listRows).toBe(11)
  expect(full.rows.map(row => row.label)).toEqual(Array.from({ length: 10 }, (_, i) => `src/file-${i}.ts`))
  expect(full.outside?.text).toBe('   +2 files outside this repo')
})

test('the list has a quarter of the rows from the start, empty until a file is read or changed', () => {
  const many = Array.from({ length: 40 }, (_, i) => recentRow(`src/file-${i}.ts`))
  const rows = listOfInput(makeInput({ recent: many })).rows
  expect(rows).toHaveLength(11)
  expect(rows[0]?.label).toBe('src/file-0.ts')
  expect(rows[10]?.label).toBe('src/file-10.ts')
  const untouched = makeInput()
  expect(paneFrame(untouched)).toEqual({ mapRows: 33, listRows: 11, hasLegend: true, hasControls: true })
  expect(layoutFrom(untouched).height).toBe(66)
  expect(listOfInput(untouched)).toEqual({ rows: [], outside: null })
  expect(paneFrame(makeInput({ recent: many, outside: 4 }))).toEqual(paneFrame(untouched))
})

test('the rectangles of every file are the same for 0, 1, 5 and 50 marked files', () => {
  const files = sampleFiles()
  const drawnWith = (count: number) => {
    const marked = files.slice(0, count).map(file => file.p)
    const input = makeInput({
      files,
      marks: Object.fromEntries(marked.map((path, i) => [path.toLowerCase(), mark(5, { isRead: i % 2 === 0, isNow: i === 0 })])),
      recent: marked.map((path, i) => recentRow(path, { change: changeOf(5, 1), isNow: i === 0 })),
      changedCount: count,
    })
    const layout = layoutFrom(input)
    const drawing = drawingOf(input)
    const rects = files.map(file => {
      const rect = layout.rects[indexOfKey(layout, file.p.toLowerCase())] as MapRect
      return [file.p, rect.kind, rect.x0, rect.y0, rect.x1, rect.y1, rect.label]
    })
    const lastMapRow = rowText(drawing.grid, 64, drawing.rows - 1)
    return { height: layout.height, rects, firstListRow: lineOf(listOfInput(input).rows[0]), lastMapRow }
  }
  const untouched = drawnWith(0)
  expect(untouched.height).toBe(66)
  expect(untouched.rects).toHaveLength(70)
  expect(untouched.firstListRow).toBe('')
  for (const count of [1, 5, 50]) {
    const drawn = drawnWith(count)
    expect(drawn.height).toBe(untouched.height)
    expect(drawn.rects).toEqual(untouched.rects)
    expect(drawn.firstListRow).toBe('   README.md' + ' '.repeat(47) + '+5 -1')
    expect(drawn.lastMapRow.includes('+5 -1')).toBe(false)
  }
})

test('a notice replaces the map, the list and the legend', () => {
  const notice = 'This folder is not a git repository, so filemap has no file list to draw a map from.'
  const input = makeInput({ notice, recent: [recentRow('src/app.ts')], outside: 2, columns: 40, rows: 12 })
  const frame = paneFrame(input)
  expect(frame).toEqual({ mapRows: 9, listRows: 0, hasLegend: false, hasControls: true })
  const drawing = drawingOf(input)
  expect(drawing.top).toBe('sample')
  const body = [0, 1, 2].map(row => rowText(drawing.grid, 40, row).trimEnd())
  expect(body.join(' ')).toBe(notice)
  for (const line of body) expect(line.length).toBeLessThanOrEqual(40)
  for (let row = 3; row < drawing.rows; row++) expect(rowText(drawing.grid, 40, row).trim()).toBe('')
  for (let at = 0; at < drawing.grid.length; at += 3) expect(wordAt(drawing.grid, at + 2)).toBe(DEFAULT)
  expect(drawing.tiles).toEqual([])
  expect(drawing.owner.every(owner => owner === -1)).toBe(true)
  expect(layoutOf(input, frame.mapRows)).toBeNull()
  expect(listOf(input, frame)).toEqual({ rows: [], outside: null })
})

test('a repository with no file of a mapped type has a notice in the rows of the map, and the list and the legend stay', () => {
  const recent = [recentRow('notes.txt', { change: changeOf(2, 1), isNow: true }), recentRow('LICENSE')]
  for (const theme of ['dark', 'light'] as const) {
    const input = makeInput({ files: [], recent, changedCount: 1, readCount: 1, columns: 64, rows: 40, theme })
    expect(paneFrame(input)).toEqual({ mapRows: 27, listRows: 9, hasLegend: true, hasControls: true })
    const drawing = drawingOf(input)
    expect(drawing.top + drawing.summary).toBe('sample  1 changed, 1 read')
    expect(rowText(drawing.grid, 64, 0).trimEnd()).toBe('No file of a mapped type in this repository.')
    for (let row = 1; row < 27; row++) expect(rowText(drawing.grid, 64, row).trim()).toBe('')
    expect(drawing.tiles).toEqual([])
    const rows = listOfInput(input).rows
    expect(lineOf(rows[0])).toBe('   notes.txt' + ' '.repeat(47) + '+2 -1')
    expect(rows[0]?.swatch).toBe(hex(FILLS[theme].now))
    expect(lineOf(rows[1])).toBe('   LICENSE' + ' '.repeat(50) + 'read')
    expect(rows[1]?.swatch).toBe(hex(FILLS[theme].read))
    expect(legendOf(input).map(span => span.text).join('')).toBe('files    read     changed     last 5 min')
  }
  const narrow = makeInput({ files: [], recent, columns: 20, rows: 12 })
  const grid = gridOf(narrow)
  expect([0, 1, 2].map(row => rowText(grid, 20, row).trimEnd())).toEqual(['No file of a mapped', 'type in this', 'repository.'])
  for (let row = 3; row < 6; row++) expect(rowText(grid, 20, row).trim()).toBe('')
  const rows = listOfInput(narrow).rows
  expect(rows[0]?.swatch).toBe(hex(FILLS.dark.now))
  expect(lineOf(rows[0]).endsWith('+2 -1')).toBe(true)
  expect(legendOf(narrow).map(span => span.text).join('').startsWith('files ')).toBe(true)
  const small = drawingOf(makeInput({ files: [], recent, columns: 64, rows: 4 }))
  expect(small.rows).toBe(1)
  expect(rowText(small.grid, 64, 0).trimEnd()).toBe('No file of a mapped type in this repository.')
})

test('a folder with one sub-folder and no files merges with it; the root never merges', () => {
  const layout = layoutFrom(makeInput({ columns: 100, rows: 60 }))
  const names = layout.rects.filter(r => r.kind !== 'file').map(r => r.name)
  expect(names).toContain('docs/guide')
  expect(names).toContain('assets/icons')
  expect(names).toContain('src')
  expect(names).toContain('util')
  const only = layoutFrom(makeInput({ files: [{ p: 'a/b/one.ts', lines: 50 }, { p: 'a/b/two.ts', lines: 80 }] }))
  expect(only.rects.map(r => r.name)).toEqual(['a/b', 'two.ts', 'one.ts'])
  expect(only.rects.map(r => r.depth)).toEqual([1, 2, 2])
  expect(only.rects.map(r => r.lines)).toEqual([130, 80, 50])
})

test('every rectangle has the path of its file or folder as git spells it, a merged folder the path of its last folder', () => {
  const files = [
    { p: 'Docs/Guide/Intro.md', lines: 200 },
    { p: 'Docs/Guide/Setup.md', lines: 180 },
    { p: 'src/App.ts', lines: 900 },
    { p: 'src/util/Text.ts', lines: 150 },
    { p: 'src/util/path.ts', lines: 90 },
    { p: 'README.md', lines: 120 },
  ]
  const layout = layoutFrom(makeInput({ files }))
  const pathOf = (name: string) => layout.rects.find(r => r.name === name)?.path
  expect(pathOf('Docs/Guide')).toBe('Docs/Guide')
  expect(pathOf('Intro.md')).toBe('Docs/Guide/Intro.md')
  expect(pathOf('src')).toBe('src')
  expect(pathOf('util')).toBe('src/util')
  expect(pathOf('Text.ts')).toBe('src/util/Text.ts')
  expect(pathOf('README.md')).toBe('README.md')
  expect(layout.rects.find(r => r.name === 'src')?.keys.sort()).toEqual(['src/app.ts', 'src/util/path.ts', 'src/util/text.ts'])
  expect(layout.byKey.get('src/app.ts')).toBe(layout.rects.findIndex(r => r.name === 'App.ts'))
})

test('a map that shows a folder lays out the files under it alone, and each tile keeps its path from the root of the repository', () => {
  const whole = makeInput()
  const zoomed: ScreenInput = { ...whole, zoom: 'src' }
  const layout = layoutFrom(zoomed)
  const inside = whole.files.filter(file => file.p.startsWith('src/')).map(file => file.p)
  expect(layout.rects.filter(r => r.kind === 'file').map(r => r.path).sort()).toEqual(inside.sort())
  expect(layout.rects.find(r => r.path === 'src/util')).toMatchObject({ kind: 'folder', name: 'util', depth: 1 })
  expect(layout.rects.find(r => r.path === 'src/app.ts')?.depth).toBe(1)
  expect(areaOf(layout, 'src/app.ts')).toBeGreaterThan(2 * areaOf(layoutFrom(whole), 'src/app.ts'))
  expect(layoutFrom(zoomed)).toBe(layout)
  expect(layoutFrom(whole)).not.toBe(layout)
  expect(geometry(layoutFrom({ ...whole, zoom: 'docs/guide' }))).not.toEqual(geometry(layout))
  const crowded = crowdedInput()
  const box = firstBox(layoutFrom(crowded)).rect
  const opened = layoutFrom({ ...crowded, zoom: box.path })
  expect(opened.rects.filter(r => r.kind === 'file').map(r => r.path.toLowerCase()).sort()).toEqual([...box.keys].sort())
})

test('zooming out passes the folders that hold one folder and no file, and hasFolder names the folders of the list', () => {
  const files = [
    { p: 'a/b/c/one.ts', lines: 10 },
    { p: 'a/b/c/two.ts', lines: 10 },
    { p: 'a/x.ts', lines: 10 },
    { p: 'top.ts', lines: 10 },
    { p: 'p/q/r.ts', lines: 10 },
    { p: 'p/q/s.ts', lines: 10 },
  ]
  const layout = layoutFrom(makeInput({ files }))
  expect(layout.rects.find(r => r.name === 'b/c')?.path).toBe('a/b/c')
  expect(layout.rects.find(r => r.name === 'p/q')?.path).toBe('p/q')
  expect(zoomOut(files, 'a/b/c')).toBe('a')
  expect(zoomOut(files, 'a')).toBe('')
  expect(zoomOut(files, 'p/q')).toBe('')
  expect(zoomOut(files, '')).toBe('')
  expect(hasFolder(files, 'a/b')).toBe(true)
  expect(hasFolder(files, '')).toBe(true)
  expect(hasFolder([], '')).toBe(true)
  for (const missing of ['a/b/c/one.ts', 'a/bb', 'A', 'b']) expect(hasFolder(files, missing)).toBe(false)
})

test('the tiles of a drawing follow its rectangles: a file opens, a folder and a box zoom, and each says its status', () => {
  const marks = {
    'src/app.ts': mark(12, { change: changeOf(12, 3), isRead: true }),
    'src/layout.ts': mark(0, { isRead: true }),
    'src/colour.ts': mark(300, { change: changeOf(0, 0, true) }),
  }
  const input = makeInput({ marks })
  const layout = layoutFrom(input)
  const drawing = drawingOf(input)
  expect(drawing.tiles).toHaveLength(layout.rects.length)
  layout.rects.forEach((rect, i) => {
    expect(drawing.tiles[i]).toMatchObject({ path: rect.path, kind: rect.kind === 'file' ? 'file' : 'folder', depth: rect.depth })
  })
  const hoverOf = (path: string) => drawing.tiles.find(tile => tile.path === path)?.hover
  expect(hoverOf('src/app.ts')).toBe('src/app.ts  +12 -3')
  expect(hoverOf('src/layout.ts')).toBe('src/layout.ts  read')
  expect(hoverOf('src/colour.ts')).toBe('src/colour.ts  binary')
  expect(hoverOf('README.md')).toBe('README.md')
  expect(hoverOf('src')).toBe('src/  6 files, 2 changed, 1 read')
  expect(hoverOf('src/util')).toBe('src/util/  2 files')
  const crowded = crowdedInput()
  const box = firstBox(layoutFrom(crowded))
  const boxTile = drawingOf(crowded).tiles[box.index]
  expect(boxTile).toEqual({ path: box.rect.path, kind: 'folder', depth: box.rect.depth, hover: `${box.rect.path}/  ${box.rect.keys.length} files` })
})

test('a hover text too long for the row loses the start of its path and keeps the name and the status', () => {
  const files = [
    { p: 'a/very/long/folder/path/that/does/not/fit/layout.ts', lines: 400 },
    { p: 'b.ts', lines: 400 },
  ]
  const input = makeInput({ files, columns: 30, rows: 20, marks: { 'a/very/long/folder/path/that/does/not/fit/layout.ts': mark(5, { change: changeOf(5, 1) }) } })
  const tiles = drawingOf(input).tiles
  expect(tiles.find(tile => tile.kind === 'file' && tile.path.endsWith('layout.ts'))?.hover).toBe('~does/not/fit/layout.ts  +5 -1')
  for (const tile of tiles) expect(tile.hover.length).toBeLessThanOrEqual(30)
})

test('a file that is neither read nor changed has the neutral fill, and a file that was only read the read fill', () => {
  for (const theme of ['dark', 'light'] as const) {
    const base = makeInput({ theme })
    const layout = layoutFrom(base)
    const index = indexOfKey(layout, 'src/app.ts')
    expect(colorsOf(gridOf(base), layout, index)).toEqual([FILLS[theme].neutral])
    const read = gridOf({ ...base, marks: { 'src/app.ts': mark(0, { isRead: true }) } })
    expect(colorsOf(read, layout, index)).toEqual([FILLS[theme].read])
  }
})

test('the changed part of a file is the share of its lines that changed, filled from the bottom across its whole width', () => {
  const base = makeInput()
  const layout = layoutFrom(base)
  const rect = layout.rects[indexOfKey(layout, 'src/app.ts')] as MapRect
  const height = rect.y1 - rect.y0
  expect(rect.lines).toBe(900)
  expect(height).toBeGreaterThan(10)
  for (const [changed, isRead] of [[450, true], [300, false], [90, true]] as const) {
    const rows = rowsOf(gridOf({ ...base, marks: { 'src/app.ts': mark(changed, { isRead }) } }), layout, rect)
    for (const colors of rows) expect(colors).toHaveLength(1)
    const filled = rows.filter(colors => colors[0] === FILLS.dark.changed).length
    expect(rows.slice(height - filled).every(colors => colors[0] === FILLS.dark.changed)).toBe(true)
    expect(rows.slice(0, height - filled).every(colors => colors[0] === (isRead ? FILLS.dark.read : FILLS.dark.neutral))).toBe(true)
    const share = Math.round((changed / 900) * height)
    expect(filled === share || filled === share + 1).toBe(true)
    expect((rect.y1 - filled) % 2).toBe(0)
  }
})

test('a change of one line fills at least one cell, and a share above one fills the whole rectangle', () => {
  let ends = 0
  for (const [columns, rows] of [[64, 48], [100, 60]] as const) {
    const base = makeInput({ columns, rows })
    const layout = layoutFrom(base)
    const files = layout.rects.filter(rect => rect.kind === 'file')
    const grid = gridOf({ ...base, marks: Object.fromEntries(files.map(rect => [rect.keys[0] as string, mark(1)])) })
    for (const rect of files) {
      ends |= 1 << (rect.y1 % 2)
      const lowest = Math.floor(rect.y1 / 2) - 1
      if (2 * lowest < rect.y0) continue
      for (let x = rect.x0; x < rect.x1; x++) {
        expect(pixelColor(grid, layout, x, 2 * lowest)).toBe(FILLS.dark.changed)
        expect(pixelColor(grid, layout, x, 2 * lowest + 1)).toBe(FILLS.dark.changed)
      }
      const filled = rowsOf(grid, layout, rect).filter(colors => colors[0] === FILLS.dark.changed).length
      expect(filled).toBeGreaterThanOrEqual(2)
      expect(filled).toBeLessThanOrEqual(3)
    }
  }
  expect(ends).toBe(3)
  const base = makeInput()
  const layout = layoutFrom(base)
  const all = gridOf({ ...base, marks: { 'src/app.ts': mark(5000, { isRead: true }) } })
  expect(colorsOf(all, layout, indexOfKey(layout, 'src/app.ts'))).toEqual([FILLS.dark.changed])
})

test('orange takes the place of blue for a file that changed in the last five minutes, and the changed part keeps its height', () => {
  for (const theme of ['dark', 'light'] as const) {
    const base = makeInput({ theme })
    const layout = layoutFrom(base)
    const rect = layout.rects[indexOfKey(layout, 'src/layout.ts')] as MapRect
    const before = rowsOf(gridOf({ ...base, marks: { 'src/layout.ts': mark(200, { isRead: true }) } }), layout, rect)
    const now = rowsOf(gridOf({ ...base, marks: { 'src/layout.ts': mark(200, { isRead: true, isNow: true }) } }), layout, rect)
    expect(now.map(colors => (colors[0] === FILLS[theme].now ? 'changed' : colors[0]))).toEqual(
      before.map(colors => (colors[0] === FILLS[theme].changed ? 'changed' : colors[0])),
    )
    expect(now.flat()).not.toContain(FILLS[theme].changed)
    expect(now.flat()).toContain(FILLS[theme].read)
  }
})

test('no cell inside a rectangle is half changed, whatever the share', () => {
  const base = makeInput({ columns: 100, rows: 60 })
  const layout = layoutFrom(base)
  const files = layout.rects.filter(rect => rect.kind === 'file')
  for (let step = 1; step <= 20; step++) {
    const marks = Object.fromEntries(files.map(rect => [rect.keys[0] as string, mark(Math.ceil((rect.lines * step) / 20), { isRead: true })]))
    const grid = gridOf({ ...base, marks })
    for (const rect of files) for (let row = Math.ceil(rect.y0 / 2); 2 * row + 2 <= rect.y1; row++) for (let x = rect.x0; x < rect.x1; x++) expect(pixelColor(grid, layout, x, 2 * row)).toBe(pixelColor(grid, layout, x, 2 * row + 1))
  }
})

test('a label takes the ink of the fill under it', () => {
  for (const theme of ['dark', 'light'] as const) {
    const base = makeInput({ theme })
    const layout = layoutFrom(base)
    const rect = layout.rects[indexOfKey(layout, 'src/layout.ts')] as MapRect
    const label = rect.label
    if (!label) throw new Error('src/layout.ts has no label at this size')
    const cell = (marks: Record<string, Mark>) => {
      const grid = gridOf({ ...base, marks })
      const at = (label.row * layout.width + label.column) * 3
      return { ink: wordAt(grid, at + 1), back: wordAt(grid, at + 2) }
    }
    expect(cell({})).toEqual({ ink: INKS[theme].quiet, back: FILLS[theme].neutral })
    expect(cell({ 'src/layout.ts': mark(10, { isRead: true }) })).toEqual({ ink: INKS[theme].read, back: FILLS[theme].read })
    expect(cell({ 'src/layout.ts': mark(600) })).toEqual({ ink: INKS[theme].light, back: FILLS[theme].changed })
    expect(cell({ 'src/layout.ts': mark(600, { isNow: true }) })).toEqual({ ink: INKS[theme].light, back: FILLS[theme].now })
  }
})

const channels = (colour: number) => [16, 8, 0].map(shift => ((colour >> shift) & 255) / 255)

function apca(text: number, back: number): number {
  const luminance = (colour: number) => {
    const [r = 0, g = 0, b = 0] = channels(colour)
    const y = 0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.072175 * b ** 2.4
    return y > 0.022 ? y : y + (0.022 - y) ** 1.414
  }
  const [t, b] = [luminance(text), luminance(back)]
  const contrast = b > t ? (b ** 0.56 - t ** 0.57) * 1.14 : (b ** 0.65 - t ** 0.62) * 1.14
  return Math.abs(contrast) < 0.1 ? 0 : Math.abs(contrast) * 100 - 2.7
}

function lightness(colour: number): number {
  const [r = 0, g = 0, b = 0] = channels(colour).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const [l, m, s] = [0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b].map(Math.cbrt)
  return 0.2104542553 * (l ?? 0) + 0.793617785 * (m ?? 0) - 0.0040720468 * (s ?? 0)
}

test('the label on a read, changed or changed-now fill takes the ink that APCA rates higher of the two inks of its theme', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const [fill, ink] of [[FILLS[theme].read, INKS[theme].read], [FILLS[theme].changed, INKS[theme].light], [FILLS[theme].now, INKS[theme].light]] as const) {
      const other = ink === INKS[theme].light ? INKS[theme].dark : INKS[theme].light
      expect(apca(ink, fill)).toBeGreaterThan(apca(other, fill))
    }
  }
})

test('a read file is one step past an untouched file, the step from a folder to an untouched file, so blue and orange stand out more than reads', () => {
  for (const theme of ['dark', 'light'] as const) {
    const { folder, neutral, read, changed, now } = FILLS[theme]
    const step = lightness(neutral) - lightness(folder)
    expect(Math.abs(lightness(read) - lightness(neutral) - step)).toBeLessThan(0.005)
    expect(Math.abs(lightness(changed) - lightness(neutral))).toBeGreaterThan(2 * Math.abs(step))
    expect(Math.abs(lightness(now) - lightness(neutral))).toBeGreaterThan(2 * Math.abs(step))
  }
})

test('paths are matched by their lower-cased form', () => {
  const base = crowdedInput()
  const layout = layoutFrom(base)
  const { rect, index } = firstBox(layout)
  const key = rect.keys[0] as string
  expect(key).toBe(key.toLowerCase())
  expect(base.files.some(f => f.p !== f.p.toLowerCase() && f.p.toLowerCase() === key)).toBe(true)
  const grid = gridOf({ ...base, marks: { [key]: mark(0, { isRead: true }) } })
  expect(colorsOf(grid, layout, index)).toEqual([FILLS.dark.read])
})

test('a folder drawn as one box fills the share of its area that its changed files take, each file by the square root of its lines', () => {
  const icons = Array.from({ length: 300 }, (_, i) => ({ p: `m/icon-${i}.json`, lines: 20 }))
  const base = makeInput({ files: [{ p: 'big.ts', lines: 40_000_000 }, { p: 'm/long.json', lines: 60_000 }, ...icons] })
  const layout = layoutFrom(base)
  const rect = layout.rects[indexOfKey(layout, 'm/icon-0.json')] as MapRect
  expect(rect.kind).toBe('box')
  expect(rect.keys).toHaveLength(301)
  const height = rect.y1 - rect.y0
  const filledBy = (marks: Record<string, Mark>) => rowsOf(gridOf({ ...base, marks }), layout, rect).filter(colors => colors[0] === FILLS.dark.changed).length
  const icon = Math.sqrt(20)
  const share = Math.round(((300 * icon) / (300 * icon + Math.sqrt(60_000))) * height)
  const icons20 = filledBy(Object.fromEntries(icons.map(file => [file.p, mark(20)])))
  expect(icons20 === share || icons20 === share + 1).toBe(true)
  expect(filledBy(Object.fromEntries(icons.map(file => [file.p, mark(500)])))).toBe(icons20)
  const half = Math.round(((150 * icon) / (300 * icon + Math.sqrt(60_000))) * height)
  const halfIcons = filledBy(Object.fromEntries(icons.slice(0, 150).map(file => [file.p, mark(20)])))
  expect(halfIcons === half || halfIcons === half + 1).toBe(true)
})

test('a folder drawn as one box has the share of its files that changed when they have one length, and the read fill when one of them was read', () => {
  const base = crowdedInput()
  const layout = layoutFrom(base)
  const { rect, index } = firstBox(layout)
  const render = (marks: Record<string, Mark>) => gridOf({ ...base, marks })
  const untouched = rect.depth % 2 === 0 ? DEFAULT : FILLS.dark.folder
  expect(colorsOf(render({}), layout, index)).toEqual([untouched])
  expect(colorsOf(render({ [rect.keys[0] as string]: mark(0, { isRead: true }) }), layout, index)).toEqual([FILLS.dark.read])
  expect(rect.lines).toBe(20 * rect.keys.length)
  const half = Object.fromEntries(rect.keys.slice(0, rect.keys.length / 2).map(key => [key, mark(20)]))
  const rows = rowsOf(render(half), layout, rect)
  const height = rect.y1 - rect.y0
  const filled = rows.filter(colors => colors[0] === FILLS.dark.changed).length
  expect(filled === Math.round(height / 2) || filled === Math.round(height / 2) + 1).toBe(true)
  expect(rows.slice(0, height - filled).every(colors => colors[0] === untouched)).toBe(true)
  const now = { ...half, [rect.keys[0] as string]: mark(20, { isNow: true }) }
  expect(colorsOf(render(now), layout, index).sort()).toEqual([untouched, FILLS.dark.now].sort())
  expect(rect.label?.text.endsWith('/')).toBe(true)
})

test('a folder inside a folder shows the default background, and a folder at the top the folder fill', () => {
  const base = makeInput({ columns: 100, rows: 60 })
  const layout = layoutFrom(base)
  const grid = gridOf({ ...base, marks: { 'src/util/text.ts': mark(150) } })
  const src = layout.rects.findIndex(r => r.kind === 'folder' && r.name === 'src')
  const util = layout.rects.findIndex(r => r.kind === 'folder' && r.name === 'util')
  expect(layout.rects[src]?.depth).toBe(1)
  expect(layout.rects[util]?.depth).toBe(2)
  expect(colorsOf(grid, layout, src)).toEqual([FILLS.dark.folder])
  expect(colorsOf(grid, layout, util)).toEqual([DEFAULT])
})

test('a label sits on cells whose two pixels belong to the labelled rectangle', () => {
  for (const [columns, rows] of [[64, 48], [100, 60], [30, 16]] as const) {
    const layout = layoutFrom(makeInput({ columns, rows }))
    const labelled = layout.rects.filter(r => r.label)
    expect(labelled.length).toBeGreaterThan(2)
    layout.rects.forEach((rect, index) => {
      const label = rect.label
      if (!label) return
      for (let x = label.column; x < label.column + label.text.length; x++) {
        expect(layout.owner[2 * label.row * layout.width + x]).toBe(index)
        expect(layout.owner[(2 * label.row + 1) * layout.width + x]).toBe(index)
      }
      expect(label.text.includes('.') || rect.kind !== 'file' || !rect.name.includes('.') || rect.name.startsWith(label.text)).toBe(true)
    })
  }
})

test('a half block is drawn in the colour of its rectangle, never in the default colour', () => {
  const base = makeInput({ columns: 100, rows: 60 })
  const marks = { 'src/app.ts': mark(300), 'src/util/text.ts': mark(0, { isRead: true }), 'src/util/path.ts': mark(20, { isNow: true }) }
  const grid = gridOf({ ...base, marks })
  let halves = 0
  for (let at = 0; at < grid.length; at += 3) {
    const glyph = wordAt(grid, at)
    if (glyph !== UPPER_HALF && glyph !== LOWER_HALF) continue
    halves++
    expect(wordAt(grid, at + 1)).not.toBe(DEFAULT)
    expect(wordAt(grid, at + 1)).not.toBe(wordAt(grid, at + 2))
    if (glyph === LOWER_HALF) expect(wordAt(grid, at + 2)).toBe(DEFAULT)
  }
  expect(halves).toBeGreaterThan(20)
})

test('every drawn file and box is at least two pixels wide and high inside a folder', () => {
  for (const [columns, rows] of [[64, 48], [100, 60]] as const) {
    const layout = layoutFrom(makeInput({ columns, rows }))
    for (const rect of layout.rects) {
      if (rect.kind === 'folder' || rect.depth === 1) continue
      expect(rect.x1 - rect.x0).toBeGreaterThanOrEqual(2)
      expect(rect.y1 - rect.y0).toBeGreaterThanOrEqual(2)
    }
    for (let i = 0; i < layout.rects.length; i++) {
      const a = layout.rects[i] as MapRect
      for (const b of layout.rects.slice(i + 1)) {
        const isInside = b.x0 >= a.x0 && b.x1 <= a.x1 && b.y0 >= a.y0 && b.y1 <= a.y1 && a.kind === 'folder' && b.depth > a.depth
        const isApart = b.x0 >= a.x1 + 1 || a.x0 >= b.x1 + 1 || b.y0 >= a.y1 + 1 || a.y0 >= b.y1 + 1
        expect(isInside || isApart).toBe(true)
      }
    }
  }
})

test('every file of a repo that fits is drawn as its own rectangle', () => {
  for (const [columns, rows] of [[64, 48], [100, 60]] as const) {
    const input = makeInput({ columns, rows })
    const layout = layoutFrom(input)
    expect(layout.rects.filter(r => r.kind === 'box')).toHaveLength(0)
    expect(layout.rects.filter(r => r.kind === 'file')).toHaveLength(input.files.length)
    for (const file of input.files) expect(areaOf(layout, file.p.toLowerCase())).toBeGreaterThan(0)
  }
})

test('a folder gets room for its name band and padding, so a file deep inside is not drawn smaller', () => {
  const files = ['top.ts', 'a/x.ts', 'a/b/y.ts', 'a/b/c/deep.ts', 'a/b/c/other.ts'].map(p => ({ p, lines: 400 }))
  const layout = layoutFrom(makeInput({ files }))
  const top = areaOf(layout, 'top.ts')
  const deep = areaOf(layout, 'a/b/c/deep.ts')
  expect(deep).toBeGreaterThanOrEqual(0.85 * top)
  expect(top).toBeGreaterThanOrEqual(0.85 * deep)
})

test('a folder closes when it has under 16 pixels for each of its files, and stays open above that', () => {
  const filesOf = (count: number) => Array.from({ length: count }, (_, i) => ({ p: `a/f${i}.ts`, lines: 20 }))
  const roomy = layoutFrom(makeInput({ files: filesOf(200) }))
  expect(roomy.width * roomy.height).toBe(64 * 66)
  expect(roomy.rects.find(r => r.name === 'a')?.kind).toBe('folder')
  expect(roomy.rects.filter(r => r.kind === 'file')).toHaveLength(200)
  const crowded = layoutFrom(makeInput({ files: filesOf(300) }))
  expect(crowded.rects.map(r => r.kind)).toEqual(['box'])
  expect(crowded.rects[0]?.keys).toHaveLength(300)
  expect(crowded.rects[0]?.label?.text).toBe('a/')
})

test('a folder closes when its shape leaves a file under 2 pixels, whatever its area is', () => {
  const files = [
    { p: 'big.ts', lines: 100000 },
    { p: 'm/a.ts', lines: 20 },
    { p: 'm/b.ts', lines: 20 },
  ]
  const layout = layoutFrom(makeInput({ files }))
  const box = layout.rects[indexOfKey(layout, 'm/a.ts')] as MapRect
  expect(box.kind).toBe('box')
  expect(box.keys).toEqual(['m/a.ts', 'm/b.ts'])
  expect((box.x1 - box.x0) * (box.y1 - box.y0)).toBeGreaterThanOrEqual(16 * 2)
})

test('short files that share a row with long ones keep a visible length, so their folder stays open', () => {
  let state = 10
  const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const files: MapFile[] = []
  for (let i = 0; i < 80; i++) {
    const folders = Array.from({ length: Math.floor(next() * 3) }, () => `d${Math.floor(next() * 3)}`)
    files.push({ p: [...folders, `f${i}.ts`].join('/'), lines: Math.floor(20 + next() ** 3 * 4000) })
  }
  const layout = layoutFrom(makeInput({ files, columns: 40, rows: 24 }))
  expect(layout.rects.find(r => r.depth === 1 && r.name === 'd0')?.kind).toBe('folder')
  const own = files.filter(f => /^d0\/f\d+\.ts$/.test(f.p))
  expect(own).toHaveLength(13)
  for (const file of own) {
    const rect = layout.rects[indexOfKey(layout, file.p)] as MapRect
    expect(rect.kind).toBe('file')
    expect(rect.x1 - rect.x0).toBeGreaterThanOrEqual(2)
    expect(rect.y1 - rect.y0).toBeGreaterThanOrEqual(2)
  }
})

test('the folders that are open suit the height that the list leaves for the map, so no file is squeezed away', () => {
  const files = [
    { p: 'd0/f0.ts', lines: 34 },
    { p: 'f1.ts', lines: 112 },
    { p: 'd0/d2/f2.ts', lines: 30 },
    { p: 'f3.ts', lines: 107 },
    { p: 'd1/d1/f4.ts', lines: 2959 },
    { p: 'd0/f5.ts', lines: 341 },
  ]
  const layout = layoutFrom(makeInput({ files, columns: 30, rows: 16 }))
  expect(layout.height).toBe(2 * 9)
  for (const file of files) {
    const rect = layout.rects[indexOfKey(layout, file.p)] as MapRect
    expect(rect.x1 - rect.x0).toBeGreaterThanOrEqual(rect.depth > 1 ? 2 : 1)
    expect(rect.y1 - rect.y0).toBeGreaterThanOrEqual(rect.depth > 1 ? 2 : 1)
  }
})

test('no file or box inside a folder is under two pixels, whatever the length of the list', () => {
  let state = 20
  const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const files: MapFile[] = []
  for (let i = 0; i < 60; i++) {
    const depth = 1 + Math.floor(next() * 4)
    const folders = Array.from({ length: depth }, (_, level) => `d${Math.floor(next() * (level === 0 ? 5 : 3))}`)
    files.push({ p: `${folders.join('/')}/f${i}.ts`, lines: Math.floor(20 + next() ** 4 * 3000) })
  }
  for (let listRows = 0; listRows <= 12; listRows++) {
    const recent = Array.from({ length: listRows }, (_, i) => recentRow(`elsewhere/file-${i}.txt`))
    const layout = layoutFrom(makeInput({ files, recent }))
    expect(layout.height).toBe(66)
    for (const file of files) expect(layout.byKey.has(file.p)).toBe(true)
    for (const rect of layout.rects) {
      if (rect.kind === 'folder' || rect.depth === 1) continue
      expect(rect.x1 - rect.x0).toBeGreaterThanOrEqual(2)
      expect(rect.y1 - rect.y0).toBeGreaterThanOrEqual(2)
    }
  }
})

test('every file of a deep chain of folders is on a rectangle or in a box', () => {
  const files = Array.from({ length: 40 }, (_, i) => ({ p: Array.from({ length: i + 1 }, (_, level) => `d${level}`).join('/') + `/file${i}.ts`, lines: 200 }))
  for (const [columns, rows] of [[180, 15], [120, 13], [30, 17], [64, 48]] as const) {
    const layout = layoutFrom(makeInput({ files, columns, rows }))
    for (const file of files) expect(layout.byKey.has(file.p)).toBe(true)
  }
})

test('a file next to a far larger folder inside a folder keeps a visible size, and the folder stays open', () => {
  const files: MapFile[] = [{ p: 'other/huge.ts', lines: 60000 }]
  for (let i = 0; i < 9; i++) files.push({ p: `pkg/editor/config-${i}.json`, lines: 20 })
  for (let i = 0; i < 12; i++) files.push({ p: `pkg/editor/src/part-${i}.ts`, lines: 2500 })
  for (let i = 0; i < 6; i++) files.push({ p: `pkg/core/part-${i}.ts`, lines: 2500 })
  const layout = layoutFrom(makeInput({ files }))
  expect(layout.rects.find(r => r.name === 'editor')?.kind).toBe('folder')
  for (let i = 0; i < 9; i++) {
    const rect = layout.rects[indexOfKey(layout, `pkg/editor/config-${i}.json`)] as MapRect
    expect(rect.kind).toBe('file')
    expect(rect.x1 - rect.x0).toBeGreaterThanOrEqual(2)
    expect(rect.y1 - rect.y0).toBeGreaterThanOrEqual(2)
  }
})

test('the layout is identical when only the marks change', () => {
  const base = makeInput({ recent: [recentRow('src/app.ts')] })
  const before = layoutFrom(base)
  const snapshot = JSON.stringify(geometry(before))
  const plain = gridOf(base)
  const marked: ScreenInput = {
    ...base,
    marks: { 'src/app.ts': mark(450, { isRead: true }), 'src/util/text.ts': mark(0, { isRead: true }), 'assets/icons/set-0/icon-0.json': mark(20, { isNow: true }) },
    recent: [recentRow('src/colour.ts', { change: changeOf(1, 0), isNow: true })],
    changedCount: 2,
    readCount: 1,
  }
  const coloured = gridOf(marked)
  const after = layoutFrom(marked)
  expect(after).toBe(before)
  expect(JSON.stringify(geometry(after))).toBe(snapshot)
  expect(coloured).not.toEqual(plain)
  const isBlock = (glyph: number) => glyph === UPPER_HALF || glyph === LOWER_HALF
  for (let at = 0; at < plain.length; at += 3) {
    const [a, b] = [wordAt(plain, at), wordAt(coloured, at)]
    if (!isBlock(a) && !isBlock(b)) expect(b).toBe(a)
  }
  const other = layoutFrom({ ...base, filesVersion: ++lastVersion, files: [...base.files, { p: 'src/new.ts', lines: 5000 }] })
  expect(other).not.toBe(before)
  expect(other.byKey.has('src/new.ts')).toBe(true)
})

test('the light theme has its own fills', () => {
  const base = makeInput({ theme: 'light' })
  const layout = layoutFrom(base)
  const marks = { 'src/app.ts': mark(5000), 'src/layout.ts': mark(0, { isRead: true }), 'src/notes.md': mark(5000, { isNow: true }) }
  const grid = gridOf({ ...base, marks })
  expect(colorsOf(grid, layout, indexOfKey(layout, 'src/app.ts'))).toEqual([FILLS.light.changed])
  expect(colorsOf(grid, layout, indexOfKey(layout, 'src/layout.ts'))).toEqual([FILLS.light.read])
  expect(colorsOf(grid, layout, indexOfKey(layout, 'src/notes.md'))).toEqual([FILLS.light.now])
  expect(colorsOf(grid, layout, indexOfKey(layout, 'src/colour.ts'))).toEqual([FILLS.light.neutral])
  expect(colorsOf(grid, layout, layout.rects.findIndex(r => r.name === 'src'))).toEqual([FILLS.light.folder])
})
