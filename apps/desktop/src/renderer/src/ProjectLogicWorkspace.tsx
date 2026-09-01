import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type JSX,
  type KeyboardEvent
} from 'react'
import type {
  AgentProfile,
  CampOpenProjection,
  ProjectLogicDiagram,
  ProjectLogicEdge,
  ProjectLogicMap,
  ProjectLogicNode,
  ProjectLogicRelation,
  WorkspaceSelection
} from '@contracts'
import {
  buildProjectLogicLayout,
  PROJECT_LOGIC_EDGE_LABEL_LINE_HEIGHT,
  projectLogicReachableNodeIds,
  type ProjectLogicReachDirection
} from './project-logic-layout'
import {
  projectLogicKindColor,
  projectLogicKindLabel,
  projectLogicMapToSvg,
  projectLogicSuggestedFileName
} from './project-logic-svg'
import {
  buildProjectLogicGenerationPrompt,
  createProjectLogicGenerationRequest,
  parseProjectLogicDiagramResponse,
  projectLogicGenerationCacheKey,
  projectLogicProjectPathIdentity,
  projectLogicScanFingerprint,
  readProjectLogicGenerationCache,
  writeProjectLogicGenerationCache,
  type ProjectLogicConversationMessage,
  type ProjectLogicGenerationRequest,
  type ProjectLogicGenerationRequestType
} from './project-logic-generation'
import {
  pauseProjectLogicAnalysis,
  runProjectLogicAnalysis,
  type ProjectLogicAnalysisProgressStatus,
  type ProjectLogicCoreRequest
} from './project-logic-analysis-runner'

const MIN_ZOOM = 0.55
const MAX_ZOOM = 1.6
const ZOOM_STEP = 0.15
const PROJECT_LOGIC_QUESTION_MAX_LENGTH = 4_000
const GENERATED_DIAGRAM_SESSION_LIMIT = 8

interface ProjectLogicInflightAnalysis {
  promise: Promise<void>
  campId: string | null
  campTurnId: string | null
  request: ProjectLogicGenerationRequest
  interruption: 'pause' | 'revise' | null
}

export interface ProjectLogicAnalysisRecovery {
  campId: string
  campTurnId: string
  requestType: ProjectLogicGenerationRequestType
  purpose: string
  assistantContent: string
  createdAt: string | null
  diagram: ProjectLogicDiagram
}

const projectLogicInflightAnalyses = new Map<string, ProjectLogicInflightAnalysis>()

const RELATION_LABEL: Record<ProjectLogicRelation, string> = {
  depends_on: '依赖',
  imports: '导入',
  contains: '包含',
  builds: '构建',
  tests: '测试',
  flows_to: '下一步',
  branches_to: '分支',
  controls: '控制',
  syncs: '同步',
  authorizes: '授权',
  records: '记录'
}

