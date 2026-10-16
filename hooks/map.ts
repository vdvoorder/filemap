import type { MapProps, MapRun } from './map-client'
import { DEFAULT, type MapDrawing, type TileFacts } from './screen'

const SPACE = 0x20
const ANY = -2

export const TREE_BUDGET = 96_000
export const PROPS_BUDGET = 90_000

type Palette = { colours: string[]; indexOf: Map<number, number> }

function colourIndex(palette: Palette, colour: number): number {
  if (colour === DEFAULT || colour === ANY) return -1
  let index = palette.indexOf.get(colour)
  if (index === undefined) {
    index = palette.colours.length
    palette.colours.push(`#${colour.toString(16).padStart(6, '0')}`)
    palette.indexOf.set(colour, index)
  }
  return index
}

function rankOf(tiles: TileFacts[], index: number): number {
  const tile = tiles[index]
  if (tile === undefined) return -1
  return (tile.kind === 'file' ? 1000 : 0) + tile.depth
}

function ownersOf(drawing: MapDrawing, row: number): number[] {
  const { columns, owner, pixelRows, tiles } = drawing
  const pairs: number[] = []
  for (let x = 0; x < columns; x++) {
    const upper = 2 * row < pixelRows ? (owner[2 * row * columns + x] ?? -1) : -1
    const lower = 2 * row + 1 < pixelRows ? (owner[(2 * row + 1) * columns + x] ?? -1) : -1
    const tile = rankOf(tiles, lower) > rankOf(tiles, upper) ? lower : upper
    const last = pairs.length - 2
    if (last >= 0 && pairs[last] === tile) pairs[last + 1] = (pairs[last + 1] ?? 0) + 1
    else pairs.push(tile, 1)
  }
  return pairs
}

function runsOf(drawing: MapDrawing, row: number, palette: Palette): MapRun[] {
  const { columns, grid } = drawing
  const runs: MapRun[] = []
  let text = ''
  let ink = ANY
  let fill = DEFAULT
  for (let x = 0; x < columns; x++) {
    const at = (row * columns + x) * 3
    const glyph = grid[at] ?? SPACE
    const cellInk = glyph === SPACE ? ANY : (grid[at + 1] ?? DEFAULT)
    const cellFill = grid[at + 2] ?? DEFAULT
    const joins = text !== '' && cellFill === fill && (cellInk === ANY || ink === ANY || cellInk === ink)
    if (text !== '' && !joins) {
      runs.push([text, colourIndex(palette, ink), colourIndex(palette, fill)])
      text = ''
    }
    if (text === '') {
      ink = cellInk
      fill = cellFill
    } else if (ink === ANY) ink = cellInk
    text += String.fromCodePoint(glyph)
  }
  if (text !== '') runs.push([text, colourIndex(palette, ink), colourIndex(palette, fill)])
  return runs
}

export function treeCost(props: MapProps): number {
  let cost = 300 + 2 * (props.columns + 80)
  for (const runs of props.rows) {
    cost += 60
    for (const [text, ink, fill] of runs) cost += text.length + (ink >= 0 && fill >= 0 ? 90 : fill >= 0 ? 72 : ink >= 0 ? 62 : 3)
  }
  return cost
}

export function mapProps(drawing: MapDrawing): MapProps {
  const palette: Palette = { colours: [], indexOf: new Map() }
  const rows = Array.from({ length: drawing.rows }, (_, row) => runsOf(drawing, row, palette))
  return {
    columns: drawing.columns,
    top: drawing.top,
    summary: drawing.summary,
    upHint: drawing.upHint,
    idle: drawing.idle,
    palette: palette.colours,
    rows,
    owners: Array.from({ length: drawing.rows }, (_, row) => ownersOf(drawing, row)),
    tiles: drawing.tiles.map(({ path, hover }) => ({ path, hover })),
  }
}

function overrun(props: MapProps): number {
  return Math.max(treeCost(props) / TREE_BUDGET, JSON.stringify(props).length / PROPS_BUDGET)
}

export function fitMap(layout: (rows: number) => MapDrawing, rows: number): MapProps | null {
  let props = mapProps(layout(rows))
  for (let over = overrun(props); over > 1; over = overrun(props)) {
    if (rows <= 1) return null
    rows = Math.max(1, Math.min(rows - 1, Math.floor(rows / over)))
    props = mapProps(layout(rows))
  }
  return props
}
