import { describe, expect, it } from 'vitest'
import type { AgentProfile, NavigationCampItem, TaskListItem } from '@contracts'
import {
  missionControlFilterTasks,
  missionControlMetrics,
  missionControlNeedsReview,
  missionControlRuntimeMetrics,
  type MissionControlTask
} from './mission-control-model'

describe('mission control model', () => {
  it('filters across project scope, owner and search while hiding cancelled work', () => {
    const tasks = [
      task('urgent-task', 'in_progress', 'urgent', 'project-a', 'agent-a', ['release']),
      task('other-task', 'pending', 'low', 'project-b', null, ['docs']),
      task('cancelled-task', 'cancelled', 'high', 'project-a', 'agent-a', ['release'])
    ]
    const filtered = missionControlFilterTasks(tasks, {
      scopeKey: 'project-a',
      query: 'release',
      priority: 'all',
      assigneeAgentId: 'agent-a'
    })
    expect(filtered.map((entry) => entry.taskId)).toEqual(['urgent-task'])
  })

  it('summarizes delivery, blockers and missing ownership', () => {
    const tasks = [
      task('active', 'in_progress', 'high', 'project-a', 'agent-a'),
      task('blocked', 'blocked', 'urgent', 'project-a', 'agent-a'),
      task('backlog', 'pending', 'medium', 'project-a', null),
      task('done', 'completed', 'low', 'project-a', 'agent-a')
    ]
    expect(missionControlMetrics(tasks)).toEqual({
      active: 1,
      blocked: 1,
      delivered: 1,
      unassigned: 1,
      completionRate: 25
    })
    expect(missionControlNeedsReview(tasks[3])).toBe(true)
  })

  it('uses actual runtime readiness instead of installation presence', () => {
    const ready = agent('ready', 'ready')
    const attention = agent('attention', 'needs_attention')
    expect(missionControlRuntimeMetrics([ready, attention])).toEqual({
      ready: 1,
      attention: 1,
      present: 2
    })
  })
})

function task(
  taskId: string,
  status: TaskListItem['status'],
  priority: TaskListItem['priority'],
  scopeKey: string,
  assigneeAgentId: string | null,
  labels: string[] = []
): MissionControlTask {
  return {
    taskId,
    title: taskId,
    status,
    priority,
    assigneeAgentId,
    labels,
    startDate: null,
    dueDate: null,
    boardOrder: 1024,
    availableActions: ['update'],
    camp: camp(),
    scopeKey,
    scopeName: scopeKey
  }
}

function camp(): NavigationCampItem {
  return {
    id: 'camp-a',
    title: '发布讨论',
    activationState: 'active',
    projectBindingKind: 'directory',
    projectPath: 'D:/project-a',
    defaultLead: { agentId: 'agent-a', displayName: 'Lead' },
    marker: 'none',
    lastActivityAt: '2026-08-30T00:00:00.000Z',
    lastActivityGlobalSequence: 20,
    latestCompletionGlobalSequence: 0,
    version: 1
  }
}

function agent(agentId: string, status: AgentProfile['runtimeReadiness']['status']): AgentProfile {
  return {
    agentId,
    displayName: agentId,
    avatarRef: null,
    accent: null,
    teamRole: '执行者',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'present',
    runtimeConfiguration: null,
    runtimeReadiness: { status, blockers: [] },
    memberOrder: 1,
    version: 1,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    removedAt: null
  }
}
