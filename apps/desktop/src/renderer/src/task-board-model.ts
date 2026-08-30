import type { TaskPriority, TaskStatus, TaskView } from '@contracts'

export const TASK_BOARD_STATUSES = [
  'pending',
  'in_progress',
  'blocked',
  'completed'
] as const satisfies readonly TaskStatus[]

export interface TaskBoardFilters {
  query: string
  assigneeAgentId: string
  priority: TaskPriority | 'all'
}

export function taskBoardStatusLabel(status: TaskStatus): string {
  if (status === 'in_progress') return '进行中'
  if (status === 'blocked') return '已阻塞'
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消'
  return '待处理'
}

export function taskPriorityLabel(priority: TaskPriority): string {
  if (priority === 'urgent') return '紧急'
  if (priority === 'high') return '高'
  if (priority === 'medium') return '中'
  if (priority === 'low') return '低'
  return '无优先级'
}

export function taskBoardMatches(task: TaskView, filters: TaskBoardFilters): boolean {
  if (filters.assigneeAgentId && task.assigneeAgentId !== filters.assigneeAgentId) return false
  if (filters.priority !== 'all' && task.priority !== filters.priority) return false
  const query = filters.query.trim().toLocaleLowerCase()
  if (!query) return true
  return [task.title, task.description, ...task.labels]
    .some((value) => value.toLocaleLowerCase().includes(query))
}

export function orderedTaskBoardColumn(
  tasks: readonly TaskView[],
  status: TaskStatus,
  filters: TaskBoardFilters
): TaskView[] {
  return tasks
    .filter((task) => task.status === status && taskBoardMatches(task, filters))
    .slice()
    .sort((left, right) => (
      left.boardOrder - right.boardOrder
      || left.createdAt.localeCompare(right.createdAt)
      || left.taskId.localeCompare(right.taskId)
    ))
}

export function taskBoardOrderForDrop(
  tasks: readonly TaskView[],
  movingTaskId: string,
  targetStatus: TaskStatus,
  beforeTaskId: string | null
): number {
  const ordered = tasks
    .filter((task) => task.taskId !== movingTaskId && task.status === targetStatus)
    .slice()
    .sort((left, right) => left.boardOrder - right.boardOrder || left.taskId.localeCompare(right.taskId))
  if (ordered.length === 0) return 1024
  if (!beforeTaskId) return ordered[ordered.length - 1].boardOrder + 1024
  const nextIndex = ordered.findIndex((task) => task.taskId === beforeTaskId)
  if (nextIndex < 0) return ordered[ordered.length - 1].boardOrder + 1024
  const nextOrder = ordered[nextIndex].boardOrder
  if (nextIndex === 0) return nextOrder - 1024
  const previousOrder = ordered[nextIndex - 1].boardOrder
  const gap = nextOrder - previousOrder
  return gap > 1 ? previousOrder + Math.floor(gap / 2) : previousOrder
}

export function taskBoardMoveNeedsNote(status: TaskStatus): 'blockedReason' | 'completionSummary' | null {
  if (status === 'blocked') return 'blockedReason'
  if (status === 'completed') return 'completionSummary'
  return null
}
