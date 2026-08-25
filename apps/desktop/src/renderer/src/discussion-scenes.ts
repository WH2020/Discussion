import type { StructuredCampMessageContent } from '@contracts'

export const DISCUSSION_SCENES_STORAGE_KEY = 'rovai.discussion-scenes.v1'
export const DISCUSSION_SCENES_RECOVERY_KEY = 'rovai.discussion-scenes.recovery.v1'
export const DISCUSSION_SCENE_SQUADS_STORAGE_KEY = 'rovai.discussion-scene-squads.v1'
export const DISCUSSION_SCENE_SQUADS_RECOVERY_KEY = 'rovai.discussion-scene-squads.recovery.v1'
export const MAX_CUSTOM_DISCUSSION_SCENES = 40
export const DISCUSSION_SCENE_DRAFT_TEXT_MAX_BYTES = 28 * 1024

const MAX_NAME_LENGTH = 60
const MAX_SUMMARY_LENGTH = 180
const MAX_INSTRUCTIONS_LENGTH = 2_000
const MAX_LIST_ITEMS = 12
const MAX_LIST_ITEM_LENGTH = 180
const MAX_DISCUSSION_SCENE_SQUADS = 80
export const MAX_DISCUSSION_SCENE_SQUAD_MEMBERS = 24

export type DiscussionSceneCategory =
  | 'algorithm'
  | 'product'
  | 'architecture'
  | 'design'
  | 'general'

export interface DiscussionSceneTemplate {
  id: string
  name: string
  category: DiscussionSceneCategory
  summary: string
  roles: string[]
  agenda: string[]
  deliverables: string[]
  instructions: string
}

export interface DiscussionSceneParticipant {
  agentId: string
  displayName: string
  teamRole: string
  isDefaultLead: boolean
}

export interface DiscussionSceneSquadPreset {
  sceneId: string
  memberAgentIds: string[]
  defaultLeadAgentId: string
}

export interface DiscussionSceneSquadLoadResult {
  squads: DiscussionSceneSquadPreset[]
  warning: string | null
}

export interface DiscussionSceneSquadSelectionPlan {
  memberAgentIds: string[]
  defaultLeadAgentId: string
  missingAgentIds: string[]
  appliedPreset: boolean
}

export interface DiscussionSceneSkillReference {
  id: string
  name: string
}

export type DiscussionSceneOrchestration = 'campfire' | 'guided' | 'solo'

export interface DiscussionSceneDraftResult {
  content: StructuredCampMessageContent
  orchestration: DiscussionSceneOrchestration
}

export interface DiscussionSceneStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface DiscussionSceneLoadResult {
  scenes: DiscussionSceneTemplate[]
  warning: string | null
}

export const DISCUSSION_SCENE_CATEGORY_LABELS: Record<DiscussionSceneCategory, string> = {
  algorithm: '算法',
  product: '产品',
  architecture: '架构',
  design: '设计',
  general: '通用'
}

