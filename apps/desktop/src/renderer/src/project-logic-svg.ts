import type { ProjectLogicMap, ProjectLogicNodeKind } from '@contracts'
import {
  PROJECT_LOGIC_EDGE_LABEL_LINE_HEIGHT,
  type ProjectLogicLayout
} from './project-logic-layout'

const KIND_COLOR: Record<ProjectLogicNodeKind, string> = {
  actor: '#f8fafc',
  application: '#22d3ee',
  device: '#60a5fa',
  process: '#34d399',
  decision: '#fbbf24',
  safety: '#fb7185',
  interface: '#38bdf8',
  service: '#34d399',
  core: '#a78bfa',
  data: '#fbbf24',
  integration: '#fb923c',
  tooling: '#94a3b8',
  test: '#f472b6',
  documentation: '#64748b',
  module: '#60a5fa'
}

const KIND_LABEL: Record<ProjectLogicNodeKind, string> = {
  actor: '参与者',
  application: '应用',
  device: '设备',
  process: '业务步骤',
  decision: '业务判断',
  safety: '安全控制',
  interface: '界面',
  service: '服务',
  core: '核心',
  data: '数据',
  integration: '集成',
  tooling: '工具',
  test: '测试',
  documentation: '文档',
  module: '模块'
}

export function projectLogicMapToSvg(
  map: ProjectLogicMap,
  layout: ProjectLogicLayout,
  options: { title?: string; description?: string; documentMode?: boolean } = {}
): string {
  const headingHeight = 74
  const footerHeight = 42
  const width = layout.width
  const height = layout.height + headingHeight + footerHeight
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]))
  const edgeById = new Map(map.edges.map((edge) => [edge.id, edge]))
  const presentKinds = [...new Set(map.nodes.map((node) => node.kind))]
    .sort((left, right) => KIND_LABEL[left].localeCompare(KIND_LABEL[right]))
  const edgePaths = layout.edges.map((edgeLayout) => {
    const edge = edgeById.get(edgeLayout.id)
    if (!edge) return ''
    return `<g class="edge${edgeLayout.primary ? ' primary' : ''}">
      <path d="${escapeXml(edgeLayout.path)}" marker-end="url(#arrow)" />
    </g>`
  }).join('\n')
  const edgeLabels = layout.edges.map((edgeLayout) => {
    const edge = edgeById.get(edgeLayout.id)
    if (!edge) return ''
    const firstLineY = -((edgeLayout.labelLines.length - 1)
      * PROJECT_LOGIC_EDGE_LABEL_LINE_HEIGHT) / 2 + 3.5
    const lines = edgeLayout.labelLines.map((line, index) => (
      `<tspan x="0" dy="${index === 0 ? 0 : PROJECT_LOGIC_EDGE_LABEL_LINE_HEIGHT}">${escapeXml(line)}</tspan>`
    )).join('')
    return `<g class="edge-label${edgeLayout.primary ? ' primary' : ''}" transform="translate(${edgeLayout.labelX} ${edgeLayout.labelY})">
      <title>${escapeXml(edge.label)}</title>
      <rect x="${-edgeLayout.labelWidth / 2}" y="${-edgeLayout.labelHeight / 2}" width="${edgeLayout.labelWidth}" height="${edgeLayout.labelHeight}" rx="7" />
      <text text-anchor="middle" y="${firstLineY}">${lines}</text>
    </g>`
  }).join('\n')
  const nodes = layout.nodes.map((nodeLayout) => {
    const node = nodeById.get(nodeLayout.id)
    if (!node) return ''
    const color = KIND_COLOR[node.kind]
    const sourceLabel = node.sources[0]?.path ?? node.path
    return `<g class="node" transform="translate(${nodeLayout.x} ${nodeLayout.y})">
      <rect width="${nodeLayout.width}" height="${nodeLayout.height}" rx="12" />
      <rect class="node-accent" width="4" height="${nodeLayout.height}" rx="2" fill="${color}" />
      <circle cx="20" cy="22" r="5" fill="${color}" />
      <text class="node-kind" x="32" y="26" fill="${color}">${escapeXml(KIND_LABEL[node.kind])}${node.entry ? ' · 入口' : ''}</text>
      <text class="node-title" x="16" y="51">${escapeXml(shorten(node.label, 23))}</text>
      <text class="node-path" x="16" y="72">${escapeXml(shorten(sourceLabel, 32))}</text>
    </g>`
  }).join('\n')
  const legend = presentKinds.map((kind, index) => {
    const x = width - 24 - (presentKinds.length - index) * 72
    return `<g transform="translate(${x} 46)"><circle r="4" fill="${KIND_COLOR[kind]}"/><text x="9" y="4">${escapeXml(KIND_LABEL[kind])}</text></g>`
  }).join('')
  const generatedAt = new Date(map.generatedAt)
  const timestamp = Number.isNaN(generatedAt.getTime()) ? map.generatedAt : generatedAt.toLocaleString('zh-CN')
  const diagramTitle = options.title?.trim() || '项目逻辑图'
  const nodeLabel = options.documentMode ? '业务节点' : '模块'
  const evidenceDescription = options.documentMode
    ? '基于产品文档中的业务角色、流程和约束生成'
    : '基于项目文件和依赖证据生成'
  const footer = options.documentMode
    ? `扫描 ${map.scan.scannedFileCount} 个文件 · 业务关系来自本地产品文档证据`
    : `扫描 ${map.scan.scannedFileCount} 个文件${map.scan.truncated ? ' · 已达到扫描上限' : ''} · 关系表示静态依赖，不等同于运行时调用链`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(map.project.name)} · ${escapeXml(diagramTitle)}</title>
  <desc id="description">${escapeXml(options.description?.trim() || evidenceDescription)}，共 ${map.nodes.length} 个${nodeLabel}、${map.edges.length} 条关系。</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker>
    <style>
      text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}.canvas{fill:#07111f}.heading{fill:#0b1727;stroke:#1e293b}.heading-title{font-size:18px;font-weight:700;fill:#f8fafc}.heading-subtitle,.legend text,.footer{font-size:10px;fill:#94a3b8}.edge path{fill:none;stroke:#52637a;stroke-width:1.5}.edge.primary path{stroke:#22d3ee;stroke-width:2.4}.node rect{fill:#0f1c2e;stroke:#27364b}.node-title{font-size:13px;font-weight:700;fill:#f8fafc}.node-kind{font-size:9px;font-weight:700;letter-spacing:.08em}.node-path{font-size:9px;fill:#94a3b8}.edge-label rect{fill:#07111f;fill-opacity:.96;stroke:#34465d;stroke-width:.8}.edge-label text{font-size:10px;font-weight:600;fill:#a9b8ca}.edge-label.primary rect{stroke:#168e9d}.edge-label.primary text{fill:#dbeafe}
    </style>
  </defs>
  <rect class="canvas" width="${width}" height="${height}"/>
  <rect class="heading" x="0.5" y="0.5" width="${width - 1}" height="${headingHeight - 1}"/>
  <text class="heading-title" x="24" y="30">${escapeXml(map.project.name)} · ${escapeXml(diagramTitle)}</text>
  <text class="heading-subtitle" x="24" y="50">${escapeXml(evidenceDescription)} · ${map.nodes.length} 个${nodeLabel} · ${map.edges.length} 条关系 · ${escapeXml(timestamp)}</text>
  <g class="legend">${legend}</g>
  <g transform="translate(0 ${headingHeight})"><g class="edges">${edgePaths}</g><g class="nodes">${nodes}</g><g class="edge-labels">${edgeLabels}</g></g>
  <text class="footer" x="24" y="${height - 18}">${escapeXml(footer)}</text>
</svg>`
}

export function projectLogicSuggestedFileName(projectName: string): string {
  const safe = projectName
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
  return `${safe || 'project'}-logic-map.svg`
}

export function projectLogicKindLabel(kind: ProjectLogicNodeKind): string {
  return KIND_LABEL[kind]
}

export function projectLogicKindColor(kind: ProjectLogicNodeKind): string {
  return KIND_COLOR[kind]
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
