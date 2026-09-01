import { describe, expect, it } from 'vitest'
import type { ProjectLogicDiagram, ProjectLogicMap } from '@contracts'
import {
  buildProjectLogicGenerationPrompt,
  createProjectLogicGenerationRequest,
  parseProjectLogicDiagramResponse,
  projectLogicGenerationCacheKey,
  projectLogicScanFingerprint,
  readProjectLogicGenerationCache,
  validateAndNormalizeProjectLogicDiagram,
  writeProjectLogicGenerationCache,
  type ProjectLogicGenerationCacheEntry,
  type ProjectLogicStorage
} from './project-logic-generation'

function diagram(): ProjectLogicDiagram {
  return {
    id: 'software-architecture',
    title: '软件架构',
    description: '入口调用核心服务。',
    nodes: [
      {
        id: 'entry',
        label: '应用入口',
        kind: 'application',
        path: 'src/app.ts',
        summary: '创建应用并启动服务。',
        language: 'TypeScript',
        fileCount: 1,
        entry: true,
        sources: [{ path: 'src/app.ts', line: 3, reason: '事实：这里创建应用。' }]
      },
      {
        id: 'core',
        label: '核心服务',
        kind: 'core',
        path: 'src/core/service.ts',
        summary: '处理核心业务。',
        language: 'TypeScript',
        fileCount: 1,
        entry: false,
        sources: [{ path: 'src/core/service.ts', line: 8, reason: '事实：这里定义核心服务。' }]
      }
    ],
    edges: [
      {
        id: 'entry-core',
        from: 'entry',
        to: 'core',
        relation: 'flows_to',
        label: '调用',
        evidenceCount: 1,
        sources: [{ path: 'src/app.ts', line: 12, reason: '事实：入口在这里调用核心服务。' }]
      }
    ],
    primaryPath: ['entry', 'core']
  }
}

function projectMap(): ProjectLogicMap {
  const value = diagram()
  return {
    schemaVersion: 1,
    project: { name: 'Demo', projectPath: 'E:\\work\\demo' },
    generatedAt: '2026-08-27T08:00:00.000Z',
    nodes: value.nodes,
    edges: value.edges,
    primaryPath: value.primaryPath,
    warnings: ['未扫描生成目录'],
    scan: {
      scannedFileCount: 12,
      skippedFileCount: 2,
      truncated: false,
      durationMs: 50,
      languages: [
        { name: 'TypeScript', fileCount: 10 },
        { name: 'JSON', fileCount: 2 }
      ]
    },
    analysisKind: 'source-code'
  }
}

function responseFor(value: unknown): string {
  return [
    '已检查入口、实现、配置和测试。',
    '```rovai-project-logic',
    JSON.stringify({ schemaVersion: 1, diagram: value }),
    '```'
  ].join('\n')
}

class MemoryStorage implements ProjectLogicStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function cacheEntry(campId: string, title = '软件架构'): ProjectLogicGenerationCacheEntry {
  const value = diagram()
  value.title = title
  return {
    schemaVersion: 1,
    projectPath: 'E:\\work\\demo',
    scanFingerprint: projectLogicScanFingerprint(projectMap()),
    diagram: value,
    campId,
    messageSummaries: [
      { role: 'user', content: '分析项目的软件架构。' },
      { role: 'assistant', content: '已生成软件架构图。' }
    ],
    savedAt: '2026-08-27T08:10:00.000Z'
  }
}

describe('project logic generation prompt', () => {
  it('builds a strict Chinese Runtime prompt with current diagram and node evidence', () => {
    const map = projectMap()
    const request = createProjectLogicGenerationRequest({
      type: 'algorithm-architecture',
      userRequest: '只分析任务调度算法。'
    })
    const prompt = buildProjectLogicGenerationPrompt({
      map,
      request,
      currentDiagram: diagram(),
      currentNode: diagram().nodes[1]
    })

    expect(prompt).toContain('检查与目标有关的真实源代码、配置、测试和文档')
    expect(prompt).toContain('真实数据流和控制流')
    expect(prompt).toContain('严格区分“事实”“推断”“待验证假设”和“未知”')
    expect(prompt).toContain('当前只返回一张图')
    expect(prompt).toContain('算法的真实调用入口')
    expect(prompt).toContain('src/core/service.ts')
    expect(prompt).toContain('reason 必须以“事实：”或“推断：”开头')
    expect(prompt).toContain('```rovai-project-logic fenced JSON')
    expect(prompt).toContain('结束围栏后不得再输出任何字符')
  })

  it('requires an explicit user target before building one software architecture diagram', () => {
    expect(() => createProjectLogicGenerationRequest({
      type: 'software-architecture',
      userRequest: '   '
    })).toThrow('请说明希望生成或分析的项目逻辑图范围。')

    const request = createProjectLogicGenerationRequest({
      type: 'software-architecture',
      userRequest: '只分析插件加载、权限校验和失败回退。'
    })
    expect(request).toEqual({
      schemaVersion: 1,
      type: 'software-architecture',
      userRequest: '只分析插件加载、权限校验和失败回退。'
    })
    const prompt = buildProjectLogicGenerationPrompt({ map: projectMap(), request })
    expect(prompt).toContain('至少生成一张软件架构图')
    expect(prompt).toContain('严格围绕用户本轮指定的范围')
    expect(prompt).not.toContain('自动深度分析整个项目')
  })
})