export const BUILTIN_DISCUSSION_SCENES: readonly DiscussionSceneTemplate[] = [
  {
    id: 'builtin:algorithm-design-review',
    name: '算法方案评审',
    category: 'algorithm',
    summary: '从约束、基线、复杂度、数值稳定性和验证方案审查算法结构。',
    roles: ['算法负责人', '系统与性能工程师', '验证工程师', '反例挑战者'],
    agenda: [
      '明确输入、输出、数据范围、实时性和资源约束',
      '比较基线方案、候选方案及关键公式或计算流程',
      '检查时间/空间复杂度、精度、溢出、噪声和边界输入',
      '设计仿真、基准数据、评价指标与通过阈值'
    ],
    deliverables: [
      '推荐方案与选择依据',
      '方案对比表及主要取舍',
      '待验证假设、失效条件与风险',
      '可执行的实验和验收清单'
    ],
    instructions: '涉及信号处理时额外检查采样率、带宽、混叠、滤波延迟、相位和定点实现风险。'
  },
  {
    id: 'builtin:prd-review',
    name: '产品 PRD 评审',
    category: 'product',
    summary: '核对用户价值、范围、流程、异常状态、约束、指标和验收条件。',
    roles: ['产品负责人', '目标用户代表', '技术可行性负责人', '质量与风险负责人'],
    agenda: [
      '确认目标用户、典型场景、问题证据和成功指标',
      '检查主流程、异常流程、关键状态和信息缺口',
      '区分必须实现、建议实现、可以延期和明确不做',
      '核对性能、成本、安全、兼容性、依赖与可测试性'
    ],
    deliverables: [
      '评审结论与产品价值判断',
      '需求遗漏、冲突和歧义清单',
      '范围与优先级建议',
      '可追踪的验收标准和待确认问题'
    ],
    instructions: '不得凭空补造市场数据、用户偏好、业务优先级或法规要求；缺少依据时给出验证方法。'
  },
  {
    id: 'builtin:software-architecture-review',
    name: '软件架构评审',
    category: 'architecture',
    summary: '审查系统边界、模块职责、接口、数据流、故障恢复与演进成本。',
    roles: ['系统架构师', '实现负责人', '可靠性与安全负责人', '独立审阅者'],
    agenda: [
      '明确系统边界、外部依赖、职责划分和关键数据流',
      '检查接口、协议、状态机、并发模型和资源预算',
      '推演错误处理、降级、恢复、可观测性和单点失效',
      '比较备选方案、迁移路径、兼容策略与回滚办法'
    ],
    deliverables: [
      '推荐架构与关键决策',
      '模块/接口责任清单',
      '主要风险、故障模式和验证方案',
      '分阶段实施、兼容与回滚计划'
    ],
    instructions: '重要结论必须能追溯到需求或约束；不要用未来可能需要的扩展点替代当前最小充分设计。'
  },
  {
    id: 'builtin:prototype-review',
    name: '设计原型评审',
    category: 'design',
    summary: '围绕用户任务、信息层级、状态覆盖、实现约束与无障碍评审原型。',
    roles: ['产品设计师', '用户任务代表', '前端实现负责人', '无障碍与质量负责人'],
    agenda: [
      '从目标用户和核心任务检查入口、路径与操作成本',
      '检查信息架构、内容层级、反馈、一致性和防误操作',
      '覆盖加载、空、禁用、超时、错误、撤销和恢复状态',
      '核对响应式、键盘、无障碍和工程实现约束'
    ],
    deliverables: [
      '按严重度排序的体验问题',
      '关键流程与状态覆盖矩阵',
      '可执行的交互/视觉修改建议',
      '原型验收清单与尚未验证风险'
    ],
    instructions: '视觉判断必须追溯到用户目标、使用环境或设计约束，不把个人审美偏好当作产品需求。'
  }
] as const

export function isBuiltinDiscussionScene(scene: DiscussionSceneTemplate): boolean {
  return scene.id.startsWith('builtin:')
}

export function createCustomDiscussionSceneId(randomId?: string): string {
  const suffix = randomId ?? globalThis.crypto?.randomUUID?.()
  if (!suffix) throw new Error('当前环境无法生成场景标识。')
  return `custom:${suffix}`
}

export function normalizeDiscussionScene(input: unknown): {
  scene: DiscussionSceneTemplate | null
  error: string | null
} {
  if (!isRecord(input)) return { scene: null, error: '场景数据格式无效。' }

  const id = normalizedText(input.id, 120)
  if (!id || (!id.startsWith('custom:') && !id.startsWith('builtin:'))) {
    return { scene: null, error: '场景标识无效。' }
  }

  const name = normalizedText(input.name, MAX_NAME_LENGTH)
  if (!name) return { scene: null, error: '请填写场景名称。' }

  const category = isDiscussionSceneCategory(input.category) ? input.category : 'general'
  const summary = normalizedText(input.summary, MAX_SUMMARY_LENGTH)
  if (!summary) return { scene: null, error: '请填写场景说明。' }

  const roles = normalizedList(input.roles)
  if (roles.length === 0) return { scene: null, error: '请至少填写一个讨论角色或视角。' }

  const agenda = normalizedList(input.agenda)
  if (agenda.length === 0) return { scene: null, error: '请至少填写一个讨论步骤。' }

  const deliverables = normalizedList(input.deliverables)
  if (deliverables.length === 0) return { scene: null, error: '请至少填写一个输出要求。' }

  return {
    scene: {
      id,
      name,
      category,
      summary,
      roles,
      agenda,
      deliverables,
      instructions: normalizedText(input.instructions, MAX_INSTRUCTIONS_LENGTH)
    },
    error: null
  }
}

