import { describe, expect, it } from 'vitest'
import type { TaskView } from '@contracts'
import {
  orderedTaskBoardColumn,
  taskBoardMatches,
  taskBoardMoveNeedsNote,
  taskBoardOrderForDrop
} from './task-board-model'

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: 'task-1',
    campId: 'camp-1',
    title: '实现任务板',
    description: '保留 Core 为唯一事实源',
    acceptanceCriteria: [],
    priority: 'high',
    labels: ['Renderer'],
    startDate: null,
    dueDate: null,
    boardOrder: 1024,
    status: 'pending',
    assigneeAgentId: 'agent-1',
    blockedReason: null,
    completionSummary: null,
    cancelReason: null,
    createdByType: 'user',
    createdById: 'local_user',
    sourceAgentRunId: null,
    closedByType: null,
    closedById: null,
    closedByAgentRunId: null,
    version: 1,
    createdAt: '2026-08-30T00:00:00Z',
    updatedAt: '2026-08-30T00:00:00Z',
    closedAt: null,
    availableActions: ['update'],
    ...overrides
  }
}

describe('task board model', () => {
  it('filters across title, labels, assignee, and priority', () => {
    const candidate = task()
    expect(taskBoardMatches(candidate, {
      query: 'renderer', assigneeAgentId: 'agent-1', priority: 'high'
    })).toBe(true)
    expect(taskBoardMatches(candidate, {
      query: 'core', assigneeAgentId: 'agent-2', priority: 'high'
    })).toBe(false)
  })

  it('orders a column by durable board order', () => {
    const tasks = [
      task({ taskId: 'later', boardOrder: 2048 }),
      task({ taskId: 'first', boardOrder: 1024 })
    ]
    expect(orderedTaskBoardColumn(tasks, 'pending', {
      query: '', assigneeAgentId: '', priority: 'all'
    }).map((candidate) => candidate.taskId)).toEqual(['first', 'later'])
  })

  it('allocates stable gaps at the start, middle, and end of a column', () => {
    const tasks = [
      task({ taskId: 'first', boardOrder: 1024 }),
      task({ taskId: 'second', boardOrder: 2048 })
    ]
    expect(taskBoardOrderForDrop(tasks, 'moving', 'pending', 'first')).toBe(0)
    expect(taskBoardOrderForDrop(tasks, 'moving', 'pending', 'second')).toBe(1536)
    expect(taskBoardOrderForDrop(tasks, 'moving', 'pending', null)).toBe(3072)
  })

  it('requires durable notes only for blocked and completed transitions', () => {
    expect(taskBoardMoveNeedsNote('blocked')).toBe('blockedReason')
    expect(taskBoardMoveNeedsNote('completed')).toBe('completionSummary')
    expect(taskBoardMoveNeedsNote('in_progress')).toBeNull()
  })
})
