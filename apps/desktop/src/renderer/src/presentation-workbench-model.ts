export const PRESENTATION_LIBRARY_STORAGE_KEY = 'rovai.presentation-workbench.v1'
export const PRESENTATION_LIBRARY_RECOVERY_KEY = 'rovai.presentation-workbench.recovery'
export const PRESENTATION_LIBRARY_MAX_PROJECTS = 100
export const PRESENTATION_PROJECT_MAX_SLIDES = 60
export const PRESENTATION_SLIDE_MAX_SOURCES = 30

export type PresentationStage = 'brief' | 'outline' | 'research' | 'draft' | 'design'
export type PresentationSlideKind = 'cover' | 'agenda' | 'content' | 'closing'
export type PresentationSlideLayout = 'statement' | 'title-body' | 'two-column'
export type PresentationStyleId = 'porcelain' | 'steel' | 'ember'

export interface PresentationSource {
  id: string
  title: string
  url: string
  note: string
}

export interface PresentationSlide {
  id: string
  kind: PresentationSlideKind
  layout: PresentationSlideLayout
  title: string
  subtitle: string
  bullets: string[]
  speakerNotes: string
  sources: PresentationSource[]
}

export interface PresentationProject {
  id: string
  title: string
  request: string
  audience: string
  objective: string
  styleId: PresentationStyleId
  currentStage: PresentationStage
  slides: PresentationSlide[]
  createdAt: string
  updatedAt: string
}

export interface PresentationLibrary {
  schemaVersion: 1
  projects: PresentationProject[]
}

export interface PresentationProjectInput {
  request: string
  title?: string
  audience?: string
  objective?: string
  slideCount?: number
  styleId?: PresentationStyleId
}

export const PRESENTATION_STAGES: ReadonlyArray<{
  id: PresentationStage
  label: string
  detail: string
}> = [
  { id: 'brief', label: '需求', detail: '目标与受众' },
  { id: 'outline', label: '大纲', detail: '页面叙事' },
  { id: 'research', label: '资料', detail: '逐页证据' },
  { id: 'draft', label: '初稿', detail: '内容承载' },
  { id: 'design', label: '设计', detail: '视觉与导出' }
]

export const PRESENTATION_STYLES: ReadonlyArray<{
  id: PresentationStyleId
  label: string
  description: string
  canvas: string
  ink: string
  accent: string
  muted: string
}> = [
  {
    id: 'porcelain',
    label: '瓷白简报',
    description: '明亮、克制，适合产品和管理汇报',
    canvas: '#f7f7f4',
    ink: '#182027',
    accent: '#526f88',
    muted: '#69747d'
  },
  {
    id: 'steel',
    label: '深钢夜幕',
    description: '深色技术感，适合架构与研发主题',
    canvas: '#151a1e',
    ink: '#e7ecef',
    accent: '#7897ae',
    muted: '#aeb9c1'
  },
  {
    id: 'ember',
    label: '暖灰叙事',
    description: '温和、有重点，适合提案和故事表达',
    canvas: '#f3efe8',
    ink: '#292723',
    accent: '#a66f3f',
    muted: '#766e65'
  }
]

export function emptyPresentationLibrary(): PresentationLibrary {
  return { schemaVersion: 1, projects: [] }
}

export function createPresentationProject(
  input: PresentationProjectInput,
  options: { now?: string; id?: () => string } = {}
): PresentationProject {
  const now = options.now ?? new Date().toISOString()
  const createId = options.id ?? (() => crypto.randomUUID())
  const request = normalizedRequiredText(input.request, 2_000, 'PPT 需求不能为空')
  const title = normalizedText(input.title, 120) || inferPresentationTitle(request)
  const audience = normalizedText(input.audience, 120) || '项目相关决策者与协作成员'
  const objective = normalizedText(input.objective, 240) || '让听众理解核心判断，并明确下一步行动。'
  const requestedSlideCount = Number.isFinite(input.slideCount) ? input.slideCount : 8
  const slideCount = Math.max(4, Math.min(24, Math.round(requestedSlideCount ?? 8)))
  const contentCount = slideCount - 3
  const requestThemes = inferThemes(request, Math.min(5, contentCount))
  const slides: PresentationSlide[] = [
    {
      id: createId(),
      kind: 'cover',
      layout: 'statement',
      title,
      subtitle: `${audience} · ${objective}`,
      bullets: [],
      speakerNotes: request,
      sources: []
    },
    {
      id: createId(),
      kind: 'agenda',
      layout: 'title-body',
      title: '目录与叙事路径',
      subtitle: '从背景证据到判断，再到行动',
      bullets: requestThemes.slice(0, 4),
      speakerNotes: '',
      sources: []
    },
    ...Array.from({ length: contentCount }, (_, index): PresentationSlide => {
      const theme = requestThemes[index % requestThemes.length] ?? `核心主题 ${index + 1}`
      return {
        id: createId(),
        kind: 'content',
        layout: index % 3 === 2 ? 'two-column' : 'title-body',
        title: theme,
        subtitle: '本页需要形成一个可验证的单一结论',
        bullets: [
          `关键事实：补充与“${theme}”直接相关的证据`,
          '核心判断：说明事实意味着什么',
          '行动建议：给出负责人、时点或下一步'
        ],
        speakerNotes: '',
        sources: []
      }
    }),
    {
      id: createId(),
      kind: 'closing',
      layout: 'statement',
      title: '结论与下一步',
      subtitle: objective,
      bullets: ['复述核心判断', '明确下一步行动', '记录仍待验证的问题'],
      speakerNotes: '',
      sources: []
    }
  ]
  return {
    id: createId(),
    title,
    request,
    audience,
    objective,
    styleId: input.styleId ?? 'porcelain',
    currentStage: 'brief',
    slides,
    createdAt: now,
    updatedAt: now
  }
}

