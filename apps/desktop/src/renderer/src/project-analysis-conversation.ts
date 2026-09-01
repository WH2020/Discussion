import type {
  CampComposerDraftView,
  StructuredCampMessageContent
} from '@contracts'

export const PROJECT_ANALYSIS_QUESTION_MAX_LENGTH = 4_000
const PROJECT_ANALYSIS_NAME_MAX_LENGTH = 80
const PROJECT_ANALYSIS_MESSAGE_MAX_BYTES = 28 * 1024
const PROJECT_ANALYSIS_DIAGRAM_NODE_LIMIT = 24

export type ProjectAnalysisMode = 'algorithm-framework' | 'software-framework'

export interface ProjectAnalysisConversationRequest {
  schemaVersion: 1
  mode: ProjectAnalysisMode
  question: string
  projectName: string
  diagram: {
    id: string
    title: string
    description: string
    nodeLabels: string[]
  } | null
  focusNode: {
    id: string
    label: string
    path: string
    summary: string
  } | null
}

export function createProjectAnalysisConversationRequest(input: {
  mode: ProjectAnalysisMode
  question: string
  projectName: string
  diagram?: {
    id: string
    title: string
    description: string
    nodeLabels: readonly string[]
  } | null
  focusNode?: {
    id: string
    label: string
    path: string
    summary: string
  } | null
}): ProjectAnalysisConversationRequest {
  const question = normalizeMultiline(input.question, PROJECT_ANALYSIS_QUESTION_MAX_LENGTH)
  if (!question) throw new Error('请先说明希望分析的算法或软件范围。')

  const projectName = normalizeInline(input.projectName, 160) || '当前项目'
  const diagram = input.diagram
    ? {
        id: normalizeInline(input.diagram.id, 160) || 'current-diagram',
        title: normalizeInline(input.diagram.title, 160) || '当前逻辑图',
        description: normalizeInline(input.diagram.description, 480),
        nodeLabels: [...new Set(input.diagram.nodeLabels
          .map((label) => normalizeInline(label, 120))
          .filter(Boolean))]
          .slice(0, PROJECT_ANALYSIS_DIAGRAM_NODE_LIMIT)
      }
    : null
  const focusNode = input.focusNode
    ? {
        id: normalizeInline(input.focusNode.id, 160) || 'selected-node',
        label: normalizeInline(input.focusNode.label, 160) || '当前选中节点',
        path: normalizeInline(input.focusNode.path, 360),
        summary: normalizeInline(input.focusNode.summary, 480)
      }
    : null

  return {
    schemaVersion: 1,
    mode: input.mode,
    question,
    projectName,
    diagram,
    focusNode
  }
}

export function projectAnalysisSceneId(mode: ProjectAnalysisMode): string {
  return mode === 'algorithm-framework'
    ? 'builtin:algorithm-design-review'
    : 'builtin:software-architecture-review'
}

export function projectAnalysisModeLabel(mode: ProjectAnalysisMode): string {
  return mode === 'algorithm-framework' ? '算法框架' : '软件框架'
}

export function projectAnalysisConversationName(
  request: ProjectAnalysisConversationRequest
): string {
  const focus = normalizeInline(request.question, 42)
  const prefix = request.mode === 'algorithm-framework' ? '算法专项' : '软件框架专项'
  return Array.from(`${prefix} · ${focus}`).slice(0, PROJECT_ANALYSIS_NAME_MAX_LENGTH).join('')
}

export function buildProjectAnalysisConversationContent(
  request: ProjectAnalysisConversationRequest
): StructuredCampMessageContent {
  return [
    { kind: 'all_members_mention' },
    { kind: 'text', text: ` ${truncateUtf8(projectAnalysisPrompt(request), PROJECT_ANALYSIS_MESSAGE_MAX_BYTES)}` }
  ]
}

export async function seedProjectAnalysisComposerDraft(
  campId: string,
  request: ProjectAnalysisConversationRequest,
  loadDraft: () => Promise<CampComposerDraftView>,
  saveDraft: (
    expectedRevision: number,
    content: StructuredCampMessageContent
  ) => Promise<CampComposerDraftView>
): Promise<CampComposerDraftView> {
  const draft = await loadDraft()
  if (draft.campId !== campId) throw new Error('专项分析草稿与新会话不匹配。')
  if (
    draft.body.trim()
    || draft.content.length > 0
    || draft.attachments.length > 0
    || draft.replyIntent
    || draft.continuationIntent
  ) {
    throw new Error('新会话输入框已有内容，未覆盖原草稿。')
  }
  return saveDraft(draft.revision, buildProjectAnalysisConversationContent(request))
}

