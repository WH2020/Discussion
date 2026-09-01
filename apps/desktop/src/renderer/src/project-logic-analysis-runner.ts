import type {
  CampOpenProjection,
  CoreMethod,
  SendCampMessageResult,
  StoredCommandResult,
  WorkspaceSelection
} from '@contracts'

export type ProjectLogicCoreRequest = <T>(method: CoreMethod, params?: unknown) => Promise<T>

export type ProjectLogicAnalysisProgressStatus =
  | 'preparing'
  | 'queued'
  | 'running'
  | 'waiting_for_approval'

export interface ProjectLogicAnalysisProgress {
  status: ProjectLogicAnalysisProgressStatus
  campId: string | null
  campTurnId: string | null
  message: string
}

export interface RunProjectLogicAnalysisInput {
  project: WorkspaceSelection
  prompt: string
  purpose: string
  agentId: string
  memberAgentIds: readonly string[]
  existingCampId?: string | null
  onProgress?(progress: ProjectLogicAnalysisProgress): void
  onCampReady?(campId: string): void | Promise<void>
}

export type ProjectLogicAnalysisRunResult =
  | {
      status: 'completed'
      campId: string
      campTurnId: string
      responseBody: string
      projection: CampOpenProjection
    }
  | {
      status: 'needs_attention'
      campId: string
      campTurnId: string
      responseBody: string | null
      message: string
      projection: CampOpenProjection
    }
  | {
      status: 'failed'
      campId: string
      campTurnId: string
      responseBody: string | null
      message: string
      projection: CampOpenProjection
    }

export interface ProjectLogicAnalysisRunnerOptions {
  pollIntervalMs?: number
  /** 仅限制当前界面持续跟踪多久，不得改变或取消 Core 中的执行预算。 */
  watchTimeoutMs?: number
  /** 兼容旧测试与调用；等同于 watchTimeoutMs。 */
  timeoutMs?: number
  returnOnApproval?: boolean
  delay?(milliseconds: number): Promise<void>
  randomId?(): string
}

export class ProjectLogicAnalysisCommandError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly campId: string | null = null
  ) {
    super(message)
    this.name = 'ProjectLogicAnalysisCommandError'
  }
}

const DEFAULT_POLL_INTERVAL_MS = 2_000

export async function pauseProjectLogicAnalysis(
  request: ProjectLogicCoreRequest,
  campId: string,
  campTurnId: string,
  randomId: () => string = defaultRandomId
): Promise<'pause_requested' | 'already_settled'> {
  const projection = await request<CampOpenProjection>('camps.open', {
    traceId: randomId(),
    campId
  })
  const turn = projection.turns.find((candidate) => candidate.id === campTurnId)
  if (!turn) {
    throw new ProjectLogicAnalysisCommandError(
      '找不到当前分析轮次，无法安全暂停。',
      'analysis_turn_missing',
      campId
    )
  }
  if (!['running', 'waiting'].includes(turn.status)) return 'already_settled'
  const result = await request<StoredCommandResult>('campTurns.cancel', {
    commandId: randomId(),
    command: {
      campId,
      campTurnId,
      expectedVersion: turn.version
    }
  })
  if (result.status === 'rejected') {
    throw new ProjectLogicAnalysisCommandError(
      stringField(result.payload, 'message') ?? `暂停分析失败：${result.code}`,
      result.code,
      campId
    )
  }
  return 'pause_requested'
}

