import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CampSnapshot, TaskView } from '@contracts'
import { TaskBoard } from './TaskBoard'

const task: TaskView = {
  taskId: 'task-board-card',
  campId: 'camp-board',
  title: '融合任务板',
  description: '复用 Rust Core 与 Durable Task',
  acceptanceCriteria: ['保持唯一事实源'],
  priority: 'urgent',
  labels: ['Renderer', 'Core'],
  startDate: '2026-08-30',
  dueDate: '2026-09-02',
  boardOrder: 1024,
  status: 'in_progress',
  assigneeAgentId: 'agent-board',
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
  availableActions: ['update']
}

describe('TaskBoard', () => {
  it('renders Core-backed columns, metadata, and a keyboard move control', () => {
    const snapshot = {
      camp: { id: 'camp-board' },
      members: [{
        agentId: 'agent-board',
        displayName: '沐瓦',
        membershipStatus: 'active',
        leaveRequestedAt: null
      }],
      tasks: [task]
    } as unknown as CampSnapshot
    const markup = renderToStaticMarkup(createElement(TaskBoard, {
      snapshot,
      busy: false,
      onTasksChanged: async () => undefined,
      onOpenTask: () => undefined
    }))

    expect(markup).toContain('Camp Taskboard')
    expect(markup).toContain('进行中，1 项')
    expect(markup).toContain('融合任务板')
    expect(markup).toContain('紧急')
    expect(markup).toContain('Renderer')
    expect(markup).toContain('2026-09-02')
    expect(markup).toContain('移动“融合任务板”')
  })
})
