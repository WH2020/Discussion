import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AgentProfile, StructuredCampMessageContent } from '@contracts'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from './AppDialog'
import type { ComposerSkillOption } from './composer-skill-picker'
import { MemberAvatar } from './MemberAvatar'
import {
  BUILTIN_DISCUSSION_SCENES,
  DISCUSSION_SCENE_CATEGORY_LABELS,
  MAX_DISCUSSION_SCENE_SQUAD_MEMBERS,
  MAX_CUSTOM_DISCUSSION_SCENES,
  buildDiscussionSceneDraft,
  createCustomDiscussionSceneId,
  discussionSceneLineInputError,
  discussionSceneSourceLabel,
  isBuiltinDiscussionScene,
  isConversationCreatedDiscussionScene,
  loadCustomDiscussionScenesResult,
  loadDiscussionSceneSquadsResult,
  mergeDiscussionScenes,
  normalizeDiscussionScene,
  normalizeDiscussionSceneSquad,
  parseDiscussionSceneLines,
  saveCustomDiscussionScenes,
  saveDiscussionSceneSquads,
  discussionSceneSquadFor,
  type DiscussionSceneCategory,
  type DiscussionSceneOrchestration,
  type DiscussionSceneParticipant,
  type DiscussionSceneSquadPreset,
  type DiscussionSceneTemplate
} from './discussion-scenes'

interface DiscussionSceneFormDraft {
  id: string | null
  name: string
  category: DiscussionSceneCategory
  summary: string
  roles: string
  agenda: string
  deliverables: string
  instructions: string
}

const BLANK_DISCUSSION_SCENE: DiscussionSceneFormDraft = {
  id: null,
  name: '',
  category: 'general',
  summary: '',
  roles: '主持人\n领域专家\n独立审阅者',
  agenda: '确认目标、输入材料和关键约束\n让各角色独立分析并提供依据\n比较方案、风险与验证方法',
  deliverables: '讨论结论\n分歧与待验证假设\n后续动作和验收标准',
  instructions: ''
}

