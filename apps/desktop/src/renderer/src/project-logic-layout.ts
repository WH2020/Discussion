import type { ProjectLogicMap, ProjectLogicNodeKind } from '@contracts'

export const PROJECT_LOGIC_NODE_WIDTH = 220
export const PROJECT_LOGIC_NODE_HEIGHT = 86
export const PROJECT_LOGIC_EDGE_LABEL_LINE_HEIGHT = 12

const PROJECT_LOGIC_EDGE_LABEL_MAX_UNITS = 24
const PROJECT_LOGIC_EDGE_LABEL_MAX_LINE_UNITS = 12
const PROJECT_LOGIC_EDGE_LABEL_FONT_SIZE = 10
const PROJECT_LOGIC_EDGE_LABEL_HORIZONTAL_PADDING = 18
const PROJECT_LOGIC_EDGE_LABEL_VERTICAL_PADDING = 10
const PROJECT_LOGIC_EDGE_LABEL_NODE_CLEARANCE = 8

export interface ProjectLogicLayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  column: number
}

export interface ProjectLogicLayoutEdge {
  id: string
  path: string
  labelX: number
  labelY: number
  labelWidth: number
  labelHeight: number
  labelLines: string[]
  primary: boolean
}

export interface ProjectLogicLayout {
  width: number
  height: number
  nodes: ProjectLogicLayoutNode[]
  edges: ProjectLogicLayoutEdge[]
}

export type ProjectLogicReachDirection = 'upstream' | 'downstream'

export interface ProjectLogicEdgeLabelMetrics {
  lines: string[]
  width: number
  height: number
}

const KIND_ORDER: Record<ProjectLogicNodeKind, number> = {
  actor: 0,
  application: 1,
  device: 2,
  process: 3,
  decision: 4,
  safety: 5,
  interface: 6,
  service: 7,
  core: 8,
  data: 9,
  integration: 10,
  module: 11,
  tooling: 12,
  test: 13,
  documentation: 14
}

const ISOLATED_KIND_COLUMN: Record<ProjectLogicNodeKind, number> = {
  actor: 0,
  interface: 0,
  application: 1,
  device: 2,
  process: 2,
  decision: 2,
  safety: 3,
  service: 3,
  core: 3,
  data: 3,
  integration: 3,
  module: 1,
  tooling: 1,
  test: 3,
  documentation: 3
}

