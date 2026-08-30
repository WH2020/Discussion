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
  sourceDocument?: PresentationSourceDocument | null
  analysis?: {
    provider: 'codex-cli'
    runtimeVersion: string | null
    narrative: string
    status: 'ready' | 'stale'
    generatedAt: string
  } | null
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
  outline: PresentationOutlineGenerationResult,
  options: { now?: string; id?: () => string } = {}
): PresentationProject {
  const now = options.now ?? new Date().toISOString()
  const createId = options.id ?? (() => crypto.randomUUID())
  const request = normalizedText(input.request, 2_000)
  return {
    id: createId(),
    title: outline.title,
    request,
    audience: outline.audience,
    objective: outline.objective,
    styleId: input.styleId ?? 'porcelain',
    currentStage: 'outline',
    slides: slidesFromGeneratedOutline(outline, createId),
    sourceDocument: outline.sourceDocument,
    analysis: {
      provider: 'codex-cli',
      runtimeVersion: outline.runtimeVersion,
      narrative: outline.narrative,
      status: 'ready',
      generatedAt: now
    },
    createdAt: now,
    updatedAt: now
  }
}

export function replacePresentationProjectOutline(
  project: PresentationProject,
  outline: PresentationOutlineGenerationResult,
  options: { now?: string; id?: () => string } = {}
): PresentationProject {
  const now = options.now ?? new Date().toISOString()
  const createId = options.id ?? (() => crypto.randomUUID())
  return {
    ...project,
    title: outline.title,
    audience: outline.audience,
    objective: outline.objective,
    currentStage: 'outline',
    slides: slidesFromGeneratedOutline(outline, createId),
    sourceDocument: outline.sourceDocument,
    analysis: {
      provider: 'codex-cli',
      runtimeVersion: outline.runtimeVersion,
      narrative: outline.narrative,
      status: 'ready',
      generatedAt: now
    },
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
    && (value.sourceDocument === undefined
      || value.sourceDocument === null
      || isPresentationSourceDocument(value.sourceDocument))
    && (value.analysis === undefined || value.analysis === null || isPresentationAnalysis(value.analysis))
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

function normalizedText(value: string | undefined, limit: number): string {
  return value?.trim().slice(0, limit) ?? ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function slidesFromGeneratedOutline(
  outline: PresentationOutlineGenerationResult,
  createId: () => string
): PresentationSlide[] {
  return outline.slides.map((slide, index) => ({
    id: createId(),
    kind: slide.kind,
    layout: slide.kind === 'cover' || slide.kind === 'closing'
      ? 'statement'
      : index % 3 === 0
        ? 'two-column'
        : 'title-body',
    title: slide.title,
    subtitle: slide.subtitle,
    bullets: [...slide.bullets],
    speakerNotes: slide.speakerNotes,
    sources: slide.evidence.map((evidence) => ({
      id: createId(),
      title: evidence.sourceTitle,
      url: '',
      note: evidence.excerpt
    }))
  }))
}

function isPresentationSourceDocument(value: unknown): value is PresentationSourceDocument {
  if (!isRecord(value)) return false
  return isBoundedString(value.path, 1, 4_000)
    && isBoundedString(value.name, 1, 260)
    && ['docx', 'markdown', 'text'].includes(String(value.kind))
    && Number.isInteger(value.byteSize) && Number(value.byteSize) > 0
    && Number.isInteger(value.characterCount) && Number(value.characterCount) > 0
    && isBoundedString(value.preview, 0, 700)
    && typeof value.truncated === 'boolean'
}

function isPresentationAnalysis(value: unknown): boolean {
  if (!isRecord(value)) return false
  return value.provider === 'codex-cli'
    && (value.runtimeVersion === null || isBoundedString(value.runtimeVersion, 1, 120))
    && isBoundedString(value.narrative, 1, 500)
    && ['ready', 'stale'].includes(String(value.status))
    && isIsoDate(value.generatedAt)
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
import type {
  PresentationOutlineGenerationResult,
  PresentationSourceDocument
} from '@contracts'
