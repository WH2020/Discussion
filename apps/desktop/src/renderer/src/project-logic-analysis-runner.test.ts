import { describe, expect, it, vi } from 'vitest'
import type {
  CampOpenProjection,
  CoreMethod,
  SendCampMessageResult,
  StoredCommandResult
} from '@contracts'
import {
  pauseProjectLogicAnalysis,
  ProjectLogicAnalysisCommandError,
  runProjectLogicAnalysis,
  type ProjectLogicCoreRequest
} from './project-logic-analysis-runner'

describe('project logic analysis runner', () => {
  it('pauses the tracked turn with its authoritative version without creating a second run', async () => {
    const calls: Array<{ method: CoreMethod; params: unknown }> = []
    const request = async <T>(method: CoreMethod, params?: unknown): Promise<T> => {
      calls.push({ method, params })
      if (method === 'camps.open') {
        return projection({
          campId: 'camp-pause',
          turnId: 'turn-pause',
          turnStatus: 'running',
          responseBody: null
        }) as T
      }
      if (method === 'campTurns.cancel') return appliedCommand({}) as T
      throw new Error(`unexpected ${method}`)
    }

    await expect(pauseProjectLogicAnalysis(
      request as ProjectLogicCoreRequest,
      'camp-pause',
      'turn-pause',
      sequenceId()
    )).resolves.toBe('pause_requested')
    expect(calls.find((call) => call.method === 'campTurns.cancel')?.params).toMatchObject({
      command: {
        campId: 'camp-pause',
        campTurnId: 'turn-pause',
        expectedVersion: 1
      }
    })
    expect(calls.map((call) => call.method)).not.toContain('userAutomation.camp.send')
  })

  it('continues a paused analysis in the same project Camp instead of creating a replacement Camp', async () => {
    const calls: Array<{ method: CoreMethod; params: unknown }> = []
    let pauseAccepted = false
    let resumedOpenCount = 0
    const request = async <T>(method: CoreMethod, params?: unknown): Promise<T> => {
      calls.push({ method, params })
      if (method === 'camps.exists') return true as T
      if (method === 'campTurns.cancel') {
        pauseAccepted = true
        return appliedCommand({}) as T
      }
      if (method === 'userAutomation.camp.send') return sendResult('turn-resumed') as T
      if (method === 'camps.open') {
        if (!pauseAccepted) {
          return projection({
            campId: 'camp-continuation',
            turnId: 'turn-paused',
            turnStatus: 'running',
            responseBody: null
          }) as T
        }
        resumedOpenCount += 1
        return projection({
          campId: 'camp-continuation',
          turnId: resumedOpenCount === 1 ? 'turn-paused' : 'turn-resumed',
          turnStatus: resumedOpenCount === 1 ? 'cancelled' : 'completed',
          responseBody: resumedOpenCount === 1 ? null : 'continued result'
        }) as T
      }
      throw new Error(`unexpected ${method}`)
    }

    await pauseProjectLogicAnalysis(
      request as ProjectLogicCoreRequest,
      'camp-continuation',
      'turn-paused',
      sequenceId()
    )
    const result = await runProjectLogicAnalysis(request as ProjectLogicCoreRequest, {
      project: { name: 'Agent4Market', projectPath: 'E:\\Agent4Market' },
      prompt: '按修改后的目标继续分析算法',
      purpose: '算法架构图：修改后的目标',
      agentId: 'agent-ready',
      memberAgentIds: ['agent-ready'],
      existingCampId: 'camp-continuation'
    }, {
      delay: async () => undefined,
      randomId: sequenceId(),
      pollIntervalMs: 50,
      timeoutMs: 1_000
    })

    expect(result).toMatchObject({
      status: 'completed',
      campId: 'camp-continuation',
      campTurnId: 'turn-resumed',
      responseBody: 'continued result'
    })
    expect(calls.map((call) => call.method)).not.toContain('camps.create')
    expect(calls.find((call) => call.method === 'userAutomation.camp.send')?.params)
      .toMatchObject({ campId: 'camp-continuation' })
  })

  it('creates one active project Camp, targets the ready agent, and returns the matching turn response', async () => {
    const calls: Array<{ method: CoreMethod; params: unknown }> = []
    let openCount = 0
    const request = async <T>(method: CoreMethod, params?: unknown): Promise<T> => {
      calls.push({ method, params })
      if (method === 'camps.create') return appliedCommand({ campId: 'camp-logic' }) as T
      if (method === 'userAutomation.camp.send') return sendResult('turn-1') as T
      if (method === 'camps.open') {
        openCount += 1
        return projection({
          campId: 'camp-logic',
          turnId: 'turn-1',
          turnStatus: openCount === 1 ? 'running' : 'completed',
          responseBody: openCount === 1 ? null : '```rovai-project-logic\n{}\n```'
        }) as T
      }
      throw new Error(`unexpected ${method}`)
    }
    const progress = vi.fn()
    const campReady = vi.fn()

    const result = await runProjectLogicAnalysis(request as ProjectLogicCoreRequest, {
      project: { name: 'Agent4Market', projectPath: 'E:\\Agent4Market' },
      prompt: '分析软件架构',
      purpose: '生成软件架构图',
      agentId: 'agent-ready',
      memberAgentIds: ['agent-ready', 'agent-second'],
      onProgress: progress,
      onCampReady: campReady
    }, {
      delay: async () => undefined,
      randomId: sequenceId(),
      pollIntervalMs: 50,
      timeoutMs: 1_000
    })

    expect(result).toMatchObject({
      status: 'completed',
      campId: 'camp-logic',
      campTurnId: 'turn-1',
      responseBody: '```rovai-project-logic\n{}\n```'
    })
    expect(campReady).toHaveBeenCalledWith('camp-logic')
    expect(calls.find((call) => call.method === 'camps.create')?.params).toMatchObject({
      workspace: { projectPath: 'E:\\Agent4Market' },
      memberAgentIds: ['agent-ready', 'agent-second'],
      defaultLeadAgentId: 'agent-ready',
      activationState: 'active'
    })
    expect(calls.find((call) => call.method === 'userAutomation.camp.send')?.params).toMatchObject({
      campId: 'camp-logic',
      agentId: 'agent-ready',
      body: '分析软件架构',
      execution: {
        budget: null
      }
    })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }))
  })

  it('reuses a matching cached Camp that still contains the target agent', async () => {
    const methods: CoreMethod[] = []
    const request = async <T>(method: CoreMethod): Promise<T> => {
      methods.push(method)
      if (method === 'camps.exists') return true as T
      if (method === 'camps.open') {
        return projection({
          campId: 'camp-cached',
          turnId: methods.filter((value) => value === 'camps.open').length > 1 ? 'turn-2' : null,
          turnStatus: 'completed',
          responseBody: methods.filter((value) => value === 'camps.open').length > 1 ? 'result' : null
        }) as T
      }
      if (method === 'userAutomation.camp.send') return sendResult('turn-2') as T
      throw new Error(`unexpected ${method}`)
    }

    const result = await runProjectLogicAnalysis(request as ProjectLogicCoreRequest, {
      project: { name: 'Demo', projectPath: 'E:\\Agent4Market\\' },
      prompt: '分析算法',
      purpose: '生成算法图',
      agentId: 'agent-ready',
      memberAgentIds: ['agent-ready'],
      existingCampId: 'camp-cached'
    }, {
      delay: async () => undefined,
      randomId: sequenceId(),
      pollIntervalMs: 50,
      timeoutMs: 1_000
    })

    expect(result.status).toBe('completed')
    expect(methods).not.toContain('camps.create')
  })

  it('returns a visible handoff when the matching run needs approval', async () => {
    const request = async <T>(method: CoreMethod): Promise<T> => {
      if (method === 'camps.create') return appliedCommand({ campId: 'camp-logic' }) as T
      if (method === 'userAutomation.camp.send') return sendResult('turn-approval') as T
      if (method === 'camps.open') {
        return projection({
          campId: 'camp-logic',
          turnId: 'turn-approval',
          turnStatus: 'waiting',
          responseBody: null,
          pendingApproval: true
        }) as T
      }
      throw new Error(`unexpected ${method}`)
    }

    const result = await runProjectLogicAnalysis(request as ProjectLogicCoreRequest, {
      project: { name: 'Demo', projectPath: 'E:\\Demo' },
      prompt: '分析软件架构',
      purpose: '生成架构图',
      agentId: 'agent-ready',
      memberAgentIds: ['agent-ready']
    }, { randomId: sequenceId(), returnOnApproval: true })

    expect(result).toMatchObject({
      status: 'needs_attention',
      campId: 'camp-logic',
      message: expect.stringContaining('请打开完整会话')
    })
  })

  it('keeps following the turn after an approval is resolved', async () => {
    let openCount = 0
    const progress = vi.fn()
    const request = async <T>(method: CoreMethod): Promise<T> => {
      if (method === 'camps.create') return appliedCommand({ campId: 'camp-logic' }) as T
      if (method === 'userAutomation.camp.send') return sendResult('turn-approval') as T
      if (method === 'camps.open') {
        openCount += 1
        return projection({
          campId: 'camp-logic',
          turnId: 'turn-approval',
          turnStatus: openCount === 1 ? 'waiting' : 'completed',
          responseBody: openCount === 1 ? null : 'validated graph',
          pendingApproval: openCount === 1
        }) as T
      }
      throw new Error(`unexpected ${method}`)
    }

    const result = await runProjectLogicAnalysis(request as ProjectLogicCoreRequest, {
      project: { name: 'Demo', projectPath: 'E:\\Demo' },
      prompt: '分析软件架构',
      purpose: '生成架构图',
      agentId: 'agent-ready',
      memberAgentIds: ['agent-ready'],
      onProgress: progress
    }, {
      randomId: sequenceId(),
      delay: async () => undefined,
      pollIntervalMs: 50,
      timeoutMs: 1_000
    })

    expect(result).toMatchObject({ status: 'completed', responseBody: 'validated graph' })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ status: 'waiting_for_approval' }))
  })

  it('does not add or cancel a Core execution limit when UI tracking times out', async () => {
    const calls: Array<{ method: CoreMethod; params: unknown }> = []
    const request = async <T>(method: CoreMethod, params?: unknown): Promise<T> => {
      calls.push({ method, params })
      if (method === 'camps.create') return appliedCommand({ campId: 'camp-long-analysis' }) as T
      if (method === 'userAutomation.camp.send') return sendResult('turn-long-analysis') as T
      if (method === 'camps.open') {
        return projection({
          campId: 'camp-long-analysis',
          turnId: 'turn-long-analysis',
          turnStatus: 'running',
          responseBody: null
        }) as T
      }
      throw new Error(`unexpected ${method}`)
    }
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(1_100)

    try {
      await expect(runProjectLogicAnalysis(request as ProjectLogicCoreRequest, {
        project: { name: 'Large Algorithm', projectPath: 'E:\\LargeAlgorithm' },
        prompt: '深度分析算法架构',
        purpose: '生成算法架构图',
        agentId: 'agent-ready',
        memberAgentIds: ['agent-ready']
      }, {
        delay: async () => undefined,
        randomId: sequenceId(),
        pollIntervalMs: 50,
        watchTimeoutMs: 1_000
      })).rejects.toMatchObject({
        code: 'analysis_watch_timeout',
        message: expect.stringContaining('后台深度分析没有被取消')
      } satisfies Partial<ProjectLogicAnalysisCommandError>)
    } finally {
      now.mockRestore()
    }

    expect(calls.find((call) => call.method === 'userAutomation.camp.send')?.params).toMatchObject({
      execution: { budget: null }
    })
    expect(calls.map((call) => call.method)).not.toContain('agentRuns.cancel')
    expect(calls.map((call) => call.method)).not.toContain('campTurns.cancel')
  })

  it('explains an execution-budget cancellation instead of reporting an unknown failure', async () => {
    const request = async <T>(method: CoreMethod): Promise<T> => {
      if (method === 'camps.create') return appliedCommand({ campId: 'camp-expired' }) as T
      if (method === 'userAutomation.camp.send') return sendResult('turn-expired') as T
      if (method === 'camps.open') {
        return projection({
          campId: 'camp-expired',
          turnId: 'turn-expired',
          turnStatus: 'failed',
          responseBody: null,
          executionBudgetSeconds: 900,
          executionBudgetExhausted: true,
          runStatus: 'cancelled',
          runCancelReasonCode: 'execution_budget_exhausted'
        }) as T
      }
      throw new Error(`unexpected ${method}`)
    }

    const result = await runProjectLogicAnalysis(request as ProjectLogicCoreRequest, {
      project: { name: 'Demo', projectPath: 'E:\\Demo' },
      prompt: '分析算法',
      purpose: '生成算法架构图',
      agentId: 'agent-ready',
      memberAgentIds: ['agent-ready']
    }, { randomId: sequenceId() })

    expect(result).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('15 分钟执行时限')
    })
  })

  it('surfaces runtime rejection without hiding the static map', async () => {
    const request = async <T>(method: CoreMethod): Promise<T> => {
      if (method === 'camps.create') return appliedCommand({ campId: 'camp-logic' }) as T
      if (method === 'userAutomation.camp.send') {
        return {
          commandResult: rejectedCommand('agent_run.runtime_not_ready'),
          replayed: false,
          preflight: null,
          pendingExecution: null
        } satisfies SendCampMessageResult as T
      }
      throw new Error(`unexpected ${method}`)
    }

    await expect(runProjectLogicAnalysis(request as ProjectLogicCoreRequest, {
      project: { name: 'Demo', projectPath: 'E:\\Demo' },
      prompt: '分析软件架构',
      purpose: '生成架构图',
      agentId: 'agent-ready',
      memberAgentIds: ['agent-ready']
    }, { randomId: sequenceId() })).rejects.toMatchObject({
      code: 'agent_run.runtime_not_ready',
      campId: 'camp-logic'
    } satisfies Partial<ProjectLogicAnalysisCommandError>)
  })
})