export async function runProjectLogicAnalysis(
  request: ProjectLogicCoreRequest,
  input: RunProjectLogicAnalysisInput,
  options: ProjectLogicAnalysisRunnerOptions = {}
): Promise<ProjectLogicAnalysisRunResult> {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('逻辑图分析请求不能为空。')
  if (!input.agentId.trim()) throw new Error('逻辑图分析缺少可用队员。')

  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  }))
  const randomId = options.randomId ?? defaultRandomId
  const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  const requestedWatchTimeoutMs = options.watchTimeoutMs ?? options.timeoutMs
  const watchTimeoutMs = requestedWatchTimeoutMs === undefined
    ? null
    : Math.max(pollIntervalMs, requestedWatchTimeoutMs)

  input.onProgress?.({
    status: 'preparing',
    campId: input.existingCampId ?? null,
    campTurnId: null,
    message: '正在准备项目深度分析…'
  })

  const campId = await ensureProjectLogicAnalysisCamp(request, input, randomId)
  await input.onCampReady?.(campId)

  const sendResult = await request<SendCampMessageResult>('userAutomation.camp.send', {
    commandId: randomId(),
    campId,
    agentId: input.agentId,
    body: prompt,
    execution: {
      taskId: null,
      purpose: input.purpose.trim() || '生成项目逻辑图',
      completionRole: 'required',
      budget: null
    }
  })
  if (sendResult.pendingExecution) {
    throw new ProjectLogicAnalysisCommandError(
      '分析请求尚未进入执行队列，请打开完整会话处理。',
      sendResult.pendingExecution.diagnosticCode ?? 'pending_execution',
      campId
    )
  }
  const commandResult = sendResult.commandResult
  if (!commandResult) {
    throw new ProjectLogicAnalysisCommandError('分析请求没有返回执行结果。', 'missing_command_result', campId)
  }
  if (commandResult.status === 'rejected') {
    throw new ProjectLogicAnalysisCommandError(
      projectLogicCommandFailureMessage(commandResult),
      commandResult.code,
      campId
    )
  }
  const campTurnId = stringField(commandResult.payload, 'campTurnId')
  if (!campTurnId) {
    throw new ProjectLogicAnalysisCommandError(
      '分析请求已发送，但没有返回可跟踪的分析轮次。',
      'missing_camp_turn_id',
      campId
    )
  }

  input.onProgress?.({
    status: 'queued',
    campId,
    campTurnId,
    message: '分析请求已发送，正在读取项目证据…'
  })

  const startedAt = Date.now()
  let terminalProjectionWithoutMessageCount = 0
  while (watchTimeoutMs === null || Date.now() - startedAt <= watchTimeoutMs) {
    const projection = await request<CampOpenProjection>('camps.open', {
      traceId: randomId(),
      campId
    })
    const turn = projection.turns.find((candidate) => candidate.id === campTurnId)
    const responseBody = latestAgentResponse(projection, campTurnId)

    if (!turn) {
      input.onProgress?.({
        status: 'queued',
        campId,
        campTurnId,
        message: '分析任务正在排队…'
      })
      await delay(pollIntervalMs)
      continue
    }

    const turnRuns = projection.agentRuns.filter((run) => run.campTurnId === campTurnId)
    const pendingApproval = projection.approvals.find((approval) => (
      approval.status === 'pending'
      && turnRuns.some((run) => run.id === approval.agentRunId)
    ))
    if (pendingApproval) {
      const message = `分析需要确认“${pendingApproval.actionSummary}”，请打开完整会话处理。`
      input.onProgress?.({
        status: 'waiting_for_approval',
        campId,
        campTurnId,
        message
      })
      if (options.returnOnApproval) {
        return {
          status: 'needs_attention',
          campId,
          campTurnId,
          responseBody,
          message,
          projection
        }
      }
      await delay(pollIntervalMs)
      continue
    }

    if (turn.status === 'completed' && responseBody) {
      return { status: 'completed', campId, campTurnId, responseBody, projection }
    }
    if (turn.status === 'failed' || turn.status === 'cancelled') {
      return {
        status: 'failed',
        campId,
        campTurnId,
        responseBody,
        message: projectLogicTerminalFailureMessage(turn, turnRuns),
        projection
      }
    }
    if (turn.status === 'completed') {
      terminalProjectionWithoutMessageCount += 1
      if (terminalProjectionWithoutMessageCount >= 2) {
        return {
          status: 'failed',
          campId,
          campTurnId,
          responseBody: null,
          message: '分析已结束，但没有收到可用于生成逻辑图的回复。',
          projection
        }
      }
    } else {
      terminalProjectionWithoutMessageCount = 0
    }

    input.onProgress?.({
      status: 'running',
      campId,
      campTurnId,
      message: turn.status === 'waiting'
        ? '正在等待分析运行时继续处理…'
        : '正在深读代码并组织逻辑图；不会因逻辑图界面计时而自动停止。'
    })
    await delay(pollIntervalMs)
  }

  throw new ProjectLogicAnalysisCommandError(
    '当前界面已停止持续跟踪，但后台深度分析没有被取消；可打开完整会话查看，完成后重新进入逻辑图会自动恢复结果。',
    'analysis_watch_timeout',
    campId
  )
}

