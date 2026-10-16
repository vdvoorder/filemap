import type { FileChange, MapFile, Theme } from '../types'
import { fold, type Mark, type RecentRow, type ScreenInput } from './track'

export type TileFacts = { path: string; kind: 'file' | 'folder'; depth: number; hover: string }
export type MapDrawing = {
  columns: number
  rows: number
  grid: Uint32Array
  owner: Int32Array
  pixelRows: number
  tiles: TileFacts[]
  top: string
  summary: string
  upHint: string
  idle: string
}

export const DEFAULT = 0x01000000
const SPACE = 0x20
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const MIN_LINES = 20
const MIN_FILE_AREA = 16
const MIN_SIDE = 2
const MIN_STEP = MIN_SIDE + 1
const FLOOR_ROUNDS = 12
const FRAME_WIDE = 2
const FRAME_HIGH = 3.5
const FOLDER = 0
const NEUTRAL = 1
const READ = 2
const CHANGED = 3
const NOW = 4
const MIN_FILL = 2

type Palette = { fill: number[]; ink: number[]; quiet: number }

const PALETTES: Record<Theme, Palette> = {
  dark: {
    fill: [0x2a2722, 0x37342d, 0x454238, 0x4f7bab, 0xdc7236],
    ink: [0xb8b1a2, 0xb8b1a2, 0xece6d8, 0xece6d8, 0xece6d8],
    quiet: 0xb8b1a2,
  },
  light: {
    fill: [0xe8e2d4, 0xd3ccbc, 0xbeb6a5, 0x6a90bc, 0xd8692e],
    ink: [0x56585c, 0x56585c, 0x26282c, 0xfaf8f2, 0xfaf8f2],
    quiet: 0x56585c,
  },
}

type LegendItem = { fill: number; word: string }

const LEGEND_LEAD = 'files '
const LIST_WIDTH = 64
const LIST_LIMIT = 160
const LIST_MIN_COLUMNS = 20
const LIST_MIN_ROWS = 8
const NO_FILES = 'No file of a mapped type in this repository.'
const LAYOUT_LIMIT = 8

type Entry = { name: string; path: string; weight: number; lines: number; key: string; children: Entry[] | null }
type Dir = { name: string; dirs: Map<string, Dir>; files: MapFile[] }
type Row = { count: number; stacked: boolean }
type Crowding = { leaves: number; isCrowded: boolean }

type Tile = {
  entry: Entry
  value: number
  tiles: Tile[] | null
  x0: number
  y0: number
  x1: number
  y1: number
}

export type MapLabel = { column: number; row: number; text: string }

export type MapRect = {
  kind: 'folder' | 'file' | 'box'
  name: string
  path: string
  depth: number
  keys: string[]
  lines: number
  weight: number
  x0: number
  y0: number
  x1: number
  y1: number
  label: MapLabel | null
}

export type MapLayout = {
  width: number
  height: number
  rects: MapRect[]
  owner: Int32Array
  byKey: Map<string, number>
  linesOf: Map<string, number>
}

export type PaneFrame = { mapRows: number; listRows: number; hasLegend: boolean; hasControls: boolean }
export type Span = { text: string; ink?: string; fill?: string }
export type ListRow = { path: string; swatch: string; label: string; rest: Span }

