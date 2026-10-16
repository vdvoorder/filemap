import type { ClientElements, ClientModule, ClientPointerEvent } from 'claude-code'

export type MapTile = { path: string; hover: string }
export type MapRun = [text: string, ink: number, fill: number]
export type MapProps = {
  columns: number
  top: string
  summary: string
  upHint: string
  idle: string
  palette: string[]
  rows: MapRun[][]
  owners: number[][]
  tiles: MapTile[]
}
export type MapMessage = { kind: 'click'; path: string } | { kind: 'up' }
type Target = number | 'top'
type Local = { x: number; y: number; isInside: boolean; press: string | null; chosen: string | null }

const START: Local = { x: -1, y: -1, isInside: false, press: null, chosen: null }
const TOP = '\u0000top'

function targetAt(props: MapProps, x: number, y: number): Target | null {
  if (x < 0 || x >= props.columns) return null
  if (y === 0) return props.upHint === '' ? null : 'top'
  const pairs = props.owners[y - 1]
  if (pairs === undefined) return null
  let left = x
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const count = pairs[i + 1] ?? 0
    if (left < count) {
      const tile = pairs[i] ?? -1
      return tile >= 0 && tile < props.tiles.length ? tile : null
    }
    left -= count
  }
  return null
}

function idOf(props: MapProps, target: Target | null): string | null {
  if (target === 'top') return TOP
  return target === null ? null : (props.tiles[target]?.path ?? null)
}

function hoverOf(props: MapProps, local: Local): Target | null {
  return local.isInside ? targetAt(props, local.x, local.y) : null
}

function hoverLine(props: MapProps, local: Local): string {
  const target = hoverOf(props, local)
  if (target === 'top') return props.upHint
  if (target !== null) return props.tiles[target]?.hover ?? ''
  return props.tiles.find(tile => tile.path === local.chosen)?.hover ?? ''
}

function messageOf(id: string): MapMessage {
  return id === TOP ? { kind: 'up' } : { kind: 'click', path: id }
}

function step(props: MapProps, local: Local, event: ClientPointerEvent): { next: Local; message: MapMessage | null } {
  const rows = props.rows.length + 2
  const isInside = event.x >= 0 && event.y >= 0 && event.x < props.columns && event.y < rows
  const under = isInside ? idOf(props, targetAt(props, event.x, event.y)) : null
  switch (event.type) {
    case 'leave':
      return { next: { ...local, isInside: false }, message: null }
    case 'enter':
    case 'move':
      return { next: { ...local, x: event.x, y: event.y, isInside, chosen: under !== null && under !== local.chosen ? null : local.chosen }, message: null }
    case 'down': {
      const isMain = event.button === undefined || event.button === 'left'
      return { next: { ...local, x: event.x, y: event.y, isInside, press: isMain ? under : null }, message: null }
    }
    case 'up': {
      const isClick = local.press !== null && under === local.press
      const chosen = isClick && under !== TOP ? under : local.chosen
      return { next: { x: event.x, y: event.y, isInside, press: null, chosen }, message: isClick && under !== null ? messageOf(under) : null }
    }
  }
}

function drawRun(Text: ClientElements['Text'], palette: string[], [text, ink, fill]: MapRun) {
  if (ink < 0 && fill < 0) return text
  const style = {
    ...(ink >= 0 ? { color: palette[ink] ?? '' } : {}),
    ...(fill >= 0 ? { backgroundColor: palette[fill] ?? '' } : {}),
  }
  return <Text {...style}>{text}</Text>
}

const MapClient: ClientModule<MapProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let current = surface.state ?? START
  surface.onPointer(event => {
    const { next, message } = step(props, current, event)
    const isChanged = next.press !== current.press || next.chosen !== current.chosen || hoverLine(props, next) !== hoverLine(props, current)
    current = next
    if (isChanged) surface.setState(next)
    if (message) surface.post(message)
  })
  const isUp = props.upHint !== ''
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        {isUp ? <Text underline>{props.top}</Text> : props.top}
        {props.summary}
      </Text>
      {props.rows.map(runs => (
        <Text wrap="truncate">{runs.map(run => drawRun(Text, props.palette, run))}</Text>
      ))}
      {props.rows.length > 0 ? <Text wrap="truncate">{hoverLine(props, current) || props.idle || ' '}</Text> : null}
    </Box>
  )
}

export default MapClient