export function buildProjectLogicLayout(map: ProjectLogicMap): ProjectLogicLayout {
  const businessFlow = map.nodes.some((node) =>
    node.kind === 'actor'
    || node.kind === 'device'
    || node.kind === 'process'
    || node.kind === 'decision'
    || node.kind === 'safety'
  )
  const maximumColumn = businessFlow ? 9 : 4
  const nodeIds = map.nodes.map((node) => node.id).sort((left, right) => left.localeCompare(right))
  const validIds = new Set(nodeIds)
  const outgoing = new Map(nodeIds.map((id) => [id, [] as string[]]))
  const incoming = new Map(nodeIds.map((id) => [id, [] as string[]]))
  for (const edge of [...map.edges].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!validIds.has(edge.from) || !validIds.has(edge.to) || edge.from === edge.to) continue
    outgoing.get(edge.from)?.push(edge.to)
    incoming.get(edge.to)?.push(edge.from)
  }
  for (const values of outgoing.values()) values.sort((left, right) => left.localeCompare(right))
  for (const values of incoming.values()) values.sort((left, right) => left.localeCompare(right))

  const components = stronglyConnectedComponents(nodeIds, outgoing)
  const componentByNode = new Map<string, number>()
  components.forEach((component, index) => component.forEach((id) => componentByNode.set(id, index)))
  const componentOutgoing = new Map(components.map((_, index) => [index, new Set<number>()]))
  const componentIncoming = new Map(components.map((_, index) => [index, new Set<number>()]))
  for (const [from, targets] of outgoing) {
    const fromComponent = componentByNode.get(from)
    if (fromComponent === undefined) continue
    for (const to of targets) {
      const toComponent = componentByNode.get(to)
      if (toComponent === undefined || toComponent === fromComponent) continue
      componentOutgoing.get(fromComponent)?.add(toComponent)
      componentIncoming.get(toComponent)?.add(fromComponent)
    }
  }

  const componentRank = topologicalRanks(components, componentOutgoing, componentIncoming)
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]))
  const columnByNode = new Map<string, number>()
  for (const id of nodeIds) {
    const node = nodeById.get(id)
    const component = componentByNode.get(id)
    if (!node || component === undefined) continue
    const isolated = (outgoing.get(id)?.length ?? 0) === 0 && (incoming.get(id)?.length ?? 0) === 0
    const rank = isolated ? ISOLATED_KIND_COLUMN[node.kind] : componentRank.get(component) ?? 0
    columnByNode.set(id, Math.min(Math.max(rank, 0), maximumColumn))
  }

  const columns = new Map<number, string[]>()
  for (const id of nodeIds) {
    const column = columnByNode.get(id) ?? 0
    const values = columns.get(column) ?? []
    values.push(id)
    columns.set(column, values)
  }
  for (const values of columns.values()) {
    values.sort((left, right) => {
      const leftNode = nodeById.get(left)
      const rightNode = nodeById.get(right)
      if (!leftNode || !rightNode) return left.localeCompare(right)
      return KIND_ORDER[leftNode.kind] - KIND_ORDER[rightNode.kind]
        || leftNode.label.localeCompare(rightNode.label)
        || left.localeCompare(right)
    })
  }

  const maxColumn = Math.max(0, ...columns.keys())
  const edgeLabelMetricsById = new Map(map.edges.map((edge) => [
    edge.id,
    projectLogicEdgeLabelMetrics(edge.label || edge.relation)
  ]))
  const maximumEdgeLabelWidth = Math.max(
    0,
    ...[...edgeLabelMetricsById.values()].map((metrics) => metrics.width)
  )
  const horizontalGap = Math.max(
    businessFlow ? 112 : 118,
    Math.ceil(maximumEdgeLabelWidth + PROJECT_LOGIC_EDGE_LABEL_NODE_CLEARANCE * 2)
  )
  const verticalGap = 42
  const hasBackwardEdge = map.edges.some((edge) => (
    (columnByNode.get(edge.to) ?? 0) <= (columnByNode.get(edge.from) ?? 0)
  ))
  const left = hasBackwardEdge
    ? Math.max(64, Math.ceil(maximumEdgeLabelWidth / 2 + 84))
    : 64
  const top = 88
  const rowPitch = PROJECT_LOGIC_NODE_HEIGHT + verticalGap
  const maxRows = Math.max(1, ...[...columns.values()].map((values) => values.length))
  const width = Math.max(920, left * 2 + (maxColumn + 1) * PROJECT_LOGIC_NODE_WIDTH + maxColumn * horizontalGap)
  const height = Math.max(560, top + maxRows * rowPitch + 72)
  const layoutNodes: ProjectLogicLayoutNode[] = []
  const layoutNodeById = new Map<string, ProjectLogicLayoutNode>()
  for (const [column, values] of [...columns].sort(([leftColumn], [rightColumn]) => leftColumn - rightColumn)) {
    const contentHeight = values.length * PROJECT_LOGIC_NODE_HEIGHT + Math.max(0, values.length - 1) * verticalGap
    const startY = Math.max(top, top + (maxRows * rowPitch - verticalGap - contentHeight) / 2)
    values.forEach((id, row) => {
      const node = {
        id,
        x: left + column * (PROJECT_LOGIC_NODE_WIDTH + horizontalGap),
        y: startY + row * rowPitch,
        width: PROJECT_LOGIC_NODE_WIDTH,
        height: PROJECT_LOGIC_NODE_HEIGHT,
        column
      }
      layoutNodes.push(node)
      layoutNodeById.set(id, node)
    })
  }

  const primaryEdgeKeys = new Set<string>()
  for (let index = 0; index < map.primaryPath.length - 1; index += 1) {
    primaryEdgeKeys.add(`${map.primaryPath[index]}\u0000${map.primaryPath[index + 1]}`)
  }
  const layoutEdges: ProjectLogicLayoutEdge[] = []
  const occupiedLabelBounds: ProjectLogicBounds[] = []
  for (const edge of [...map.edges].sort((leftEdge, rightEdge) => leftEdge.id.localeCompare(rightEdge.id))) {
    const from = layoutNodeById.get(edge.from)
    const to = layoutNodeById.get(edge.to)
    if (!from || !to || from.id === to.id) continue
    const geometry = connectionGeometry(from, to)
    const labelMetrics = edgeLabelMetricsById.get(edge.id)
      ?? projectLogicEdgeLabelMetrics(edge.label || edge.relation)
    const label = placeEdgeLabel(
      geometry,
      labelMetrics,
      layoutNodes,
      occupiedLabelBounds,
      width,
      height
    )
    occupiedLabelBounds.push(label.bounds)
    layoutEdges.push({
      id: edge.id,
      path: geometry.path,
      labelX: label.x,
      labelY: label.y,
      labelWidth: labelMetrics.width,
      labelHeight: labelMetrics.height,
      labelLines: labelMetrics.lines,
      primary: primaryEdgeKeys.has(`${edge.from}\u0000${edge.to}`)
    })
  }

  return {
    width,
    height,
    nodes: layoutNodes.sort((leftNode, rightNode) => leftNode.id.localeCompare(rightNode.id)),
    edges: layoutEdges
  }
}