export function ProjectLogicWorkspace({
  project,
  agents = [],
  onChooseProject,
  onOpenAnalysisCamp,
  onConfigureRuntime,
  onAnalysisCampReady,
  analysisCampIds = [],
  onNotify = () => undefined
}: {
  project: WorkspaceSelection | null
  agents?: readonly AgentProfile[]
  onChooseProject(): void
  onOpenAnalysisCamp?(campId: string): void
  onConfigureRuntime?(): void
  onAnalysisCampReady?(campId: string): void
  analysisCampIds?: readonly string[]
  onNotify?(message: string): void
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<ProjectLogicMap | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeDiagramId, setActiveDiagramId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [reachDirection, setReachDirection] = useState<ProjectLogicReachDirection | null>(null)
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(0.85)
  const [exporting, setExporting] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [analysisMode, setAnalysisMode] = useState<ProjectLogicGenerationRequestType>('software-architecture')
  const [analysisQuestion, setAnalysisQuestion] = useState('')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisStatus, setAnalysisStatus] = useState<ProjectLogicAnalysisUiStatus>('idle')
  const [analysisStatusMessage, setAnalysisStatusMessage] = useState('等待本地静态扫描完成。')
  const [analysisRunning, setAnalysisRunning] = useState(false)
  const [analysisControlBusy, setAnalysisControlBusy] = useState(false)
  const [analysisPaused, setAnalysisPaused] = useState(false)
  const [pendingRevision, setPendingRevision] = useState<ProjectLogicGenerationRequest | null>(null)
  const [activeAnalysisTurnId, setActiveAnalysisTurnIdState] = useState<string | null>(null)
  const [activeAnalysisRequest, setActiveAnalysisRequest] = useState<ProjectLogicGenerationRequest | null>(null)
  const [analysisCampId, setAnalysisCampIdState] = useState<string | null>(null)
  const [analysisMessages, setAnalysisMessagesState] = useState<ProjectLogicConversationMessage[]>([])
  const [generatedDiagrams, setGeneratedDiagrams] = useState<ProjectLogicDiagram[]>([])
  const [hydratedGenerationKey, setHydratedGenerationKey] = useState<string | null>(null)
  const [generationCacheHit, setGenerationCacheHit] = useState(false)
  const [generationCacheRevision, setGenerationCacheRevision] = useState(0)
  const scanGeneration = useRef(0)
  const scannedProjectPath = useRef<string | null>(null)
  const analysisRunGeneration = useRef(0)
  const analysisRunningRef = useRef(false)
  const analysisCampIdRef = useRef<string | null>(null)
  const activeAnalysisTurnIdRef = useRef<string | null>(null)
  const analysisInterruptionRef = useRef<'pause' | 'revise' | null>(null)
  const analysisMessagesRef = useRef<ProjectLogicConversationMessage[]>([])
  const generatedDiagramsRef = useRef<ProjectLogicDiagram[]>([])
  const analysisRecoveryAttemptRef = useRef<string | null>(null)
  const analysisInputRef = useRef<HTMLTextAreaElement>(null)
  const projectIdentity = projectLogicScanIdentity(project)
  const analysisCampIdsKey = analysisCampIds.join('\0')
  const projectPathRef = useRef(project?.projectPath ?? null)
  projectPathRef.current = project?.projectPath ?? null
  const analysisRuntime = useMemo(
    () => projectLogicAnalysisRuntimeFromAgents(agents),
    [agents]
  )

  const setAnalysisCampId = useCallback((campId: string | null): void => {
    analysisCampIdRef.current = campId
    setAnalysisCampIdState(campId)
  }, [])

  const setActiveAnalysisTurnId = useCallback((campTurnId: string | null): void => {
    activeAnalysisTurnIdRef.current = campTurnId
    setActiveAnalysisTurnIdState(campTurnId)
  }, [])

  const setAnalysisMessages = useCallback((messages: ProjectLogicConversationMessage[]): void => {
    analysisMessagesRef.current = messages
    setAnalysisMessagesState(messages)
  }, [])

  const replaceGeneratedDiagrams = useCallback((diagrams: ProjectLogicDiagram[]): void => {
    generatedDiagramsRef.current = diagrams
    setGeneratedDiagrams(diagrams)
  }, [])

  const scan = useCallback(async (): Promise<void> => {
    const generation = ++scanGeneration.current
    const projectPath = projectPathRef.current
    if (!projectIdentity || !projectPath) {
      analysisRunGeneration.current += 1
      analysisRecoveryAttemptRef.current = null
      scannedProjectPath.current = null
      setSnapshot(null)
      setActiveDiagramId(null)
      setSelectedNodeId(null)
      setError(null)
      setLoading(false)
      replaceGeneratedDiagrams([])
      setAnalysisMessages([])
      setAnalysisCampId(null)
      setHydratedGenerationKey(null)
      setGenerationCacheHit(false)
      setAnalysisRunning(false)
      setAnalysisControlBusy(false)
      setAnalysisPaused(false)
      setPendingRevision(null)
      setActiveAnalysisTurnId(null)
      setActiveAnalysisRequest(null)
      analysisInterruptionRef.current = null
      setAnalysisStatus('idle')
      setAnalysisStatusMessage('等待选择项目。')
      setAnalysisOpen(false)
      setAnalysisQuestion('')
      return
    }
    if (scannedProjectPath.current !== projectIdentity) {
      analysisRunGeneration.current += 1
      analysisRecoveryAttemptRef.current = null
      scannedProjectPath.current = null
      setSnapshot(null)
      setActiveDiagramId(null)
      setSelectedNodeId(null)
      setAnalysisOpen(false)
      setAnalysisQuestion('')
    }
    setLoading(true)
    setError(null)
    try {
      const nextSnapshot = await window.rovai.projectLogic.scan(projectPath)
      if (scanGeneration.current !== generation) return
      scannedProjectPath.current = projectIdentity
      setSnapshot(nextSnapshot)
      const firstDiagram = nextSnapshot.diagrams?.[0] ?? null
      setActiveDiagramId(firstDiagram?.id ?? null)
      setSelectedNodeId(
        firstDiagram?.primaryPath[0]
        ?? firstDiagram?.nodes[0]?.id
        ?? nextSnapshot.primaryPath[0]
        ?? nextSnapshot.nodes[0]?.id
        ?? null
      )
      setReachDirection(null)
      setQuery('')
      setZoom(0.85)
    } catch (nextError) {
      if (scanGeneration.current !== generation) return
      setSnapshot(null)
      setError(errorMessage(nextError))
    } finally {
      if (scanGeneration.current === generation) setLoading(false)
    }
  }, [
    projectIdentity,
    replaceGeneratedDiagrams,
    setActiveAnalysisTurnId,
    setAnalysisCampId,
    setAnalysisMessages
  ])

  useEffect(() => {
    void scan()
    return () => { scanGeneration.current += 1 }
  }, [scan])

  const staticDiagrams = useMemo<ProjectLogicDiagram[]>(() => {
    if (!snapshot) return []
    if (snapshot.diagrams && snapshot.diagrams.length > 0) return snapshot.diagrams
    return [{
      id: 'architecture',
      title: '文件结构图',
      description: '根据本地文件、目录、项目清单、模块边界和静态依赖生成。',
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      primaryPath: snapshot.primaryPath
    }]
  }, [snapshot])
  const diagrams = useMemo<ProjectLogicDiagram[]>(() => {
    const ids = new Set<string>()
    return [...staticDiagrams, ...generatedDiagrams].filter((diagram) => {
      if (ids.has(diagram.id)) return false
      ids.add(diagram.id)
      return true
    })
  }, [generatedDiagrams, staticDiagrams])
  const activeDiagram = useMemo(
    () => diagrams.find((diagram) => diagram.id === activeDiagramId) ?? diagrams[0] ?? null,
    [activeDiagramId, diagrams]
  )
  const activeMap = useMemo<ProjectLogicMap | null>(() => {
    if (!snapshot || !activeDiagram) return snapshot
    return {
      ...snapshot,
      nodes: activeDiagram.nodes,
      edges: activeDiagram.edges,
      primaryPath: activeDiagram.primaryPath
    }
  }, [activeDiagram, snapshot])
  const documentMode = snapshot?.analysisKind === 'product-document'
    || snapshot?.analysisKind === 'mixed' && activeDiagram?.id !== 'architecture'

  const layout = useMemo(
    () => activeMap ? buildProjectLogicLayout(activeMap) : null,
    [activeMap]
  )
  const nodeById = useMemo(
    () => new Map(activeMap?.nodes.map((node) => [node.id, node]) ?? []),
    [activeMap]
  )
  const edgeById = useMemo(
    () => new Map(activeMap?.edges.map((edge) => [edge.id, edge]) ?? []),
    [activeMap]
  )
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const queryMatchIds = useMemo(() => {
    if (!activeMap || !normalizedQuery) return null
    return new Set(activeMap.nodes
      .filter((node) => [node.label, node.path, node.summary, node.language ?? '', projectLogicKindLabel(node.kind)]
        .join('\n')
        .toLocaleLowerCase()
        .includes(normalizedQuery))
      .map((node) => node.id))
  }, [activeMap, normalizedQuery])
  const emphasizedNodeIds = useMemo(() => {
    if (!activeMap) return null
    if (selectedNodeId && reachDirection) {
      return projectLogicReachableNodeIds(activeMap, selectedNodeId, reachDirection)
    }
    return queryMatchIds
  }, [activeMap, queryMatchIds, reachDirection, selectedNodeId])
  const selectedConnections = useMemo(() => {
    if (!activeMap || !selectedNodeId) return []
    return activeMap.edges
      .filter((edge) => edge.from === selectedNodeId || edge.to === selectedNodeId)
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
  }, [activeMap, selectedNodeId])
  const scanFingerprint = useMemo(
    () => snapshot ? projectLogicScanFingerprint(snapshot) : null,
    [snapshot]
  )
  const generationKey = useMemo(
    () => project && scanFingerprint
      ? projectLogicGenerationCacheKey(project.projectPath, scanFingerprint)
      : null,
    [project, scanFingerprint]
  )

  useEffect(() => {
    analysisRunGeneration.current += 1
    analysisRunningRef.current = false
    setAnalysisRunning(false)
    setAnalysisControlBusy(false)
    setAnalysisPaused(false)
    setPendingRevision(null)
    setActiveAnalysisTurnId(null)
    setActiveAnalysisRequest(null)
    analysisInterruptionRef.current = null
    setAnalysisError(null)
    replaceGeneratedDiagrams([])
    setAnalysisMessages([])
    setAnalysisCampId(null)
    setGenerationCacheHit(false)
    setHydratedGenerationKey(null)
    if (!snapshot || !project || !scanFingerprint || !generationKey) return

    const cached = readProjectLogicGenerationCache(
      window.localStorage,
      project.projectPath,
      scanFingerprint
    )
    if (cached.warning) onNotify(cached.warning)
    if (cached.status === 'hit') {
      const messages = cached.value.messageSummaries.map((message, index) => ({
        schemaVersion: 1 as const,
        id: `cached-${index}`,
        role: message.role,
        content: message.content,
        createdAt: null
      }))
      replaceGeneratedDiagrams([...(cached.value.diagrams ?? [cached.value.diagram])])
      setAnalysisMessages(messages)
      setAnalysisCampId(cached.value.campId)
      setGenerationCacheHit(true)
      setAnalysisStatus('completed')
      setAnalysisStatusMessage(
        `已恢复“${cached.value.diagram.title}”；当前仍先显示文件结构图，可切换查看或继续追问。`
      )
    } else {
      setAnalysisStatus(analysisRuntime ? 'idle' : 'unavailable')
      setAnalysisStatusMessage(analysisRuntime
        ? '文件结构图已生成。输入分析目标后，才会启动 Runtime 深读相关代码。'
        : '文件结构图已生成；按需深度分析需要先配置一个可用 Runtime。')
    }
    setHydratedGenerationKey(generationKey)
  }, [
    generationCacheRevision,
    generationKey,
    onNotify,
    projectIdentity,
    replaceGeneratedDiagrams,
    scanFingerprint,
    setAnalysisCampId,
    setActiveAnalysisTurnId,
    setAnalysisMessages
  ])

  useEffect(() => {
    if (
      !snapshot
      || !project
      || !scanFingerprint
      || !generationKey
      || hydratedGenerationKey !== generationKey
      || generationCacheHit
      || analysisRunningRef.current
      || !analysisCampIdsKey
    ) return
    const recoveryKey = `${generationKey}:${analysisCampIdsKey}`
    if (analysisRecoveryAttemptRef.current === recoveryKey) return
    analysisRecoveryAttemptRef.current = recoveryKey
    let cancelled = false

    void (async (): Promise<void> => {
      const recovered: ProjectLogicAnalysisRecovery[] = []
      for (const campId of analysisCampIds) {
        try {
          const projection = await window.rovai.request<CampOpenProjection>('camps.open', {
            traceId: crypto.randomUUID(),
            campId
          })
          recovered.push(...recoverCompletedProjectLogicAnalyses(projection))
        } catch {
          // A stale or unreadable historical Camp must not block the local structure graph.
        }
      }
      recovered.sort((left, right) => (
        (left.createdAt ?? '').localeCompare(right.createdAt ?? '')
        || left.diagram.id.localeCompare(right.diagram.id)
      ))
      if (recovered.length === 0) return

      let nextDiagrams = generatedDiagramsRef.current
      let nextMessages = analysisMessagesRef.current
      for (const result of recovered) {
        nextDiagrams = appendGeneratedProjectLogicDiagram(nextDiagrams, result.diagram)
        const userMessage: ProjectLogicConversationMessage = {
          schemaVersion: 1,
          id: `logic-recovered-user-${result.campTurnId}`,
          role: 'user',
          content: result.purpose,
          createdAt: result.createdAt,
          requestType: result.requestType,
          diagram: null
        }
        const assistantMessage: ProjectLogicConversationMessage = {
          schemaVersion: 1,
          id: `logic-recovered-assistant-${result.campTurnId}`,
          role: 'assistant',
          content: result.assistantContent,
          createdAt: result.createdAt,
          requestType: result.requestType,
          diagram: result.diagram
        }
        nextMessages = [...nextMessages, userMessage, assistantMessage].slice(-24)
      }
      const latest = recovered[recovered.length - 1]
      const cacheWrite = writeProjectLogicGenerationCache(window.localStorage, {
        schemaVersion: 1,
        projectPath: project.projectPath,
        scanFingerprint,
        diagram: latest.diagram,
        diagrams: nextDiagrams,
        campId: latest.campId,
        messageSummaries: nextMessages.map((message) => ({
          role: message.role,
          content: projectLogicCacheMessageSummary(message.content)
        })),
        savedAt: new Date().toISOString()
      })
      if (cancelled) return
      replaceGeneratedDiagrams(nextDiagrams)
      setAnalysisMessages(nextMessages)
      setAnalysisCampId(latest.campId)
      setGenerationCacheHit(true)
      setAnalysisStatus('completed')
      setAnalysisStatusMessage(
        `已从本地分析记录恢复 ${nextDiagrams.length} 张专项逻辑图；当前仍先显示文件结构图。`
      )
      if (!cacheWrite.ok) onNotify(cacheWrite.error)
      else onNotify(`已恢复“${latest.diagram.title}”`)
    })()

    return () => { cancelled = true }
  }, [
    analysisCampIdsKey,
    generationCacheHit,
    generationKey,
    hydratedGenerationKey,
    onNotify,
    project,
    replaceGeneratedDiagrams,
    scanFingerprint,
    setAnalysisCampId,
    setAnalysisMessages,
    snapshot
  ])

  const runGeneration = useCallback(async (
    request: ProjectLogicGenerationRequest
  ): Promise<void> => {
    if (analysisRunningRef.current) return
    if (!snapshot || !project || !scanFingerprint || !generationKey) {
      setAnalysisError('项目静态扫描尚未完成。')
      return
    }
    if (!analysisRuntime) {
      setAnalysisStatus('unavailable')
      setAnalysisStatusMessage('没有可执行深度分析的 Runtime；文件结构图仍可正常使用。')
      setAnalysisError('请先为至少一位在队队员配置可用的 Codex、Claude Code 或其他 Runtime。')
      return
    }

    const runGenerationId = ++analysisRunGeneration.current
    const isCurrentRun = (): boolean => analysisRunGeneration.current === runGenerationId
    const currentInterruption = (): 'pause' | 'revise' | null => (
      analysisInterruptionRef.current
      ?? projectLogicInflightAnalyses.get(generationKey)?.interruption
      ?? null
    )
    analysisInterruptionRef.current = null
    analysisRunningRef.current = true
    setAnalysisRunning(true)
    setAnalysisControlBusy(false)
    setAnalysisPaused(false)
    setActiveAnalysisTurnId(null)
    setActiveAnalysisRequest(request)
    setAnalysisError(null)
    setAnalysisOpen(true)
    setAnalysisStatus('preparing')
    setAnalysisStatusMessage('正在根据你的目标准备本轮深度分析…')

    const previousMessages = analysisMessagesRef.current
    const previousGeneratedDiagrams = generatedDiagramsRef.current
    const userMessage: ProjectLogicConversationMessage = {
      schemaVersion: 1,
      id: `logic-user-${runGenerationId}`,
      role: 'user',
      content: request.userRequest,
      createdAt: new Date().toISOString(),
      requestType: request.type,
      diagram: null
    }
    const messagesWithUser = [...previousMessages, userMessage].slice(-24)
    setAnalysisMessages(messagesWithUser)

    const prompt = buildProjectLogicGenerationPrompt({
      map: snapshot,
      request,
      currentDiagram: activeDiagram,
      currentNode: selectedNode,
      messages: previousMessages
    })

    try {
      const coreRequest: ProjectLogicCoreRequest = (method, params) => window.rovai.request(method, params)
      const result = await runProjectLogicAnalysis(coreRequest, {
        project,
        prompt,
        purpose: `${projectLogicGenerationTypeLabel(request.type)}：${request.userRequest}`,
        agentId: analysisRuntime.agentId,
        memberAgentIds: analysisRuntime.memberAgentIds,
        existingCampId: analysisCampIdRef.current,
        onCampReady: (campId) => {
          setAnalysisCampId(campId)
          const inflight = projectLogicInflightAnalyses.get(generationKey)
          if (inflight) inflight.campId = campId
          onAnalysisCampReady?.(campId)
        },
        onProgress: (progress) => {
          if (!isCurrentRun()) return
          if (progress.campTurnId) {
            setActiveAnalysisTurnId(progress.campTurnId)
            const inflight = projectLogicInflightAnalyses.get(generationKey)
            if (inflight) inflight.campTurnId = progress.campTurnId
          }
          setAnalysisStatus(progress.status)
          setAnalysisStatusMessage(progress.message)
        }
      })
      if (result.status !== 'completed') {
        if (!isCurrentRun()) return
        const interruption = currentInterruption()
        if (interruption) {
          analysisInterruptionRef.current = null
          setAnalysisError(null)
          if (interruption === 'pause') {
            setAnalysisPaused(true)
            setAnalysisStatus('paused')
            setAnalysisStatusMessage('分析已暂停；同一项目分析会话和已有上下文均已保留。')
          } else {
            setAnalysisPaused(false)
            setAnalysisStatus('revising')
            setAnalysisStatusMessage('当前执行已安全暂停，正在按修改后的要求从同一会话继续…')
          }
          return
        }
        const assistantContent = result.responseBody
          ? projectLogicResponseSummary(result.responseBody)
          : result.message
        const nextMessages = appendAnalysisAssistantMessage(
          messagesWithUser,
          assistantContent,
          request.type,
          null,
          runGenerationId
        )
        setAnalysisMessages(nextMessages)
        setAnalysisStatus(result.status === 'needs_attention' ? 'waiting_for_approval' : 'error')
        setAnalysisStatusMessage(result.message)
        setAnalysisError(result.message)
        setActiveAnalysisRequest(null)
        return
      }

      // The turn may have completed just before a pause/revision request reached Core.
      // Keep the valid result; a pending revision will start after this promise settles.
      analysisInterruptionRef.current = null

      const parsed = parseProjectLogicDiagramResponse(result.responseBody)
      if (!parsed.ok) {
        if (!isCurrentRun()) return
        const nextMessages = appendAnalysisAssistantMessage(
          messagesWithUser,
          projectLogicResponseSummary(result.responseBody),
          request.type,
          null,
          runGenerationId
        )
        setAnalysisMessages(nextMessages)
        setAnalysisStatus('error')
        setAnalysisStatusMessage('分析回复已收到，但结构化逻辑图校验未通过。')
        setAnalysisError(`${parsed.error.message} 可在下方继续要求队员修正后重新生成。`)
        setActiveAnalysisRequest(null)
        return
      }

      const diagram = generatedDiagramIdentity(parsed.diagram, request.type, result.campTurnId)
      const assistantContent = projectLogicResponseSummary(result.responseBody)
        || `已基于项目证据生成“${diagram.title}”。`
      const nextMessages = appendAnalysisAssistantMessage(
        messagesWithUser,
        assistantContent,
        request.type,
        diagram,
        runGenerationId
      )
      const nextGeneratedDiagrams = appendGeneratedProjectLogicDiagram(
        previousGeneratedDiagrams,
        diagram
      )
      const cacheWrite = writeProjectLogicGenerationCache(window.localStorage, {
        schemaVersion: 1,
        projectPath: project.projectPath,
        scanFingerprint,
        diagram,
        diagrams: nextGeneratedDiagrams,
        campId: result.campId,
        messageSummaries: nextMessages.slice(-24).map((message) => ({
          role: message.role,
          content: projectLogicCacheMessageSummary(message.content)
        })),
        savedAt: new Date().toISOString()
      })
      if (!isCurrentRun()) return

      setAnalysisMessages(nextMessages)
      replaceGeneratedDiagrams(nextGeneratedDiagrams)
      setActiveDiagramId(diagram.id)
      setSelectedNodeId(diagram.primaryPath[0] ?? diagram.nodes[0]?.id ?? null)
      setReachDirection(null)
      setQuery('')
      setZoom(0.85)
      setGenerationCacheHit(true)
      setAnalysisPaused(false)
      setActiveAnalysisRequest(null)
      setAnalysisStatus('completed')
      setAnalysisStatusMessage(`已生成“${diagram.title}”，可继续追问并生成下一张图。`)
      if (!cacheWrite.ok) onNotify(cacheWrite.error)
      else onNotify(`已生成“${diagram.title}”`)
    } catch (nextError) {
      if (!isCurrentRun()) return
      const interruption = currentInterruption()
      if (interruption) {
        analysisInterruptionRef.current = null
        setAnalysisError(null)
        if (interruption === 'pause') {
          setAnalysisPaused(true)
          setAnalysisStatus('paused')
          setAnalysisStatusMessage('分析已暂停；同一项目分析会话和已有上下文均已保留。')
        } else {
          setAnalysisPaused(false)
          setAnalysisStatus('revising')
          setAnalysisStatusMessage('当前执行已安全暂停，正在按修改后的要求从同一会话继续…')
        }
        return
      }
      const message = errorMessage(nextError)
      const campId = projectLogicAnalysisErrorCampId(nextError)
      if (campId) setAnalysisCampId(campId)
      setAnalysisStatus('error')
      setAnalysisStatusMessage(message)
      setAnalysisError(message)
      setActiveAnalysisRequest(null)
    } finally {
      if (isCurrentRun()) {
        setActiveAnalysisTurnId(null)
        analysisRunningRef.current = false
        setAnalysisRunning(false)
        setAnalysisControlBusy(false)
      }
    }
  }, [
    activeDiagram,
    analysisRuntime,
    generationKey,
    onAnalysisCampReady,
    onNotify,
    project,
    replaceGeneratedDiagrams,
    scanFingerprint,
    selectedNode,
    setActiveAnalysisTurnId,
    setAnalysisCampId,
    setAnalysisMessages,
    snapshot
  ])

  const launchGeneration = useCallback((
    request: ProjectLogicGenerationRequest
  ): void => {
    if (!generationKey) {
      void runGeneration(request)
      return
    }
    const existing = projectLogicInflightAnalyses.get(generationKey)
    if (existing) {
      analysisRunningRef.current = true
      setAnalysisRunning(true)
      setAnalysisOpen(true)
      setAnalysisStatus('running')
      setAnalysisStatusMessage('该项目的深度分析仍在运行，正在继续跟踪同一任务…')
      if (existing.campId) setAnalysisCampId(existing.campId)
      if (existing.campTurnId) setActiveAnalysisTurnId(existing.campTurnId)
      setActiveAnalysisRequest(existing.request)
      void existing.promise.finally(() => {
        analysisRunningRef.current = false
        setAnalysisRunning(false)
        setAnalysisControlBusy(false)
        setActiveAnalysisTurnId(null)
        if (project && scanFingerprint) {
          const cached = readProjectLogicGenerationCache(
            window.localStorage,
            project.projectPath,
            scanFingerprint
          )
          if (cached.status === 'hit') {
            existing.interruption = null
            setGenerationCacheRevision((current) => current + 1)
          } else if (existing.interruption === 'pause') {
            existing.interruption = null
            setAnalysisPaused(true)
            setAnalysisStatus('paused')
            setAnalysisStatusMessage('分析已暂停；同一项目分析会话和已有上下文均已保留。')
            setAnalysisError(null)
          } else if (existing.interruption === 'revise') {
            existing.interruption = null
            setAnalysisPaused(false)
            setAnalysisStatus('revising')
            setAnalysisStatusMessage('当前执行已安全暂停，正在按修改后的要求从同一会话继续…')
            setAnalysisError(null)
          } else {
            setAnalysisStatus('error')
            setAnalysisStatusMessage('此前的深度分析已结束，但没有生成通过证据校验的逻辑图。')
            setAnalysisError('可调整范围后重新发送，或打开完整会话查看原始回复。')
          }
        }
      })
      return
    }

    const promise = runGeneration(request)
    const entry: ProjectLogicInflightAnalysis = {
      promise,
      campId: null,
      campTurnId: null,
      request,
      interruption: null
    }
    projectLogicInflightAnalyses.set(generationKey, entry)
    void promise.finally(() => {
      if (projectLogicInflightAnalyses.get(generationKey) === entry) {
        projectLogicInflightAnalyses.delete(generationKey)
      }
    })
  }, [generationKey, project, runGeneration, scanFingerprint, setActiveAnalysisTurnId, setAnalysisCampId])

  const interruptAnalysis = useCallback(async (
    intent: 'pause' | 'revise',
    revision: ProjectLogicGenerationRequest | null = null
  ): Promise<void> => {
    if (!analysisRunningRef.current || analysisControlBusy || analysisInterruptionRef.current) return
    const campId = analysisCampIdRef.current
    const campTurnId = activeAnalysisTurnIdRef.current
    if (!campId || !campTurnId) {
      if (intent === 'revise' && revision) {
        setAnalysisQuestion((current) => current.trim() ? current : revision.userRequest)
      }
      setAnalysisError('当前分析正在建立执行轮次，请稍候再暂停或修改。')
      return
    }
    if (intent === 'revise' && !revision) return

    analysisInterruptionRef.current = intent
    const inflight = generationKey ? projectLogicInflightAnalyses.get(generationKey) : null
    if (inflight) inflight.interruption = intent
    setAnalysisControlBusy(true)
    setAnalysisError(null)
    if (intent === 'pause') {
      setAnalysisStatus('pausing')
      setAnalysisStatusMessage('正在安全暂停当前分析，并保留同一项目分析会话…')
    } else {
      setPendingRevision(revision)
      setAnalysisStatus('revising')
      setAnalysisStatusMessage('正在安全结束当前执行，随后按修改后的要求继续…')
    }

    try {
      const coreRequest: ProjectLogicCoreRequest = (method, params) => window.rovai.request(method, params)
      await pauseProjectLogicAnalysis(coreRequest, campId, campTurnId)
    } catch (nextError) {
      if (analysisInterruptionRef.current === intent) analysisInterruptionRef.current = null
      if (inflight?.interruption === intent) inflight.interruption = null
      if (intent === 'revise') {
        setPendingRevision(null)
        if (revision) {
          setAnalysisQuestion((current) => current.trim() ? current : revision.userRequest)
        }
      }
      setAnalysisControlBusy(false)
      setAnalysisStatus('running')
      setAnalysisStatusMessage('当前分析仍在运行。')
      setAnalysisError(errorMessage(nextError))
    }
  }, [analysisControlBusy, generationKey])

  useEffect(() => {
    if (analysisRunning || analysisControlBusy || !pendingRevision) return
    const revision = pendingRevision
    setPendingRevision(null)
    setAnalysisPaused(false)
    launchGeneration(revision)
  }, [analysisControlBusy, analysisRunning, launchGeneration, pendingRevision])

  useEffect(() => {
    if (analysisPaused || analysisControlBusy || pendingRevision) return
    if (!projectLogicRuntimeStatusCanSync({
      snapshotReady: Boolean(snapshot),
      generationKey,
      hydratedGenerationKey,
      generationCacheHit,
      analysisRunning: analysisRunningRef.current
    })) return
    setAnalysisStatus(analysisRuntime ? 'idle' : 'unavailable')
    setAnalysisStatusMessage(analysisRuntime
      ? '文件结构图已生成。输入分析目标后，才会启动 Runtime 深读相关代码。'
      : '文件结构图已生成；按需深度分析需要先配置一个可用 Runtime。')
  }, [
    analysisControlBusy,
    analysisPaused,
    analysisRuntime,
    generationCacheHit,
    generationKey,
    hydratedGenerationKey,
    pendingRevision,
    snapshot
  ])

  const chooseDiagram = (diagram: ProjectLogicDiagram): void => {
    setActiveDiagramId(diagram.id)
    setSelectedNodeId(diagram.primaryPath[0] ?? diagram.nodes[0]?.id ?? null)
    setReachDirection(null)
    setQuery('')
    setZoom(0.85)
  }

  const openAnalysisConversation = (): void => {
    setAnalysisOpen(true)
    setAnalysisError(null)
    window.requestAnimationFrame(() => analysisInputRef.current?.focus())
  }

  const resumeAnalysis = (): void => {
    if (analysisRunningRef.current || analysisControlBusy) return
    const draft = analysisQuestion.trim()
    const previousRequest = activeAnalysisRequest
    if (!draft && !previousRequest) {
      setAnalysisError('没有可继续的分析目标，请先输入新的分析要求。')
      window.requestAnimationFrame(() => analysisInputRef.current?.focus())
      return
    }
    try {
      const request = createProjectLogicGenerationRequest({
        type: draft ? analysisMode : previousRequest?.type ?? analysisMode,
        userRequest: draft || previousRequest?.userRequest || ''
      })
      setAnalysisError(null)
      setAnalysisPaused(false)
      if (draft) setAnalysisQuestion('')
      launchGeneration(request)
    } catch (nextError) {
      setAnalysisError(errorMessage(nextError))
    }
  }

  const submitGeneration = (event: FormEvent): void => {
    event.preventDefault()
    if (analysisControlBusy) return
    try {
      const request = createProjectLogicGenerationRequest({
        type: analysisMode,
        userRequest: analysisQuestion
      })
      setAnalysisError(null)
      if (analysisRunningRef.current) {
        setAnalysisQuestion('')
        void interruptAnalysis('revise', request)
        return
      }
      setAnalysisQuestion('')
      setAnalysisPaused(false)
      launchGeneration(request)
    } catch (nextError) {
      setAnalysisError(errorMessage(nextError))
    }
  }

  const selectNode = (nodeId: string): void => {
    setSelectedNodeId(nodeId)
    setReachDirection(null)
  }

  const handleNodeKeyDown = (event: KeyboardEvent<SVGGElement>, nodeId: string): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectNode(nodeId)
  }

  const changeZoom = (delta: number): void => {
    setZoom((current) => clampZoom(current + delta))
  }

  const exportSvg = async (): Promise<void> => {
    if (!activeMap || !activeDiagram || !layout || exporting) return
    setExporting(true)
    try {
      const path = await window.rovai.projectLogic.exportSvg({
        suggestedName: projectLogicSuggestedFileName(`${activeMap.project.name}-${activeDiagram.title}`),
        svg: projectLogicMapToSvg(activeMap, layout, {
          title: activeDiagram.title,
          description: activeDiagram.description,
          documentMode
        })
      })
      if (path) onNotify(`“${activeDiagram.title}”已导出为 SVG`)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setExporting(false)
    }
  }

  const revealSource = async (relativePath: string): Promise<void> => {
    if (!project) return
    try {
      const revealed = await window.rovai.projectLogic.revealSource({
        projectPath: project.projectPath,
        relativePath
      })
      if (!revealed) onNotify('未能在文件管理器中定位该证据文件')
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }

  if (!project) {
    return (
      <section className="project-logic-workspace project-logic-empty" aria-labelledby="project-logic-title">
        <div className="project-logic-empty-mark" aria-hidden="true">⌘</div>
        <p className="settings-page-eyebrow">PROJECT LOGIC MAP</p>
        <h1 id="project-logic-title">选择一个项目，查看整体逻辑</h1>
        <p>Rovai 不会上传项目文件。选择项目后会先在本机生成文件结构图；只有你提交具体目标后，才会让队员深读相关代码并生成新的专项逻辑图。</p>
        <button className="primary-button" type="button" onClick={onChooseProject}>选择项目目录</button>
      </section>
    )
  }

  const analysisDraft = analysisQuestion.trim()
  const analysisDraftChangesActiveRequest = Boolean(analysisDraft) && (
    !activeAnalysisRequest
    || activeAnalysisRequest.type !== analysisMode
    || activeAnalysisRequest.userRequest.trim() !== analysisDraft
  )
  const canReviseRunningAnalysis = analysisRunning
    && Boolean(analysisCampId && activeAnalysisTurnId)
    && analysisDraftChangesActiveRequest
  const analysisSubmitDisabled = !analysisRuntime
    || analysisControlBusy
    || (!analysisRunning && !analysisDraft)
    || (analysisRunning && !canReviseRunningAnalysis)

  return (
    <section className="project-logic-workspace" aria-labelledby="project-logic-title">
      <header className="project-logic-header">
        <div>
          <p className="settings-page-eyebrow">PROJECT LOGIC MAP</p>
          <h1 id="project-logic-title">{project.name} · 项目逻辑图</h1>
          <p title={project.projectPath}>{displayLocalPath(project.projectPath)}</p>
        </div>
        <div className="project-logic-header-actions">
          <button
            className="quiet-button"
            type="button"
            aria-expanded={analysisOpen}
            onClick={() => analysisOpen ? setAnalysisOpen(false) : openAnalysisConversation()}
          >
            {analysisOpen ? '收起深度分析' : '按需深度分析'}
          </button>
          <button className="quiet-button" type="button" onClick={() => void scan()} disabled={loading}>
            {loading ? '正在扫描…' : '重新扫描'}
          </button>
          <button className="primary-button" type="button" onClick={() => void exportSvg()} disabled={!snapshot || exporting}>
            {exporting ? '正在导出…' : '导出 SVG'}
          </button>
        </div>
      </header>

      {error && (
        <div className="project-logic-error" role="alert">
          <div><strong>项目逻辑图暂时不可用</strong><span>{error}</span></div>
          <button className="quiet-button compact" type="button" onClick={() => void scan()}>重试</button>
        </div>
      )}

      {loading && !snapshot && (
        <div className="project-logic-loading" role="status" aria-live="polite">
          <span className="camp-loading-spinner" aria-hidden="true" />
          <div><strong>正在生成文件结构图</strong><span>扫描本地目录、项目清单、模块边界和静态依赖，不会启动 Runtime…</span></div>
        </div>
      )}

      {snapshot && activeMap && activeDiagram && layout && (
        <>
          <div className="project-logic-summary" aria-label="扫描摘要">
            <Metric label={documentMode ? '业务节点' : '模块'} value={activeMap.nodes.length} />
            <Metric label={documentMode ? '业务关系' : '关系'} value={activeMap.edges.length} />
            <Metric label="已扫描文件" value={snapshot.scan.scannedFileCount} />
            <Metric label={documentMode ? '资料类型' : '主要语言'} value={snapshot.scan.languages[0]?.name ?? '未识别'} />
            <Metric label="分析耗时" value={`${snapshot.scan.durationMs} ms`} />
          </div>

          <div className="project-logic-stages" aria-label="逻辑图生成阶段">
            <div className="complete">
              <span aria-hidden="true">1</span>
              <div>
                <strong>{staticDiagrams.some((diagram) => diagram.id === 'architecture') ? '文件结构图' : '项目基础图'}</strong>
                <small>本地静态扫描已完成，不启动 Runtime</small>
              </div>
            </div>
            <i aria-hidden="true" />
            <div className={analysisRunning ? 'active' : generatedDiagrams.length > 0 ? 'complete' : 'pending'}>
              <span aria-hidden="true">2</span>
              <div>
                <strong>按需深度分析</strong>
                <small>{analysisRunning
                  ? '正在围绕你的目标深读代码并生成新图'
                  : generatedDiagrams.length > 0
                    ? `已保留 ${generatedDiagrams.length} 张专项逻辑图，可继续追问`
                    : '提交具体目标后才会启动 Runtime'}</small>
              </div>
              {!analysisOpen && (
                <button type="button" className="quiet-button compact" onClick={openAnalysisConversation}>
                  {generatedDiagrams.length > 0 ? '继续提出需求' : '提出分析需求'}
                </button>
              )}
            </div>
          </div>

          {diagrams.length > 1 && (
            <nav className="project-logic-diagram-tabs" aria-label="业务逻辑图类型">
              {diagrams.map((diagram) => (
                <button
                  key={diagram.id}
                  type="button"
                  className={diagram.id === activeDiagram.id ? 'active' : ''}
                  aria-current={diagram.id === activeDiagram.id ? 'page' : undefined}
                  onClick={() => chooseDiagram(diagram)}
                >
                  <strong>{diagram.title}</strong>
                  <span>{diagram.nodes.length} 节点</span>
                </button>
              ))}
            </nav>
          )}

          <div className="project-logic-diagram-intro">
            <strong>{activeDiagram.title}</strong>
            {isGeneratedProjectLogicDiagram(activeDiagram) && <small>AI 深度分析</small>}
            {!isGeneratedProjectLogicDiagram(activeDiagram) && activeDiagram.id === 'architecture' && <small>本地结构底图</small>}
            <span>{activeDiagram.description}</span>
          </div>

          {analysisOpen && (
            <form className="project-logic-analysis" onSubmit={submitGeneration}>
              <div className="project-logic-analysis-heading">
                <div>
                  <strong>按需求深度分析并生成新图</strong>
                  <span>只有提交后才会启动队员；队员会围绕你的目标深读真实代码、配置、测试和文档，并把结果添加为独立新图。</span>
                </div>
                <div className="project-logic-analysis-modes" aria-label="逻辑图类型">
                  <button
                    type="button"
                    className={analysisMode === 'software-architecture' ? 'active' : ''}
                    aria-pressed={analysisMode === 'software-architecture'}
                    onClick={() => {
                      setAnalysisMode('software-architecture')
                      setAnalysisError(null)
                    }}
                  >
                    软件架构图
                  </button>
                  <button
                    type="button"
                    className={analysisMode === 'algorithm-architecture' ? 'active' : ''}
                    aria-pressed={analysisMode === 'algorithm-architecture'}
                    onClick={() => {
                      setAnalysisMode('algorithm-architecture')
                      setAnalysisError(null)
                    }}
                  >
                    算法架构图
                  </button>
                  <button
                    type="button"
                    className={analysisMode === 'custom' ? 'active' : ''}
                    aria-pressed={analysisMode === 'custom'}
                    onClick={() => {
                      setAnalysisMode('custom')
                      setAnalysisError(null)
                    }}
                  >
                    自定义图
                  </button>
                </div>
              </div>

              <div className={`project-logic-analysis-status ${analysisStatus}`} role="status" aria-live="polite">
                <span className="project-logic-analysis-status-mark" aria-hidden="true">
                  {analysisRunning ? <i className="camp-loading-spinner" /> : 'AI'}
                </span>
                <div>
                  <strong>{projectLogicAnalysisStatusLabel(analysisStatus)}</strong>
                  <span>{analysisStatusMessage}</span>
                </div>
                <div className="project-logic-analysis-status-actions">
                  {analysisRunning && (
                    <button
                      type="button"
                      className="quiet-button compact"
                      disabled={!analysisCampId || !activeAnalysisTurnId || analysisControlBusy}
                      onClick={() => { void interruptAnalysis('pause') }}
                    >
                      {analysisControlBusy
                        ? pendingRevision ? '正在应用修改…' : '正在暂停…'
                        : '暂停分析'}
                    </button>
                  )}
                  {analysisPaused && !analysisRunning && (
                    <button
                      type="button"
                      className="quiet-button compact"
                      disabled={!analysisRuntime || analysisControlBusy}
                      onClick={resumeAnalysis}
                    >
                      继续分析
                    </button>
                  )}
                  {analysisCampId && onOpenAnalysisCamp && (
                    <button type="button" className="quiet-button compact" onClick={() => onOpenAnalysisCamp(analysisCampId)}>
                      打开完整会话
                    </button>
                  )}
                  {!analysisRuntime && onConfigureRuntime && (
                    <button type="button" className="quiet-button compact" onClick={onConfigureRuntime}>
                      配置 Runtime
                    </button>
                  )}
                </div>
              </div>

              {analysisMessages.length > 0 && (
                <div className="project-logic-analysis-history" aria-label="逻辑图生成对话记录">
                  {analysisMessages.slice(-6).map((message) => (
                    <article key={message.id} className={message.role}>
                      <span>{message.role === 'assistant' ? '队员' : message.role === 'user' ? '你' : '系统'}</span>
                      <p>{message.content}</p>
                      {message.diagram && (
                        <button type="button" onClick={() => chooseDiagram(message.diagram as ProjectLogicDiagram)}>
                          查看“{message.diagram.title}”
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}

              <div className="project-logic-analysis-composer">
                <label>
                  <span className="sr-only">希望生成的逻辑图</span>
                  <textarea
                    ref={analysisInputRef}
                    value={analysisQuestion}
                    maxLength={PROJECT_LOGIC_QUESTION_MAX_LENGTH}
                    rows={2}
                    placeholder={projectLogicGenerationPlaceholder(analysisMode)}
                    onChange={(event) => {
                      setAnalysisQuestion(event.target.value)
                      setAnalysisError(null)
                    }}
                  />
                </label>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={analysisSubmitDisabled}
                >
                  {analysisControlBusy && pendingRevision
                    ? '正在应用修改…'
                    : analysisControlBusy
                      ? '正在暂停…'
                      : analysisRunning
                        ? '应用修改并继续'
                        : analysisPaused
                          ? '按当前要求继续'
                          : '分析并生成图'}
                </button>
              </div>
              <div className="project-logic-analysis-meta">
                <span>
                  上下文：{activeDiagram.title} · {activeDiagram.nodes.length} 个节点
                  {selectedNode ? ` · 当前焦点 ${selectedNode.label}` : ''}
                  {analysisRuntime ? ` · 执行队员 ${analysisRuntime.displayName}` : ''}
                </span>
                <span>{analysisQuestion.length} / {PROJECT_LOGIC_QUESTION_MAX_LENGTH}</span>
              </div>
              {analysisError && <p className="project-logic-analysis-error" role="alert">{analysisError}</p>}
              <p className="project-logic-analysis-note">
                原始“文件结构图”始终保留。AI 图只有在每个节点和关系都带有项目内相对路径证据并通过结构校验后才会显示；每轮生成独立新图，失败不会伪造或覆盖已有结果。
                逻辑图入口不再添加固定执行时限；运行中可以暂停，也可以直接输入修改后的目标并选择“应用修改并继续”，后续执行会复用同一项目分析会话。
              </p>
            </form>
          )}

          <div className="project-logic-tools">
            <label className="project-logic-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={documentMode ? '搜索角色、业务步骤或规则' : '搜索模块、路径或语言'}
                aria-label="搜索项目逻辑节点"
              />
              {normalizedQuery && <small>{queryMatchIds?.size ?? 0} 个匹配</small>}
            </label>
            <div className="project-logic-zoom" aria-label="画布缩放">
              <button type="button" aria-label="缩小" onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>−</button>
              <button type="button" aria-label="恢复默认缩放" onClick={() => setZoom(0.85)}>{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="放大" onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>＋</button>
            </div>
            <div className="project-logic-legend" aria-label="节点类型图例">
              {[...new Set(activeMap.nodes.map((node) => node.kind))].map((kind) => (
                <span key={kind} style={{ '--logic-color': projectLogicKindColor(kind) } as CSSProperties}>
                  <i aria-hidden="true" />{projectLogicKindLabel(kind)}
                </span>
              ))}
            </div>
          </div>

          <div className="project-logic-main">
            <div
              className="project-logic-canvas-viewport"
              onWheel={(event) => {
                if (!event.ctrlKey) return
                event.preventDefault()
                changeZoom(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)
              }}
            >
              <svg
                className="project-logic-canvas"
                width={layout.width * zoom}
                height={layout.height * zoom}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="img"
                aria-label={`${project.name} ${activeDiagram.title}，共 ${activeMap.nodes.length} 个节点和 ${activeMap.edges.length} 条关系`}
              >
                <defs>
                  <marker id="project-logic-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                <g className="project-logic-edges">
                  {layout.edges.map((edgeLayout) => {
                    const edge = edgeById.get(edgeLayout.id)
                    if (!edge) return null
                    const incident = selectedNodeId === edge.from || selectedNodeId === edge.to
                    const dimmed = emphasizedNodeIds !== null
                      && (!emphasizedNodeIds.has(edge.from) || !emphasizedNodeIds.has(edge.to))
                    return (
                      <g
                        key={edge.id}
                        className={classNames(
                          'project-logic-edge',
                          edgeLayout.primary && 'primary',
                          incident && 'incident',
                          dimmed && 'dimmed'
                        )}
                      >
                        <path d={edgeLayout.path} markerEnd="url(#project-logic-arrow)" />
                      </g>
                    )
                  })}
                </g>
                <g className="project-logic-nodes">
                  {layout.nodes.map((nodeLayout) => {
                    const node = nodeById.get(nodeLayout.id)
                    if (!node) return null
                    const selected = node.id === selectedNodeId
                    const matching = queryMatchIds?.has(node.id) === true
                    const dimmed = emphasizedNodeIds !== null && !emphasizedNodeIds.has(node.id)
                    const color = projectLogicKindColor(node.kind)
                    return (
                      <g
                        key={node.id}
                        className={classNames(
                          'project-logic-node',
                          selected && 'selected',
                          matching && 'matching',
                          dimmed && 'dimmed'
                        )}
                        transform={`translate(${nodeLayout.x} ${nodeLayout.y})`}
                        style={{ '--logic-color': color } as CSSProperties}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selected}
                        aria-label={documentMode
                          ? `${node.label}，${projectLogicKindLabel(node.kind)}，${node.sources.length} 条来源证据`
                          : `${node.label}，${projectLogicKindLabel(node.kind)}，${node.fileCount} 个文件`}
                        onClick={() => selectNode(node.id)}
                        onKeyDown={(event) => handleNodeKeyDown(event, node.id)}
                      >
                        <title>{`${node.label}\n${node.summary}\n${node.path}`}</title>
                        <rect className="project-logic-node-surface" width={nodeLayout.width} height={nodeLayout.height} rx="13" />
                        <rect className="project-logic-node-accent" width="4" height={nodeLayout.height} rx="2" />
                        <circle className="project-logic-node-dot" cx="20" cy="21" r="5" />
                        <text className="project-logic-node-kind" x="32" y="25">{projectLogicKindLabel(node.kind)}{node.entry ? ' · 入口' : ''}</text>
                        <text className="project-logic-node-title" x="16" y="51">{shorten(node.label, 24)}</text>
                        <text className="project-logic-node-path" x="16" y="72">{shorten(node.path, 32)}</text>
                        {node.sources.length > 0 && <text className="project-logic-source-count" x={nodeLayout.width - 14} y="23" textAnchor="end">SRC {node.sources.length}</text>}
                      </g>
                    )
                  })}
                </g>
                <g className="project-logic-edge-labels">
                  {layout.edges.map((edgeLayout) => {
                    const edge = edgeById.get(edgeLayout.id)
                    if (!edge) return null
                    const incident = selectedNodeId === edge.from || selectedNodeId === edge.to
                    const dimmed = emphasizedNodeIds !== null
                      && (!emphasizedNodeIds.has(edge.from) || !emphasizedNodeIds.has(edge.to))
                    const firstLineY = -((edgeLayout.labelLines.length - 1)
                      * PROJECT_LOGIC_EDGE_LABEL_LINE_HEIGHT) / 2 + 3.5
                    return (
                      <g
                        key={edge.id}
                        className={classNames(
                          'project-logic-edge-label',
                          edgeLayout.primary && 'primary',
                          incident && 'incident',
                          dimmed && 'dimmed'
                        )}
                        transform={`translate(${edgeLayout.labelX} ${edgeLayout.labelY})`}
                      >
                        <title>{edge.label || relationLabel(edge.relation)}</title>
                        <rect
                          x={-edgeLayout.labelWidth / 2}
                          y={-edgeLayout.labelHeight / 2}
                          width={edgeLayout.labelWidth}
                          height={edgeLayout.labelHeight}
                          rx="7"
                        />
                        <text textAnchor="middle" y={firstLineY}>
                          {edgeLayout.labelLines.map((line, index) => (
                            <tspan
                              key={`${edge.id}-${index}`}
                              x="0"
                              dy={index === 0 ? 0 : PROJECT_LOGIC_EDGE_LABEL_LINE_HEIGHT}
                            >
                              {line}
                            </tspan>
                          ))}
                        </text>
                      </g>
                    )
                  })}
                </g>
              </svg>
            </div>

            <ProjectLogicInspector
              node={selectedNode}
              connections={selectedConnections}
              nodeById={nodeById}
              reachDirection={reachDirection}
              onReachDirectionChange={setReachDirection}
              onSelectNode={selectNode}
              onRevealSource={(path) => void revealSource(path)}
              documentMode={documentMode}
            />
          </div>

          {(snapshot.warnings.length > 0 || snapshot.scan.truncated) && (
            <div className="project-logic-warning" role="status">
              <strong>扫描说明</strong>
              <span>{[...snapshot.warnings, ...(snapshot.scan.truncated ? ['项目较大，图谱基于扫描上限内的文件生成。'] : [])].join(' ')}</span>
            </div>
          )}
          <p className="project-logic-footnote">{documentMode
            ? '业务节点与分支来自产品文档中的角色、权限、流程、安全和记录规则；未写入文档的内容不会被当成已确认事实。点击节点可查看具体依据。'
            : '关系来自项目清单、目录结构和静态导入证据，不等同于完整的运行时调用链；点击节点可查看证据和追踪上下游。'}</p>
        </>
      )}
    </section>
  )
}

function ProjectLogicInspector({
  node,
  connections,
  nodeById,
  reachDirection,
  onReachDirectionChange,
  onSelectNode,
  onRevealSource,
  documentMode
}: {
  node: ProjectLogicNode | null
  connections: ProjectLogicEdge[]
  nodeById: Map<string, ProjectLogicNode>
  reachDirection: ProjectLogicReachDirection | null
  onReachDirectionChange(direction: ProjectLogicReachDirection | null): void
  onSelectNode(nodeId: string): void
  onRevealSource(path: string): void
  documentMode: boolean
}): JSX.Element {
  if (!node) {
    return (
      <aside className="project-logic-inspector project-logic-inspector-empty">
        <strong>节点详情</strong>
        <p>{documentMode ? '选择业务节点，查看前后流程与文档依据。' : '选择图中的模块，查看路径、依赖关系和来源证据。'}</p>
      </aside>
    )
  }
  return (
    <aside className="project-logic-inspector" aria-label={`${node.label} 节点详情`}>
      <div className="project-logic-inspector-heading">
        <span style={{ '--logic-color': projectLogicKindColor(node.kind) } as CSSProperties}><i />{projectLogicKindLabel(node.kind)}</span>
        {node.entry && <small>{documentMode ? '业务起点' : '入口模块'}</small>}
      </div>
      <h2>{node.label}</h2>
      <p>{node.summary}</p>
      <dl className="project-logic-node-facts">
        <div><dt>{documentMode ? '业务位置' : '目录'}</dt><dd title={node.path}>{node.path}</dd></div>
        <div><dt>{documentMode ? '业务类型' : '主要语言'}</dt><dd>{node.language ?? (documentMode ? projectLogicKindLabel(node.kind) : '未识别')}</dd></div>
        <div><dt>{documentMode ? '来源证据' : '文件数量'}</dt><dd>{documentMode ? node.sources.length : node.fileCount}</dd></div>
      </dl>
      <div className="project-logic-reach-actions" aria-label="关系追踪">
        <button
          type="button"
          className={reachDirection === 'upstream' ? 'active' : ''}
          aria-pressed={reachDirection === 'upstream'}
          onClick={() => onReachDirectionChange(reachDirection === 'upstream' ? null : 'upstream')}
        >{documentMode ? '前置流程' : '上游'}</button>
        <button
          type="button"
          className={reachDirection === 'downstream' ? 'active' : ''}
          aria-pressed={reachDirection === 'downstream'}
          onClick={() => onReachDirectionChange(reachDirection === 'downstream' ? null : 'downstream')}
        >{documentMode ? '后续流程' : '下游'}</button>
      </div>
      <section className="project-logic-inspector-section">
        <h3>直接关系 <span>{connections.length}</span></h3>
        {connections.length === 0 && <p className="project-logic-inspector-placeholder">{documentMode ? '该节点没有更多直接业务分支。' : '没有发现跨模块静态依赖。'}</p>}
        <div className="project-logic-connection-list">
          {connections.map((edge) => {
            const incoming = edge.to === node.id
            const counterpartId = incoming ? edge.from : edge.to
            const counterpart = nodeById.get(counterpartId)
            if (!counterpart) return null
            return (
              <button type="button" key={edge.id} onClick={() => onSelectNode(counterpartId)}>
                <span>{incoming ? '来自' : '指向'} · {relationLabel(edge.relation)}</span>
                <strong>{counterpart.label}</strong>
                <small>{edge.evidenceCount} 条证据</small>
              </button>
            )
          })}
        </div>
      </section>
      <section className="project-logic-inspector-section">
        <h3>来源证据 <span>{node.sources.length}</span></h3>
        {node.sources.length === 0 && <p className="project-logic-inspector-placeholder">{documentMode ? '文档中没有可定位的直接依据。' : '该节点仅由目录结构识别。'}</p>}
        <div className="project-logic-source-list">
          {node.sources.map((source, index) => (
            <button type="button" key={`${source.path}:${source.line ?? 0}:${index}`} onClick={() => onRevealSource(source.path)} title={`在文件管理器中定位 ${source.path}`}>
              <strong>{source.path}{source.line ? `:${source.line}` : ''}</strong>
              <span>{source.reason}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}

type ProjectLogicAnalysisUiStatus =
  | 'idle'
  | 'unavailable'
  | 'pausing'
  | 'paused'
  | 'revising'
  | ProjectLogicAnalysisProgressStatus
  | 'completed'
  | 'error'

export interface ProjectLogicAnalysisRuntime {
  agentId: string
  displayName: string
  memberAgentIds: string[]
}

export function projectLogicAnalysisRuntimeFromAgents(
  agents: readonly AgentProfile[]
): ProjectLogicAnalysisRuntime | null {
  const present = agents
    .filter((agent) => agent.presence === 'present')
    .sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId))
  const selected = present.find((agent) => agent.runtimeReadiness.status === 'ready')
    ?? present.find((agent) => agent.runtimeReadiness.status === 'light_ready')
    ?? null
  if (!selected) return null
  return {
    agentId: selected.agentId,
    displayName: selected.displayName,
    memberAgentIds: present.map((agent) => agent.agentId)
  }
}

export function projectLogicRuntimeStatusCanSync(input: {
  snapshotReady: boolean
  generationKey: string | null
  hydratedGenerationKey: string | null
  generationCacheHit: boolean
  analysisRunning: boolean
}): boolean {
  return input.snapshotReady
    && input.generationKey !== null
    && input.hydratedGenerationKey === input.generationKey
    && !input.generationCacheHit
    && !input.analysisRunning
}

function projectLogicGenerationTypeLabel(type: ProjectLogicGenerationRequestType): string {
  if (type === 'software-architecture') return '软件架构图'
  if (type === 'algorithm-architecture') return '算法架构图'
  return '自定义逻辑图'
}

function projectLogicGenerationPlaceholder(type: ProjectLogicGenerationRequestType): string {
  if (type === 'algorithm-architecture') {
    return '例如：只分析推荐排序算法，从真实调用入口拆解特征输入、召回、排序、阈值分支、复杂度和失效条件。'
  }
  if (type === 'custom') {
    return '例如：画出从用户提交订单到支付回调、库存补偿和失败重试的完整数据流与控制流。'
  }
  return '例如：深度分析插件系统，画出入口、模块职责、接口、数据流、状态变化、异常恢复和持久化边界。'
}

function projectLogicAnalysisStatusLabel(status: ProjectLogicAnalysisUiStatus): string {
  if (status === 'unavailable') return '等待 Runtime'
  if (status === 'preparing') return '准备分析'
  if (status === 'queued') return '已进入队列'
  if (status === 'running') return '正在深读项目'
  if (status === 'pausing') return '正在暂停'
  if (status === 'paused') return '分析已暂停'
  if (status === 'revising') return '正在应用修改'
  if (status === 'waiting_for_approval') return '需要你确认'
  if (status === 'completed') return '深度分析已完成'
  if (status === 'error') return '本轮未生成图'
  return '等待你的分析目标'
}

function appendAnalysisAssistantMessage(
  messages: ProjectLogicConversationMessage[],
  content: string,
  requestType: ProjectLogicGenerationRequestType,
  diagram: ProjectLogicDiagram | null,
  runGenerationId: number
): ProjectLogicConversationMessage[] {
  const message: ProjectLogicConversationMessage = {
    schemaVersion: 1,
    id: `logic-assistant-${runGenerationId}`,
    role: 'assistant',
    content: content.trim() || (diagram ? `已生成“${diagram.title}”。` : '本轮没有生成可用逻辑图。'),
    createdAt: new Date().toISOString(),
    requestType,
    diagram
  }
  return [...messages, message].slice(-24)
}

function generatedDiagramIdentity(
  diagram: ProjectLogicDiagram,
  requestType: ProjectLogicGenerationRequestType,
  campTurnId: string
): ProjectLogicDiagram {
  const suffix = campTurnId.replace(/[^a-zA-Z0-9_-]+/gu, '-').slice(-64) || String(Date.now())
  return {
    ...diagram,
    id: `ai-${requestType}-${suffix}`.slice(0, 128)
  }
}

function isGeneratedProjectLogicDiagram(diagram: ProjectLogicDiagram): boolean {
  return diagram.id.startsWith('ai-')
}

function projectLogicResponseSummary(responseBody: string): string {
  const withoutPayload = responseBody
    .replace(/```(?:rovai-project-logic[^\r\n`]*|json)?\r?\n[\s\S]*?```/giu, '')
    .trim()
  return Array.from(withoutPayload).slice(0, 1_600).join('')
}

function projectLogicCacheMessageSummary(content: string): string {
  return Array.from(content.trim().replace(/\s+/gu, ' ')).slice(0, 600).join('')
}

function projectLogicAnalysisErrorCampId(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('campId' in error)) return null
  const campId = (error as { campId?: unknown }).campId
  return typeof campId === 'string' && campId.trim() ? campId : null
}

function Metric({ label, value }: { label: string; value: string | number }): JSX.Element {
  return <div><strong>{value}</strong><span>{label}</span></div>
}

export function relationLabel(relation: ProjectLogicRelation): string {
  return RELATION_LABEL[relation]
}

export function recoverCompletedProjectLogicAnalyses(
  projection: Pick<CampOpenProjection, 'camp' | 'turns' | 'messages' | 'agentRuns'>
): ProjectLogicAnalysisRecovery[] {
  const completedTurnIds = new Set(
    projection.turns
      .filter((turn) => turn.status === 'completed')
      .map((turn) => turn.id)
  )
  const runByTurnId = new Map(
    projection.agentRuns.map((run) => [run.campTurnId, run])
  )
  const recoveredByTurnId = new Map<string, ProjectLogicAnalysisRecovery>()
  const messages = [...projection.messages]
    .filter((message) => message.authorType === 'agent' && message.campTurnId)
    .sort((left, right) => left.sequence - right.sequence)

  for (const message of messages) {
    const campTurnId = message.campTurnId as string
    if (!completedTurnIds.has(campTurnId)) continue
    const parsed = parseProjectLogicDiagramResponse(message.body)
    if (!parsed.ok) continue
    const run = runByTurnId.get(campTurnId)
    const purpose = run?.purpose?.trim() || '恢复已完成的项目逻辑分析。'
    const requestType = projectLogicRequestTypeFromPurpose(purpose)
    const diagram = generatedDiagramIdentity(parsed.diagram, requestType, campTurnId)
    recoveredByTurnId.set(campTurnId, {
      campId: projection.camp.id,
      campTurnId,
      requestType,
      purpose,
      assistantContent: projectLogicResponseSummary(message.body)
        || `已从本地分析记录恢复“${diagram.title}”。`,
      createdAt: message.createdAt,
      diagram
    })
  }
  return [...recoveredByTurnId.values()]
}

export function appendGeneratedProjectLogicDiagram(
  current: readonly ProjectLogicDiagram[],
  diagram: ProjectLogicDiagram
): ProjectLogicDiagram[] {
  return [
    ...current.filter((candidate) => candidate.id !== diagram.id),
    diagram
  ].slice(-GENERATED_DIAGRAM_SESSION_LIMIT)
}

function projectLogicRequestTypeFromPurpose(purpose: string): ProjectLogicGenerationRequestType {
  if (purpose.includes('算法架构图')) return 'algorithm-architecture'
  if (purpose.includes('自定义逻辑图')) return 'custom'
  return 'software-architecture'
}

export function projectLogicScanIdentity(project: WorkspaceSelection | null): string | null {
  if (!project?.projectPath) return null
  return projectLogicProjectPathIdentity(project.projectPath) || null
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '未知错误'
}

function displayLocalPath(path: string): string {
  return path.replace(/^\\\\\?\\/, '')
}