describe('project logic diagram parser', () => {
  it('extracts the unique payload from arbitrary model prose and normalizes safe paths', () => {
    const value = diagram()
    value.nodes[0].path = 'src\\app.ts'
    value.nodes[0].sources[0].path = './src\\app.ts'
    value.nodes[0].sources[0].reason = '事实:  这里创建应用。'
    const response = [
      '正文中可能有普通说明。',
      '```mermaid',
      'flowchart LR',
      '```',
      responseFor(value)
    ].join('\n')

    const parsed = parseProjectLogicDiagramResponse(response)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.diagram.nodes[0].path).toBe('src/app.ts')
    expect(parsed.diagram.nodes[0].sources[0]).toEqual({
      path: 'src/app.ts',
      line: 3,
      reason: '事实：这里创建应用。'
    })
  })

  it.each([
    'C:\\secret\\token.txt',
    '/etc/passwd',
    '../../outside.ts',
    'src/../../../outside.ts',
    'https://example.com/source.ts'
  ])('rejects malicious or absolute evidence path %s', (path) => {
    const value = diagram()
    value.edges[0].sources[0].path = path
    const parsed = parseProjectLogicDiagramResponse(responseFor(value))
    expect(parsed).toMatchObject({ ok: false, error: { code: 'invalid-path' } })
  })

  it('returns an explainable error for malformed JSON and missing fences', () => {
    expect(parseProjectLogicDiagramResponse(
      '```rovai-project-logic\n{"schemaVersion":1,"diagram":\n```'
    )).toMatchObject({ ok: false, error: { code: 'invalid-json' } })
    expect(parseProjectLogicDiagramResponse('只有分析正文，没有 payload。')).toMatchObject({
      ok: false,
      error: { code: 'payload-not-found' }
    })
  })

  it('rejects duplicate IDs and dangling edge endpoints', () => {
    const duplicate = diagram()
    duplicate.nodes[1].id = 'entry'
    expect(parseProjectLogicDiagramResponse(responseFor(duplicate))).toMatchObject({
      ok: false,
      error: { code: 'duplicate-id' }
    })

    const dangling = diagram()
    dangling.edges[0].to = 'missing-node'
    expect(parseProjectLogicDiagramResponse(responseFor(dangling))).toMatchObject({
      ok: false,
      error: { code: 'dangling-edge' }
    })
  })

  it('rejects unsupported contracts values, missing evidence and ambiguous payloads', () => {
    const badKind = diagram() as unknown as { nodes: Array<{ kind: string }> }
    badKind.nodes[0].kind = 'database-table'
    expect(validateAndNormalizeProjectLogicDiagram(badKind)).toMatchObject({
      ok: false,
      error: { code: 'unsupported-kind' }
    })

    const noEvidence = diagram()
    noEvidence.edges[0].sources = []
    noEvidence.edges[0].evidenceCount = 0
    expect(validateAndNormalizeProjectLogicDiagram(noEvidence)).toMatchObject({
      ok: false,
      error: { code: 'limit-exceeded' }
    })

    const twice = `${responseFor(diagram())}\n${responseFor(diagram())}`
    expect(parseProjectLogicDiagramResponse(twice)).toMatchObject({
      ok: false,
      error: { code: 'ambiguous-payload' }
    })
  })
})