export function DiscussionSceneLauncher({
  participants,
  agents,
  conversationScenes = [],
  composerSkills,
  skillCatalogStatus,
  composerDraftStatus,
  hasExistingDraft,
  initialSceneId = null,
  onInitialSceneConsumed,
  onAddMembers,
  onApply
}: {
  participants: DiscussionSceneParticipant[]
  agents: AgentProfile[]
  conversationScenes?: DiscussionSceneTemplate[]
  composerSkills: ComposerSkillOption[]
  skillCatalogStatus: 'loading' | 'ready' | 'error'
  composerDraftStatus: 'loading' | 'ready' | 'error'
  hasExistingDraft: boolean
  initialSceneId?: string | null
  onInitialSceneConsumed?(): void
  onAddMembers?(agentIds: string[]): Promise<void>
  onApply(
    content: StructuredCampMessageContent,
    sceneName: string,
    orchestration: DiscussionSceneOrchestration
  ): void
}): React.JSX.Element {
  const [initialSceneLoad] = useState(() => loadCustomDiscussionScenesResult())
  const [initialSquadLoad] = useState(() => loadDiscussionSceneSquadsResult())
  const [customScenes, setCustomScenes] = useState<DiscussionSceneTemplate[]>(
    initialSceneLoad.scenes
  )
  const [sceneSquads, setSceneSquads] = useState<DiscussionSceneSquadPreset[]>(
    initialSquadLoad.squads
  )
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedSceneId, setSelectedSceneId] = useState(BUILTIN_DISCUSSION_SCENES[0].id)
  const [editorDraft, setEditorDraft] = useState<DiscussionSceneFormDraft | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(
    initialSceneLoad.warning ?? initialSquadLoad.warning
  )
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [squadEditor, setSquadEditor] = useState<DiscussionSceneSquadPreset | null>(null)
  const [squadError, setSquadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [applyingSceneId, setApplyingSceneId] = useState<string | null>(null)
  const initialSceneAttempted = useRef<string | null>(null)
  const allScenes = useMemo(
    () => mergeDiscussionScenes(conversationScenes, customScenes),
    [conversationScenes, customScenes]
  )
  const selectedScene = allScenes.find((scene) => scene.id === selectedSceneId)
    ?? allScenes[0]
  const selectedSquad = discussionSceneSquadFor(selectedScene.id, sceneSquads)
  const presentAgents = useMemo(
    () => agents.filter((agent) => agent.presence === 'present'),
    [agents]
  )
  const leadPresent = participants.some((participant) => participant.isDefaultLead)
  const campfireSkill = leadPresent
    ? composerSkills.find((skill) => skill.name === 'campfire') ?? null
    : null
  const launcherScenes = [
    ...BUILTIN_DISCUSSION_SCENES,
    ...conversationScenes.slice(-2),
    ...customScenes.slice(0, 2)
  ]
  const draftReady = composerDraftStatus === 'ready'
  const readiness = composerDraftStatus === 'loading'
    ? '正在读取当前草稿，场景稍后可用…'
    : composerDraftStatus === 'error'
      ? '无法确认当前草稿，为避免覆盖已暂停场景填充。'
      : discussionSceneReadiness(
          participants.length,
          leadPresent,
          Boolean(campfireSkill),
          skillCatalogStatus
        )

  const applyScene = async (scene: DiscussionSceneTemplate): Promise<void> => {
    if (!draftReady || applyingSceneId) return
    setApplyingSceneId(scene.id)
    setActionError(null)
    try {
      const squad = discussionSceneSquadFor(scene.id, sceneSquads)
      const participantIds = new Set(participants.map((participant) => participant.agentId))
      const missingAgents = squad
        ? presentAgents.filter((agent) =>
            squad.memberAgentIds.includes(agent.agentId) && !participantIds.has(agent.agentId)
          )
        : []
      if (missingAgents.length > 0) {
        if (!onAddMembers) throw new Error('当前界面无法把预设队员加入会话。')
        await onAddMembers(missingAgents.map((agent) => agent.agentId))
      }
      const effectiveParticipants = [
        ...participants,
        ...missingAgents.map((agent) => ({
          agentId: agent.agentId,
          displayName: agent.displayName,
          teamRole: agent.teamRole || '队员',
          isDefaultLead: false
        }))
      ]
      const draft = buildDiscussionSceneDraft(
        scene,
        effectiveParticipants,
        campfireSkill ? { id: campfireSkill.id, name: campfireSkill.name } : null
      )
      onApply(draft.content, scene.name, draft.orchestration)
      setDialogOpen(false)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setApplyingSceneId(null)
    }
  }

  const requestScene = (scene: DiscussionSceneTemplate): void => {
    if (!draftReady) return
    if (hasExistingDraft) {
      setSelectedSceneId(scene.id)
      setDialogOpen(true)
      return
    }
    void applyScene(scene).catch(() => undefined)
  }

  useEffect(() => {
    if (!initialSceneId) {
      initialSceneAttempted.current = null
      return
    }
    if (!draftReady || initialSceneAttempted.current === initialSceneId) return
    initialSceneAttempted.current = initialSceneId
    const scene = allScenes.find((candidate) => candidate.id === initialSceneId)
    if (!scene) {
      setActionError('创建会话时选择的场景已不可用，请从场景库重新选择。')
      onInitialSceneConsumed?.()
      return
    }
    if (hasExistingDraft) {
      setActionError('输入框已有内容，未自动覆盖；可以从场景库手动填入。')
      onInitialSceneConsumed?.()
      return
    }
    void applyScene(scene)
      .catch(() => undefined)
      .finally(() => onInitialSceneConsumed?.())
  }, [initialSceneId, draftReady])

  const persistCustomScenes = (nextScenes: DiscussionSceneTemplate[]): boolean => {
    if (!saveCustomDiscussionScenes(nextScenes)) {
      setStorageError('自定义场景未能写入本机存储。内置场景仍可继续使用。')
      return false
    }
    setCustomScenes(nextScenes)
    setStorageError(null)
    return true
  }

  const persistSceneSquads = (nextSquads: DiscussionSceneSquadPreset[]): boolean => {
    if (!saveDiscussionSceneSquads(nextSquads)) {
      setStorageError('场景小队未能写入本机存储；原有配置保持不变。')
      return false
    }
    setSceneSquads(nextSquads)
    setStorageError(null)
    return true
  }

  const beginSquadEditing = (scene: DiscussionSceneTemplate): void => {
    const existing = discussionSceneSquadFor(scene.id, sceneSquads)
    const availableIds = new Set(presentAgents.map((agent) => agent.agentId))
    const memberAgentIds = existing?.memberAgentIds.filter((agentId) => availableIds.has(agentId))
      ?? participants.map((participant) => participant.agentId).filter((agentId) => availableIds.has(agentId))
    const fallbackMemberIds = memberAgentIds.length > 0
      ? memberAgentIds
      : presentAgents.slice(0, 1).map((agent) => agent.agentId)
    const defaultLeadAgentId = existing && fallbackMemberIds.includes(existing.defaultLeadAgentId)
      ? existing.defaultLeadAgentId
      : participants.find((participant) =>
          participant.isDefaultLead && fallbackMemberIds.includes(participant.agentId)
        )?.agentId ?? fallbackMemberIds[0] ?? ''
    setSquadEditor({
      sceneId: scene.id,
      memberAgentIds: fallbackMemberIds,
      defaultLeadAgentId
    })
    setSquadError(null)
  }

  const toggleSquadMember = (agentId: string): void => {
    if (!squadEditor) return
    const selected = squadEditor.memberAgentIds.includes(agentId)
    if (!selected && squadEditor.memberAgentIds.length >= MAX_DISCUSSION_SCENE_SQUAD_MEMBERS) {
      setSquadError(`每个预设小队最多 ${MAX_DISCUSSION_SCENE_SQUAD_MEMBERS} 位队员。`)
      return
    }
    const memberAgentIds = selected
      ? squadEditor.memberAgentIds.filter((candidate) => candidate !== agentId)
      : presentAgents
          .filter((agent) => squadEditor.memberAgentIds.includes(agent.agentId) || agent.agentId === agentId)
          .map((agent) => agent.agentId)
    setSquadEditor({
      ...squadEditor,
      memberAgentIds,
      defaultLeadAgentId: memberAgentIds.includes(squadEditor.defaultLeadAgentId)
        ? squadEditor.defaultLeadAgentId
        : memberAgentIds[0] ?? ''
    })
    setSquadError(null)
  }

  const saveSquadEditor = (): void => {
    if (!squadEditor) return
    const { squad, error } = normalizeDiscussionSceneSquad(squadEditor)
    if (!squad) {
      setSquadError(error ?? '预设小队无效。')
      return
    }
    const nextSquads = [
      ...sceneSquads.filter((candidate) => candidate.sceneId !== squad.sceneId),
      squad
    ]
    if (!persistSceneSquads(nextSquads)) return
    setSquadEditor(null)
    setSquadError(null)
  }

  const clearSelectedSquad = (): void => {
    if (!selectedSquad) return
    if (!persistSceneSquads(sceneSquads.filter((squad) => squad.sceneId !== selectedSquad.sceneId))) return
    setSquadEditor(null)
    setSquadError(null)
  }

  const beginNewScene = (): void => {
    setEditorDraft({ ...BLANK_DISCUSSION_SCENE })
    setEditorError(null)
    setConfirmingDeleteId(null)
    setSquadEditor(null)
  }

  const beginEditingScene = (scene: DiscussionSceneTemplate): void => {
    const copyAsCustom = isBuiltinDiscussionScene(scene)
      || isConversationCreatedDiscussionScene(scene)
    setEditorDraft(sceneFormDraft(
      scene,
      copyAsCustom ? null : scene.id,
      copyAsCustom ? `${scene.name}（自定义）` : scene.name
    ))
    setEditorError(null)
    setConfirmingDeleteId(null)
    setSquadEditor(null)
  }

  const saveEditor = (event: FormEvent): void => {
    event.preventDefault()
    if (!editorDraft) return
    const lineError = [
      discussionSceneLineInputError(editorDraft.roles, '角色 / 视角'),
      discussionSceneLineInputError(editorDraft.agenda, '讨论议程'),
      discussionSceneLineInputError(editorDraft.deliverables, '最终交付')
    ].find((error) => error !== null)
    if (lineError) {
      setEditorError(lineError)
      return
    }
    let id = editorDraft.id
    try {
      id ??= createCustomDiscussionSceneId()
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error))
      return
    }
    const { scene, error } = normalizeDiscussionScene({
      id,
      name: editorDraft.name,
      category: editorDraft.category,
      summary: editorDraft.summary,
      roles: parseDiscussionSceneLines(editorDraft.roles),
      agenda: parseDiscussionSceneLines(editorDraft.agenda),
      deliverables: parseDiscussionSceneLines(editorDraft.deliverables),
      instructions: editorDraft.instructions
    })
    if (!scene) {
      setEditorError(error ?? '场景内容无效。')
      return
    }
    const exists = customScenes.some((candidate) => candidate.id === scene.id)
    if (!exists && customScenes.length >= MAX_CUSTOM_DISCUSSION_SCENES) {
      setEditorError(`最多保存 ${MAX_CUSTOM_DISCUSSION_SCENES} 个自定义场景。`)
      return
    }
    const nextScenes = exists
      ? customScenes.map((candidate) => candidate.id === scene.id ? scene : candidate)
      : [...customScenes, scene]
    if (!persistCustomScenes(nextScenes)) return
    setSelectedSceneId(scene.id)
    setEditorDraft(null)
    setEditorError(null)
  }

  const deleteSelectedScene = (): void => {
    if (
      !selectedScene
      || isBuiltinDiscussionScene(selectedScene)
      || isConversationCreatedDiscussionScene(selectedScene)
    ) return
    if (confirmingDeleteId !== selectedScene.id) {
      setConfirmingDeleteId(selectedScene.id)
      return
    }
    const nextScenes = customScenes.filter((scene) => scene.id !== selectedScene.id)
    if (!persistCustomScenes(nextScenes)) return
    persistSceneSquads(sceneSquads.filter((squad) => squad.sceneId !== selectedScene.id))
    setSelectedSceneId(BUILTIN_DISCUSSION_SCENES[0].id)
    setConfirmingDeleteId(null)
    setSquadEditor(null)
  }

  return (
    <section className="discussion-scene-launcher" aria-labelledby="discussion-scene-title">
      <div className="discussion-scene-heading">
        <div>
          <span className="discussion-scene-heading-mark" aria-hidden="true">◇</span>
          <span><strong id="discussion-scene-title">工程讨论场景</strong><small>{readiness}</small></span>
        </div>
        <Dialog.Root
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) {
              setEditorDraft(null)
              setEditorError(null)
              setConfirmingDeleteId(null)
              setSquadEditor(null)
              setSquadError(null)
            }
          }}
        >
          <Dialog.Trigger asChild>
            <button className="discussion-scene-manage" type="button">管理场景与小队</button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
            <AppDialogContent
              className="discussion-scene-dialog"
              width="large"
              aria-describedby="discussion-scene-dialog-description"
            >
              {editorDraft
                ? (
                    <form className="discussion-scene-editor" onSubmit={saveEditor}>
                      <AppDialogHeader
                        icon="pencil"
                        kicker="LOCAL SCENE"
                        title={editorDraft.id ? '编辑讨论场景' : '新建讨论场景'}
                        description="定义本场需要覆盖的角色、议程与交付物；保存后只在当前设备可用。"
                        descriptionId="discussion-scene-dialog-description"
                      />
                      <AppDialogBody className="discussion-scene-editor-body">
                        <DiscussionSceneEditorFields draft={editorDraft} onChange={setEditorDraft} />
                        {editorError && <p className="discussion-scene-error" role="alert">{editorError}</p>}
                        {storageError && <p className="discussion-scene-error" role="alert">{storageError}</p>}
                      </AppDialogBody>
                      <AppDialogFooter note="每组最多 12 项、每项 180 字符；重复空行会自动整理。">
                        <button className="quiet-button" type="button" onClick={() => { setEditorDraft(null); setEditorError(null) }}>返回场景库</button>
                        <button className="primary-button" type="submit">保存场景</button>
                      </AppDialogFooter>
                    </form>
                  )
                : (
                    <>
                      <AppDialogHeader
                        icon="sparkles"
                        kicker="DISCUSSION SCENES"
                        title="讨论场景库"
                        description="定义角色、议程、输出要求和预设小队；场景启动后仍可临时增加队员。"
                        descriptionId="discussion-scene-dialog-description"
                      />
                      <AppDialogBody className="discussion-scene-library-body">
                        <aside className="discussion-scene-roster" aria-label="讨论场景列表">
                          <button className="discussion-scene-new" type="button" onClick={beginNewScene}>＋ 新建自定义场景</button>
                          <div aria-label="选择讨论场景">
                            {allScenes.map((scene) => (
                              <button
                                className={scene.id === selectedScene.id ? 'selected' : ''}
                                type="button"
                                aria-pressed={scene.id === selectedScene.id}
                                key={scene.id}
                                onClick={() => {
                                  setSelectedSceneId(scene.id)
                                  setConfirmingDeleteId(null)
                                  setSquadEditor(null)
                                  setSquadError(null)
                                }}
                              >
                                <span>{DISCUSSION_SCENE_CATEGORY_LABELS[scene.category]}</span>
                                <strong>{scene.name}</strong>
                                <small>
                                  {discussionSceneSourceLabel(scene)} · {discussionSceneSquadFor(scene.id, sceneSquads)?.memberAgentIds.length ?? 0} 人小队
                                </small>
                              </button>
                            ))}
                          </div>
                        </aside>
                        <section className="discussion-scene-detail" aria-label="场景详情">
                          <header>
                            <span>{DISCUSSION_SCENE_CATEGORY_LABELS[selectedScene.category]} · {discussionSceneSourceLabel(selectedScene)}</span>
                            <h3>{selectedScene.name}</h3>
                            <p>{selectedScene.summary}</p>
                          </header>
                          <SceneDetailList title="角色 / 视角" items={selectedScene.roles} />
                          <SceneDetailList title="讨论议程" items={selectedScene.agenda} ordered />
                          <SceneDetailList title="最终交付" items={selectedScene.deliverables} />
                          {selectedScene.instructions && (
                            <div className="discussion-scene-instruction"><strong>补充要求</strong><p>{selectedScene.instructions}</p></div>
                          )}
                          {squadEditor?.sceneId === selectedScene.id
                            ? (
                                <SceneSquadEditor
                                  draft={squadEditor}
                                  candidates={presentAgents}
                                  error={squadError}
                                  onToggle={toggleSquadMember}
                                  onLead={(agentId) => setSquadEditor({ ...squadEditor, defaultLeadAgentId: agentId })}
                                  onCancel={() => { setSquadEditor(null); setSquadError(null) }}
                                  onSave={saveSquadEditor}
                                />
                              )
                            : (
                                <SceneSquadSummary
                                  squad={selectedSquad}
                                  agents={agents}
                                  onEdit={() => beginSquadEditing(selectedScene)}
                                  onClear={selectedSquad ? clearSelectedSquad : undefined}
                                />
                              )}
                          <p className="discussion-scene-authority-note">
                            场景会确保预设小队进入当前会话，但不会修改队员的长期身份；临时队员只属于本会话。草稿仍不会自动发送或启动执行。
                          </p>
                          {hasExistingDraft && (
                            <p className="discussion-scene-delete-warning" role="alert">输入框已有草稿。继续将用该场景提纲覆盖现有正文；已添加的附件不受影响。</p>
                          )}
                          {storageError && <p className="discussion-scene-error" role="alert">{storageError}</p>}
                          {actionError && <p className="discussion-scene-error" role="alert">{actionError}</p>}
                          {confirmingDeleteId === selectedScene.id && (
                            <p className="discussion-scene-delete-warning" role="alert">再次点击“确认删除”将从本机移除此场景，内置场景和已有对话不受影响。</p>
                          )}
                        </section>
                      </AppDialogBody>
                      <AppDialogFooter note="对话创建场景由 Core 持久保留；手动自定义和小队预设保存在本机。发送前仍可修改输入框并添加附件。">
                        {!isBuiltinDiscussionScene(selectedScene) && !isConversationCreatedDiscussionScene(selectedScene) && (
                          <button
                            className={confirmingDeleteId === selectedScene.id ? 'danger-button' : 'quiet-button'}
                            type="button"
                            onClick={deleteSelectedScene}
                          >{confirmingDeleteId === selectedScene.id ? '确认删除' : '删除'}</button>
                        )}
                        <button className="quiet-button" type="button" onClick={() => beginEditingScene(selectedScene)}>
                          {isBuiltinDiscussionScene(selectedScene) || isConversationCreatedDiscussionScene(selectedScene) ? '复制并编辑' : '编辑'}
                        </button>
                        <button className="primary-button" type="button" disabled={!draftReady || Boolean(applyingSceneId)} onClick={() => void applyScene(selectedScene).catch(() => undefined)}>
                          {applyingSceneId === selectedScene.id ? '正在集结小队…' : hasExistingDraft ? '覆盖并填入' : '集结小队并填入'}
                        </button>
                      </AppDialogFooter>
                    </>
                  )}
            </AppDialogContent>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <div className="discussion-scene-grid" aria-label="常用讨论场景">
        {launcherScenes.map((scene) => (
          <button type="button" key={scene.id} disabled={!draftReady || Boolean(applyingSceneId)} onClick={() => requestScene(scene)}>
            <span>{DISCUSSION_SCENE_CATEGORY_LABELS[scene.category]}</span>
            <strong>{scene.name}</strong>
            <small>{scene.summary}{discussionSceneSquadFor(scene.id, sceneSquads) ? ` · 预设 ${discussionSceneSquadFor(scene.id, sceneSquads)?.memberAgentIds.length} 人` : ''}</small>
          </button>
        ))}
      </div>
      {actionError && !dialogOpen && <p className="discussion-scene-error" role="alert">{actionError}</p>}
    </section>
  )
}