export function parseDiscussionSceneLines(value: string): string[] {
  return normalizedList(value.split(/\r?\n/u))
}

export function discussionSceneLineInputError(value: string, label: string): string | null {
  const lines = value.split(/\r?\n/u)
    .map((item) => item.trim().replace(/\s+/gu, ' '))
    .filter(Boolean)
  if (lines.some((item) => Array.from(item).length > MAX_LIST_ITEM_LENGTH)) {
    return `${label}每行最多 ${MAX_LIST_ITEM_LENGTH} 个字符。`
  }
  if (new Set(lines).size > MAX_LIST_ITEMS) {
    return `${label}最多填写 ${MAX_LIST_ITEMS} 项。`
  }
  return null
}

export function loadCustomDiscussionScenes(
  storage: DiscussionSceneStorage | null = browserDiscussionSceneStorage()
): DiscussionSceneTemplate[] {
  return loadCustomDiscussionScenesResult(storage).scenes
}

export function loadCustomDiscussionScenesResult(
  storage: DiscussionSceneStorage | null = browserDiscussionSceneStorage()
): DiscussionSceneLoadResult {
  if (!storage) return { scenes: [], warning: null }
  let raw: string | null
  try {
    raw = storage.getItem(DISCUSSION_SCENES_STORAGE_KEY)
  } catch {
    return {
      scenes: [],
      warning: '无法读取本机自定义场景。为避免覆盖原数据，保存将保持防御性失败。'
    }
  }
  if (raw === null) return { scenes: [], warning: null }

  const parsed = parseStoredDiscussionScenes(raw)
  if (parsed.clean) return { scenes: parsed.scenes, warning: null }
  const recovered = preserveDiscussionSceneRecovery(raw, storage)
  return {
    scenes: parsed.scenes,
    warning: recovered
      ? parsed.readable
        ? '部分自定义场景数据无效，已保留原始恢复副本并加载可用项。'
        : '自定义场景数据损坏，已保留原始恢复副本；内置场景仍可用。'
      : '自定义场景数据损坏且无法保存恢复副本；后续保存将被阻止，以避免覆盖原数据。'
  }
}

export function saveCustomDiscussionScenes(
  scenes: readonly DiscussionSceneTemplate[],
  storage: DiscussionSceneStorage | null = browserDiscussionSceneStorage()
): boolean {
  if (!storage) return false
  const normalizedScenes = scenes.flatMap((candidate) => {
    const { scene } = normalizeDiscussionScene(candidate)
    return scene?.id.startsWith('custom:') ? [scene] : []
  }).slice(0, MAX_CUSTOM_DISCUSSION_SCENES)
  try {
    const currentRaw = storage.getItem(DISCUSSION_SCENES_STORAGE_KEY)
    if (currentRaw !== null) {
      const current = parseStoredDiscussionScenes(currentRaw)
      if (!current.clean && !preserveDiscussionSceneRecovery(currentRaw, storage)) return false
    }
    storage.setItem(DISCUSSION_SCENES_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      scenes: normalizedScenes
    }))
    return true
  } catch {
    return false
  }
}

