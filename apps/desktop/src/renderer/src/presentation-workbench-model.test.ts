import { describe, expect, it } from 'vitest'
import type { PresentationOutlineGenerationResult } from '@contracts'
import {
  applyPresentationDesign,
  auditPresentationProject,
  extractPresentationMetrics,
  markPresentationDesignStale,
  presentationSourceNotes
} from './presentation-design'
import {
  PRESENTATION_LIBRARY_RECOVERY_KEY,
  PRESENTATION_LIBRARY_STORAGE_KEY,
  createPresentationProject,
  nextPresentationStage,
  persistPresentationLibrary,
  readPresentationLibrary,
  reorderPresentationSlide,
  sanitizePresentationFileName
} from './presentation-workbench-model'

function idFactory(): () => string {
  let value = 0
  return () => `ppt-id-${++value}`
}

function storageFixture(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) }
  }
}

function outlineFixture(slideCount = 6): PresentationOutlineGenerationResult {
  const contentCount = slideCount - 3
  return {
    title: '自主神经状态调节设备市场机会判断',
    audience: '管理层',
    objective: '确认非治疗产品定位和下一阶段调研重点',
    narrative: '先界定非治疗边界，再用需求与竞品证据判断市场空白，最后形成定位建议。',
    runtimeVersion: 'codex-cli 0.151.0',
    sourceDocument: {
      path: 'D:\\research.docx',
      name: 'research.docx',
      kind: 'docx',
      byteSize: 1024,
      characterCount: 5000,
      preview: '资料预览',
      truncated: false
    },
    slides: [
      { kind: 'cover', title: '自主神经状态调节设备市场机会判断', subtitle: '管理层决策简报', bullets: [], speakerNotes: '', evidence: [] },
      { kind: 'agenda', title: '从边界到机会', subtitle: '叙事路径', bullets: ['定位边界', '需求证据', '竞品空白'], speakerNotes: '', evidence: [] },
      ...Array.from({ length: contentCount }, (_, index) => ({
        kind: 'content' as const,
        title: `结论页 ${index + 1}`,
        subtitle: '单一结论',
        bullets: ['资料支持的事实', '事实对应的判断'],
        speakerNotes: '说明证据边界。',
        evidence: [{ sourceTitle: 'research.docx', excerpt: '资料原文摘录' }]
      })),
      { kind: 'closing', title: '建议进入验证阶段', subtitle: '下一步行动', bullets: ['确认验证计划'], speakerNotes: '', evidence: [] }
    ]
  }
}

describe('presentation workbench model', () => {
  it('applies a page-level design pass and keeps source provenance in notes', () => {
    const project = createPresentationProject(
      { request: '市场机会判断', slideCount: 6 },
      outlineFixture(),
      { now: '2026-08-30T00:00:00.000Z', id: idFactory() }
    )
    const designed = applyPresentationDesign(project, {
      runtimeVersion: 'codex-cli 0.151.0',
      slides: [
        { layout: 'statement', rationale: '封面保持单一焦点。' },
        { layout: 'process', rationale: '目录表现叙事顺序。' },
        { layout: 'evidence', rationale: '引用原文作为视觉锚点。' },
        { layout: 'title-body', rationale: '用一个结论带出支撑事实。' },
        { layout: 'two-column', rationale: '并列信息分栏呈现。' },
        { layout: 'statement', rationale: '收尾聚焦行动。' }
      ]
    }, '2026-08-30T01:00:00.000Z')

    expect(designed.currentStage).toBe('design')
    expect(designed.designAnalysis).toMatchObject({ status: 'ready', provider: 'codex-cli' })
    expect(designed.slides.map((slide) => slide.layout)).toEqual([
      'statement', 'process', 'evidence', 'title-body', 'two-column', 'statement'
    ])
    expect(presentationSourceNotes(designed, designed.slides[2])).toContain('[Sources]')
    expect(auditPresentationProject(designed).errors).toEqual([])
    expect(markPresentationDesignStale(designed).designAnalysis?.status).toBe('stale')
  })

  it('extracts explicit metrics for a native key-number layout', () => {
    const project = createPresentationProject(
      { request: '市场机会判断', slideCount: 6 },
      outlineFixture(),
      { now: '2026-08-30T00:00:00.000Z', id: idFactory() }
    )
    const slide = {
      ...project.slides[2],
      bullets: ['目标市场规模约20亿元', '预计3年完成渠道验证', '用户满意度达到85%']
    }
    expect(extractPresentationMetrics(slide).map((metric) => metric.value)).toEqual(['约20亿元', '3年', '85%'])
  })

  it('creates a Codex-authored project with page-local evidence pools', () => {
    const project = createPresentationProject({
      request: '为管理层制作 AI 客服改造方案，覆盖现状、目标架构、投入产出和实施计划。',
      audience: '管理层',
      slideCount: 6,
      styleId: 'steel'
    }, outlineFixture(), { now: '2026-08-30T00:00:00.000Z', id: idFactory() })

    expect(project.slides).toHaveLength(6)
    expect(project.currentStage).toBe('outline')
    expect(project.styleId).toBe('steel')
    expect(project.slides[0]).toMatchObject({ kind: 'cover', sources: [] })
    expect(project.slides[2].sources[0]).toMatchObject({ title: 'research.docx', note: '资料原文摘录' })
    expect(project.analysis).toMatchObject({ provider: 'codex-cli', status: 'ready' })
    expect(project.slides.at(-1)?.kind).toBe('closing')
    expect(new Set(project.slides.map((slide) => slide.id)).size).toBe(6)
  })

  it('uses the analyzed title instead of deriving fragments from a Windows path', () => {
    const project = createPresentationProject(
      { request: '根据D:\\research.docx生成一份PPT', slideCount: 6 },
      outlineFixture(),
      { now: '2026-08-30T00:00:00.000Z', id: idFactory() }
    )

    expect(project.title).toBe('自主神经状态调节设备市场机会判断')
    expect(project.slides.some((slide) => slide.title === '根据D')).toBe(false)
  })

  it('keeps stage progression and slide ordering deterministic', () => {
    const project = createPresentationProject(
      { request: '产品路线图', slideCount: 4 },
      outlineFixture(4),
      { now: '2026-08-30T00:00:00.000Z', id: idFactory() }
    )
    const secondId = project.slides[1].id
    const reordered = reorderPresentationSlide(project.slides, secondId, 1)

    expect(reordered[2].id).toBe(secondId)
    expect(nextPresentationStage('brief')).toBe('outline')
    expect(nextPresentationStage('design')).toBeNull()
  })

  it('round-trips valid projects and preserves corrupt input as recovery evidence', () => {
    const storage = storageFixture()
    const project = createPresentationProject(
      { request: '季度复盘' },
      outlineFixture(),
      { now: '2026-08-30T00:00:00.000Z', id: idFactory() }
    )
    persistPresentationLibrary({ schemaVersion: 1, projects: [project] }, storage)
    expect(readPresentationLibrary(storage).projects[0].title).toBe('自主神经状态调节设备市场机会判断')

    storage.setItem(PRESENTATION_LIBRARY_STORAGE_KEY, '{broken')
    expect(readPresentationLibrary(storage).projects).toEqual([])
    expect(storage.getItem(PRESENTATION_LIBRARY_RECOVERY_KEY)).toBe('{broken')
  })

  it('produces a safe and bounded PowerPoint filename', () => {
    expect(sanitizePresentationFileName('  Q3: 方案 / 复盘?.  ')).toBe('Q3- 方案 - 复盘-')
    expect(sanitizePresentationFileName('')).toBe('Rovai-Presentation')
  })
})