const layouts = new Map<string, MapLayout>()
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const join = (folder: string, name: string) => (folder === '' ? name : `${folder}/${name}`)
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const hex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`
const weightOf = (lines: number) => Math.sqrt(Math.max(lines, MIN_LINES))

const SHOWN = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Common}]/u
const HIDDEN = /[\p{C}\p{M}\p{Zl}\p{Zp}\p{Emoji_Presentation} ᄀ-ᅟ⺀-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/u

export function plainText(text: string): string {
  let out = ''
  for (const ch of text.normalize('NFC')) out += ch.length === 1 && SHOWN.test(ch) && !HIDDEN.test(ch) ? ch : '?'
  return out
}

export function hasFolder(files: MapFile[], folder: string): boolean {
  return folder === '' || files.some(file => file.p.startsWith(`${folder}/`))
}

function holdsOneFolder(files: MapFile[], folder: string): boolean {
  let only: string | undefined
  for (const file of files) {
    if (!file.p.startsWith(`${folder}/`)) continue
    const rest = file.p.slice(folder.length + 1)
    const cut = rest.indexOf('/')
    if (cut < 0 || (only !== undefined && only !== rest.slice(0, cut))) return false
    only = rest.slice(0, cut)
  }
  return only !== undefined
}

export function zoomOut(files: MapFile[], folder: string): string {
  let parent = parentOf(folder)
  while (parent !== '' && holdsOneFolder(files, parent)) parent = parentOf(parent)
  return parent
}

function onlyDir(dir: Dir): Dir | undefined {
  if (dir.files.length > 0 || dir.dirs.size !== 1) return undefined
  for (const only of dir.dirs.values()) return only
}

function toEntry(dir: Dir, path: string, isRoot: boolean): Entry {
  let name = dir.name
  for (let only = isRoot ? undefined : onlyDir(dir); only; only = onlyDir(dir)) {
    dir = only
    name += '/' + dir.name
    path += '/' + dir.name
  }
  const children = [...dir.dirs.values()].map(d => toEntry(d, join(path, d.name), false))
  for (const f of dir.files) children.push({ name: baseName(f.p), path: f.p, weight: weightOf(f.lines), lines: f.lines, key: fold(f.p), children: null })
  let weight = 0
  let lines = 0
  for (const c of children) {
    weight += c.weight
    lines += c.lines
  }
  return { name, path, weight, lines, key: '', children }
}

function toTree(files: MapFile[], zoom: string): Entry {
  const root: Dir = { name: '', dirs: new Map(), files: [] }
  const depth = zoom === '' ? 0 : zoom.split('/').length
  for (const f of files) {
    if (zoom !== '' && !f.p.startsWith(`${zoom}/`)) continue
    let dir = root
    for (const part of f.p.split('/').slice(depth, -1)) {
      let next = dir.dirs.get(part)
      if (!next) {
        next = { name: part, dirs: new Map(), files: [] }
        dir.dirs.set(part, next)
      }
      dir = next
    }
    dir.files.push(f)
  }
  return toEntry(root, zoom, true)
}

function framed(content: number, floor: number): number {
  const perPixel = floor / MIN_FILE_AREA
  const side = Math.sqrt(content / perPixel)
  return (side + FRAME_WIDE) * (side + FRAME_HIGH) * perPixel
}

function valueOf(entry: Entry, closed: Set<Entry>, floor: number, isRoot: boolean): number {
  if (!entry.children || closed.has(entry)) return Math.max(entry.weight, floor)
  let content = 0
  for (const c of entry.children) content += valueOf(c, closed, floor, false)
  return isRoot ? content : framed(content, floor)
}

function toTile(entry: Entry, closed: Set<Entry>, floor: number, isRoot: boolean): Tile {
  const tile: Tile = { entry, value: Math.max(entry.weight, floor), tiles: null, x0: 0, y0: 0, x1: 0, y1: 0 }
  if (!entry.children || closed.has(entry)) return tile
  const tiles = entry.children.map(c => toTile(c, closed, floor, false))
  tiles.sort((a, b) => b.value - a.value || (a.entry.name < b.entry.name ? -1 : a.entry.name > b.entry.name ? 1 : 0))
  tile.tiles = tiles
  let content = 0
  for (const t of tiles) content += t.value
  tile.value = isRoot ? content : framed(content, floor)
  return tile
}

function floorOf(root: Entry, closed: Set<Entry>, area: number): number {
  let floor = (MIN_FILE_AREA * root.weight) / area
  for (let round = 0; round < FLOOR_ROUNDS; round++) floor = (MIN_FILE_AREA * valueOf(root, closed, floor, true)) / area
  return floor
}

function squarify(values: number[], width: number, height: number): Row[] {
  const rows: Row[] = []
  let rest = 0
  for (const v of values) rest += v
  let row: Row | null = null
  let side = 0
  let perValue = 0
  let sum = 0
  let min = 0
  let max = 0
  let ratio = 0
  const worst = (total: number, least: number, most: number) => {
    const thickness = (total * perValue) / side
    return Math.max((thickness * thickness) / (least * perValue), (most * perValue) / (thickness * thickness))
  }
  for (const v of values) {
    if (row) {
      const next = side > 0 ? worst(sum + v, Math.min(min, v), Math.max(max, v)) : 0
      if (next <= ratio) {
        row.count++
        sum += v
        min = Math.min(min, v)
        max = Math.max(max, v)
        ratio = next
        continue
      }
      if (row.stacked) width -= (sum * perValue) / side
      else height -= (sum * perValue) / side
      rest -= sum
    }
    row = { count: 1, stacked: width >= height }
    rows.push(row)
    side = row.stacked ? height : width
    perValue = (width * height) / rest
    sum = min = max = v
    ratio = side > 0 ? worst(v, v, v) : 0
  }
  return rows
}

function spread(members: Tile[], start: number, end: number, set: (tile: Tile, from: number, to: number) => void): void {
  const least = members.length * MIN_STEP <= end - start ? MIN_STEP : 0
  let sum = 0
  for (const t of members) sum += t.value
  let to = end
  for (const t of [...members].reverse()) {
    const from = t === members[0] ? start : to - Math.max(least, ((to - start) * t.value) / sum)
    set(t, from, to)
    sum -= t.value
    to = from
  }
}

function setRect(tile: Tile, x0: number, y0: number, x1: number, y1: number): void {
  tile.x0 = Math.round(x0)
  tile.y0 = Math.round(y0)
  tile.x1 = Math.round(x1) - 1
  tile.y1 = Math.round(y1) - 1
}

function place(tile: Tile, isRoot: boolean): void {
  const tiles = tile.tiles
  if (!tiles) return
  const band = isRoot ? 0 : tile.y0 % 2 === 0 ? 2 : 3
  const pad = isRoot ? 0 : 1
  let left = tile.x0 + pad
  let top = tile.y0 + band
  const right = Math.max(left, tile.x1 - pad + 1)
  const bottom = Math.max(top, tile.y1 - pad + 1)
  const rows = squarify(tiles.map(t => t.value), right - left, bottom - top)
  const steps = rows.map(row => ({ row, wideAfter: 0, highAfter: 0 }))
  let wide = 0
  let high = 0
  for (const step of [...steps].reverse()) {
    step.wideAfter = wide
    step.highAfter = high
    const along = step.row.count * MIN_STEP
    wide = step.row.stacked ? wide + MIN_STEP : Math.max(wide, along)
    high = step.row.stacked ? Math.max(high, along) : high + MIN_STEP
  }
  const thickness = (room: number, share: number, after: number) =>
    room - after >= MIN_STEP ? Math.min(room - after, Math.max(MIN_STEP, room * share)) : room * share
  let rest = 0
  for (const t of tiles) rest += t.value
  let first = 0
  steps.forEach((step, r) => {
    const members = tiles.slice(first, first + step.row.count)
    const isLastRow = r === steps.length - 1
    let sum = 0
    for (const t of members) sum += t.value
    if (step.row.stacked) {
      const x = left
      const edge = isLastRow ? right : x + thickness(right - x, sum / rest, step.wideAfter)
      spread(members, top, bottom, (t, from, to) => setRect(t, x, from, edge, to))
      left = edge
    } else {
      const y = top
      const edge = isLastRow ? bottom : y + thickness(bottom - y, sum / rest, step.highAfter)
      spread(members, left, right, (t, from, to) => setRect(t, from, y, to, edge))
      top = edge
    }
    rest -= sum
    first += step.row.count
  })
  for (const t of tiles) place(t, false)
}

function findCrowded(tile: Tile, isRoot: boolean, innermost: Entry[]): Crowding {
  if (!tile.tiles) return { leaves: 1, isCrowded: false }
  let leaves = 0
  let hasCrowdedInside = false
  let hasThinLeaf = false
  for (const t of tile.tiles) {
    const inside = findCrowded(t, false, innermost)
    leaves += inside.leaves
    if (inside.isCrowded) hasCrowdedInside = true
    if (!t.tiles && (t.x1 - t.x0 < MIN_SIDE || t.y1 - t.y0 < MIN_SIDE)) hasThinLeaf = true
  }
  if (isRoot) return { leaves, isCrowded: hasCrowdedInside }
  const area = Math.max(0, tile.x1 - tile.x0) * Math.max(0, tile.y1 - tile.y0)
  const isCrowded = hasThinLeaf || area < MIN_FILE_AREA * leaves
  if (isCrowded && !hasCrowdedInside) innermost.push(tile.entry)
  return { leaves, isCrowded: isCrowded || hasCrowdedInside }
}

function makePlan(root: Entry, width: number, height: number): Tile {
  const closed = new Set<Entry>()
  for (;;) {
    const top = toTile(root, closed, floorOf(root, closed, width * height), true)
    top.x1 = width
    top.y1 = height
    place(top, true)
    const innermost: Entry[] = []
    findCrowded(top, true, innermost)
    if (!innermost.length) return top
    for (const e of innermost) closed.add(e)
  }
}

function leavesUnder(entry: Entry, out: Entry[]): Entry[] {
  if (!entry.children) out.push(entry)
  else for (const c of entry.children) leavesUnder(c, out)
  return out
}

function collect(tile: Tile, depth: number, layout: MapLayout): void {
  const x1 = Math.min(tile.x1, layout.width)
  const y1 = Math.min(tile.y1, layout.height)
  if (depth > 0) {
    if (x1 <= tile.x0 || y1 <= tile.y0) return
    const index = layout.rects.length
    const kind = tile.tiles ? 'folder' : tile.entry.children ? 'box' : 'file'
    const leaves = leavesUnder(tile.entry, [])
    const { name, path, lines, weight } = tile.entry
    layout.rects.push({ kind, name, path, depth, keys: leaves.map(leaf => leaf.key), lines, weight, x0: tile.x0, y0: tile.y0, x1, y1, label: null })
    if (kind !== 'folder') {
      for (const leaf of leaves) {
        layout.byKey.set(leaf.key, index)
        layout.linesOf.set(leaf.key, leaf.lines)
      }
    }
    for (let y = tile.y0; y < y1; y++) layout.owner.fill(index, y * layout.width + tile.x0, y * layout.width + x1)
  }
  if (tile.tiles) for (const t of tile.tiles) collect(t, depth + 1, layout)
}

function labelOf(rect: MapRect): MapLabel | null {
  const row = Math.ceil(rect.y0 / 2)
  if (2 * row + 2 > rect.y1) return null
  const name = plainText(rect.name)
  const texts =
    rect.kind === 'file'
      ? [name, name.replace(/\.[^.]+$/, '')]
      : [name, baseName(name)].map(t => (rect.kind === 'box' ? t + '/' : t))
  const width = rect.x1 - rect.x0
  const text = texts.find(t => t && t.length <= width)
  return text ? { column: text.length < width ? rect.x0 + 1 : rect.x0, row, text } : null
}

export function paneFrame(input: ScreenInput): PaneFrame {
  const hasControls = input.rows > 1
  const rest = Math.max(0, input.rows - (hasControls ? 1 : 0))
  const mapRowsOf = (regionRows: number) => (regionRows >= 3 ? regionRows - 2 : 0)
  if (input.notice !== undefined || input.columns < LIST_MIN_COLUMNS || rest < LIST_MIN_ROWS) return { mapRows: mapRowsOf(rest), listRows: 0, hasLegend: false, hasControls }
  const listRows = Math.floor(rest / 4)
  return { mapRows: mapRowsOf(rest - listRows - 1), listRows, hasLegend: true, hasControls }
}

function layoutFor(input: ScreenInput, rows: number): MapLayout {
  const key = `${input.filesVersion} ${input.columns} ${rows} ${input.zoom}`
  const held = layouts.get(key)
  if (held) return held
  const width = input.columns
  const height = 2 * rows
  const layout: MapLayout = { width, height, rects: [], owner: new Int32Array(width * height).fill(-1), byKey: new Map(), linesOf: new Map() }
  collect(makePlan(toTree(input.files, input.zoom), width, height), 0, layout)
  for (const rect of layout.rects) rect.label = labelOf(rect)
  layouts.set(key, layout)
  for (const old of layouts.keys()) {
    if (layouts.size <= LAYOUT_LIMIT) break
    layouts.delete(old)
  }
  return layout
}

export function layoutOf(input: ScreenInput, rows: number): MapLayout | null {
  return input.notice !== undefined || input.files.length === 0 || rows <= 0 || input.columns <= 0 ? null : layoutFor(input, rows)
}

function changedTop(rect: MapRect, share: number): number {
  const filled = Math.max(MIN_FILL, Math.round(share * (rect.y1 - rect.y0)))
  return Math.max(rect.y0, Math.floor((rect.y1 - filled) / 2) * 2)
}

function writeText(grid: Uint32Array, columns: number, row: number, column: number, text: string, ink: number): void {
  for (let i = 0; i < text.length && column + i < columns; i++) {
    const at = (row * columns + column + i) * 3
    grid[at] = text.charCodeAt(i)
    grid[at + 1] = ink
  }
}

function drawMap(grid: Uint32Array, input: ScreenInput, layout: MapLayout, palette: Palette): void {
  const { rects, width, owner } = layout
  const changed = rects.map(() => 0)
  const isRead = rects.map(() => false)
  const isNow = rects.map(() => false)
  for (const [key, mark] of Object.entries(input.marks)) {
    const index = layout.byKey.get(key)
    if (index === undefined) continue
    const lines = layout.linesOf.get(key) ?? 0
    changed[index] = (changed[index] ?? 0) + weightOf(lines) * Math.min(1, mark.changed / Math.max(1, lines))
    if (mark.isRead) isRead[index] = true
    if (mark.isNow) isNow[index] = true
  }
  const looks = rects.map((rect, i) => {
    const share = (changed[i] ?? 0) / rect.weight
    const base = rect.kind !== 'folder' && isRead[i] ? READ : rect.kind === 'file' ? NEUTRAL : FOLDER
    const fill = isNow[i] ? NOW : CHANGED
    const top = share > 0 ? changedTop(rect, share) : rect.y1
    const baseColor = base === FOLDER && rect.depth % 2 === 0 ? DEFAULT : (palette.fill[base] ?? DEFAULT)
    return { base, fill, top, baseColor, fillColor: palette.fill[fill] ?? DEFAULT }
  })
  const colorAt = (pixel: number) => {
    const look = looks[owner[pixel] ?? -1]
    if (look === undefined) return DEFAULT
    return Math.floor(pixel / width) >= look.top ? look.fillColor : look.baseColor
  }
  for (let row = 0; 2 * row < layout.height; row++) {
    for (let x = 0; x < width; x++) {
      const upper = colorAt(2 * row * width + x)
      const lower = colorAt((2 * row + 1) * width + x)
      const at = (row * width + x) * 3
      if (upper === lower) grid[at + 2] = upper
      else if (upper === DEFAULT) {
        grid[at] = LOWER_HALF
        grid[at + 1] = lower
      } else {
        grid[at] = UPPER_HALF
        grid[at + 1] = upper
        grid[at + 2] = lower
      }
    }
  }
  rects.forEach((rect, i) => {
    const look = looks[i]
    if (!rect.label || look === undefined) return
    const under = 2 * rect.label.row >= look.top ? look.fill : look.base
    writeText(grid, width, rect.label.row, rect.label.column, rect.label.text, palette.ink[under] ?? DEFAULT)
  })
}

const countText = (change: FileChange | null) => (change === null ? 'read' : change.isBinary ? 'binary' : `+${change.added} -${change.deleted}`)

function folderStatus(keys: string[], marks: Record<string, Mark>): string {
  let changed = 0
  let read = 0
  for (const key of keys) {
    const mark = marks[key]
    if (mark?.change) changed++
    else if (mark?.isRead) read++
  }
  const parts = [`${keys.length} ${keys.length === 1 ? 'file' : 'files'}`]
  if (changed > 0) parts.push(`${changed} changed`)
  if (read > 0) parts.push(`${read} read`)
  return parts.join(', ')
}

function hoverText(path: string, name: string, status: string, width: number): string {
  const tail = status === '' ? '' : `  ${status}`
  if (path.length + tail.length <= width) return path + tail
  const room = width - tail.length
  if (room > name.length) return `~${path.slice(path.length - room + 1)}${tail}`
  return path.length <= width ? path : `~${path.slice(path.length - width + 1)}`
}

function tilesOf(input: ScreenInput, layout: MapLayout): TileFacts[] {
  return layout.rects.map(rect => {
    const isFile = rect.kind === 'file'
    const mark = input.marks[rect.keys[0] ?? '']
    const status = isFile ? (mark === undefined ? '' : countText(mark.change)) : folderStatus(rect.keys, input.marks)
    const end = isFile ? '' : '/'
    const hover = hoverText(plainText(rect.path) + end, plainText(rect.name) + end, status, input.columns)
    return { path: rect.path, kind: isFile ? 'file' : 'folder', depth: rect.depth, hover }
  })
}

function headerOf(input: ScreenInput): Pick<MapDrawing, 'top' | 'summary' | 'upHint'> {
  const { columns, zoom } = input
  const place = plainText(zoom === '' ? input.repo : `${input.repo}/${zoom}`)
  const top = place.length <= columns ? place : zoom === '' ? place.slice(0, columns) : `~${place.slice(place.length - columns + 1)}`
  let summary = ''
  const fits = (more: string) => top.length + summary.length + more.length <= columns
  for (const [i, folder] of input.busy.entries()) {
    const more = (i === 0 ? '  now: ' : ', ') + plainText(folder)
    if (!fits(more)) break
    summary += more
  }
  const counts = `  ${input.changedCount} changed, ${input.readCount} read`
  if (fits(counts)) summary += counts
  const back = zoomOut(input.files, zoom)
  const upHint = zoom === '' ? '' : plainText(`Click to show ${back === '' ? input.repo : back} again.`).slice(0, columns)
  return { top, summary, upHint }
}

function drawNotice(grid: Uint32Array, columns: number, rows: number, notice: string): void {
  let row = 0
  let line = ''
  for (const word of plainText(notice.replace(/\s+/g, ' ')).split(' ')) {
    let rest = word
    while (rest && row < rows) {
      const joined = line ? line + ' ' + rest : rest
      if (joined.length <= columns) {
        line = joined
        rest = ''
      } else if (line) {
        writeText(grid, columns, row++, 0, line, DEFAULT)
        line = ''
      } else {
        writeText(grid, columns, row++, 0, rest.slice(0, columns), DEFAULT)
        rest = rest.slice(columns)
      }
    }
  }
  if (line && row < rows) writeText(grid, columns, row, 0, line, DEFAULT)
}

export function mapDrawing(input: ScreenInput, rows: number): MapDrawing {
  const { columns } = input
  const grid = new Uint32Array(columns * rows * 3)
  for (let at = 0; at < grid.length; at += 3) {
    grid[at] = SPACE
    grid[at + 1] = DEFAULT
    grid[at + 2] = DEFAULT
  }
  const owner = new Int32Array(columns * 2 * rows).fill(-1)
  const drawing: MapDrawing = { columns, rows, grid, owner, pixelRows: 2 * rows, tiles: [], idle: input.idle ?? '', ...headerOf(input) }
  const notice = input.notice ?? (input.files.length === 0 ? NO_FILES : undefined)
  if (notice !== undefined) {
    drawNotice(grid, columns, rows, notice)
    return drawing
  }
  const layout = layoutOf(input, rows)
  if (layout === null) return drawing
  drawMap(grid, input, layout, PALETTES[input.theme])
  return { ...drawing, owner: layout.owner, tiles: tilesOf(input, layout) }
}

function listRow(recent: RecentRow, width: number, palette: Palette): ListRow {
  const label = plainText(recent.label)
  const tail = countText(recent.change)
  const room = Math.max(0, width - 3 - tail.length - 2)
  const shown = label.length <= room ? label : room > 0 ? '~' + label.slice(label.length - room + 1) : ''
  const gap = Math.max(3, width - tail.length) - 3 - shown.length
  return {
    path: recent.label,
    swatch: hex(palette.fill[recent.change === null ? READ : recent.isNow ? NOW : CHANGED] ?? DEFAULT),
    label: shown,
    rest: { text: ' '.repeat(gap) + tail, ink: hex(palette.quiet) },
  }
}

export function listOf(input: ScreenInput, frame: PaneFrame): { rows: ListRow[]; outside: Span | null } {
  const palette = PALETTES[input.theme]
  const shown = input.recent.slice(0, input.outside > 0 ? Math.max(0, frame.listRows - 1) : frame.listRows)
  const count = `+${input.outside} ${input.outside === 1 ? 'file' : 'files'} outside this repo`
  const widest = shown.reduce((most, recent) => Math.max(most, 3 + plainText(recent.label).length + 2 + countText(recent.change).length), LIST_WIDTH)
  const width = Math.min(input.columns, LIST_LIMIT, widest)
  return {
    rows: shown.map(recent => listRow(recent, width, palette)),
    outside: input.outside > 0 && frame.listRows > 0 ? { text: `   ${count}`, ink: hex(palette.quiet) } : null,
  }
}

export function legendOf(input: ScreenInput): Span[] {
  const palette = PALETTES[input.theme]
  const widthOf = (items: LegendItem[]) => items.reduce((sum, item) => sum + 2 + 1 + item.word.length + 2, LEGEND_LEAD.length - 2)
  let items: LegendItem[] = [
    { fill: READ, word: 'read' },
    { fill: CHANGED, word: 'changed' },
    { fill: NOW, word: `last ${input.windowMinutes} min` },
  ]
  while (items.length > 1 && widthOf(items) > input.columns) items = items.slice(0, -1)
  const quiet = hex(palette.quiet)
  const spans: Span[] = [{ text: LEGEND_LEAD, ink: quiet }]
  items.forEach((item, i) => spans.push({ text: '  ', fill: hex(palette.fill[item.fill] ?? DEFAULT) }, { text: ` ${item.word}${i < items.length - 1 ? '  ' : ''}`, ink: quiet }))
  return spans
}
