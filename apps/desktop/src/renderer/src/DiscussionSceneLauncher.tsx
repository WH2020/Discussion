import { useMemo, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { StructuredCampMessageContent } from '@contracts'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from './AppDialog'
import type { ComposerSkillOption } from './composer-skill-picker'
import {
  BUILTIN_DISCUSSION_SCENES,
  DISCUSSION_SCENE_CATEGORY_LABELS,
  MAX_CUSTOM_DISCUSSION_SCENES,
  buildDiscussionSceneDraft,
  createCustomDiscussionSceneId,
  discussionSceneLineInputError,
  isBuiltinDiscussionScene,
  loadCustomDiscussionScenesResult,
  normalizeDiscussionScene,
  parseDiscussionSceneLines,
  saveCustomDiscussionScenes,
  type DiscussionSceneCategory,
  type DiscussionSceneOrchestration,
  type DiscussionSceneParticipant,
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
  composerSkills,
  skillCatalogStatus,
  composerDraftStatus,
  hasExistingDraft,
  onApply
}: {
  participants: DiscussionSceneParticipant[]
  composerSkills: ComposerSkillOption[]
  skillCatalogStatus: 'loading' | 'ready' | 'error'
  composerDraftStatus: 'loading' | 'ready' | 'error'
  hasExistingDraft: boolean
  onApply(
    content: StructuredCampMessageContent,
    sceneName: string,
    orchestration: DiscussionSceneOrchestration
  ): void
}): React.JSX.Element {
  const [initialSceneLoad] = useState(() => loadCustomDiscussionScenesResult())
  const [customScenes, setCustomScenes] = useState<DiscussionSceneTemplate[]>(
    initialSceneLoad.scenes
  )
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedSceneId, setSelectedSceneId] = useState(BUILTIN_DISCUSSION_SCENES[0].id)
  const [editorDraft, setEditorDraft] = useState<DiscussionSceneFormDraft | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(initialSceneLoad.warning)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const allScenes = useMemo(
    () => [...BUILTIN_DISCUSSION_SCENES, ...customScenes],
    [customScenes]
  )
  const selectedScene = allScenes.find((scene) => scene.id === selectedSceneId)
    ?? allScenes[0]
  const leadPresent = participants.some((participant) => participant.isDefaultLead)
  const campfireSkill = leadPresent
    ? composerSkills.find((skill) => skill.name === 'campfire') ?? null
    : null
  const launcherScenes = [
    ...BUILTIN_DISCUSSION_SCENES,
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

  const applyScene = (scene: DiscussionSceneTemplate): void => {
    if (!draftReady) return
    const draft = buildDiscussionSceneDraft(
      scene,
      participants,
      campfireSkill ? { id: campfireSkill.id, name: campfireSkill.name } : null
    )
    onApply(draft.content, scene.name, draft.orchestration)
    setDialogOpen(false)
  }

  const requestScene = (scene: DiscussionSceneTemplate): void => {
    if (!draftReady) return
    if (hasExistingDraft) {
      setSelectedSceneId(scene.id)
      setDialogOpen(true)
      return
    }
    applyScene(scene)
  }

  const persistCustomScenes = (nextScenes: DiscussionSceneTemplate[]): boolean => {
    if (!saveCustomDiscussionScenes(nextScenes)) {
      setStorageError('自定义场景未能写入本机存储。内置场景仍可继续使用。')
      return false
    }
    setCustomScenes(nextScenes)
    setStorageError(null)
    return true
  }

  const beginNewScene = (): void => {
    setEditorDraft({ ...BLANK_DISCUSSION_SCENE })
    setEditorError(null)
    setConfirmingDeleteId(null)
  }

  const beginEditingScene = (scene: DiscussionSceneTemplate): void => {
    setEditorDraft(sceneFormDraft(
      scene,
      isBuiltinDiscussionScene(scene) ? null : scene.id,
      isBuiltinDiscussionScene(scene) ? `${scene.name}（自定义）` : scene.name
    ))
    setEditorError(null)
    setConfirmingDeleteId(null)
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
    if (!selectedScene || isBuiltinDiscussionScene(selectedScene)) return
    if (confirmingDeleteId !== selectedScene.id) {
      setConfirmingDeleteId(selectedScene.id)
      return
    }
    const nextScenes = customScenes.filter((scene) => scene.id !== selectedScene.id)
    if (!persistCustomScenes(nextScenes)) return
    setSelectedSceneId(BUILTIN_DISCUSSION_SCENES[0].id)
    setConfirmingDeleteId(null)
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
            }
          }}
        >
          <Dialog.Trigger asChild>
            <button className="discussion-scene-manage" type="button">管理自定义场景</button>
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
                        description="选择内置工程场景，或保存自己的角色、议程和输出要求。"
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
                                }}
                              >
                                <span>{DISCUSSION_SCENE_CATEGORY_LABELS[scene.category]}</span>
                                <strong>{scene.name}</strong>
                                <small>{isBuiltinDiscussionScene(scene) ? '内置' : '自定义'}</small>
                              </button>
                            ))}
                          </div>
                        </aside>
                        <section className="discussion-scene-detail" aria-label="场景详情">
                          <header>
                            <span>{DISCUSSION_SCENE_CATEGORY_LABELS[selectedScene.category]} · {isBuiltinDiscussionScene(selectedScene) ? '内置场景' : '本机自定义'}</span>
                            <h3>{selectedScene.name}</h3>
                            <p>{selectedScene.summary}</p>
                          </header>
                          <SceneDetailList title="角色 / 视角" items={selectedScene.roles} />
                          <SceneDetailList title="讨论议程" items={selectedScene.agenda} ordered />
                          <SceneDetailList title="最终交付" items={selectedScene.deliverables} />
                          {selectedScene.instructions && (
                            <div className="discussion-scene-instruction"><strong>补充要求</strong><p>{selectedScene.instructions}</p></div>
                          )}
                          <p className="discussion-scene-authority-note">
                            场景只填充当前 Camp 的权威草稿，不会修改队员身份，也不会自动发送或启动执行。
                          </p>
                          {hasExistingDraft && (
                            <p className="discussion-scene-delete-warning" role="alert">输入框已有草稿。继续将用该场景提纲覆盖现有正文；已添加的附件不受影响。</p>
                          )}
                          {storageError && <p className="discussion-scene-error" role="alert">{storageError}</p>}
                          {confirmingDeleteId === selectedScene.id && (
                            <p className="discussion-scene-delete-warning" role="alert">再次点击“确认删除”将从本机移除此场景，内置场景和已有对话不受影响。</p>
                          )}
                        </section>
                      </AppDialogBody>
                      <AppDialogFooter note="模板只保存在本机；发送前仍可在输入框修改并添加附件。">
                        {!isBuiltinDiscussionScene(selectedScene) && (
                          <button
                            className={confirmingDeleteId === selectedScene.id ? 'danger-button' : 'quiet-button'}
                            type="button"
                            onClick={deleteSelectedScene}
                          >{confirmingDeleteId === selectedScene.id ? '确认删除' : '删除'}</button>
                        )}
                        <button className="quiet-button" type="button" onClick={() => beginEditingScene(selectedScene)}>
                          {isBuiltinDiscussionScene(selectedScene) ? '复制并编辑' : '编辑'}
                        </button>
                        <button className="primary-button" type="button" disabled={!draftReady} onClick={() => applyScene(selectedScene)}>
                          {hasExistingDraft ? '覆盖并填入' : '填入输入框'}
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
          <button type="button" key={scene.id} disabled={!draftReady} onClick={() => requestScene(scene)}>
            <span>{DISCUSSION_SCENE_CATEGORY_LABELS[scene.category]}</span>
            <strong>{scene.name}</strong>
            <small>{scene.summary}</small>
          </button>
        ))}
      </div>
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