export function nextPresentationStage(stage: PresentationStage): PresentationStage | null {
  const index = PRESENTATION_STAGES.findIndex((item) => item.id === stage)
  return index >= 0 ? PRESENTATION_STAGES[index + 1]?.id ?? null : null
}

export function presentationStageProgress(stage: PresentationStage): number {
  const index = PRESENTATION_STAGES.findIndex((item) => item.id === stage)
  return index < 0 ? 0 : Math.round(((index + 1) / PRESENTATION_STAGES.length) * 100)
}

export function reorderPresentationSlide(
  slides: readonly PresentationSlide[],
  slideId: string,
  direction: -1 | 1
): PresentationSlide[] {
  const index = slides.findIndex((slide) => slide.id === slideId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= slides.length) return [...slides]
  const next = [...slides]
  const [slide] = next.splice(index, 1)
  next.splice(target, 0, slide)
  return next
}

export function sanitizePresentationFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  return (normalized || 'Rovai-Presentation').slice(0, 100)
}

export function readPresentationLibrary(storage?: Pick<Storage, 'getItem' | 'setItem'>): PresentationLibrary {
  if (!storage) return emptyPresentationLibrary()
  const raw = storage.getItem(PRESENTATION_LIBRARY_STORAGE_KEY)
  if (!raw) return emptyPresentationLibrary()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPresentationLibrary(parsed)) throw new Error('invalid presentation library')
    return parsed
  } catch {
    storage.setItem(PRESENTATION_LIBRARY_RECOVERY_KEY, raw)
    return emptyPresentationLibrary()
  }
}

export function persistPresentationLibrary(
  library: PresentationLibrary,
  storage?: Pick<Storage, 'setItem'>
): void {
  if (!storage || !isPresentationLibrary(library)) return
  storage.setItem(PRESENTATION_LIBRARY_STORAGE_KEY, JSON.stringify(library))
}

export function isPresentationLibrary(value: unknown): value is PresentationLibrary {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.projects)) return false
  return value.projects.length <= PRESENTATION_LIBRARY_MAX_PROJECTS
    && value.projects.every(isPresentationProject)
}

function isPresentationProject(value: unknown): value is PresentationProject {
  if (!isRecord(value)) return false
  return isBoundedString(value.id, 1, 120)
    && isBoundedString(value.title, 0, 120)
    && isBoundedString(value.request, 0, 2_000)
    && isBoundedString(value.audience, 0, 120)
    && isBoundedString(value.objective, 0, 240)
    && PRESENTATION_STYLES.some((style) => style.id === value.styleId)
    && PRESENTATION_STAGES.some((stage) => stage.id === value.currentStage)
    && Array.isArray(value.slides)
    && value.slides.length >= 1
    && value.slides.length <= PRESENTATION_PROJECT_MAX_SLIDES
    && value.slides.every(isPresentationSlide)
    && isIsoDate(value.createdAt)
    && isIsoDate(value.updatedAt)
}

function isPresentationSlide(value: unknown): value is PresentationSlide {
  if (!isRecord(value)) return false
  return isBoundedString(value.id, 1, 120)
    && ['cover', 'agenda', 'content', 'closing'].includes(String(value.kind))
    && ['statement', 'title-body', 'two-column'].includes(String(value.layout))
    && isBoundedString(value.title, 0, 180)
    && typeof value.subtitle === 'string'
    && value.subtitle.length <= 300
    && Array.isArray(value.bullets)
    && value.bullets.length <= 12
    && value.bullets.every((bullet) => isBoundedString(bullet, 1, 300))
    && typeof value.speakerNotes === 'string'
    && value.speakerNotes.length <= 4_000
    && Array.isArray(value.sources)
    && value.sources.length <= PRESENTATION_SLIDE_MAX_SOURCES
    && value.sources.every(isPresentationSource)
}

function isPresentationSource(value: unknown): value is PresentationSource {
  if (!isRecord(value)) return false
  return isBoundedString(value.id, 1, 120)
    && isBoundedString(value.title, 1, 240)
    && typeof value.url === 'string'
    && value.url.length <= 2_000
    && typeof value.note === 'string'
    && value.note.length <= 2_000
}

function inferPresentationTitle(request: string): string {
  const firstLine = request.split(/[\r\n。！？]/)[0]?.trim() ?? ''
  return (firstLine || '新建演示文稿').replace(/^(请|帮我|生成|制作|创建)\s*/, '').slice(0, 120)
}

function inferThemes(request: string, count: number): string[] {
  const candidates = request
    .split(/[，,；;。！？!?：:\r\n]+/)
    .map((item) => item.trim().replace(/^(请|并|以及|需要|希望)\s*/, ''))
    .filter((item) => item.length >= 2 && item.length <= 32)
  const defaults = ['背景与机会', '现状与证据', '核心方案', '实施路径', '风险与衡量']
  return [...new Set([...candidates, ...defaults])].slice(0, Math.max(1, count))
}

function normalizedText(value: string | undefined, limit: number): string {
  return value?.trim().slice(0, limit) ?? ''
}

function normalizedRequiredText(value: string, limit: number, message: string): string {
  const normalized = normalizedText(value, limit)
  if (!normalized) throw new Error(message)
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
