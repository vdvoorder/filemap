import { expect } from 'claude-code/testing'

import type { MapFile } from '../types'
import { PROPS_BUDGET, TREE_BUDGET, fitMap, mapProps, treeCost } from '../hooks/map'
import { DEFAULT, type MapDrawing, mapDrawing, paneFrame } from '../hooks/screen'
import type { ScreenInput } from '../hooks/track'
import { test } from './limit'

const UPPER = 0x2580
const LOWER = 0x2584

let lastVersion = 0

function bigInput(columns: number, rows: number): ScreenInput {
  const files: MapFile[] = []
  for (let i = 0; i < 400; i++) files.push({ p: `packages/package-${i % 8}/source/module-${i % 5}/file-${i}.ts`, lines: 20 + ((i * 37) % 300) })
  return {
    repo: 'big',
    files,
    filesVersion: ++lastVersion,
    marks: {},
    recent: [],
    outside: 0,
    busy: [],
    changedCount: 0,
    readCount: 0,
    windowMinutes: 5,
    zoom: '',
    columns,
    rows,
    theme: 'dark',
  }
}

const hasHalfBlocks = (rows: ReturnType<typeof mapProps>['rows']) => rows.some(runs => runs.some(([text]) => /[▀▄]/.test(text)))

function fitted(layout: (rows: number) => MapDrawing, rows: number): ReturnType<typeof mapProps> {
  const props = fitMap(layout, rows)
  if (props === null) throw new Error('the map did not fit at any row count')
  return props
}

function crowded(tiles?: number): (rows: number) => MapDrawing {
  return rows => ({
    columns: 10,
    rows,
    pixelRows: 2 * rows,
    grid: Uint32Array.from({ length: 10 * rows * 3 }, (_, i) => (i % 3 === 0 ? 0x20 : 0x37342d)),
    owner: new Int32Array(10 * 2 * rows).fill(0),
    tiles: Array.from({ length: tiles ?? rows * 20 }, (_, i) => ({ path: `folder/${'x'.repeat(80)}-${i}.ts`, kind: 'file' as const, depth: 1, hover: `${i}.ts` })),
    top: 'repo',
    summary: '',
    upHint: '',
    idle: '',
  })
}

test('each cell goes to one tile: a file before its folder, the upper of two files, nothing to no tile', () => {
  const A = 0x3a5d86
  const B = 0xdc7236
  const D = 0x2a2722
  const owner = Int32Array.from([1, 0, -1, 1, 0, 2, 2, 2, 0, -1])
  const cell = (glyph: number, ink: number, fill: number) => [glyph, ink, fill]
  const drawing: MapDrawing = {
    columns: 5,
    rows: 1,
    pixelRows: 2,
    owner,
    grid: Uint32Array.from([...cell(UPPER, A, B), ...cell(UPPER, D, B), ...cell(LOWER, B, DEFAULT), ...cell(UPPER, A, D), ...cell(UPPER, D, DEFAULT)]),
    tiles: [
      { path: 'src', kind: 'folder', depth: 1, hover: 'src/  2 files' },
      { path: 'src/a.ts', kind: 'file', depth: 2, hover: 'src/a.ts  +1 -0' },
      { path: 'src/b.ts', kind: 'file', depth: 2, hover: 'src/b.ts' },
    ],
    top: 'repo',
    summary: '  1 changed, 0 read',
    upHint: '',
    idle: '',
  }
  const props = mapProps(drawing)
  expect(props.owners).toEqual([[1, 1, 2, 2, 1, 1, 0, 1]])
  expect(props.palette).toEqual(['#3a5d86', '#dc7236', '#2a2722'])
  expect(props.rows).toEqual([
    [
      ['▀', 0, 1],
      ['▀', 2, 1],
      ['▄', 1, -1],
      ['▀', 0, 2],
      ['▀', 2, -1],
    ],
  ])
  expect(props.tiles).toEqual([
    { path: 'src', hover: 'src/  2 files' },
    { path: 'src/a.ts', hover: 'src/a.ts  +1 -0' },
    { path: 'src/b.ts', hover: 'src/b.ts' },
  ])
  expect([props.columns, props.top, props.summary, props.upHint]).toEqual([5, 'repo', '  1 changed, 0 read', ''])
})

test('runs join cells of one fill, and a space takes the ink of its run', () => {
  const A = 0x3a5d86
  const ink = 0xece6d8
  const text = ' ab  '
  const drawing: MapDrawing = {
    columns: 7,
    rows: 1,
    pixelRows: 2,
    owner: new Int32Array(14).fill(0),
    grid: Uint32Array.from([...[...text].flatMap(ch => [ch.charCodeAt(0), ch === ' ' ? DEFAULT : ink, A]), 0x20, DEFAULT, DEFAULT, 0x20, DEFAULT, DEFAULT]),
    tiles: [{ path: 'a.ts', kind: 'file', depth: 1, hover: 'a.ts' }],
    top: 'repo',
    summary: '',
    upHint: '',
    idle: '',
  }
  expect(mapProps(drawing).rows).toEqual([
    [
      [' ab  ', 0, 1],
      ['  ', -1, -1],
    ],
  ])
})

test('a map past the tree budget is laid out again with fewer rows, as wide as the pane', () => {
  for (const [columns, rows] of [[64, 48], [100, 60], [140, 60], [200, 100], [600, 300]] as const) {
    const input = bigInput(columns, rows)
    const mapRows = paneFrame(input).mapRows
    const asked = mapProps(mapDrawing(input, mapRows))
    const props = fitted(fewer => mapDrawing(input, fewer), mapRows)
    expect(treeCost(props)).toBeLessThanOrEqual(TREE_BUDGET)
    expect(JSON.stringify(props).length).toBeLessThanOrEqual(PROPS_BUDGET)
    expect(props.columns).toBe(columns)
    if (treeCost(asked) <= TREE_BUDGET && JSON.stringify(asked).length <= PROPS_BUDGET) expect(props.rows).toHaveLength(mapRows)
    else expect(props.rows.length).toBeLessThan(mapRows)
    expect(hasHalfBlocks(props.rows)).toBe(true)
  }
  expect(fitted(fewer => mapDrawing(bigInput(64, 48), fewer), 33).rows).toHaveLength(33)
})

test('a map whose props would overrun their budget is laid out again with fewer rows', () => {
  const asked = mapProps(crowded()(50))
  const props = fitted(crowded(), 50)
  expect(JSON.stringify(asked).length).toBeGreaterThan(PROPS_BUDGET)
  expect(treeCost(asked)).toBeLessThan(TREE_BUDGET)
  expect(JSON.stringify(props).length).toBeLessThanOrEqual(PROPS_BUDGET)
  expect(props.rows.length).toBeLessThan(50)
  expect(props.rows.length).toBeGreaterThan(20)
})

test('fitMap gives no props when the map overruns its budget even at one row, so the Client never gets more than its bounds', () => {
  expect(JSON.stringify(mapProps(crowded(1_200)(1))).length).toBeGreaterThan(PROPS_BUDGET)
  expect(fitMap(crowded(1_200), 50)).toBeNull()
  expect(fitMap(crowded(1_200), 1)).toBeNull()
  expect(fitMap(crowded(100), 1)?.rows).toHaveLength(1)
})