function projectLogicTerminalFailureMessage(
  turn: CampOpenProjection['turns'][number],
  runs: CampOpenProjection['agentRuns']
): string {
  const failedRun = runs.find((run) => run.failure)
  if (failedRun?.failure?.summary) return failedRun.failure.summary
  const executionBudgetExhausted = turn.executionBudget.exhaustionReason === 'elapsed'
    || runs.some((run) => run.cancelReasonCode === 'execution_budget_exhausted')
  if (executionBudgetExhausted) {
    return `项目深度分析达到本轮 ${formatDuration(turn.executionBudget.elapsedSeconds)}执行时限，未能生成完整逻辑图。可缩小分析范围后重新提交。`
  }
  return turn.status === 'cancelled' ? '项目深度分析已取消。' : '项目深度分析执行失败。'
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(1, Math.ceil(totalSeconds))
  if (seconds % 3_600 === 0) return `${seconds / 3_600} 小时`
  if (seconds >= 3_600) {
    const hours = Math.floor(seconds / 3_600)
    const minutes = Math.ceil((seconds % 3_600) / 60)
    return `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}`
  }
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} 分钟`
  return `${seconds} 秒`
}

async function ensureProjectLogicAnalysisCamp(
  request: ProjectLogicCoreRequest,
  input: RunProjectLogicAnalysisInput,
  randomId: () => string
): Promise<string> {
  const existingCampId = input.existingCampId?.trim() || null
  if (existingCampId) {
    try {
      const exists = await request<boolean>('camps.exists', { campId: existingCampId })
      if (exists) {
        const projection = await request<CampOpenProjection>('camps.open', {
          traceId: randomId(),
          campId: existingCampId
        })
        const agentIsActive = projection.members.some((member) => (
          member.agentId === input.agentId
          && member.membershipStatus === 'active'
          && member.leaveRequestedAt === null
        ))
        if (sameProjectPath(projection.camp.projectPath, input.project.projectPath) && agentIsActive) {
          return existingCampId
        }
      }
    } catch {
      // A stale or unreadable cached Camp must never block creation of a fresh analysis Camp.
    }
  }

  const memberAgentIds = [...new Set([
    input.agentId,
    ...input.memberAgentIds.filter((agentId) => agentId.trim())
  ])]
  const result = await request<StoredCommandResult>('camps.create', {
    commandId: randomId(),
    name: boundedCampName(input.project.name),
    workspace: { projectPath: input.project.projectPath },
    memberAgentIds,
    defaultLeadAgentId: input.agentId,
    collaborationMode: 'peer',
    activationState: 'active'
  })
  if (result.status === 'rejected') {
    throw new ProjectLogicAnalysisCommandError(
      projectLogicCommandFailureMessage(result),
      result.code
    )
  }
  const campId = stringField(result.payload, 'campId')
  if (!campId) {
    throw new ProjectLogicAnalysisCommandError(
      '项目分析会话已创建，但没有返回会话标识。',
      'missing_camp_id'
    )
  }
  return campId
}

function latestAgentResponse(projection: CampOpenProjection, campTurnId: string): string | null {
  const response = projection.messages
    .filter((message) => (
      message.authorType === 'agent'
      && message.campTurnId === campTurnId
      && message.body.trim().length > 0
    ))
    .sort((left, right) => right.sequence - left.sequence)[0]
  return response?.body.trim() || null
}

function boundedCampName(projectName: string): string {
  const name = `项目逻辑分析 · ${projectName.trim() || '当前项目'}`
  return Array.from(name).slice(0, 80).join('')
}

function sameProjectPath(left: string, right: string): boolean {
  const normalize = (value: string): string => value
    .replace(/^\\\\\?\\/u, '')
    .replace(/[\\/]+$/u, '')
    .replace(/\\/gu, '/')
    .toLocaleLowerCase()
  return normalize(left) === normalize(right)
}

function projectLogicCommandFailureMessage(result: StoredCommandResult): string {
  if (result.code === 'agent_run.runtime_not_ready') {
    return '目标队员的 Agent 运行时暂不可用；静态逻辑图仍可继续使用。'
  }
  if (
    result.code === 'camp_message.no_addressable_member'
    || result.code === 'camp.default_lead_invariant'
    || result.code === 'camp.no_present_members'
  ) {
    return '当前没有可执行深度分析的队员。'
  }
  return stringField(result.payload, 'message') ?? `项目深度分析未能启动：${result.code}`
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function defaultRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `logic-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