export function projectLogicEdgeLabelMetrics(value: string): ProjectLogicEdgeLabelMetrics {
  const normalized = value.trim().replace(/\s+/gu, ' ') || '关系'
  const shortened = truncateProjectLogicEdgeLabel(normalized)
  const lines = splitProjectLogicEdgeLabel(shortened)
  const width = Math.ceil(
    Math.max(...lines.map(projectLogicLabelVisualUnits)) * PROJECT_LOGIC_EDGE_LABEL_FONT_SIZE
      + PROJECT_LOGIC_EDGE_LABEL_HORIZONTAL_PADDING
  )
  const height = lines.length * PROJECT_LOGIC_EDGE_LABEL_LINE_HEIGHT
    + PROJECT_LOGIC_EDGE_LABEL_VERTICAL_PADDING
  return { lines, width, height }
}

export function projectLogicReachableNodeIds(
  map: ProjectLogicMap,
  originId: string,
  direction: ProjectLogicReachDirection
): Set<string> {
  const validIds = new Set(map.nodes.map((node) => node.id))
  if (!validIds.has(originId)) return new Set()
  const adjacency = new Map([...validIds].map((id) => [id, [] as string[]]))
  for (const edge of map.edges) {
    if (!validIds.has(edge.from) || !validIds.has(edge.to)) continue
    const from = direction === 'downstream' ? edge.from : edge.to
    const to = direction === 'downstream' ? edge.to : edge.from
    adjacency.get(from)?.push(to)
  }
  const visited = new Set([originId])
  const queue = [originId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }
  return visited
}

function stronglyConnectedComponents(
  nodeIds: string[],
  outgoing: Map<string, string[]>
): string[][] {
  let nextIndex = 0
  const indices = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const stacked = new Set<string>()
  const components: string[][] = []

  const visit = (id: string): void => {
    indices.set(id, nextIndex)
    lowLinks.set(id, nextIndex)
    nextIndex += 1
    stack.push(id)
    stacked.add(id)
    for (const target of outgoing.get(id) ?? []) {
      if (!indices.has(target)) {
        visit(target)
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, lowLinks.get(target) ?? 0))
      } else if (stacked.has(target)) {
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, indices.get(target) ?? 0))
      }
    }
    if (lowLinks.get(id) !== indices.get(id)) return
    const component: string[] = []
    while (stack.length > 0) {
      const value = stack.pop()
      if (!value) break
      stacked.delete(value)
      component.push(value)
      if (value === id) break
    }
    components.push(component.sort((left, right) => left.localeCompare(right)))
  }

  for (const id of nodeIds) if (!indices.has(id)) visit(id)
  return components.sort((left, right) => left[0].localeCompare(right[0]))
}

function topologicalRanks(
  components: string[][],
  outgoing: Map<number, Set<number>>,
  incoming: Map<number, Set<number>>
): Map<number, number> {
  const indegree = new Map(components.map((_, index) => [index, incoming.get(index)?.size ?? 0]))
  const rank = new Map(components.map((_, index) => [index, 0]))
  const queue = [...indegree]
    .filter(([, value]) => value === 0)
    .map(([index]) => index)
    .sort((left, right) => components[left][0].localeCompare(components[right][0]))
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) continue
    const targets = [...(outgoing.get(current) ?? [])]
      .sort((left, right) => components[left][0].localeCompare(components[right][0]))
    for (const target of targets) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(current) ?? 0) + 1))
      const nextIndegree = (indegree.get(target) ?? 1) - 1
      indegree.set(target, nextIndegree)
      if (nextIndegree === 0) {
        queue.push(target)
        queue.sort((left, right) => components[left][0].localeCompare(components[right][0]))
      }
    }
  }
  return rank
}

