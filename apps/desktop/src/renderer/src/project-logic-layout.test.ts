import { describe, expect, it } from 'vitest'
import type { ProjectLogicMap, ProjectLogicNode } from '@contracts'
import {
  buildProjectLogicLayout,
  projectLogicEdgeLabelMetrics,
  projectLogicReachableNodeIds
} from './project-logic-layout'

function node(id: string, kind: ProjectLogicNode['kind'] = 'module'): ProjectLogicNode {
  return {
    id,
    label: id,
    kind,
    path: id,
    summary: id,
    language: 'TypeScript',
    fileCount: 1,
    entry: id === 'app',
    sources: []
  }
}

function map(): ProjectLogicMap {
  return {
    schemaVersion: 1,
    project: { name: 'demo', projectPath: 'C:\\demo' },
    generatedAt: '2026-08-27T00:00:00.000Z',
    nodes: [node('app', 'application'), node('service', 'service'), node('core', 'core'), node('cycle-a'), node('cycle-b')],
    edges: [
      { id: 'app-service', from: 'app', to: 'service', relation: 'depends_on', label: '依赖', evidenceCount: 1, sources: [] },
      { id: 'service-core', from: 'service', to: 'core', relation: 'imports', label: '导入', evidenceCount: 1, sources: [] },
      { id: 'cycle-a-b', from: 'cycle-a', to: 'cycle-b', relation: 'imports', label: '导入', evidenceCount: 1, sources: [] },
      { id: 'cycle-b-a', from: 'cycle-b', to: 'cycle-a', relation: 'imports', label: '导入', evidenceCount: 1, sources: [] }
    ],
    primaryPath: ['app', 'service', 'core'],
    warnings: [],
    scan: { scannedFileCount: 5, skippedFileCount: 0, truncated: false, durationMs: 4, languages: [{ name: 'TypeScript', fileCount: 5 }] }
  }
}

describe('project logic layout', () => {
  it('is deterministic and keeps cyclic graphs finite', () => {
    const first = buildProjectLogicLayout(map())
    const second = buildProjectLogicLayout(map())
    expect(first).toEqual(second)
    expect(first.nodes).toHaveLength(5)
    expect(first.edges).toHaveLength(4)
    expect(first.width).toBeGreaterThanOrEqual(920)
  })

  it('traces authored upstream and downstream relations only', () => {
    const snapshot = map()
    expect([...projectLogicReachableNodeIds(snapshot, 'app', 'downstream')].sort()).toEqual(['app', 'core', 'service'])
    expect([...projectLogicReachableNodeIds(snapshot, 'core', 'upstream')].sort()).toEqual(['app', 'core', 'service'])
    expect(projectLogicReachableNodeIds(snapshot, 'missing', 'downstream').size).toBe(0)
  })

  it('keeps a long business primary flow in sequential columns', () => {
    const nodes = Array.from({ length: 10 }, (_, index) => node(`step-${index}`, index === 0 ? 'decision' : 'process'))
    const snapshot: ProjectLogicMap = {
      ...map(),
      nodes,
      edges: nodes.slice(1).map((current, index) => ({
        id: `edge-${index}`,
        from: nodes[index].id,
        to: current.id,
        relation: 'flows_to',
        label: '下一步',
        evidenceCount: 1,
        sources: []
      })),
      primaryPath: nodes.map((item) => item.id)
    }

    const layout = buildProjectLogicLayout(snapshot)
    const columns = snapshot.primaryPath.map((id) => layout.nodes.find((item) => item.id === id)?.column)
    expect(columns).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('keeps relationship labels readable outside node cards in dense business graphs', () => {
    const nodes = [
      node('motion-protocol', 'process'),
      node('dual-imu-acquisition', 'device'),
      node('cohort-validation', 'process'),
      node('joint-angle-engine', 'integration'),
      node('rotation-feature-extraction', 'core')
    ]
    const snapshot: ProjectLogicMap = {
      ...map(),
      nodes,
      edges: [
        edge('motion-acquisition', 'motion-protocol', 'dual-imu-acquisition', '按运动捕捉系统规范采集'),
        edge('acquisition-joint', 'dual-imu-acquisition', 'joint-angle-engine', '传入双段 IMU 数据'),
        edge('joint-feature', 'joint-angle-engine', 'rotation-feature-extraction', '输出屈伸角与层间旋转量'),
        edge('acquisition-feature', 'dual-imu-acquisition', 'rotation-feature-extraction', '原始惯性信号进入旋转特征提取'),
        edge('motion-validation', 'motion-protocol', 'cohort-validation', '与运动捕捉系统数据对照'),
        edge('validation-feature', 'cohort-validation', 'rotation-feature-extraction', '以先验验证结果约束特征解释')
      ],
      primaryPath: ['motion-protocol', 'dual-imu-acquisition', 'joint-angle-engine', 'rotation-feature-extraction']
    }

    const layout = buildProjectLogicLayout(snapshot)
    expect(layout.edges).toHaveLength(snapshot.edges.length)
    for (const label of layout.edges) {
      expect(label.labelLines.length).toBeLessThanOrEqual(2)
      expect(label.labelWidth).toBeGreaterThan(0)
      const labelBounds = {
        left: label.labelX - label.labelWidth / 2,
        top: label.labelY - label.labelHeight / 2,
        right: label.labelX + label.labelWidth / 2,
        bottom: label.labelY + label.labelHeight / 2
      }
      for (const card of layout.nodes) {
        const overlaps = labelBounds.left < card.x + card.width
          && labelBounds.right > card.x
          && labelBounds.top < card.y + card.height
          && labelBounds.bottom > card.y
        expect(overlaps, `${label.id} overlaps ${card.id}`).toBe(false)
      }
    }
  })

  it('wraps and safely truncates verbose relationship labels', () => {
    const metrics = projectLogicEdgeLabelMetrics(
      '将经过校准和质量门控的双段惯性数据送入关节角计算并同步记录完整失败回退路径'
    )
    expect(metrics.lines).toHaveLength(2)
    expect(metrics.lines.join('')).toContain('…')
    expect(metrics.width).toBeLessThanOrEqual(140)
    expect(metrics.height).toBeGreaterThan(22)
  })
})

function edge(id: string, from: string, to: string, label: string): ProjectLogicMap['edges'][number] {
  return {
    id,
    from,
    to,
    relation: 'flows_to',
    label,
    evidenceCount: 1,
    sources: []
  }
}
