import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, CampOpenProjection, ProjectLogicDiagram, RuntimeReadinessStatus } from '@contracts'
import {
  appendGeneratedProjectLogicDiagram,
  ProjectLogicWorkspace,
  projectLogicAnalysisRuntimeFromAgents,
  projectLogicRuntimeStatusCanSync,
  projectLogicScanIdentity,
  recoverCompletedProjectLogicAnalyses,
  relationLabel
} from './ProjectLogicWorkspace'

describe('ProjectLogicWorkspace', () => {
  it('explains the local evidence boundary before a project is selected', () => {
    const markup = renderToStaticMarkup(createElement(ProjectLogicWorkspace, {
      project: null,
      onChooseProject: () => undefined
    }))
    expect(markup).toContain('选择一个项目，查看整体逻辑')
    expect(markup).toContain('不会上传项目文件')
    expect(markup).toContain('先在本机生成文件结构图')
    expect(markup).toContain('只有你提交具体目标后')
    expect(markup).toContain('选择项目目录')
  })

  it('uses stable localized relation labels', () => {
    expect(relationLabel('depends_on')).toBe('依赖')
    expect(relationLabel('imports')).toBe('导入')
    expect(relationLabel('contains')).toBe('包含')
    expect(relationLabel('flows_to')).toBe('下一步')
    expect(relationLabel('branches_to')).toBe('分支')
    expect(relationLabel('controls')).toBe('控制')
    expect(relationLabel('syncs')).toBe('同步')
    expect(relationLabel('authorizes')).toBe('授权')
    expect(relationLabel('records')).toBe('记录')
  })

  it('keeps the scan identity stable when the parent recreates an equivalent project value', () => {
    const firstRenderProject = { name: 'NueroLeap', projectPath: 'E:\\PersonalWorkSpace\\NueroLeap' }
    const nextRenderProject = { name: 'NueroLeap', projectPath: 'E:\\PersonalWorkSpace\\NueroLeap' }

    expect(firstRenderProject).not.toBe(nextRenderProject)
    expect(projectLogicScanIdentity(firstRenderProject)).toBe(projectLogicScanIdentity(nextRenderProject))
    expect(projectLogicScanIdentity({
      name: 'Other',
      projectPath: 'E:\\PersonalWorkSpace\\Other'
    })).not.toBe(projectLogicScanIdentity(firstRenderProject))
  })

  it('does not cancel an active analysis when navigation canonicalizes the same Windows project path', () => {
    const selectedPath = projectLogicScanIdentity({
      name: 'gyt',
      projectPath: 'E:\\WorkSpace\\gyt'
    })
    const navigationPath = projectLogicScanIdentity({
      name: 'gyt',
      projectPath: '\\\\?\\E:\\WorkSpace\\gyt\\'
    })
    expect(navigationPath).toBe(selectedPath)
    expect(projectLogicScanIdentity({
      name: 'gyt',
      projectPath: 'e:/workspace/GYT'
    })).toBe(selectedPath)
  })

  it('appends each completed analysis as a distinct graph while replacing only the same turn', () => {
    const first = generatedDiagram('ai-software-turn-1', '软件架构图')
    const second = generatedDiagram('ai-algorithm-turn-2', '算法架构图')
    const replacedFirst = generatedDiagram(first.id, '软件架构图（修正版）')

    expect(appendGeneratedProjectLogicDiagram([first], second).map((diagram) => diagram.id))
      .toEqual([first.id, second.id])
    expect(appendGeneratedProjectLogicDiagram([first, second], replacedFirst).map((diagram) => diagram.title))
      .toEqual(['算法架构图', '软件架构图（修正版）'])
  })

  it('recovers a validated graph from a completed local analysis Camp without rerunning Runtime', () => {
    const value = recoverableDiagram()
    const response = [
      '已检查论文与数据处理步骤。',
      '```rovai-project-logic',
      JSON.stringify({ schemaVersion: 1, diagram: value }),
      '```'
    ].join('\n')
    const projection = {
      camp: { id: 'camp-recovery' },
      turns: [{ id: 'turn-completed', status: 'completed' }, { id: 'turn-running', status: 'running' }],
      agentRuns: [{ campTurnId: 'turn-completed', purpose: '算法架构图：恢复滤波算法流程' }],
      messages: [
        {
          sequence: 1,
          authorType: 'agent',
          campTurnId: 'turn-running',
          body: response,
          createdAt: '2026-08-28T02:00:00Z'
        },
        {
          sequence: 2,
          authorType: 'agent',
          campTurnId: 'turn-completed',
          body: response,
          createdAt: '2026-08-28T02:10:00Z'
        }
      ]
    } as unknown as Pick<CampOpenProjection, 'camp' | 'turns' | 'messages' | 'agentRuns'>

    expect(recoverCompletedProjectLogicAnalyses(projection)).toMatchObject([{
      campId: 'camp-recovery',
      campTurnId: 'turn-completed',
      requestType: 'algorithm-architecture',
      diagram: {
        id: 'ai-algorithm-architecture-turn-completed',
        title: value.title
      }
    }])
  })

  it('chooses a ready project-analysis runtime and keeps all present members in its Camp', () => {
    const runtime = projectLogicAnalysisRuntimeFromAgents([
      agent('light', 0, 'light_ready'),
      agent('ready', 2, 'ready'),
      { ...agent('away', 1, 'ready'), presence: 'away' }
    ])

    expect(runtime).toEqual({
      agentId: 'ready',
      displayName: 'ready',
      memberAgentIds: ['light', 'ready']
    })
    expect(projectLogicAnalysisRuntimeFromAgents([
      agent('blocked', 0, 'needs_attention')
    ])).toBeNull()
  })

  it('does not let Runtime availability overwrite cache hydration or an active analysis state', () => {
    const ready = {
      snapshotReady: true,
      generationKey: 'project:fingerprint',
      hydratedGenerationKey: 'project:fingerprint',
      generationCacheHit: false,
      analysisRunning: false
    }
    expect(projectLogicRuntimeStatusCanSync(ready)).toBe(true)
    expect(projectLogicRuntimeStatusCanSync({ ...ready, hydratedGenerationKey: null })).toBe(false)
    expect(projectLogicRuntimeStatusCanSync({ ...ready, generationCacheHit: true })).toBe(false)
    expect(projectLogicRuntimeStatusCanSync({ ...ready, analysisRunning: true })).toBe(false)
  })
})

