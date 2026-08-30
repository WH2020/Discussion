import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AdapterInstallation,
  AgentProfile,
  CampSnapshot,
  NavigationCampItem,
  NavigationCampPage,
  NavigationSnapshot,
  StoredCommandResult,
  TaskListPage,
  TaskPriority,
  TaskStatus,
  TaskView
} from '@contracts'
import { relativeTimeLabel } from './ui-model'
import {
  MISSION_CONTROL_STATUSES,
  missionControlAssigneeName,
  missionControlColumn,
  missionControlFilterTasks,
  missionControlMetrics,
  missionControlNeedsReview,
  missionControlPriorityLabel,
  missionControlRuntimeMetrics,
  missionControlStatusLabel,
  type MissionControlScope,
  type MissionControlTask
} from './mission-control-model'
import { localizeExecutionEngineTerms } from './product-copy'

type CampRecord = {
  camp: NavigationCampItem
  scopeKey: string
  scopeName: string
}

type DetailMode = 'task' | 'team'

export function MissionControlWorkbench({
  navigation,
  agents,
  installations,
  onOpenCamp,
  onNewCollaboration
}: {
  navigation: NavigationSnapshot | null
  agents: AgentProfile[]
  installations: AdapterInstallation[]
  onOpenCamp(camp: NavigationCampItem): void
  onNewCollaboration(): void
}): React.JSX.Element {
  const [scopes, setScopes] = useState<MissionControlScope[]>([])
  const [campRecords, setCampRecords] = useState<CampRecord[]>([])
  const [tasks, setTasks] = useState<MissionControlTask[]>([])
  const [scopeKey, setScopeKey] = useState('all')
  const [campFilterId, setCampFilterId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<TaskPriority | 'all'>('all')
  const [assigneeAgentId, setAssigneeAgentId] = useState('')
  const [selectedCampId, setSelectedCampId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [detailMode, setDetailMode] = useState<DetailMode>('team')
  const [selectedSnapshot, setSelectedSnapshot] = useState<CampSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const loadGeneration = useRef(0)

  const loadWorkbench = useCallback(async (): Promise<void> => {
    if (!navigation) {
      setScopes([])
      setCampRecords([])
      setTasks([])
      setLoading(false)
      return
    }
    const generation = ++loadGeneration.current
    setLoading(true)
    setError(null)
    try {
      const nextScopes = navigationScopes(navigation)
      const nextCampRecords = await loadCampRecords(nextScopes, navigation)
      const nextTasks = await loadMissionTasks(nextCampRecords)
      if (generation !== loadGeneration.current) return
      setScopes(nextScopes.map((scope) => ({
        ...scope,
        camps: nextCampRecords
          .filter((record) => record.scopeKey === scope.key)
          .map((record) => record.camp)
      })))
      setCampRecords(nextCampRecords)
      setTasks(nextTasks)
      setSelectedCampId((current) => current && nextCampRecords.some((record) => record.camp.id === current)
        ? current
        : nextCampRecords[0]?.camp.id ?? null)
    } catch (nextError) {
      if (generation === loadGeneration.current) {
        setError(errorMessage(nextError))
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [navigation])

  useEffect(() => {
    void loadWorkbench()
  }, [loadWorkbench, refreshSignal])

  useEffect(() => {
    if (!selectedCampId) {
      setSelectedSnapshot(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setSelectedSnapshot((current) => current?.camp.id === selectedCampId ? current : null)
    void window.rovai.request<CampSnapshot>('camps.snapshot', { campId: selectedCampId })
      .then((snapshot) => {
        if (!cancelled) setSelectedSnapshot(snapshot)
      })
      .catch((nextError) => {
        if (!cancelled) setError(errorMessage(nextError))
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedCampId, refreshSignal])

  const filteredTasks = useMemo(() => {
    const filtered = missionControlFilterTasks(tasks, {
      scopeKey,
      query,
      priority,
      assigneeAgentId
    })
    return campFilterId ? filtered.filter((task) => task.camp.id === campFilterId) : filtered
  }, [assigneeAgentId, campFilterId, priority, query, scopeKey, tasks])
  const metrics = useMemo(() => missionControlMetrics(filteredTasks), [filteredTasks])
  const runtimeMetrics = useMemo(() => missionControlRuntimeMetrics(agents), [agents])
  const selectedCampRecord = campRecords.find((record) => record.camp.id === selectedCampId) ?? null
  const selectedTask = selectedSnapshot?.camp.id === selectedCampId
    ? selectedSnapshot.tasks.find((task) => task.taskId === selectedTaskId) ?? null
    : null
  const visibleScopes = scopeKey === 'all'
    ? scopes
    : scopes.filter((scope) => scope.key === scopeKey)
  const visibleCampRecords = campRecords.filter((record) => (
    scopeKey === 'all' || record.scopeKey === scopeKey
  ))
  const reviewTasks = selectedSnapshot?.tasks
    .filter((task) => missionControlNeedsReview(task))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5) ?? []

  const selectCamp = (record: CampRecord, filter: boolean): void => {
    setSelectedCampId(record.camp.id)
    setSelectedTaskId(null)
    setDetailMode('team')
    if (filter) {
      setScopeKey(record.scopeKey)
      setCampFilterId(record.camp.id)
    }
  }

  const selectTask = (task: MissionControlTask): void => {
    setSelectedCampId(task.camp.id)
    setSelectedTaskId(task.taskId)
    setDetailMode('task')
  }

  return (
    <section className="mission-control-workbench" aria-label="协作工作台">
      <header className="mission-control-header">
        <div>
          <span className="mission-control-eyebrow">MISSION CONTROL</span>
          <h1>协作驾驶舱</h1>
          <p>把项目、讨论区、角色与任务放进一条可观察、可复核的执行链。</p>
        </div>
        <div className="mission-control-header-actions">
          <span className={`mission-control-live ${loading ? 'is-loading' : ''}`}>
            <i aria-hidden="true" />{loading ? '正在同步' : '本地事实已同步'}
          </span>
          <button className="quiet-button" type="button" disabled={loading} onClick={() => setRefreshSignal((value) => value + 1)}>刷新</button>
          <button className="primary-button" type="button" onClick={onNewCollaboration}>新建协作</button>
        </div>
      </header>

      {error && <div className="mission-control-message is-error" role="alert"><span>{error}</span><button type="button" onClick={() => setRefreshSignal((value) => value + 1)}>重试</button></div>}
      {notice && <div className="mission-control-message" role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}

      <div className="mission-control-metrics" aria-label="协作概览">
        <Metric label="项目范围" value={String(scopes.filter((scope) => scope.key !== 'quick-chat').length)} detail={`${campRecords.length} 个讨论区`} tone="scope" />
        <Metric label="执行中" value={String(metrics.active)} detail={`${runtimeMetrics.present} 位队员在线`} tone="active" />
        <Metric label="已阻塞" value={String(metrics.blocked)} detail={metrics.blocked > 0 ? '需要解除依赖' : '当前无阻塞'} tone="blocked" />
        <Metric label="待分配" value={String(metrics.unassigned)} detail="明确负责人后推进" tone="unassigned" />
        <Metric label="已交付" value={`${metrics.completionRate}%`} detail={`${metrics.delivered} 项进入复核`} tone="delivered" />
        <Metric label="运行就绪" value={`${runtimeMetrics.ready}/${Math.max(agents.filter((agent) => agent.presence !== 'removed').length, runtimeMetrics.ready)}`} detail={runtimeMetrics.attention > 0 ? `${runtimeMetrics.attention} 位需配置` : `${installations.filter((item) => item.enabled).length} 个入口可用`} tone="runtime" />
      </div>

      <div className="mission-control-toolbar" aria-label="任务筛选">
        <label className="mission-control-search">
          <span className="sr-only">搜索任务</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input type="search" value={query} placeholder="搜索任务、讨论区或标签" onChange={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <label>
          <span className="sr-only">优先级</span>
          <select value={priority} onChange={(event) => setPriority(event.currentTarget.value as TaskPriority | 'all')}>
            <option value="all">全部优先级</option>
            <option value="urgent">紧急</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option><option value="none">普通</option>
          </select>
        </label>
        <label>
          <span className="sr-only">负责人</span>
          <select value={assigneeAgentId} onChange={(event) => setAssigneeAgentId(event.currentTarget.value)}>
            <option value="">全部负责人</option>
            {agents.filter((agent) => agent.presence !== 'removed').map((agent) => <option value={agent.agentId} key={agent.agentId}>{agent.displayName}</option>)}
          </select>
        </label>
        {(scopeKey !== 'all' || campFilterId || query || priority !== 'all' || assigneeAgentId) && (
          <button className="mission-control-clear" type="button" onClick={() => {
            setScopeKey('all'); setCampFilterId(null); setQuery(''); setPriority('all'); setAssigneeAgentId('')
          }}>清除筛选</button>
        )}
      </div>

      <div className="mission-control-layout">
        <aside className="mission-control-scope" aria-label="协作范围">
          <div className="mission-control-panel-heading">
            <div><span>协作范围</span><strong>{visibleScopes.length}</strong></div>
            <small>项目与讨论频道</small>
          </div>
          <button className={`mission-control-scope-all ${scopeKey === 'all' && !campFilterId ? 'selected' : ''}`} type="button" onClick={() => { setScopeKey('all'); setCampFilterId(null) }}>
            <span className="mission-control-scope-icon" aria-hidden="true">⌘</span>
            <span><strong>全部协作</strong><small>{tasks.filter((task) => task.status !== 'cancelled').length} 项任务</small></span>
          </button>
          <div className="mission-control-scope-list">
            {scopes.map((scope) => {
              const scopeTaskCount = tasks.filter((task) => task.scopeKey === scope.key && task.status !== 'cancelled').length
              return (
                <div className="mission-control-scope-group" key={scope.key}>
                  <button className={scopeKey === scope.key && !campFilterId ? 'selected' : ''} type="button" onClick={() => { setScopeKey(scope.key); setCampFilterId(null) }}>
                    <span><strong>{scope.name}</strong><small>{scope.camps.length} 个讨论区</small></span><b>{scopeTaskCount}</b>
                  </button>
                  {(scopeKey === 'all' || scopeKey === scope.key) && scope.camps.map((camp) => {
                    const record = campRecords.find((candidate) => candidate.camp.id === camp.id)
                    const campTaskCount = tasks.filter((task) => task.camp.id === camp.id && task.status !== 'cancelled').length
                    return record ? (
                      <button className={`mission-control-camp-row ${campFilterId === camp.id ? 'selected' : ''}`} type="button" key={camp.id} onClick={() => selectCamp(record, true)}>
                        <i className={`task-dot camp-marker-${camp.marker}`} aria-hidden="true" />
                        <span><strong>{camp.title}</strong><small>{camp.defaultLead?.displayName ?? '未设负责人'} · {campTaskCount} 项</small></span>
                      </button>
                    ) : null
                  })}
                </div>
              )
            })}
            {!loading && scopes.length === 0 && <p className="mission-control-empty-copy">新建协作后，项目与讨论区会出现在这里。</p>}
          </div>
        </aside>

        <main className="mission-control-board" aria-label="跨讨论区任务流">
          <div className="mission-control-board-heading">
            <div><span>执行任务流</span><small>{filteredTasks.length} 项可见任务</small></div>
            {campFilterId && <button type="button" onClick={() => setCampFilterId(null)}>查看项目全部任务</button>}
          </div>
          <div className="mission-control-columns">
            {MISSION_CONTROL_STATUSES.map((status) => {
              const columnTasks = missionControlColumn(filteredTasks, status)
              return (
                <section className={`mission-control-column state-${status}`} key={status} aria-label={`${missionControlStatusLabel(status)} ${columnTasks.length} 项`}>
                  <header><i aria-hidden="true" /><strong>{missionControlStatusLabel(status)}</strong><small>{columnTasks.length}</small></header>
                  <div className="mission-control-card-list">
                    {columnTasks.map((task) => (
                      <button className={`mission-control-task-card priority-${task.priority} ${selectedTaskId === task.taskId ? 'selected' : ''}`} type="button" key={`${task.camp.id}:${task.taskId}`} onClick={() => selectTask(task)}>
                        <span className="mission-control-task-context">{task.scopeName}<i>›</i>{task.camp.title}</span>
                        <strong>{task.title}</strong>
                        {task.labels.length > 0 && <span className="mission-control-task-labels">{task.labels.slice(0, 2).map((label) => <i key={label}>{label}</i>)}</span>}
                        <span className="mission-control-task-meta">
                          <i className={`priority-${task.priority}`}>{missionControlPriorityLabel(task.priority)}</i>
                          <span>{missionControlAssigneeName(task, agents)}</span>
                          {task.dueDate && <time dateTime={task.dueDate}>{shortDate(task.dueDate)}</time>}
                        </span>
                      </button>
                    ))}
                    {!loading && columnTasks.length === 0 && <div className="mission-control-column-empty">暂无任务</div>}
                  </div>
                </section>
              )
            })}
          </div>
        </main>

        <aside className="mission-control-detail" aria-label="协作详情">
          <div className="mission-control-detail-tabs" role="tablist" aria-label="详情分类">
            <button role="tab" aria-selected={detailMode === 'team'} type="button" onClick={() => setDetailMode('team')}>团队编排</button>
            <button role="tab" aria-selected={detailMode === 'task'} disabled={!selectedTaskId} type="button" onClick={() => setDetailMode('task')}>任务详情</button>
          </div>
          {detailMode === 'task' && selectedTaskId
            ? (
                <TaskDetail
                  task={selectedTask}
                  snapshot={selectedSnapshot?.camp.id === selectedCampId ? selectedSnapshot : null}
                  camp={selectedCampRecord?.camp ?? null}
                  loading={detailLoading}
                  saving={saving}
                  onSave={async (draft) => {
                    if (!selectedTask || !selectedCampRecord) return
                    setSaving(true)
                    setError(null)
                    try {
                      const result = await window.rovai.request<StoredCommandResult>('tasks.update', {
                        commandId: crypto.randomUUID(),
                        campId: selectedCampRecord.camp.id,
                        taskId: selectedTask.taskId,
                        expectedVersion: selectedTask.version,
                        status: draft.status,
                        assignee: draft.assigneeAgentId === (selectedTask.assigneeAgentId ?? '')
                          ? { operation: 'unchanged' }
                          : draft.assigneeAgentId
                            ? { operation: 'assign', agentId: draft.assigneeAgentId }
                            : { operation: 'clear' },
                        acceptanceCriteria: { operation: 'unchanged' },
                        blockedReason: draft.status === 'blocked' ? draft.note.trim() : undefined,
                        completionSummary: draft.status === 'completed' ? draft.note.trim() : undefined
                      })
                      if (result.status === 'rejected') {
                        setError(result.code === 'task.version_conflict' ? '任务已被其他操作更新，已为你刷新当前版本。' : `任务未更新：${result.code}`)
                      } else {
                        setNotice('任务状态已写回讨论区，任务板与协作驾驶舱保持一致。')
                      }
                      setRefreshSignal((value) => value + 1)
                    } catch (nextError) {
                      setError(errorMessage(nextError))
                    } finally {
                      setSaving(false)
                    }
                  }}
                  onOpenCamp={() => selectedCampRecord && onOpenCamp(selectedCampRecord.camp)}
                />
              )
            : (
                <TeamDetail
                  record={selectedCampRecord}
                  snapshot={selectedSnapshot?.camp.id === selectedCampId ? selectedSnapshot : null}
                  agents={agents}
                  loading={detailLoading}
                  reviewTasks={reviewTasks}
                  onSelectTask={(taskId) => { setSelectedTaskId(taskId); setDetailMode('task') }}
                  onOpenCamp={() => selectedCampRecord && onOpenCamp(selectedCampRecord.camp)}
                />
              )}
        </aside>
      </div>
    </section>
  )
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }): React.JSX.Element {
  return <div className={`mission-control-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function TeamDetail({
  record,
  snapshot,
  agents,
  loading,
  reviewTasks,
  onSelectTask,
  onOpenCamp
}: {
  record: CampRecord | null
  snapshot: CampSnapshot | null
  agents: AgentProfile[]
  loading: boolean
  reviewTasks: TaskView[]
  onSelectTask(taskId: string): void
  onOpenCamp(): void
}): React.JSX.Element {
  if (!record) return <div className="mission-control-detail-empty"><span>⌘</span><strong>选择一个讨论区</strong><p>查看角色、运行时、交付复核和最近活动。</p></div>
  const running = snapshot?.agentRuns.filter((run) => run.status === 'running' || run.status === 'queued' || run.status === 'waiting').length ?? 0
  const pendingApprovals = snapshot?.approvals.filter((approval) => approval.status === 'pending').length ?? 0
  return (
    <div className="mission-control-team-detail">
      <div className="mission-control-detail-title">
        <span>{record.scopeName}</span><h2>{record.camp.title}</h2><p>{record.camp.defaultLead ? `${record.camp.defaultLead.displayName} 负责协调` : '尚未设置默认负责人'}</p>
      </div>
      <div className="mission-control-detail-actions"><button className="quiet-button" type="button" onClick={onOpenCamp}>打开讨论区</button></div>
      <div className="mission-control-orchestration-strip">
        <span><strong>{snapshot?.members.filter((member) => member.membershipStatus === 'active').length ?? '—'}</strong>位成员</span>
        <span><strong>{running}</strong>项运行</span>
        <span><strong>{pendingApprovals}</strong>项审批</span>
      </div>
      <section className="mission-control-detail-section">
        <header><strong>角色与运行时</strong><small>{loading ? '读取中' : '实时状态'}</small></header>
        <div className="mission-control-member-list">
          {snapshot?.members.filter((member) => member.membershipStatus === 'active').map((member) => {
            const agent = agents.find((candidate) => candidate.agentId === member.agentId)
            const readiness = agent?.runtimeReadiness.status ?? 'runtime_not_configured'
            return (
              <div className="mission-control-member" key={member.agentId}>
                <span className="mission-control-avatar" style={{ background: agent?.accent ?? member.accent }}>{member.displayName.slice(0, 1)}</span>
                <span><strong>{member.displayName}{member.isDefaultLead ? <i>主控</i> : null}</strong><small>{member.teamRole || '协作成员'}</small></span>
                <b className={`runtime-${readiness}`}>{runtimeReadinessLabel(readiness)}</b>
              </div>
            )
          })}
          {!loading && snapshot && snapshot.members.length === 0 && <p className="mission-control-empty-copy">这个讨论区还没有成员。</p>}
        </div>
      </section>
      <section className="mission-control-detail-section">
        <header><strong>交付复核</strong><small>{reviewTasks.length} 项</small></header>
        <div className="mission-control-review-list">
          {reviewTasks.map((task) => <button type="button" key={task.taskId} onClick={() => onSelectTask(task.taskId)}><span>{task.title}</span><small>{task.completionSummary || '已完成，等待人工查看完成摘要'}</small></button>)}
          {!loading && reviewTasks.length === 0 && <p className="mission-control-empty-copy">完成的任务会进入这里，供人工复核。</p>}
        </div>
      </section>
      <section className="mission-control-detail-section">
        <header><strong>最近活动</strong><small>{snapshot ? relativeTimeLabel(record.camp.lastActivityAt) : ''}</small></header>
        <div className="mission-control-activity-list">
          {snapshot?.timeline.slice(-4).reverse().map((event) => <div key={`${event.globalSequence}:${event.eventType}`}><i aria-hidden="true" /><span><strong>{eventLabel(event.eventType)}</strong><small>{relativeTimeLabel(event.createdAt)}</small></span></div>)}
          {!loading && snapshot && snapshot.timeline.length === 0 && <p className="mission-control-empty-copy">暂无可显示的活动。</p>}
        </div>
      </section>
    </div>
  )
}

function TaskDetail({
  task,
  snapshot,
  camp,
  loading,
  saving,
  onSave,
  onOpenCamp
}: {
  task: TaskView | null
  snapshot: CampSnapshot | null
  camp: NavigationCampItem | null
  loading: boolean
  saving: boolean
  onSave(draft: { status: TaskStatus; assigneeAgentId: string; note: string }): Promise<void>
  onOpenCamp(): void
}): React.JSX.Element {
  const [status, setStatus] = useState<TaskStatus>('pending')
  const [assigneeAgentId, setAssigneeAgentId] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  useEffect(() => {
    if (!task) return
    setStatus(task.status)
    setAssigneeAgentId(task.assigneeAgentId ?? '')
    setNote(task.status === 'blocked' ? task.blockedReason ?? '' : task.status === 'completed' ? task.completionSummary ?? '' : '')
    setFormError(null)
  }, [task])
  if (loading && !task) return <div className="mission-control-detail-loading"><i aria-hidden="true" />正在读取任务详情…</div>
  if (!task || !camp) return <div className="mission-control-detail-empty"><strong>任务暂不可见</strong><p>刷新后重试，或回到讨论区查看。</p></div>
  const terminal = task.status === 'completed' || task.status === 'cancelled' || !task.availableActions.includes('update')
  const members = snapshot?.members.filter((member) => member.membershipStatus === 'active') ?? []
  const submit = (): void => {
    if ((status === 'in_progress' || status === 'blocked') && !assigneeAgentId) {
      setFormError('进行中或已阻塞的任务必须明确负责人。'); return
    }
    if (status === 'blocked' && !note.trim()) { setFormError('请填写阻塞原因。'); return }
    if (status === 'completed' && !note.trim()) { setFormError('请填写完成摘要，作为人工复核依据。'); return }
    setFormError(null)
    void onSave({ status, assigneeAgentId, note })
  }
  return (
    <div className="mission-control-task-detail">
      <div className="mission-control-detail-title"><span>{camp.title}</span><h2>{task.title}</h2><p>{task.description || '没有补充说明'}</p></div>
      <div className="mission-control-task-facts">
        <span className={`status-${task.status}`}>{missionControlStatusLabel(task.status)}</span>
        <span className={`priority-${task.priority}`}>{missionControlPriorityLabel(task.priority)}优先级</span>
        {task.dueDate && <span>截止 {shortDate(task.dueDate)}</span>}
      </div>
      {task.acceptanceCriteria.length > 0 && <section className="mission-control-acceptance"><strong>验收标准</strong><ul>{task.acceptanceCriteria.map((item) => <li key={item}>{item}</li>)}</ul></section>}
      <div className="mission-control-task-form">
        <label><span>负责人</span><select disabled={terminal || saving} value={assigneeAgentId} onChange={(event) => setAssigneeAgentId(event.currentTarget.value)}><option value="">未分配</option>{members.map((member) => <option value={member.agentId} key={member.agentId}>{member.displayName}</option>)}</select></label>
        <label><span>执行阶段</span><select disabled={terminal || saving} value={status} onChange={(event) => { const next = event.currentTarget.value as TaskStatus; setStatus(next); setNote(next === 'blocked' ? task.blockedReason ?? '' : next === 'completed' ? task.completionSummary ?? '' : '') }}><option value="pending">待处理</option><option value="in_progress">进行中</option><option value="blocked">已阻塞</option><option value="completed">已交付</option></select></label>
        {(status === 'blocked' || status === 'completed') && <label><span>{status === 'blocked' ? '阻塞原因' : '完成摘要 / 复核依据'}</span><textarea disabled={terminal || saving} value={note} placeholder={status === 'blocked' ? '说明受阻原因和需要的支持' : '说明完成内容、验证结果和交付位置'} onChange={(event) => setNote(event.currentTarget.value)} /></label>}
        {formError && <p className="mission-control-form-error" role="alert">{formError}</p>}
        <div className="mission-control-task-actions">
          <button className="quiet-button" type="button" onClick={onOpenCamp}>打开讨论区</button>
          {!terminal && <button className="primary-button" type="button" disabled={saving} onClick={submit}>{saving ? '正在保存…' : '更新任务'}</button>}
        </div>
      </div>
      {terminal && <div className="mission-control-review-note"><strong>已进入人工复核</strong><p>{task.completionSummary || '请在讨论区核对实际交付，再决定后续动作。'}</p></div>}
    </div>
  )
}

function navigationScopes(navigation: NavigationSnapshot): MissionControlScope[] {
  return [
    { key: 'quick-chat', name: '快速协作', projectPath: null, camps: navigation.quickChat.recentCamps },
    ...navigation.projects.map((project) => ({ key: project.projectKey, name: project.name, projectPath: project.projectPath, camps: project.recentCamps }))
  ].filter((scope) => scope.camps.length > 0 || scope.key !== 'quick-chat')
}

async function loadCampRecords(scopes: MissionControlScope[], navigation: NavigationSnapshot): Promise<CampRecord[]> {
  const totalByScope = new Map<string, number>([
    ['quick-chat', navigation.quickChat.totalCount],
    ...navigation.projects.map((project) => [project.projectKey, project.totalCount] as const)
  ])
  const groups = await Promise.all(scopes.map(async (scope) => {
    const total = totalByScope.get(scope.key) ?? scope.camps.length
    if (total <= scope.camps.length) return scope.camps
    const camps: NavigationCampItem[] = []
    let offset = 0
    while (camps.length < Math.min(total, 200)) {
      const page = await window.rovai.request<NavigationCampPage>('navigation.groupCamps', {
        projectPath: scope.projectPath,
        offset,
        limit: Math.min(100, 200 - camps.length)
      })
      if (page.schemaVersion !== 3) throw new Error('协作范围数据版本不兼容。')
      camps.push(...page.camps)
      if (page.nextOffset === null) break
      offset = page.nextOffset
    }
    return camps
  }))
  return scopes.flatMap((scope, index) => groups[index].map((camp) => ({ camp, scopeKey: scope.key, scopeName: scope.name })))
}

async function loadMissionTasks(records: CampRecord[]): Promise<MissionControlTask[]> {
  const all: MissionControlTask[] = []
  for (let index = 0; index < records.length; index += 8) {
    const batch = await Promise.all(records.slice(index, index + 8).map(async (record) => {
      const result: MissionControlTask[] = []
      let cursor: string | null = null
      do {
        const page: TaskListPage = await window.rovai.request<TaskListPage>('tasks.list', { campId: record.camp.id, limit: 100, cursor })
        result.push(...page.tasks.map((task) => ({ ...task, camp: record.camp, scopeKey: record.scopeKey, scopeName: record.scopeName })))
        cursor = result.length < 200 ? page.nextCursor : null
      } while (cursor)
      return result
    }))
    all.push(...batch.flat())
  }
  return all
}

function shortDate(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function runtimeReadinessLabel(status: AgentProfile['runtimeReadiness']['status']): string {
  if (status === 'ready') return '就绪'
  if (status === 'light_ready') return '可用'
  if (status === 'installed_unverified') return '待验证'
  if (status === 'needs_attention') return '需处理'
  return '未配置'
}

function eventLabel(eventType: string): string {
  if (eventType.includes('task')) return '任务状态已更新'
  if (eventType.includes('message')) return '讨论区收到新消息'
  if (eventType.includes('approval')) return '审批状态发生变化'
  if (eventType.includes('run')) return 'Agent 执行状态更新'
  if (eventType.includes('member')) return '团队编排已调整'
  return '协作事实已记录'
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