interface ProjectLogicPoint {
  x: number
  y: number
}

interface ProjectLogicConnectionGeometry {
  path: string
  start: ProjectLogicPoint
  control1: ProjectLogicPoint
  control2: ProjectLogicPoint
  end: ProjectLogicPoint
}

interface ProjectLogicBounds {
  left: number
  top: number
  right: number
  bottom: number
}

function connectionGeometry(
  from: ProjectLogicLayoutNode,
  to: ProjectLogicLayoutNode
): ProjectLogicConnectionGeometry {
  const fromCenterY = from.y + from.height / 2
  const toCenterY = to.y + to.height / 2
  if (to.x > from.x) {
    const startX = from.x + from.width
    const endX = to.x
    const control = Math.max(44, (endX - startX) * 0.48)
    const start = { x: startX, y: fromCenterY }
    const control1 = { x: startX + control, y: fromCenterY }
    const control2 = { x: endX - control, y: toCenterY }
    const end = { x: endX, y: toCenterY }
    return {
      path: `M ${startX} ${fromCenterY} C ${startX + control} ${fromCenterY}, ${endX - control} ${toCenterY}, ${endX} ${toCenterY}`,
      start,
      control1,
      control2,
      end
    }
  }
  const startX = from.x
  const endX = to.x + to.width
  const detourX = Math.min(startX, endX) - 54 - Math.abs(from.y - to.y) * 0.04
  const start = { x: startX, y: fromCenterY }
  const control1 = { x: detourX, y: fromCenterY }
  const control2 = { x: detourX, y: toCenterY }
  const end = { x: endX, y: toCenterY }
  return {
    path: `M ${startX} ${fromCenterY} C ${detourX} ${fromCenterY}, ${detourX} ${toCenterY}, ${endX} ${toCenterY}`,
    start,
    control1,
    control2,
    end
  }
}

function placeEdgeLabel(
  geometry: ProjectLogicConnectionGeometry,
  metrics: ProjectLogicEdgeLabelMetrics,
  nodes: ProjectLogicLayoutNode[],
  occupiedLabels: ProjectLogicBounds[],
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number; bounds: ProjectLogicBounds } {
  const sampleParameters = Array.from({ length: 43 }, (_, index) => 0.08 + index * 0.02)
    .sort((left, right) => Math.abs(left - 0.5) - Math.abs(right - 0.5) || left - right)
  const primaryOffset = metrics.height / 2 + 7
  const offsets = [
    -primaryOffset,
    primaryOffset,
    -(primaryOffset + metrics.height + 6),
    primaryOffset + metrics.height + 6,
    0
  ]
  let best: { x: number; y: number; bounds: ProjectLogicBounds; score: number } | null = null

  for (const parameter of sampleParameters) {
    const point = cubicPoint(geometry, parameter)
    for (const [offsetIndex, offset] of offsets.entries()) {
      const x = point.x
      const y = point.y + offset
      const bounds = centeredBounds(x, y, metrics.width, metrics.height)
      const overflow = boundsOverflow(bounds, canvasWidth, canvasHeight)
      const nodeCollisions = nodes.filter((node) => boundsOverlap(
        bounds,
        expandBounds(nodeBounds(node), PROJECT_LOGIC_EDGE_LABEL_NODE_CLEARANCE)
      )).length
      const labelCollisions = occupiedLabels.filter((occupied) => boundsOverlap(
        expandBounds(bounds, 4),
        expandBounds(occupied, 4)
      )).length
      const score = overflow * 1_000_000
        + nodeCollisions * 100_000
        + labelCollisions * 10_000
        + Math.abs(parameter - 0.5) * 100
        + offsetIndex * 3
      if (!best || score < best.score) best = { x, y, bounds, score }
    }
  }

  if (best) return best
  const fallback = cubicPoint(geometry, 0.5)
  const x = fallback.x
  const y = fallback.y - primaryOffset
  return { x, y, bounds: centeredBounds(x, y, metrics.width, metrics.height) }
}