function projectAnalysisPrompt(request: ProjectAnalysisConversationRequest): string {
  const diagramLines = request.diagram
    ? [
        `- 当前逻辑图：${request.diagram.title}`,
        ...(request.diagram.description ? [`- 当前图说明：${request.diagram.description}`] : []),
        ...(request.diagram.nodeLabels.length > 0
          ? [`- 当前图已识别节点：${request.diagram.nodeLabels.join('、')}`]
          : [])
      ]
    : ['- 当前逻辑图：未提供；请直接从项目代码和文档建立分析边界。']
  const focusNodeLines = request.focusNode
    ? [
        `- 当前选中节点：${request.focusNode.label}`,
        ...(request.focusNode.path ? [`- 节点位置：${request.focusNode.path}`] : []),
        ...(request.focusNode.summary ? [`- 节点说明：${request.focusNode.summary}`] : [])
      ]
    : ['- 当前选中节点：未指定；以用户描述的专项范围为准。']
  const modeRequirements = request.mode === 'algorithm-framework'
    ? [
        '明确算法边界、输入输出、数据约束、前置假设和调用方。',
        '拆解核心步骤、数据流、关键公式或决策逻辑，并给出时间/空间复杂度。',
        '检查精度、数值稳定性、边界输入、实时性、资源占用和失效条件。',
        '给出基准方案、候选优化、验证数据、评价指标和通过阈值。'
      ]
    : [
        '明确系统边界、分层、模块职责、外部依赖以及入口。',
        '拆解接口、数据流、控制流、关键状态机和持久化边界。',
        '检查并发模型、错误处理、降级恢复、可观测性、兼容与升级路径。',
        '给出主要架构风险、备选方案、演进顺序和可验证验收点。'
      ]

  return [
    `请围绕「${request.projectName}」开展一次可持续追问的${projectAnalysisModeLabel(request.mode)}专项分析。`,
    '',
    '## 用户本轮目标',
    request.question,
    '',
    '## 已带入的项目逻辑上下文',
    ...diagramLines,
    ...focusNodeLines,
    '',
    '## 执行边界',
    '- 先检查项目内的真实代码、配置、测试和文档，再形成结论；不要只根据目录名猜测。',
    '- 只分析与用户目标相关的范围，明确排除项，避免把成熟项目重新做一遍全量泛化分析。',
    '- 严格区分已证实事实、基于证据的推断、待验证假设和当前未知。',
    '- 重要结论附相对文件路径、符号名、接口或配置项作为证据；无法读取时明确说明。',
    '',
    `## ${projectAnalysisModeLabel(request.mode)}必须覆盖`,
    ...modeRequirements.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 第一轮输出',
    '- 范围与入口',
    '- 框架分层或算法步骤图（同时给出 Mermaid flowchart 代码）',
    '- 模块/步骤职责、输入输出和关键关系',
    '- 证据清单与事实/推断标记',
    '- 主要风险、缺口和验证方案',
    '- 最多 3 个真正影响结论的后续问题',
    '',
    '先基于现有证据完成第一轮拆解，不要因为非关键缺口停在提问阶段。后续根据我的回答继续收敛、比较方案或深入某个模块。'
  ].join('\n')
}

function normalizeInline(value: string, maxLength: number): string {
  return Array.from(value.trim().replace(/\s+/gu, ' ')).slice(0, maxLength).join('')
}

function normalizeMultiline(value: string, maxLength: number): string {
  return Array.from(value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[\t ]+/gu, ' '))
    .join('\n')
    .trim())
    .slice(0, maxLength)
    .join('')
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).byteLength <= maxBytes) return value
  let output = ''
  let usedBytes = 0
  for (const character of value) {
    const size = encoder.encode(character).byteLength
    if (usedBytes + size > maxBytes) break
    output += character
    usedBytes += size
  }
  return output
}