function DiscussionSceneEditorFields({
  draft,
  onChange
}: {
  draft: DiscussionSceneFormDraft
  onChange(draft: DiscussionSceneFormDraft): void
}): React.JSX.Element {
  return (
    <div className="discussion-scene-editor-fields">
      <div className="discussion-scene-editor-row">
        <label>场景名称<input data-dialog-autofocus value={draft.name} maxLength={60} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="例如：嵌入式方案评审" /></label>
        <label>分类<select value={draft.category} onChange={(event) => onChange({ ...draft, category: event.target.value as DiscussionSceneCategory })}>
          {(Object.entries(DISCUSSION_SCENE_CATEGORY_LABELS) as Array<[DiscussionSceneCategory, string]>).map(([value, label]) => (
            <option value={value} key={value}>{label}</option>
          ))}
        </select></label>
      </div>
      <label>场景说明<textarea rows={2} value={draft.summary} maxLength={180} onChange={(event) => onChange({ ...draft, summary: event.target.value })} placeholder="说明这个场景解决什么问题，以及什么时候使用。" /></label>
      <div className="discussion-scene-editor-columns">
        <label>角色 / 视角 <small>每行一个 · 最多 12 项</small><textarea rows={6} maxLength={5_000} value={draft.roles} onChange={(event) => onChange({ ...draft, roles: event.target.value })} /></label>
        <label>讨论议程 <small>每行一步 · 最多 12 项</small><textarea rows={6} maxLength={5_000} value={draft.agenda} onChange={(event) => onChange({ ...draft, agenda: event.target.value })} /></label>
      </div>
      <label>最终交付 <small>每行一项 · 最多 12 项</small><textarea rows={4} maxLength={5_000} value={draft.deliverables} onChange={(event) => onChange({ ...draft, deliverables: event.target.value })} /></label>
      <label>补充要求 <small>可选</small><textarea rows={3} value={draft.instructions} maxLength={2_000} onChange={(event) => onChange({ ...draft, instructions: event.target.value })} placeholder="例如：额外关注功耗、法规、版本兼容或量产测试。" /></label>
    </div>
  )
}