describe('project logic generation cache', () => {
  it('keeps scan fingerprints stable across volatile metadata and unordered scan collections', () => {
    const first = projectMap()
    const second = projectMap()
    second.generatedAt = '2030-01-01T00:00:00.000Z'
    second.scan.durationMs = 9_999
    second.scan.languages.reverse()
    second.nodes.reverse()
    second.nodes[0].sources.reverse()
    second.edges.reverse()
    second.warnings.reverse()

    expect(projectLogicScanFingerprint(second)).toBe(projectLogicScanFingerprint(first))
    second.nodes[0].summary = '实际语义已经变化。'
    expect(projectLogicScanFingerprint(second)).not.toBe(projectLogicScanFingerprint(first))
    expect(projectLogicGenerationCacheKey('E:\\WORK\\demo\\', projectLogicScanFingerprint(first)))
      .toBe(projectLogicGenerationCacheKey('e:/work/demo', projectLogicScanFingerprint(first)))
    expect(projectLogicGenerationCacheKey('\\\\?\\E:\\work\\demo', projectLogicScanFingerprint(first)))
      .toBe(projectLogicGenerationCacheKey('e:/work/demo', projectLogicScanFingerprint(first)))
    expect(projectLogicGenerationCacheKey('\\\\SERVER\\Share\\Demo\\', projectLogicScanFingerprint(first)))
      .toBe(projectLogicGenerationCacheKey('//server/share/demo', projectLogicScanFingerprint(first)))
    expect(projectLogicGenerationCacheKey('\\\\?\\UNC\\SERVER\\Share\\Demo', projectLogicScanFingerprint(first)))
      .toBe(projectLogicGenerationCacheKey('//server/share/demo', projectLogicScanFingerprint(first)))
  })

  it('persists multiple generated diagrams while remaining compatible with one-diagram caches', () => {
    const storage = new MemoryStorage()
    const entry = cacheEntry('camp-multi', '第二张图')
    const first = diagram()
    first.id = 'ai-software-turn-1'
    first.title = '第一张图'
    entry.diagram.id = 'ai-algorithm-turn-2'
    entry.diagrams = [first, entry.diagram]

    expect(writeProjectLogicGenerationCache(storage, entry).ok).toBe(true)
    expect(readProjectLogicGenerationCache(storage, entry.projectPath, entry.scanFingerprint))
      .toMatchObject({
        status: 'hit',
        value: {
          diagram: { id: 'ai-algorithm-turn-2' },
          diagrams: [
            { id: 'ai-software-turn-1' },
            { id: 'ai-algorithm-turn-2' }
          ]
        }
      })

    const legacy = cacheEntry('camp-legacy')
    expect(writeProjectLogicGenerationCache(storage, legacy).ok).toBe(true)
    expect(readProjectLogicGenerationCache(storage, legacy.projectPath, legacy.scanFingerprint))
      .toMatchObject({ status: 'hit', value: { diagrams: [{ id: legacy.diagram.id }] } })
  })

  it('falls back from a damaged primary cache and never overwrites recovered data', () => {
    const storage = new MemoryStorage()
    const first = cacheEntry('camp-1', '第一版')
    const second = cacheEntry('camp-2', '第二版')
    const third = cacheEntry('camp-3', '第三版')

    expect(writeProjectLogicGenerationCache(storage, first).ok).toBe(true)
    expect(writeProjectLogicGenerationCache(storage, second).ok).toBe(true)
    const key = projectLogicGenerationCacheKey(first.projectPath, first.scanFingerprint)
    const recoveryBeforeDamage = storage.getItem(`${key}:recovery`)
    expect(JSON.parse(recoveryBeforeDamage ?? '{}').campId).toBe('camp-1')

    storage.setItem(key, '{bad json')
    const recovered = readProjectLogicGenerationCache(storage, first.projectPath, first.scanFingerprint)
    expect(recovered).toMatchObject({
      status: 'hit',
      source: 'recovery',
      value: { campId: 'camp-1' }
    })
    expect(recovered.warning).toContain('主缓存损坏')

    expect(writeProjectLogicGenerationCache(storage, third).ok).toBe(true)
    expect(storage.getItem(`${key}:recovery`)).toBe(recoveryBeforeDamage)
    expect(readProjectLogicGenerationCache(storage, third.projectPath, third.scanFingerprint))
      .toMatchObject({ status: 'hit', source: 'primary', value: { campId: 'camp-3' } })
  })

  it('safely ignores cache JSON when both primary and recovery are damaged', () => {
    const storage = new MemoryStorage()
    const entry = cacheEntry('camp-1')
    const key = projectLogicGenerationCacheKey(entry.projectPath, entry.scanFingerprint)
    storage.setItem(key, '{bad')
    storage.setItem(`${key}:recovery`, JSON.stringify({ schemaVersion: 999 }))

    expect(readProjectLogicGenerationCache(storage, entry.projectPath, entry.scanFingerprint))
      .toEqual({
        status: 'miss',
        value: null,
        source: null,
        warning: '项目逻辑图缓存损坏，已安全忽略。'
      })
  })
})