function parseStoredDiscussionScenes(raw: string): {
  scenes: DiscussionSceneTemplate[]
  clean: boolean
  readable: boolean
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { scenes: [], clean: false, readable: false }
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.scenes)) {
    return { scenes: [], clean: false, readable: false }
  }

  const seen = new Set<string>()
  const scenes: DiscussionSceneTemplate[] = []
  let clean = true
  for (const candidate of parsed.scenes) {
    const { scene } = normalizeDiscussionScene(candidate)
    if (!scene || !scene.id.startsWith('custom:') || seen.has(scene.id)) {
      clean = false
      continue
    }
    if (scenes.length >= MAX_CUSTOM_DISCUSSION_SCENES) {
      clean = false
      continue
    }
    if (!storedDiscussionSceneMatchesNormalized(candidate, scene)) clean = false
    seen.add(scene.id)
    scenes.push(scene)
  }
  return { scenes, clean, readable: true }
}

function storedDiscussionSceneMatchesNormalized(
  candidate: unknown,
  normalized: DiscussionSceneTemplate
): boolean {
  if (!isRecord(candidate)) return false
  return candidate.id === normalized.id
    && candidate.name === normalized.name
    && candidate.category === normalized.category
    && candidate.summary === normalized.summary
    && stringArraysEqual(candidate.roles, normalized.roles)
    && stringArraysEqual(candidate.agenda, normalized.agenda)
    && stringArraysEqual(candidate.deliverables, normalized.deliverables)
    && candidate.instructions === normalized.instructions
}

function stringArraysEqual(candidate: unknown, expected: readonly string[]): boolean {
  return Array.isArray(candidate)
    && candidate.length === expected.length
    && candidate.every((item, index) => item === expected[index])
}

function preserveDiscussionSceneRecovery(
  raw: string,
  storage: DiscussionSceneStorage
): boolean {
  try {
    storage.setItem(DISCUSSION_SCENES_RECOVERY_KEY, raw)
    return true
  } catch {
    return false
  }
}

export function normalizeDiscussionSceneSquad(input: unknown): {
  squad: DiscussionSceneSquadPreset | null
  error: string | null
} {
  if (!isRecord(input)) return { squad: null, error: '预设小队数据格式无效。' }
  const sceneId = normalizedIdentifier(input.sceneId, 120)
  if (!sceneId || (!sceneId.startsWith('custom:') && !sceneId.startsWith('builtin:'))) {
    return { squad: null, error: '预设小队的场景标识无效。' }
  }
  if (!Array.isArray(input.memberAgentIds)) {
    return { squad: null, error: '请至少选择一位预设队员。' }
  }
  const memberAgentIds: string[] = []
  const seen = new Set<string>()
  for (const candidate of input.memberAgentIds) {
    const agentId = normalizedIdentifier(candidate, 200)
    if (!agentId || seen.has(agentId)) continue
    if (memberAgentIds.length >= MAX_DISCUSSION_SCENE_SQUAD_MEMBERS) {
      return {
        squad: null,
        error: `每个预设小队最多 ${MAX_DISCUSSION_SCENE_SQUAD_MEMBERS} 位队员。`
      }
    }
    seen.add(agentId)
    memberAgentIds.push(agentId)
  }
  if (memberAgentIds.length === 0) {
    return { squad: null, error: '请至少选择一位预设队员。' }
  }
  const defaultLeadAgentId = normalizedIdentifier(input.defaultLeadAgentId, 200)
  if (!defaultLeadAgentId || !memberAgentIds.includes(defaultLeadAgentId)) {
    return { squad: null, error: '预设负责人必须属于预设小队。' }
  }
  return {
    squad: { sceneId, memberAgentIds, defaultLeadAgentId },
    error: null
  }
}

export function discussionSceneSquadFor(
  sceneId: string,
  squads: readonly DiscussionSceneSquadPreset[]
): DiscussionSceneSquadPreset | null {
  return squads.find((squad) => squad.sceneId === sceneId) ?? null
}