function SceneSquadSummary({
  squad,
  agents,
  onEdit,
  onClear
}: {
  squad: DiscussionSceneSquadPreset | null
  agents: AgentProfile[]
  onEdit(): void
  onClear?(): void
}): React.JSX.Element {
  const agentById = new Map(agents.map((agent) => [agent.agentId, agent]))
  const availableMembers = squad?.memberAgentIds.flatMap((agentId) => {
    const agent = agentById.get(agentId)
    return agent?.presence === 'present' ? [agent] : []
  }) ?? []
  const unavailableCount = (squad?.memberAgentIds.length ?? 0) - availableMembers.length
  return (
    <div className="discussion-scene-squad">
      <div className="discussion-scene-squad-heading">
        <div><strong>预设小队</strong><small>创建会话时自动选中；已有会话会补齐缺少的队员。</small></div>
        <div>
          {onClear && <button type="button" className="quiet-button compact" onClick={onClear}>清除</button>}
          <button type="button" className="quiet-button compact" onClick={onEdit}>{squad ? '调整小队' : '配置小队'}</button>
        </div>
      </div>
      {squad
        ? (
            <div className="discussion-scene-squad-members">
              {availableMembers.map((agent) => (
                <span className={agent.agentId === squad.defaultLeadAgentId ? 'is-lead' : ''} key={agent.agentId}>
                  <MemberAvatar agentId={agent.agentId} avatarRef={agent.avatarRef} displayName={agent.displayName} size="mention" decorative />
                  <span><strong>{agent.displayName}</strong><small>{agent.agentId === squad.defaultLeadAgentId ? `负责人 · ${agent.teamRole || '队员'}` : agent.teamRole || '队员'}</small></span>
                </span>
              ))}
              {unavailableCount > 0 && <em>{unavailableCount} 位已配置队员当前不可用</em>}
            </div>
          )
        : <p className="discussion-scene-squad-empty">尚未配置，启动时沿用当前会话的小队。</p>}
    </div>
  )
}