function cubicPoint(geometry: ProjectLogicConnectionGeometry, parameter: number): ProjectLogicPoint {
  const inverse = 1 - parameter
  const startWeight = inverse ** 3
  const control1Weight = 3 * inverse ** 2 * parameter
  const control2Weight = 3 * inverse * parameter ** 2
  const endWeight = parameter ** 3
  return {
    x: startWeight * geometry.start.x
      + control1Weight * geometry.control1.x
      + control2Weight * geometry.control2.x
      + endWeight * geometry.end.x,
    y: startWeight * geometry.start.y
      + control1Weight * geometry.control1.y
      + control2Weight * geometry.control2.y
      + endWeight * geometry.end.y
  }
}

function centeredBounds(x: number, y: number, width: number, height: number): ProjectLogicBounds {
  return {
    left: x - width / 2,
    top: y - height / 2,
    right: x + width / 2,
    bottom: y + height / 2
  }
}

function nodeBounds(node: ProjectLogicLayoutNode): ProjectLogicBounds {
  return {
    left: node.x,
    top: node.y,
    right: node.x + node.width,
    bottom: node.y + node.height
  }
}

function expandBounds(bounds: ProjectLogicBounds, amount: number): ProjectLogicBounds {
  return {
    left: bounds.left - amount,
    top: bounds.top - amount,
    right: bounds.right + amount,
    bottom: bounds.bottom + amount
  }
}

function boundsOverlap(left: ProjectLogicBounds, right: ProjectLogicBounds): boolean {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top
}

function boundsOverflow(bounds: ProjectLogicBounds, width: number, height: number): number {
  const margin = 10
  return Math.max(0, margin - bounds.left)
    + Math.max(0, bounds.right - width + margin)
    + Math.max(0, margin - bounds.top)
    + Math.max(0, bounds.bottom - height + margin)
}

function truncateProjectLogicEdgeLabel(value: string): string {
  const characters = Array.from(value)
  const ellipsisUnits = projectLogicLabelCharacterUnits('…')
  let units = 0
  const visible: string[] = []
  for (const character of characters) {
    const characterUnits = projectLogicLabelCharacterUnits(character)
    if (units + characterUnits <= PROJECT_LOGIC_EDGE_LABEL_MAX_UNITS) {
      visible.push(character)
      units += characterUnits
      continue
    }
    while (visible.length > 0 && units + ellipsisUnits > PROJECT_LOGIC_EDGE_LABEL_MAX_UNITS) {
      const removed = visible.pop()
      if (removed) units -= projectLogicLabelCharacterUnits(removed)
    }
    visible.push('…')
    break
  }
  return visible.join('')
}

function splitProjectLogicEdgeLabel(value: string): string[] {
  if (projectLogicLabelVisualUnits(value) <= PROJECT_LOGIC_EDGE_LABEL_MAX_LINE_UNITS) return [value]
  const characters = Array.from(value)
  const target = projectLogicLabelVisualUnits(value) / 2
  let units = 0
  let splitIndex = 1
  for (let index = 0; index < characters.length - 1; index += 1) {
    units += projectLogicLabelCharacterUnits(characters[index])
    splitIndex = index + 1
    if (units >= target) break
  }
  const whitespaceCandidates = characters
    .map((character, index) => (/\s/u.test(character) ? index : -1))
    .filter((index) => index > 0 && index < characters.length - 1)
    .sort((left, right) => Math.abs(left - splitIndex) - Math.abs(right - splitIndex))
  if (whitespaceCandidates.length > 0 && Math.abs(whitespaceCandidates[0] - splitIndex) <= 4) {
    splitIndex = whitespaceCandidates[0]
  }
  const first = characters.slice(0, splitIndex).join('').trim()
  const second = characters.slice(splitIndex).join('').trim()
  return first && second ? [first, second] : [value]
}

function projectLogicLabelVisualUnits(value: string): number {
  return Array.from(value).reduce(
    (total, character) => total + projectLogicLabelCharacterUnits(character),
    0
  )
}

function projectLogicLabelCharacterUnits(character: string): number {
  return /^[\u0000-\u00ff]$/u.test(character) ? 0.62 : 1
}