export function planDiscussionSceneSquadSelection(
  squad: DiscussionSceneSquadPreset | null,
  availableAgentIds: readonly string[],
  fallback: { memberAgentIds: readonly string[]; defaultLeadAgentId: string }
): DiscussionSceneSquadSelectionPlan {
  const available = new Set(availableAgentIds)
  if (!squad) {
    return {
      memberAgentIds: [...fallback.memberAgentIds],
      defaultLeadAgentId: fallback.defaultLeadAgentId,
      missingAgentIds: [],
      appliedPreset: false
    }
  }
  const memberAgentIds = squad.memberAgentIds.filter((agentId) => available.has(agentId))
  const missingAgentIds = squad.memberAgentIds.filter((agentId) => !available.has(agentId))
  if (memberAgentIds.length === 0) {
    return {
      memberAgentIds: [...fallback.memberAgentIds],
      defaultLeadAgentId: fallback.defaultLeadAgentId,
      missingAgentIds,
      appliedPreset: false
    }
  }
  return {
    memberAgentIds,
    defaultLeadAgentId: memberAgentIds.includes(squad.defaultLeadAgentId)
      ? squad.defaultLeadAgentId
      : memberAgentIds[0],
    missingAgentIds,
    appliedPreset: true
  }
}

export function loadDiscussionSceneSquads(
  storage: DiscussionSceneStorage | null = browserDiscussionSceneStorage()
): DiscussionSceneSquadPreset[] {
  return loadDiscussionSceneSquadsResult(storage).squads
}

export function loadDiscussionSceneSquadsResult(
  storage: DiscussionSceneStorage | null = browserDiscussionSceneStorage()
): DiscussionSceneSquadLoadResult {
  if (!storage) return { squads: [], warning: null }
  let raw: string | null
  try {
    raw = storage.getItem(DISCUSSION_SCENE_SQUADS_STORAGE_KEY)
  } catch {
    return {
      squads: [],
      warning: '无法读取本机场景小队。为避免覆盖原数据，保存将保持防御性失败。'
    }
  }
  if (raw === null) return { squads: [], warning: null }

  const parsed = parseStoredDiscussionSceneSquads(raw)
  if (parsed.clean) return { squads: parsed.squads, warning: null }
  const recovered = preserveDiscussionSceneSquadRecovery(raw, storage)
  return {
    squads: parsed.squads,
    warning: recovered
      ? parsed.readable
        ? '部分场景小队数据无效，已保留原始恢复副本并加载可用项。'
        : '场景小队数据损坏，已保留原始恢复副本。'
      : '场景小队数据损坏且无法保存恢复副本；后续保存将被阻止，以避免覆盖原数据。'
  }
}

export function saveDiscussionSceneSquads(
  squads: readonly DiscussionSceneSquadPreset[],
  storage: DiscussionSceneStorage | null = browserDiscussionSceneStorage()
): boolean {
  if (!storage) return false
  const normalizedSquads: DiscussionSceneSquadPreset[] = []
  const seen = new Set<string>()
  for (const candidate of squads) {
    const { squad } = normalizeDiscussionSceneSquad(candidate)
    if (!squad || seen.has(squad.sceneId)) continue
    seen.add(squad.sceneId)
    normalizedSquads.push(squad)
    if (normalizedSquads.length >= MAX_DISCUSSION_SCENE_SQUADS) break
  }
  try {
    const currentRaw = storage.getItem(DISCUSSION_SCENE_SQUADS_STORAGE_KEY)
    if (currentRaw !== null) {
      const current = parseStoredDiscussionSceneSquads(currentRaw)
      if (!current.clean && !preserveDiscussionSceneSquadRecovery(currentRaw, storage)) return false
    }
    storage.setItem(DISCUSSION_SCENE_SQUADS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      squads: normalizedSquads
    }))
    return true
  } catch {
    return false
  }
}

function parseStoredDiscussionSceneSquads(raw: string): {
  squads: DiscussionSceneSquadPreset[]
  clean: boolean
  readable: boolean
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { squads: [], clean: false, readable: false }
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.squads)) {
    return { squads: [], clean: false, readable: false }
  }
  const squads: DiscussionSceneSquadPreset[] = []
  const seen = new Set<string>()
  let clean = true
  for (const candidate of parsed.squads) {
    const { squad } = normalizeDiscussionSceneSquad(candidate)
    if (!squad || seen.has(squad.sceneId)) {
      clean = false
      continue
    }
    if (squads.length >= MAX_DISCUSSION_SCENE_SQUADS) {
      clean = false
      continue
    }
    if (!storedDiscussionSceneSquadMatchesNormalized(candidate, squad)) clean = false
    seen.add(squad.sceneId)
    squads.push(squad)
  }
  return { squads, clean, readable: true }
}

