import type {
  PresentationDesignGenerationInput,
  PresentationDesignGenerationResult
} from '@contracts'
import type {
  PresentationProject,
  PresentationSlide,
  PresentationSlideLayout
} from './presentation-workbench-model'

export interface PresentationDesignAudit {
  errors: string[]
  warnings: string[]
}

export interface PresentationMetric {
  value: string
  label: string
}

export function presentationDesignInput(
  project: PresentationProject
): PresentationDesignGenerationInput {
  return {
    title: project.title,
    audience: project.audience,
    objective: project.objective,
    styleId: project.styleId,
    slides: project.slides.map((slide) => ({
      kind: slide.kind,
      title: slide.title,
      subtitle: slide.subtitle,
      bullets: [...slide.bullets],
      evidence: slide.sources.map((source) => ({
        sourceTitle: source.title,
        excerpt: source.note
      }))
    }))
  }
}

export function applyPresentationDesign(
  project: PresentationProject,
  result: PresentationDesignGenerationResult,
  now = new Date().toISOString()
): PresentationProject {
  if (result.slides.length !== project.slides.length) {
    throw new Error('逐页设计数量与当前页面数量不一致。')
  }
  const slides = project.slides.map((slide, index) => ({
    ...slide,
    layout: result.slides[index]?.layout ?? slide.layout,
    designRationale: result.slides[index]?.rationale ?? ''
  }))
  const audit = auditPresentationProject({ ...project, slides })
  return {
    ...project,
    currentStage: 'design',
    slides,
    designAnalysis: {
      provider: 'codex-cli',
      runtimeVersion: result.runtimeVersion,
      status: 'ready',
      generatedAt: now,
      warnings: audit.warnings
    },
    updatedAt: now
  }
}

export function markPresentationDesignStale(project: PresentationProject): PresentationProject {
  if (!project.designAnalysis || project.designAnalysis.status === 'stale') return project
  return {
    ...project,
    designAnalysis: { ...project.designAnalysis, status: 'stale' }
  }
}

export function auditPresentationProject(project: PresentationProject): PresentationDesignAudit {
  const errors: string[] = []
  const warnings: string[] = []
  if (!project.title.trim()) errors.push('项目标题为空。')
  if (!project.audience.trim()) errors.push('目标听众为空。')
  if (!project.objective.trim()) errors.push('期望行动为空。')
  if (project.slides.length < 1) errors.push('项目中没有页面。')

  project.slides.forEach((slide, index) => {
    const page = `第 ${index + 1} 页`
    if (!slide.title.trim()) errors.push(`${page}标题为空。`)
    if (visibleLength(slide.title) > 54) warnings.push(`${page}标题偏长，建议压缩为一句结论。`)
    if (slide.bullets.length > 6) warnings.push(`${page}有 ${slide.bullets.length} 条要点，建议删减或拆页。`)
    if (slide.bullets.some((bullet) => visibleLength(bullet) > 88)) {
      warnings.push(`${page}存在过长要点，导出时会自动压缩显示。`)
    }
    if (slide.kind === 'content' && slide.sources.length === 0) {
      warnings.push(`${page}没有逐页证据，演讲者备注会标记为待补来源。`)
    }
    if (slide.layout === 'metric' && extractPresentationMetrics(slide).length === 0) {
      errors.push(`${page}选择了数据强调版式，但没有可识别的数字。`)
    }
    if (slide.layout === 'comparison' && slide.bullets.length < 2) {
      errors.push(`${page}选择了对照版式，但不足两条内容。`)
    }
    if (slide.layout === 'evidence' && slide.sources.length === 0) {
      errors.push(`${page}选择了证据版式，但没有逐页资料。`)
    }
  })

  for (let index = 2; index < project.slides.length; index += 1) {
    const current = project.slides[index]?.layout
    if (current
      && current === project.slides[index - 1]?.layout
      && current === project.slides[index - 2]?.layout
      && current !== 'statement') {
      warnings.push(`第 ${index - 1}–${index + 1} 页连续使用相同版式，页面节奏可能单调。`)
    }
  }
  return { errors: unique(errors), warnings: unique(warnings) }
}

export function extractPresentationMetrics(slide: PresentationSlide): PresentationMetric[] {
  const metrics: PresentationMetric[] = []
  const candidates = [...slide.bullets, slide.subtitle, slide.title].filter(Boolean)
  const pattern = /(?:约|近|超|>|<|≥|≤|≈)?\s*\d+(?:\.\d+)?\s*(?:%|％|亿元|万元|亿|万|元|年|个月|月|天|小时|分钟|家|项|倍|人次|人)/g
  for (const text of candidates) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0].replace(/\s+/g, '')
      if (metrics.some((item) => item.value === value)) continue
      const label = text
        .replace(match[0], '')
        .replace(/^[\s，。,:：；;、—-]+|[\s，。,:：；;、—-]+$/g, '')
        .slice(0, 34)
      metrics.push({ value, label: label || '关键指标' })
      if (metrics.length >= 3) return metrics
    }
  }
  return metrics
}

export function splitPresentationBullets(slide: PresentationSlide): [string[], string[]] {
  const pivot = Math.max(1, Math.ceil(slide.bullets.length / 2))
  return [slide.bullets.slice(0, pivot), slide.bullets.slice(pivot)]
}

export function presentationSourceNotes(project: PresentationProject, slide: PresentationSlide): string {
  const lines = slide.sources.map((source, index) => {
    const locator = source.url.trim()
      ? source.url.trim()
      : project.sourceDocument?.name === source.title
        ? `${project.sourceDocument.name}（本地资料）`
        : source.title
    const note = source.note.trim().replace(/\s+/g, ' ').slice(0, 500)
    return `[${index + 1}] ${source.title} — ${locator}${note ? `\n    ${note}` : ''}`
  })
  if (lines.length === 0 && slide.kind === 'content') {
    return '[Sources]\n待补：本页尚未绑定可追溯来源。'
  }
  return lines.length > 0 ? `[Sources]\n${lines.join('\n')}` : ''
}

export function safePresentationLayout(slide: PresentationSlide): PresentationSlideLayout {
  if (slide.kind === 'cover' || slide.kind === 'closing') return 'statement'
  if (slide.kind === 'agenda') return 'process'
  if (slide.layout === 'metric' && extractPresentationMetrics(slide).length === 0) return 'title-body'
  if (slide.layout === 'comparison' && slide.bullets.length < 2) return 'title-body'
  if (slide.layout === 'evidence' && slide.sources.length === 0) return 'title-body'
  if (slide.layout === 'process' && slide.bullets.length < 2) return 'title-body'
  return slide.layout
}

function visibleLength(value: string): number {
  return Array.from(value.trim()).length
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