function SceneSquadEditor({
  draft,
  candidates,
  error,
  onToggle,
  onLead,
  onCancel,
  onSave
}: {
  draft: DiscussionSceneSquadPreset
  candidates: AgentProfile[]
  error: string | null
  onToggle(agentId: string): void
  onLead(agentId: string): void
  onCancel(): void
  onSave(): void
}): React.JSX.Element {
  const selected = candidates.filter((agent) => draft.memberAgentIds.includes(agent.agentId))
  return (
    <div className="discussion-scene-squad is-editing">
      <div className="discussion-scene-squad-heading">
        <div><strong>配置预设小队</strong><small>只保存队员引用，不复制或修改队员身份 · 已选 {draft.memberAgentIds.length}/{MAX_DISCUSSION_SCENE_SQUAD_MEMBERS}</small></div>
      </div>
      <div className="discussion-scene-squad-options" role="group" aria-label="选择预设队员">
        {candidates.map((agent) => (
          <label className={draft.memberAgentIds.includes(agent.agentId) ? 'selected' : ''} key={agent.agentId}>
            <input type="checkbox" checked={draft.memberAgentIds.includes(agent.agentId)} onChange={() => onToggle(agent.agentId)} />
            <MemberAvatar agentId={agent.agentId} avatarRef={agent.avatarRef} displayName={agent.displayName} size="mention" decorative />
            <span><strong>{agent.displayName}</strong><small>{agent.teamRole || '队员'}</small></span>
          </label>
        ))}
        {candidates.length === 0 && <p>当前没有可加入预设小队的在队成员。</p>}
      </div>
      <label className="discussion-scene-squad-lead">
        <span>预设负责人</span>
        <select value={draft.defaultLeadAgentId} disabled={selected.length === 0} onChange={(event) => onLead(event.target.value)}>
          {selected.map((agent) => <option value={agent.agentId} key={agent.agentId}>{agent.displayName} · {agent.teamRole || '队员'}</option>)}
        </select>
      </label>
      {error && <p className="discussion-scene-error" role="alert">{error}</p>}
      <div className="discussion-scene-squad-actions">
        <button type="button" className="quiet-button compact" onClick={onCancel}>取消</button>
        <button type="button" className="primary-button compact" onClick={onSave}>保存小队</button>
      </div>
    </div>
  )
}