function storedDiscussionSceneSquadMatchesNormalized(
  candidate: unknown,
  normalized: DiscussionSceneSquadPreset
): boolean {
  return isRecord(candidate)
    && candidate.sceneId === normalized.sceneId
    && candidate.defaultLeadAgentId === normalized.defaultLeadAgentId
    && stringArraysEqual(candidate.memberAgentIds, normalized.memberAgentIds)
}

function preserveDiscussionSceneSquadRecovery(
  raw: string,
  storage: DiscussionSceneStorage
): boolean {
  try {
    storage.setItem(DISCUSSION_SCENE_SQUADS_RECOVERY_KEY, raw)
    return true
  } catch {
    return false
  }
}

export function buildDiscussionSceneDraft(
  scene: DiscussionSceneTemplate,
  participants: readonly DiscussionSceneParticipant[],
  campfireSkill: DiscussionSceneSkillReference | null
): DiscussionSceneDraftResult {
  const prompt = discussionScenePrompt(scene, participants)
  const orchestration: DiscussionSceneOrchestration = participants.length < 2
    ? 'solo'
    : participants.length >= 3
        && participants.some((participant) => participant.isDefaultLead)
        && campfireSkill
      ? 'campfire'
      : 'guided'
  const content: StructuredCampMessageContent = orchestration === 'campfire' && campfireSkill
    ? [
        { kind: 'skill_mention', skillId: campfireSkill.id, nameAtSend: campfireSkill.name },
        { kind: 'text', text: ` ${prompt}` }
      ]
    : [{ kind: 'text', text: prompt }]
  return { content, orchestration }
}

export function discussionScenePrompt(
  scene: DiscussionSceneTemplate,
  participants: readonly DiscussionSceneParticipant[]
): string {
  const prompt = renderDiscussionScenePrompt(scene, participants, false, 0)
  if (utf8ByteLength(prompt) <= DISCUSSION_SCENE_DRAFT_TEXT_MAX_BYTES) return prompt

  const compactScene: DiscussionSceneTemplate = {
    ...scene,
    name: truncateUtf8(scene.name, 240),
    roles: compactPromptList(scene.roles, 8, 320),
    agenda: compactPromptList(scene.agenda, 8, 320),
    deliverables: compactPromptList(scene.deliverables, 8, 320),
    instructions: truncateUtf8(scene.instructions, 1_200)
  }
  const compactParticipants = participants.slice(0, 8).map((participant) => ({
    agentId: participant.agentId,
    displayName: truncateUtf8(participant.displayName, 240),
    teamRole: truncateUtf8(participant.teamRole, 320),
    isDefaultLead: participant.isDefaultLead
  }))
  const compactPrompt = renderDiscussionScenePrompt(
    compactScene,
    compactParticipants,
    true,
    Math.max(0, participants.length - compactParticipants.length)
  )
  if (utf8ByteLength(compactPrompt) <= DISCUSSION_SCENE_DRAFT_TEXT_MAX_BYTES) {
    return compactPrompt
  }

  const minimalScene: DiscussionSceneTemplate = {
    ...compactScene,
    roles: compactPromptList(compactScene.roles, 4, 160),
    agenda: compactPromptList(compactScene.agenda, 4, 160),
    deliverables: compactPromptList(compactScene.deliverables, 4, 160),
    instructions: ''
  }
  return truncateUtf8(renderDiscussionScenePrompt(
    minimalScene,
    compactParticipants.slice(0, 4),
    true,
    Math.max(0, participants.length - Math.min(participants.length, 4))
  ), DISCUSSION_SCENE_DRAFT_TEXT_MAX_BYTES)
}

