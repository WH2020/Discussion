import { useMemo, useState, type DragEvent, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { CampSnapshot, StoredCommandResult, TaskPriority, TaskStatus, TaskView } from '@contracts'
import { localizeExecutionEngineTerms } from './product-copy'
import {
  TASK_BOARD_STATUSES,
  orderedTaskBoardColumn,
  taskBoardMatches,
  taskBoardMoveNeedsNote,
  taskBoardOrderForDrop,
  taskBoardStatusLabel,
  taskPriorityLabel,
  type TaskBoardFilters
} from './task-board-model'

interface PendingTaskMove {
  task: TaskView
  targetStatus: TaskStatus
  beforeTaskId: string | null
}

export function TaskBoard({
  snapshot,
  busy,
  onTasksChanged,
  onOpenTask
}: {
  snapshot: CampSnapshot
  busy: boolean
  onTasksChanged(): Promise<void>
  onOpenTask(task: TaskView): void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [assigneeAgentId, setAssigneeAgentId] = useState('')
  const [priority, setPriority] = useState<TaskPriority | 'all'>('all')
  const [showCancelled, setShowCancelled] = useState(false)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingTaskMove | null>(null)
  const [moveNote, setMoveNote] = useState('')
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const filters = useMemo<TaskBoardFilters>(() => ({
    query,
    assigneeAgentId,
    priority
  }), [assigneeAgentId, priority, query])
  const activeMembers = snapshot.members.filter((member) =>
    member.membershipStatus === 'active' && member.leaveRequestedAt === null)
  const cancelled = snapshot.tasks.filter((task) =>
    task.status === 'cancelled' && taskBoardMatches(task, filters))

  const applyMove = async (
    task: TaskView,
    targetStatus: TaskStatus,
    beforeTaskId: string | null,
    note: string
  ): Promise<void> => {
    if (busy || savingTaskId || !task.availableActions.includes('update')) return
    const boardOrder = taskBoardOrderForDrop(
      snapshot.tasks,
      task.taskId,
      targetStatus,
      beforeTaskId
    )
    if (targetStatus === task.status && boardOrder === task.boardOrder) return
    setSavingTaskId(task.taskId)
    setFeedback(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('tasks.update', {
        commandId: crypto.randomUUID(),
        campId: snapshot.camp.id,
        taskId: task.taskId,
        expectedVersion: task.version,
        status: targetStatus,
        boardOrder,
        blockedReason: targetStatus === 'blocked' && task.status !== 'blocked'
          ? note.trim()
          : undefined,
        completionSummary: targetStatus === 'completed' ? note.trim() : undefined
      })
      if (result.status === 'rejected') {
        setFeedback(result.code === 'task.version_conflict'
          ? '任务已被其他操作更新，任务板已刷新，请重新操作。'
          : `移动未完成：${result.code}`)
        await onTasksChanged()
        return
      }
      await onTasksChanged()
    } catch (error) {
      setFeedback(localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error)))
    } finally {
      setSavingTaskId(null)
      setDraggingTaskId(null)
      setDropTarget(null)
    }
  }

  const requestMove = (
    task: TaskView,
    targetStatus: TaskStatus,
    beforeTaskId: string | null = null
  ): void => {
    if (task.status === 'completed' || task.status === 'cancelled') return
    if (targetStatus !== 'pending' && !task.assigneeAgentId) {
      setFeedback('请先在任务详情中分配负责人，再推进任务状态。')
      return
    }
    if (task.status === targetStatus) {
      void applyMove(task, targetStatus, beforeTaskId, '')
      return
    }
    if (taskBoardMoveNeedsNote(targetStatus)) {
      setPendingMove({ task, targetStatus, beforeTaskId })
      setMoveNote('')
      return
    }
    void applyMove(task, targetStatus, beforeTaskId, '')
  }

  const dropTask = (
    event: DragEvent,
    targetStatus: TaskStatus,
    beforeTaskId: string | null = null
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const taskId = draggingTaskId ?? event.dataTransfer.getData('text/rovai-task-id')
    const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId)
    setDropTarget(null)
    if (task) requestMove(task, targetStatus, beforeTaskId)
  }

  return (
    <section className="task-board" aria-label="Camp 任务板">
      <header className="task-board-header">
        <div>
          <span className="eyebrow">Camp Taskboard</span>
          <h2>任务板</h2>
          <p>任务、讨论和执行共用同一份 Core 事实。</p>
        </div>
        <div className="task-board-summary" aria-label="任务统计">
          <strong>{snapshot.tasks.filter((task) => task.status !== 'cancelled').length}</strong>
          <span>项任务</span>
        </div>
      </header>

      <div className="task-board-toolbar" aria-label="任务板筛选">
        <label className="task-board-search">
          <span className="sr-only">搜索任务</span>
          <input
            type="search"
            value={query}
            placeholder="搜索标题、说明或标签"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label>
          <span className="sr-only">按负责人筛选</span>
          <select value={assigneeAgentId} onChange={(event) => setAssigneeAgentId(event.currentTarget.value)}>
            <option value="">全部负责人</option>
            {activeMembers.map((member) => (
              <option value={member.agentId} key={member.agentId}>{member.displayName}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">按优先级筛选</span>
          <select value={priority} onChange={(event) => setPriority(event.currentTarget.value as TaskPriority | 'all')}>
            <option value="all">全部优先级</option>
            <option value="urgent">紧急</option>
            <option value="high">高优先级</option>
            <option value="medium">中优先级</option>
            <option value="low">低优先级</option>
            <option value="none">无优先级</option>
          </select>
        </label>
        <label className="task-board-archive-toggle">
          <input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.currentTarget.checked)} />
          <span>已取消 {cancelled.length}</span>
        </label>
      </div>

      {feedback && <div className="task-board-feedback" role="alert">{feedback}</div>}

      <div className="task-board-columns">
        {TASK_BOARD_STATUSES.map((status) => {
          const tasks = orderedTaskBoardColumn(snapshot.tasks, status, filters)
          const columnDropKey = `${status}:end`
          return (
            <section
              className={`task-board-column state-${status}${dropTarget === columnDropKey ? ' is-drop-target' : ''}`}
              aria-label={`${taskBoardStatusLabel(status)}，${tasks.length} 项`}
              key={status}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget(columnDropKey)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
              }}
              onDrop={(event) => dropTask(event, status)}
            >
              <header>
                <span className="task-board-column-mark" aria-hidden="true" />
                <strong>{taskBoardStatusLabel(status)}</strong>
                <small>{tasks.length}</small>
              </header>
              <div className="task-board-card-list">
                {tasks.map((task) => {
                  const cardDropKey = `${status}:${task.taskId}`
                  const member = snapshot.members.find((candidate) => candidate.agentId === task.assigneeAgentId)
                  const canMove = task.status !== 'completed'
                    && task.status !== 'cancelled'
                    && task.availableActions.includes('update')
                  return (
                    <article
                      className={`task-board-card priority-${task.priority}${savingTaskId === task.taskId ? ' is-saving' : ''}${dropTarget === cardDropKey ? ' is-drop-target' : ''}`}
                      draggable={canMove && !busy && !savingTaskId}
                      key={task.taskId}
                      onDragStart={(event) => {
                        setDraggingTaskId(task.taskId)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/rovai-task-id', task.taskId)
                      }}
                      onDragEnd={() => {
                        setDraggingTaskId(null)
                        setDropTarget(null)
                      }}
                      onDragOver={(event) => {
                        if (!draggingTaskId || draggingTaskId === task.taskId) return
                        event.preventDefault()
                        event.stopPropagation()
                        setDropTarget(cardDropKey)
                      }}
                      onDrop={(event) => dropTask(event, status, task.taskId)}
                    >
                      <div className="task-board-card-topline">
                        <span className={`task-priority priority-${task.priority}`}>{taskPriorityLabel(task.priority)}</span>
                        {task.dueDate && (
                          <time className={task.dueDate < new Date().toISOString().slice(0, 10) ? 'is-overdue' : ''} dateTime={task.dueDate}>
                            {task.dueDate}
                          </time>
                        )}
                      </div>
                      <button className="task-board-card-title" type="button" onClick={() => onOpenTask(task)}>
                        {task.title}
                      </button>
                      {task.description && <p>{task.description}</p>}
                      {task.labels.length > 0 && (
                        <div className="task-board-labels" aria-label="标签">
                          {task.labels.map((label) => <span key={label}>{label}</span>)}
                        </div>
                      )}
                      <footer>
                        <span>{member?.displayName ?? (task.assigneeAgentId ? '队员不可用' : '未分配')}</span>
                        {canMove && (
                          <label>
                            <span className="sr-only">移动“{task.title}”</span>
                            <select
                              value={task.status}
                              disabled={busy || Boolean(savingTaskId)}
                              onChange={(event) => requestMove(task, event.currentTarget.value as TaskStatus)}
                            >
                              {TASK_BOARD_STATUSES.map((candidate) => (
                                <option value={candidate} key={candidate}>{taskBoardStatusLabel(candidate)}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </footer>
                    </article>
                  )
                })}
                {tasks.length === 0 && <p className="task-board-empty">暂无匹配任务</p>}
              </div>
            </section>
          )
        })}
      </div>

      {showCancelled && (
        <section className="task-board-archive" aria-label="已取消任务">
          <header><strong>已取消</strong><small>{cancelled.length}</small></header>
          <div>
            {cancelled.map((task) => (
              <button type="button" key={task.taskId} onClick={() => onOpenTask(task)}>
                <span>{task.title}</span><small>{task.cancelReason ?? '未记录原因'}</small>
              </button>
            ))}
            {cancelled.length === 0 && <p>没有匹配的已取消任务。</p>}
          </div>
        </section>
      )}

      <Dialog.Root open={pendingMove !== null} onOpenChange={(open) => {
        if (!open) setPendingMove(null)
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content task-board-move-dialog" aria-describedby="task-board-move-description">
            <Dialog.Title>
              {pendingMove?.targetStatus === 'blocked' ? '说明阻塞原因' : '填写完成摘要'}
            </Dialog.Title>
            <Dialog.Description id="task-board-move-description">
              这项说明会成为任务的持久审计事实。
            </Dialog.Description>
            <textarea
              value={moveNote}
              rows={5}
              maxLength={4000}
              autoFocus
              placeholder={pendingMove?.targetStatus === 'blocked' ? '是什么阻止了任务继续推进？' : '任务完成了什么？'}
              onChange={(event) => setMoveNote(event.currentTarget.value)}
            />
            <div className="dialog-actions">
              <Dialog.Close asChild><button className="quiet-button" type="button">返回</button></Dialog.Close>
              <button
                className="primary-button"
                type="button"
                disabled={!moveNote.trim() || Boolean(savingTaskId)}
                onClick={() => {
                  if (!pendingMove || !moveNote.trim()) return
                  const move = pendingMove
                  setPendingMove(null)
                  void applyMove(move.task, move.targetStatus, move.beforeTaskId, moveNote)
                }}
              >
                确认移动
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