function agent(
  agentId: string,
  memberOrder: number,
  status: RuntimeReadinessStatus
): AgentProfile {
  return {
    agentId,
    displayName: agentId,
    avatarRef: null,
    accent: null,
    teamRole: '测试角色',
    professionalResponsibilities: '测试',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'present',
    memberOrder,
    runtimeConfiguration: null,
    runtimeReadiness: { status, blockers: [] },
    version: 1,
    createdAt: '2026-08-27T00:00:00Z',
    updatedAt: '2026-08-27T00:00:00Z',
    removedAt: null
  }
}

function generatedDiagram(id: string, title: string): ProjectLogicDiagram {
  return {
    id,
    title,
    description: '',
    nodes: [],
    edges: [],
    primaryPath: []
  }
}

function recoverableDiagram(): ProjectLogicDiagram {
  return {
    id: 'algorithm-architecture',
    title: '恢复的算法架构图',
    description: '从本地完成记录恢复。',
    nodes: [{
      id: 'filter',
      label: '滤波处理',
      kind: 'core',
      path: 'paper.pdf',
      summary: '处理输入信号。',
      language: null,
      fileCount: 1,
      entry: true,
      sources: [{ path: 'paper.pdf', line: null, reason: '事实：论文描述了滤波步骤。' }]
    }],
    edges: [],
    primaryPath: ['filter']
  }
}