function renderDiscussionScenePrompt(
  scene: DiscussionSceneTemplate,
  participants: readonly DiscussionSceneParticipant[],
  compacted: boolean,
  omittedParticipantCount: number
): string {
  const memberLines = participants.length > 0
    ? participants.map((participant) => {
        const leadLabel = participant.isDefaultLead ? '，草稿生成时的默认负责人' : ''
        const displayName = normalizedText(participant.displayName, 80) || '未命名队员'
        const teamRole = normalizedText(participant.teamRole, 120) || '队员'
        return `- ${displayName}｜${teamRole}${leadLabel}`
      })
    : ['- 当前没有可用队员']
  if (omittedParticipantCount > 0) {
    memberLines.push(`- 另有 ${omittedParticipantCount} 位队员未在精简草稿中展开`)
  }

  return [
    `请主持一场「${scene.name}」讨论。先确认讨论对象和材料，再组织分析并形成一份可执行纪要。`,
    ...(compacted
      ? ['', '> 场景内容较长，已按消息字节上限精简；完整模板仍保留在本机场景库。']
      : []),
    '',
    '## 本次输入（发送前请补充）',
    '- 讨论主题或对象：［请在这里补充］',
    '- 已有材料：［可粘贴摘要，或把 PRD、代码目录、架构文档、原型图拖入输入区］',
    '- 关键约束与成功标准：［请在这里补充］',
    '',
    '## 草稿生成时的队员（发送时以 Camp 最新配置为准）',
    ...memberLines,
    '',
    '## 本场需要覆盖的角色 / 视角',
    ...scene.roles.map((item) => `- ${item}`),
    '',
    '请按队员的长期角色和专业职责分工；一位队员可以覆盖多个视角。没有合适队员的视角要明确标为缺口，不要虚构参与者。',
    '',
    '## 讨论议程',
    ...scene.agenda.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 讨论规则',
    '- 严格区分已证实事实、基于证据的推断、待验证假设和当前未知。',
    '- 重要判断给出依据；材料不足时先提出关键问题，或在明确假设下继续。',
    '- 比较备选方案的适用场景、成本、资源、维护性和主要风险。',
    '- 不为制造讨论感强行设置反方；意见一致时也要说明覆盖范围和未验证项。',
    ...(scene.instructions ? [`- 场景补充要求：${scene.instructions}`] : []),
    '',
    '## 最终纪要必须包含',
    ...scene.deliverables.map((item) => `- ${item}`),
    '- 共识、分歧及其依据',
    '- 决策、后续动作、负责人建议和可验证验收点',
    '- 仍未知的信息与剩余风险'
  ].join('\n')
}

function compactPromptList(items: readonly string[], maxItems: number, maxBytes: number): string[] {
  return items.slice(0, maxItems).map((item) => truncateUtf8(item, maxBytes))
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value
  let output = ''
  let usedBytes = 0
  for (const character of value) {
    const characterBytes = utf8ByteLength(character)
    if (usedBytes + characterBytes > maxBytes) break
    output += character
    usedBytes += characterBytes
  }
  return output
}

function browserDiscussionSceneStorage(): DiscussionSceneStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function normalizedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return Array.from(value.trim().replace(/\s+/gu, ' ')).slice(0, maxLength).join('')
}

function normalizedIdentifier(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const normalized = Array.from(value.trim()).slice(0, maxLength).join('')
  return /\s/u.test(normalized) ? '' : normalized
}

function normalizedList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const candidate of value) {
    const item = normalizedText(candidate, MAX_LIST_ITEM_LENGTH)
    if (!item || seen.has(item)) continue
    seen.add(item)
    normalized.push(item)
    if (normalized.length >= MAX_LIST_ITEMS) break
  }
  return normalized
}

function isDiscussionSceneCategory(value: unknown): value is DiscussionSceneCategory {
  return value === 'algorithm'
    || value === 'product'
    || value === 'architecture'
    || value === 'design'
    || value === 'general'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
