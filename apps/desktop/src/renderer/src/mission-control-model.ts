import type {
  AgentProfile,
  NavigationCampItem,
  TaskListItem,
  TaskPriority,
  TaskStatus
} from '@contracts'

export const MISSION_CONTROL_STATUSES = [
  'pending',
  'in_progress',
  'blocked',
  'completed'
] as const satisfies readonly TaskStatus[]

export type MissionControlScope = {
  key: string
  name: string
  projectPath: string | null
  camps: NavigationCampItem[]
}

export type MissionControlTask = TaskListItem & {
  camp: NavigationCampItem
  scopeKey: string
  scopeName: string
}

export type MissionControlFilters = {
  scopeKey: string
  query: string
  priority: TaskPriority | 'all'
  assigneeAgentId: string
}

export function missionControlStatusLabel(status: TaskStatus): string {
  if (status === 'in_progress') return '进行中'
  if (status === 'blocked') return '已阻塞'
  if (status === 'completed') return '已交付'
  if (status === 'cancelled') return '已取消'
  return '待处理'
}

export function missionControlPriorityLabel(priority: TaskPriority): string {
  if (priority === 'urgent') return '紧急'
  if (priority === 'high') return '高'
  if (priority === 'medium') return '中'
  if (priority === 'low') return '低'
  return '普通'
}

export function missionControlFilterTasks(
  tasks: readonly MissionControlTask[],
  filters: MissionControlFilters
): MissionControlTask[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return tasks
    .filter((task) => task.status !== 'cancelled')
    .filter((task) => filters.scopeKey === 'all' || task.scopeKey === filters.scopeKey)
    .filter((task) => filters.priority === 'all' || task.priority === filters.priority)
    .filter((task) => !filters.assigneeAgentId || task.assigneeAgentId === filters.assigneeAgentId)
    .filter((task) => !query || [task.title, task.camp.title, task.scopeName, ...task.labels]
      .some((value) => value.toLocaleLowerCase().includes(query)))
    .slice()
    .sort((left, right) => (
      priorityRank(left.priority) - priorityRank(right.priority)
      || left.boardOrder - right.boardOrder
      || right.camp.lastActivityGlobalSequence - left.camp.lastActivityGlobalSequence
      || left.taskId.localeCompare(right.taskId)
    ))
}

export function missionControlColumn(
  tasks: readonly MissionControlTask[],
  status: TaskStatus
): MissionControlTask[] {
  return tasks.filter((task) => task.status === status)
}

export function missionControlMetrics(tasks: readonly MissionControlTask[]): {
  active: number
  blocked: number
  delivered: number
  unassigned: number
  completionRate: number
} {
  const current = tasks.filter((task) => task.status !== 'cancelled')
  const delivered = current.filter((task) => task.status === 'completed').length
  return {
    active: current.filter((task) => task.status === 'in_progress').length,
    blocked: current.filter((task) => task.status === 'blocked').length,
    delivered,
    unassigned: current.filter((task) => task.status !== 'completed' && !task.assigneeAgentId).length,
    completionRate: current.length === 0 ? 0 : Math.round(delivered / current.length * 100)
  }
}

export function missionControlRuntimeMetrics(agents: readonly AgentProfile[]): {
  ready: number
  attention: number
  present: number
} {
  const available = agents.filter((agent) => agent.presence !== 'removed' && agent.removedAt === null)
  return {
    ready: available.filter((agent) => agent.runtimeReadiness.status === 'ready').length,
    attention: available.filter((agent) => agent.runtimeReadiness.status !== 'ready').length,
    present: available.filter((agent) => agent.presence === 'present').length
  }
}

export function missionControlAssigneeName(
  task: Pick<TaskListItem, 'assigneeAgentId'>,
  agents: readonly AgentProfile[]
): string {
  if (!task.assigneeAgentId) return '未分配'
  return agents.find((agent) => agent.agentId === task.assigneeAgentId)?.displayName ?? '队员不可用'
}

export function missionControlNeedsReview(task: Pick<TaskListItem, 'status'>): boolean {
  return task.status === 'completed'
}

function priorityRank(priority: TaskPriority): number {
  if (priority === 'urgent') return 0
  if (priority === 'high') return 1
  if (priority === 'medium') return 2
  if (priority === 'low') return 3
  return 4
}
