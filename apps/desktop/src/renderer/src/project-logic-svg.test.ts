import { describe, expect, it } from 'vitest'
import type { ProjectLogicMap } from '@contracts'
import { buildProjectLogicLayout } from './project-logic-layout'
import { projectLogicMapToSvg, projectLogicSuggestedFileName } from './project-logic-svg'

const snapshot: ProjectLogicMap = {
  schemaVersion: 1,
  project: { name: '<Demo & Co>', projectPath: 'C:\\demo' },
  generatedAt: '2026-08-27T00:00:00.000Z',
  nodes: [
    {
      id: 'app',
      label: '<script>alert(1)</script>',
      kind: 'application',
      path: 'apps/web',
      summary: 'Web',
      language: 'TypeScript',
      fileCount: 2,
      entry: true,
      sources: [{ path: 'apps/web/package.json', line: 1, reason: '清单' }]
    },
    {
      id: 'core',
      label: '结构校验与画布回写',
      kind: 'core',
      path: 'apps/core',
      summary: 'Core',
      language: 'TypeScript',
      fileCount: 1,
      entry: false,
      sources: [{ path: 'apps/core/index.ts', line: 1, reason: '入口' }]
    }
  ],
  edges: [{
    id: 'app-core',
    from: 'app',
    to: 'core',
    relation: 'flows_to',
    label: '提交代码证据并校验后回写新的逻辑图',
    evidenceCount: 1,
    sources: [{ path: 'apps/web/index.ts', line: 2, reason: '调用' }]
  }],
  primaryPath: ['app', 'core'],
  warnings: [],
  scan: { scannedFileCount: 2, skippedFileCount: 0, truncated: false, durationMs: 2, languages: [{ name: 'TypeScript', fileCount: 2 }] }
}

describe('project logic SVG export', () => {
  it('creates a self-contained escaped SVG', () => {
    const svg = projectLogicMapToSvg(snapshot, buildProjectLogicLayout(snapshot))
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('&lt;script&gt;alert(1)')
    expect(svg).not.toContain('<script>alert(1)</script>')
    expect(svg).toContain('关系表示静态依赖')
    expect(svg).toContain('class="edge-labels"')
    expect(svg).toContain('<tspan')
    expect(svg.indexOf('class="nodes"')).toBeLessThan(svg.indexOf('class="edge-labels"'))
    expect(svg).toContain('<rect x="-')
  })

  it('sanitizes the suggested Windows file name', () => {
    expect(projectLogicSuggestedFileName('Demo: App?')).toBe('Demo- App--logic-map.svg')
    expect(projectLogicSuggestedFileName('   ')).toBe('project-logic-map.svg')
  })
})