function SceneDetailList({ title, items, ordered = false }: {
  title: string
  items: string[]
  ordered?: boolean
}): React.JSX.Element {
  const List = ordered ? 'ol' : 'ul'
  return (
    <div className="discussion-scene-detail-list">
      <strong>{title}</strong>
      <List>{items.map((item) => <li key={item}>{item}</li>)}</List>
    </div>
  )
}

function sceneFormDraft(
  scene: DiscussionSceneTemplate,
  id: string | null,
  name: string
): DiscussionSceneFormDraft {
  return {
    id,
    name,
    category: scene.category,
    summary: scene.summary,
    roles: scene.roles.join('\n'),
    agenda: scene.agenda.join('\n'),
    deliverables: scene.deliverables.join('\n'),
    instructions: scene.instructions
  }
}

function discussionSceneReadiness(
  participantCount: number,
  leadPresent: boolean,
  campfireAvailable: boolean,
  skillCatalogStatus: 'loading' | 'ready' | 'error'
): string {
  if (participantCount < 2) return '当前不足 2 位在队成员，将生成单人多视角提纲。'
  if (!leadPresent) return '当前默认负责人不可用；将生成结构化评审提纲。'
  if (participantCount < 3) return '负责人外不足 2 位队员，将生成双角色评审提纲。'
  if (campfireAvailable) return '选择后由负责人组织多角色讨论；发送前可继续修改。'
  if (skillCatalogStatus === 'loading') return '正在确认负责人的多人讨论能力…'
  return '多人讨论 Skill 暂不可用；仍可生成结构化评审提纲。'
}
