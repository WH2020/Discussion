import { describe, expect, it } from 'vitest'
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

describe('presentation workbench model', () => {
  it('creates a bounded six-stage-inspired project with page-local evidence pools', () => {
    const project = createPresentationProject({
      request: '为管理层制作 AI 客服改造方案，覆盖现状、目标架构、投入产出和实施计划。',
      audience: '管理层',
      slideCount: 10,
      styleId: 'steel'
    }, { now: '2026-08-30T00:00:00.000Z', id: idFactory() })

    expect(project.slides).toHaveLength(10)
    expect(project.currentStage).toBe('brief')
    expect(project.styleId).toBe('steel')
    expect(project.slides[0]).toMatchObject({ kind: 'cover', sources: [] })
    expect(project.slides.at(-1)?.kind).toBe('closing')
    expect(new Set(project.slides.map((slide) => slide.id)).size).toBe(10)
  })

  it('uses the default page count when the numeric request is invalid', () => {
    const project = createPresentationProject(
      { request: '准备季度业务复盘', slideCount: Number.NaN },
      { now: '2026-08-30T00:00:00.000Z', id: idFactory() }
    )

    expect(project.slides).toHaveLength(8)
  })

  it('keeps stage progression and slide ordering deterministic', () => {
    const project = createPresentationProject(
      { request: '产品路线图', slideCount: 4 },
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
      { now: '2026-08-30T00:00:00.000Z', id: idFactory() }
    )
    persistPresentationLibrary({ schemaVersion: 1, projects: [project] }, storage)
    expect(readPresentationLibrary(storage).projects[0].title).toBe('季度复盘')

    storage.setItem(PRESENTATION_LIBRARY_STORAGE_KEY, '{broken')
    expect(readPresentationLibrary(storage).projects).toEqual([])
    expect(storage.getItem(PRESENTATION_LIBRARY_RECOVERY_KEY)).toBe('{broken')
  })

  it('produces a safe and bounded PowerPoint filename', () => {
    expect(sanitizePresentationFileName('  Q3: 方案 / 复盘?.  ')).toBe('Q3- 方案 - 复盘-')
    expect(sanitizePresentationFileName('')).toBe('Rovai-Presentation')
  })
})