function appliedCommand(payload: Record<string, unknown>): StoredCommandResult {
  return {
    commandId: 'command',
    commandType: 'test',
    requestDigest: 'digest',
    requestDigestVersion: 1,
    status: 'applied',
    code: 'ok',
    payload,
    resultEntity: null,
    recordedAt: '2026-08-27T00:00:00Z'
  }
}

function rejectedCommand(code: string): StoredCommandResult {
  return { ...appliedCommand({}), status: 'rejected', code }
}

function sendResult(turnId: string): SendCampMessageResult {
  return {
    commandResult: appliedCommand({ campTurnId: turnId, campMessageId: 'message-user' }),
    replayed: false,
    preflight: null,
    pendingExecution: null
  }
}

function projection(input: {
  campId: string
  turnId: string | null
  turnStatus: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  responseBody: string | null
  pendingApproval?: boolean
  executionBudgetSeconds?: number
  executionBudgetExhausted?: boolean
  runStatus?: CampOpenProjection['agentRuns'][number]['status']
  runCancelReasonCode?: CampOpenProjection['agentRuns'][number]['cancelReasonCode']
}): CampOpenProjection {
  const executionBudgetSeconds = input.executionBudgetSeconds ?? 900
  const turnTerminal = ['completed', 'failed', 'cancelled'].includes(input.turnStatus)
  const turn = input.turnId
    ? [{
        id: input.turnId,
        triggerType: 'camp_message' as const,
        triggerId: 'message-user',
        status: input.turnStatus,
        cancelRequestedAt: null,
        aggregateReasonCode: null,
        executionBudget: {
          schemaVersion: 1 as const,
          acceptedAt: '2026-08-27T00:00:00Z',
          deadlineAt: '2026-08-27T00:15:00Z',
          elapsedSeconds: executionBudgetSeconds,
          maxAgentRunResponsibilities: 1,
          maxAcceptedA2a: 0,
          allocatedAgentRunResponsibilities: 1,
          acceptedA2a: 0,
          exhaustedAt: input.executionBudgetExhausted ? '2026-08-27T00:15:00Z' : null,
          exhaustionReason: input.executionBudgetExhausted ? 'elapsed' as const : null,
          exhaustionCommandId: input.executionBudgetExhausted ? 'command-exhausted' : null
        },
        version: 1,
        createdAt: '2026-08-27T00:00:00Z',
        updatedAt: '2026-08-27T00:00:01Z',
        endedAt: turnTerminal ? '2026-08-27T00:15:00Z' : null
      }]
    : []
  return {
    schemaVersion: 3,
    throughGlobalSequence: 2,
    camp: {
      id: input.campId,
      title: '项目逻辑分析',
      activationState: 'active',
      projectBindingKind: 'directory',
      projectPath: 'E:\\Agent4Market',
      defaultLeadAgentId: 'agent-ready',
      version: 1,
      createdAt: '2026-08-27T00:00:00Z',
      updatedAt: '2026-08-27T00:00:00Z'
    },
    members: [{
      agentId: 'agent-ready',
      displayName: 'Architect',
      avatarRef: null,
      teamRole: '架构师',
      accent: '#58a6ff',
      membershipStatus: 'active',
      leaveRequestedAt: null,
      profilePresence: 'present',
      memberOrder: 0,
      isDefaultLead: true,
      version: 1
    }],
    tasks: [],
    messages: input.responseBody && input.turnId
      ? [{
          id: 'message-agent',
          sequence: 2,
          timelineGlobalSequence: 2,
          authorType: 'agent',
          authorId: 'agent-ready',
          sourceAgentRunId: 'run-1',
          body: input.responseBody,
          content: [{ kind: 'text', text: input.responseBody }],
          attachments: [],
          addressMode: 'default',
          addressedAgentIds: [],
          replyToCampMessageId: null,
          campTurnId: input.turnId,
          presentation: null,
          createdAt: '2026-08-27T00:00:01Z'
        }]
      : [],
    messageDeliveries: [],
    turns: turn,
    agentRuns: input.turnId
      ? [{
          id: 'run-1',
          campTurnId: input.turnId,
          status: input.runStatus ?? 'running',
          cancelReasonCode: input.runCancelReasonCode ?? null,
          failure: null
        } as CampOpenProjection['agentRuns'][number]]
      : [],
    executionEvidence: [],
    approvals: input.pendingApproval
      ? [{
          id: 'approval-1',
          agentRunId: 'run-1',
          actionSummary: '读取受限文件',
          status: 'pending'
        } as CampOpenProjection['approvals'][number]]
      : [],
    timeline: [],
    coverage: {
      tasks: coverage(),
      messages: { ...coverage(), oldestLoadedSequence: null, newestLoadedSequence: null, hasEarlier: false },
      messageDeliveries: coverage(),
      turns: coverage(),
      agentRuns: coverage(),
      executionEvidence: coverage(),
      approvals: coverage(),
      timeline: coverage()
    }
  }
}

function coverage() {
  return { loadedCount: 0, totalCount: 0, omittedCount: 0, complete: true }
}

function sequenceId(): () => string {
  let value = 0
  return () => `id-${++value}`
}
