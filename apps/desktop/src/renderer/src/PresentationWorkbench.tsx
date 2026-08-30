import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent
} from 'react'
import { exportPresentationProject } from './presentation-export'
import {
  PRESENTATION_LIBRARY_MAX_PROJECTS,
  PRESENTATION_PROJECT_MAX_SLIDES,
  PRESENTATION_SLIDE_MAX_SOURCES,
  PRESENTATION_STAGES,
  PRESENTATION_STYLES,
  createPresentationProject,
  emptyPresentationLibrary,
  nextPresentationStage,
  persistPresentationLibrary,
  presentationStageProgress,
  readPresentationLibrary,
  replacePresentationProjectOutline,
  reorderPresentationSlide,
  type PresentationLibrary,
  type PresentationProject,
  type PresentationSlide,
  type PresentationSlideLayout,
  type PresentationSource,
  type PresentationStage,
  type PresentationStyleId
} from './presentation-workbench-model'
import type { PresentationSourceDocument } from '@contracts'

type ProjectDraft = {
  request: string
  title: string
  audience: string
  objective: string
  slideCount: number
  styleId: PresentationStyleId
  sourceDocument: PresentationSourceDocument | null
}

const INITIAL_PROJECT_DRAFT: ProjectDraft = {
  request: '',
  title: '',
  audience: '',
  objective: '',
  slideCount: 8,
  styleId: 'porcelain',
  sourceDocument: null
}

interface PresentationWorkbenchProps {
  initialLibrary?: PresentationLibrary
  onLibraryChange?(library: PresentationLibrary): void
}

export function PresentationWorkbench({
  initialLibrary,
  onLibraryChange
}: PresentationWorkbenchProps): React.JSX.Element {
  const [library, setLibrary] = useState<PresentationLibrary>(() => initialLibrary
    ?? readPresentationLibrary(typeof window === 'undefined' ? undefined : window.localStorage))
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null)
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(INITIAL_PROJECT_DRAFT)
  const [creating, setCreating] = useState(false)
  const [selectingSource, setSelectingSource] = useState(false)
  const [analyzingProject, setAnalyzingProject] = useState(false)
  const [sourceDraft, setSourceDraft] = useState({ title: '', url: '', note: '' })
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [presenting, setPresenting] = useState(false)
  const [presentationIndex, setPresentationIndex] = useState(0)

  useEffect(() => {
    if (initialLibrary === undefined && typeof window !== 'undefined') {
      persistPresentationLibrary(library, window.localStorage)
    }
    onLibraryChange?.(library)
  }, [initialLibrary, library, onLibraryChange])

  const activeProject = useMemo(
    () => library.projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, library.projects]
  )
  const selectedSlide = activeProject?.slides.find((slide) => slide.id === selectedSlideId)
    ?? activeProject?.slides[0]
    ?? null

  useEffect(() => {
    if (!activeProject) {
      setSelectedSlideId(null)
      return
    }
    if (!activeProject.slides.some((slide) => slide.id === selectedSlideId)) {
      setSelectedSlideId(activeProject.slides[0]?.id ?? null)
    }
  }, [activeProject, selectedSlideId])

  const updateProject = useCallback((
    projectId: string,
    updater: (project: PresentationProject) => PresentationProject
  ): void => {
    setLibrary((current) => ({
      ...current,
      projects: current.projects.map((project) => project.id === projectId
        ? { ...updater(project), updatedAt: new Date().toISOString() }
        : project)
    }))
  }, [])

  const updateActiveProject = useCallback((
    updater: (project: PresentationProject) => PresentationProject
  ): void => {
    if (activeProjectId) updateProject(activeProjectId, updater)
  }, [activeProjectId, updateProject])

  const updateSelectedSlide = useCallback((patch: Partial<PresentationSlide>): void => {
    if (!selectedSlideId) return
    updateActiveProject((project) => ({
      ...project,
      slides: project.slides.map((slide) => slide.id === selectedSlideId
        ? { ...slide, ...patch }
        : slide)
    }))
  }, [selectedSlideId, updateActiveProject])

  const selectSourceDocument = async (): Promise<void> => {
    if (selectingSource) return
    setSelectingSource(true)
    setNotice(null)
    try {
      const sourceDocument = await window.rovai.presentations.selectSourceDocument()
      if (!sourceDocument) return
      setProjectDraft((current) => ({
        ...current,
        sourceDocument,
        request: current.request.trim()
          ? current.request
          : `请根据所选资料“${sourceDocument.name}”生成一份结构清晰、证据可追溯的 PPT。`
      }))
    } catch (error) {
      setNotice(error instanceof Error ? `资料读取失败：${error.message}` : '资料读取失败。')
    } finally {
      setSelectingSource(false)
    }
  }

  const createProject = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!projectDraft.request.trim() && !projectDraft.sourceDocument) return
    if (!projectDraft.sourceDocument && looksLikeDocumentPath(projectDraft.request)) {
      setNotice('检测到文件路径，但工作台不会把路径当正文。请点击“选择资料”并读取该文件。')
      return
    }
    if (library.projects.length >= PRESENTATION_LIBRARY_MAX_PROJECTS) {
      setNotice(`项目库最多保存 ${PRESENTATION_LIBRARY_MAX_PROJECTS} 个项目，请先删除不再需要的项目。`)
      return
    }
    setCreating(true)
    setNotice('正在读取资料并由 Codex 分析叙事结构，通常需要 1–5 分钟；首次运行时检测可能更久。')
    try {
      const outline = await window.rovai.presentations.generateOutline({
        request: projectDraft.request,
        title: projectDraft.title,
        audience: projectDraft.audience,
        objective: projectDraft.objective,
        slideCount: projectDraft.slideCount,
        styleId: projectDraft.styleId,
        sourcePath: projectDraft.sourceDocument?.path ?? null
      })
      const project = createPresentationProject(projectDraft, outline)
      setLibrary((current) => ({ ...current, projects: [project, ...current.projects] }))
      setActiveProjectId(project.id)
      setSelectedSlideId(project.slides[0]?.id ?? null)
      setProjectDraft(INITIAL_PROJECT_DRAFT)
      setNotice(`已读取${outline.sourceDocument ? `“${outline.sourceDocument.name}”并` : ''}生成 ${outline.slides.length} 页大纲。`)
    } catch (error) {
      setNotice(error instanceof Error ? `大纲分析失败：${error.message}` : '大纲分析失败。')
    } finally {
      setCreating(false)
    }
  }

  const deleteProject = (projectId: string): void => {
    const project = library.projects.find((item) => item.id === projectId)
    if (typeof window !== 'undefined' && !window.confirm(`删除“${project?.title || '未命名演示'}”？此操作无法撤销。`)) return
    setLibrary((current) => ({
      ...current,
      projects: current.projects.filter((project) => project.id !== projectId)
    }))
    if (activeProjectId === projectId) setActiveProjectId(null)
  }

  const addSlide = (): void => {
    if (!activeProject) return
    if (activeProject.slides.length >= PRESENTATION_PROJECT_MAX_SLIDES) {
      setNotice(`每个项目最多保存 ${PRESENTATION_PROJECT_MAX_SLIDES} 页。`)
      return
    }
    const slide: PresentationSlide = {
      id: crypto.randomUUID(),
      kind: 'content',
      layout: 'title-body',
      title: `新页面 ${activeProject.slides.length + 1}`,
      subtitle: '为本页写下一个单一结论',
      bullets: ['关键事实', '核心判断', '下一步行动'],
      speakerNotes: '',
      sources: []
    }
    updateActiveProject((project) => ({ ...project, slides: [...project.slides, slide] }))
    setSelectedSlideId(slide.id)
  }

  const removeSlide = (): void => {
    if (!activeProject || !selectedSlide || activeProject.slides.length <= 1) return
    const index = activeProject.slides.findIndex((slide) => slide.id === selectedSlide.id)
    const nextSlides = activeProject.slides.filter((slide) => slide.id !== selectedSlide.id)
    updateActiveProject((project) => ({ ...project, slides: nextSlides }))
    setSelectedSlideId(nextSlides[Math.min(index, nextSlides.length - 1)]?.id ?? null)
  }

  const moveSlide = (direction: -1 | 1): void => {
    if (!selectedSlide) return
    updateActiveProject((project) => ({
      ...project,
      slides: reorderPresentationSlide(project.slides, selectedSlide.id, direction)
    }))
  }

  const addSource = (event: FormEvent): void => {
    event.preventDefault()
    if (!selectedSlide || !sourceDraft.title.trim()) return
    if (selectedSlide.sources.length >= PRESENTATION_SLIDE_MAX_SOURCES) {
      setNotice(`每页最多保存 ${PRESENTATION_SLIDE_MAX_SOURCES} 条资料。`)
      return
    }
    const source: PresentationSource = {
      id: crypto.randomUUID(),
      title: sourceDraft.title.trim().slice(0, 240),
      url: sourceDraft.url.trim().slice(0, 2_000),
      note: sourceDraft.note.trim().slice(0, 2_000)
    }
    updateSelectedSlide({ sources: [...selectedSlide.sources, source] })
    setSourceDraft({ title: '', url: '', note: '' })
  }

  const removeSource = (sourceId: string): void => {
    if (!selectedSlide) return
    updateSelectedSlide({ sources: selectedSlide.sources.filter((source) => source.id !== sourceId) })
  }

  const exportProject = async (): Promise<void> => {
    if (!activeProject || exporting) return
    setExporting(true)
    setNotice(null)
    try {
      const fileName = await exportPresentationProject(activeProject)
      setNotice(`已导出 ${fileName}`)
    } catch (error) {
      setNotice(error instanceof Error ? `导出失败：${error.message}` : 'PPTX 导出失败。')
    } finally {
      setExporting(false)
    }
  }

  const regenerateActiveOutline = async (): Promise<void> => {
    if (!activeProject || analyzingProject) return
    if (typeof window !== 'undefined' && !window.confirm('重新分析会替换当前全部页面、备注和逐页资料。是否继续？')) return
    setAnalyzingProject(true)
    setNotice('正在根据最新需求重新分析大纲。')
    try {
      const outline = await window.rovai.presentations.generateOutline({
        request: activeProject.request,
        title: activeProject.title,
        audience: activeProject.audience,
        objective: activeProject.objective,
        slideCount: activeProject.slides.length,
        styleId: activeProject.styleId,
        sourcePath: activeProject.sourceDocument?.path ?? null
      })
      const nextProject = replacePresentationProjectOutline(activeProject, outline)
      updateProject(activeProject.id, () => nextProject)
      setSelectedSlideId(nextProject.slides[0]?.id ?? null)
      setNotice(`大纲已重新生成，共 ${nextProject.slides.length} 页。`)
    } catch (error) {
      setNotice(error instanceof Error ? `重新分析失败：${error.message}` : '重新分析失败。')
    } finally {
      setAnalyzingProject(false)
    }
  }

  if (!activeProject) {
    return (
      <PresentationLibraryView
        library={library}
        draft={projectDraft}
        creating={creating}
        selectingSource={selectingSource}
        notice={notice}
        onDraftChange={setProjectDraft}
        onCreate={createProject}
        onSelectSource={() => void selectSourceDocument()}
        onOpen={(project) => {
          setActiveProjectId(project.id)
          setSelectedSlideId(project.slides[0]?.id ?? null)
          setNotice(null)
        }}
        onDelete={deleteProject}
        onReset={() => {
          if (typeof window !== 'undefined' && !window.confirm('清空全部 PPT 项目？此操作无法撤销。')) return
          setLibrary(emptyPresentationLibrary())
        }}
      />
    )
  }

  const selectedIndex = selectedSlide
    ? activeProject.slides.findIndex((slide) => slide.id === selectedSlide.id)
    : 0
  const currentStage = activeProject.currentStage
  const nextStage = nextPresentationStage(currentStage)

  return (
    <section className="presentation-workbench" aria-label="PPT 工作台">
      <header className="presentation-workbench-header">
        <div className="presentation-workbench-title-row">
          <button className="quiet-button compact" type="button" onClick={() => setActiveProjectId(null)}>← 项目库</button>
          <div>
            <span className="settings-page-eyebrow">PPT WORKBENCH / PHASE 3</span>
            <h1>{activeProject.title || '未命名演示'}</h1>
          </div>
        </div>
        <div className="presentation-workbench-actions">
          <button className="quiet-button" type="button" onClick={() => {
            setPresentationIndex(Math.max(0, selectedIndex))
            setPresenting(true)
          }}>放映</button>
          <button className="primary-button" type="button" onClick={() => void exportProject()} disabled={exporting}>
            {exporting ? '正在导出…' : '导出 PPTX'}
          </button>
        </div>
      </header>

      <nav className="presentation-stage-nav" aria-label="PPT 生成阶段">
        {PRESENTATION_STAGES.map((stage, index) => (
          <button
            key={stage.id}
            className={stage.id === currentStage ? 'active' : ''}
            type="button"
            aria-current={stage.id === currentStage ? 'step' : undefined}
            onClick={() => {
              if (stage.id === 'outline' && activeProject.analysis?.status === 'stale') {
                void regenerateActiveOutline()
                return
              }
              updateActiveProject((project) => ({ ...project, currentStage: stage.id }))
            }}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{stage.label}</strong>
            <small>{stage.detail}</small>
          </button>
        ))}
        <i style={{ width: `${presentationStageProgress(currentStage)}%` }} />
      </nav>

      {notice && <div className="presentation-workbench-notice" role="status">{notice}</div>}

      <div className="presentation-editor-grid">
        <aside className="presentation-slide-rail" aria-label="页面列表">
          <div className="presentation-slide-rail-heading">
            <span>页面</span><strong>{activeProject.slides.length}</strong>
          </div>
          <div className="presentation-slide-list">
            {activeProject.slides.map((slide, index) => (
              <button
                key={slide.id}
                className={slide.id === selectedSlide?.id ? 'active' : ''}
                type="button"
                aria-current={slide.id === selectedSlide?.id ? 'true' : undefined}
                onClick={() => setSelectedSlideId(slide.id)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <SlideMiniature project={activeProject} slide={slide} />
                <small>{slide.title}</small>
              </button>
            ))}
          </div>
          <button className="presentation-add-slide" type="button" onClick={addSlide}>＋ 添加页面</button>
        </aside>

        <main className="presentation-canvas-column">
          {selectedSlide && (
            <>
              <div className="presentation-canvas-toolbar">
                <span>第 {selectedIndex + 1} 页 · {stageLabel(currentStage)}</span>
                <div>
                  <button className="icon-button" type="button" aria-label="页面上移" onClick={() => moveSlide(-1)} disabled={selectedIndex <= 0}>↑</button>
                  <button className="icon-button" type="button" aria-label="页面下移" onClick={() => moveSlide(1)} disabled={selectedIndex >= activeProject.slides.length - 1}>↓</button>
                  <button className="quiet-button compact" type="button" onClick={removeSlide} disabled={activeProject.slides.length <= 1}>删除页</button>
                </div>
              </div>
              <SlideCanvas project={activeProject} slide={selectedSlide} />
              <div className="presentation-stage-handoff">
                <div>
                  <strong>{currentStage === 'design' ? '已到达可交付阶段' : `${stageLabel(currentStage)}内容会原样保留`}</strong>
                  <span>{stageHandoffCopy(currentStage)}</span>
                </div>
                {nextStage && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={analyzingProject}
                    onClick={() => {
                      if (currentStage === 'brief' && activeProject.analysis?.status === 'stale') {
                        void regenerateActiveOutline()
                        return
                      }
                      updateActiveProject((project) => ({ ...project, currentStage: nextStage }))
                    }}
                  >
                    {analyzingProject
                      ? '正在分析…'
                      : currentStage === 'brief' && activeProject.analysis?.status === 'stale'
                        ? '重新分析大纲'
                        : `进入${stageLabel(nextStage)}`}
                  </button>
                )}
              </div>
            </>
          )}
        </main>

        <aside className="presentation-inspector" aria-label={`${stageLabel(currentStage)}编辑器`}>
          {selectedSlide && (
            <PresentationStageInspector
              project={activeProject}
              slide={selectedSlide}
              stage={currentStage}
              sourceDraft={sourceDraft}
              onProjectChange={(patch) => updateActiveProject((project) => ({
                ...project,
                ...patch,
                analysis: currentStage === 'brief' && project.analysis
                  ? { ...project.analysis, status: 'stale' }
                  : project.analysis
              }))}
              onSlideChange={updateSelectedSlide}
              onSourceDraftChange={setSourceDraft}
              onAddSource={addSource}
              onRemoveSource={removeSource}
              onRegenerate={() => void regenerateActiveOutline()}
              analyzing={analyzingProject}
            />
          )}
        </aside>
      </div>

      {presenting && (
        <PresentationPlayer
          project={activeProject}
          index={presentationIndex}
          onIndexChange={setPresentationIndex}
          onClose={() => setPresenting(false)}
        />
      )}
    </section>
  )
}

function PresentationLibraryView({
  library,
  draft,
  creating,
  selectingSource,
  notice,
  onDraftChange,
  onCreate,
  onSelectSource,
  onOpen,
  onDelete,
  onReset
}: {
  library: PresentationLibrary
  draft: ProjectDraft
  creating: boolean
  selectingSource: boolean
  notice: string | null
  onDraftChange(draft: ProjectDraft): void
  onCreate(event: FormEvent): void
  onSelectSource(): void
  onOpen(project: PresentationProject): void
  onDelete(projectId: string): void
  onReset(): void
}): React.JSX.Element {
  return (
    <section className="presentation-library" aria-label="PPT 项目库">
      <header className="presentation-library-heading">
        <span className="settings-page-eyebrow">PPT WORKBENCH / PHASE 3</span>
        <h1>把一份演示从想法推进到可交付文件</h1>
        <p>需求、大纲、逐页资料、初稿和设计保持在同一个本机工作台中，最终直接导出 PowerPoint。</p>
      </header>
      {notice && <div className="presentation-workbench-notice" role="status">{notice}</div>}
      <form className="presentation-create-panel" onSubmit={onCreate}>
        <div className="presentation-create-prompt">
          <label htmlFor="presentation-request">这份 PPT 要解决什么问题？</label>
          <textarea
            id="presentation-request"
            rows={5}
            value={draft.request}
            placeholder="例如：为管理层制作一份 AI 客服改造方案，说明现状、目标架构、投入产出和三个月实施计划。"
            onChange={(event) => onDraftChange({ ...draft, request: event.target.value })}
          />
          <div className="presentation-source-picker">
            <button className="quiet-button" type="button" onClick={onSelectSource} disabled={selectingSource || creating}>
              {selectingSource ? '正在读取…' : draft.sourceDocument ? '更换资料' : '选择资料'}
            </button>
            {draft.sourceDocument
              ? (
                <article>
                  <strong>{draft.sourceDocument.name}</strong>
                  <span>{formatFileSize(draft.sourceDocument.byteSize)} · 已提取 {draft.sourceDocument.characterCount.toLocaleString('zh-CN')} 字符{draft.sourceDocument.truncated ? ' · 已按上下文上限截取' : ''}</span>
                  <p>{draft.sourceDocument.preview}</p>
                  <button type="button" className="text-button" onClick={() => onDraftChange({ ...draft, sourceDocument: null })}>移除资料</button>
                </article>
              )
              : <span>支持 DOCX、Markdown 和 TXT；文件路径不会再被当成正文。</span>}
          </div>
        </div>
        <div className="presentation-create-fields">
          <label>标题（可选）<input value={draft.title} maxLength={120} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} /></label>
          <label>听众<input value={draft.audience} maxLength={120} placeholder="管理层 / 客户 / 项目组" onChange={(event) => onDraftChange({ ...draft, audience: event.target.value })} /></label>
          <label>期望行动<input value={draft.objective} maxLength={240} placeholder="希望听众在会后作出什么决定" onChange={(event) => onDraftChange({ ...draft, objective: event.target.value })} /></label>
          <label>页数<input type="number" min={4} max={24} value={draft.slideCount} onChange={(event) => onDraftChange({ ...draft, slideCount: Number(event.target.value) })} /></label>
          <label>视觉预设<select value={draft.styleId} onChange={(event) => onDraftChange({ ...draft, styleId: event.target.value as PresentationStyleId })}>{PRESENTATION_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}</select></label>
        </div>
        <div className="presentation-create-footer">
          <span>资料在本机提取；点击生成后，正文会交给当前已登录的 Codex CLI 分析。</span>
          <button className="primary-button" type="submit" disabled={creating || (!draft.request.trim() && !draft.sourceDocument)}>{creating ? '正在分析大纲…' : '分析资料并建立大纲'}</button>
        </div>
      </form>
      <section className="presentation-recent-projects" aria-labelledby="presentation-recent-heading">
        <div className="presentation-section-heading">
          <div><span className="settings-page-eyebrow">LOCAL PROJECTS</span><h2 id="presentation-recent-heading">最近项目</h2></div>
          {library.projects.length > 0 && <button className="quiet-button compact" type="button" onClick={onReset}>清空项目库</button>}
        </div>
        {library.projects.length === 0
          ? <div className="presentation-empty-state"><strong>还没有 PPT 项目</strong><span>导入资料后，Codex 会先给出可编辑、可追溯的逐页大纲。</span></div>
          : <div className="presentation-project-grid">{library.projects.map((project) => (
            <article key={project.id} className="presentation-project-card">
              <button className="presentation-project-open" type="button" onClick={() => onOpen(project)}>
                <SlideMiniature project={project} slide={project.slides[0]} />
                <span className="presentation-project-meta">{project.slides.length} 页 · {stageLabel(project.currentStage)}</span>
                <strong>{project.title || '未命名演示'}</strong>
                <small>{formatUpdatedAt(project.updatedAt)}</small>
              </button>
              <button className="icon-button" type="button" aria-label={`删除 ${project.title || '未命名演示'}`} onClick={() => onDelete(project.id)}>×</button>
            </article>
          ))}</div>}
      </section>
    </section>
  )
}

function PresentationStageInspector({
  project,
  slide,
  stage,
  sourceDraft,
  onProjectChange,
  onSlideChange,
  onSourceDraftChange,
  onAddSource,
  onRemoveSource,
  onRegenerate,
  analyzing
}: {
  project: PresentationProject
  slide: PresentationSlide
  stage: PresentationStage
  sourceDraft: { title: string; url: string; note: string }
  onProjectChange(patch: Partial<PresentationProject>): void
  onSlideChange(patch: Partial<PresentationSlide>): void
  onSourceDraftChange(draft: { title: string; url: string; note: string }): void
  onAddSource(event: FormEvent): void
  onRemoveSource(sourceId: string): void
  onRegenerate(): void
  analyzing: boolean
}): React.JSX.Element {
  if (stage === 'brief') {
    return (
      <div className="presentation-inspector-form">
        <InspectorHeading stage={stage} title="需求单" detail="先冻结听众、目标和边界，再继续生成页面。" />
        <label>项目标题<input value={project.title} maxLength={120} onChange={(event) => onProjectChange({ title: event.target.value })} /></label>
        <label>原始需求<textarea rows={7} value={project.request} maxLength={2_000} onChange={(event) => onProjectChange({ request: event.target.value })} /></label>
        <label>目标听众<input value={project.audience} maxLength={120} onChange={(event) => onProjectChange({ audience: event.target.value })} /></label>
        <label>期望行动<textarea rows={3} value={project.objective} maxLength={240} onChange={(event) => onProjectChange({ objective: event.target.value })} /></label>
        {project.sourceDocument && (
          <div className="presentation-analysis-card">
            <span className="settings-page-eyebrow">SOURCE DOCUMENT</span>
            <strong>{project.sourceDocument.name}</strong>
            <p>已提取 {project.sourceDocument.characterCount.toLocaleString('zh-CN')} 字符{project.sourceDocument.truncated ? '，分析使用前 90,000 字符' : ''}</p>
          </div>
        )}
        {project.analysis && (
          <div className={`presentation-analysis-card is-${project.analysis.status}`}>
            <span className="settings-page-eyebrow">叙事主线</span>
            <p>{project.analysis.narrative}</p>
            <small>{project.analysis.runtimeVersion ?? 'Codex CLI'} · {project.analysis.status === 'stale' ? '需求已修改，需要重新分析' : '大纲与当前需求一致'}</small>
          </div>
        )}
        <button className="primary-button" type="button" onClick={onRegenerate} disabled={analyzing}>
          {analyzing ? '正在重新分析…' : '重新分析并生成大纲'}
        </button>
      </div>
    )
  }
  if (stage === 'research') {
    return (
      <div className="presentation-inspector-form">
        <InspectorHeading stage={stage} title="逐页资料池" detail="资料只归属当前页，不会混入其他页面。" />
        <div className="presentation-source-list">
          {slide.sources.length === 0 && <div className="presentation-source-empty">本页还没有资料。先记录标题、链接和可引用结论。</div>}
          {slide.sources.map((source) => (
            <article key={source.id}>
              <div><strong>{source.title}</strong><button className="icon-button" type="button" aria-label={`移除资料 ${source.title}`} onClick={() => onRemoveSource(source.id)}>×</button></div>
              {safeHttpUrl(source.url) && <a href={safeHttpUrl(source.url) ?? undefined} target="_blank" rel="noreferrer">打开来源</a>}
              {source.note && <p>{source.note}</p>}
            </article>
          ))}
        </div>
        <form className="presentation-source-form" onSubmit={onAddSource}>
          <label>资料标题<input value={sourceDraft.title} maxLength={240} onChange={(event) => onSourceDraftChange({ ...sourceDraft, title: event.target.value })} /></label>
          <label>链接<input type="url" value={sourceDraft.url} maxLength={2_000} placeholder="https://" onChange={(event) => onSourceDraftChange({ ...sourceDraft, url: event.target.value })} /></label>
          <label>可引用结论<textarea rows={4} value={sourceDraft.note} maxLength={2_000} onChange={(event) => onSourceDraftChange({ ...sourceDraft, note: event.target.value })} /></label>
          <button className="quiet-button" type="submit" disabled={!sourceDraft.title.trim()}>加入当前页</button>
        </form>
      </div>
    )
  }
  return (
    <div className="presentation-inspector-form">
      <InspectorHeading
        stage={stage}
        title={stage === 'outline' ? '页面结构' : stage === 'draft' ? '页面初稿' : '视觉设计'}
        detail={stage === 'outline' ? '每页只承担一个清晰结论。' : stage === 'draft' ? '编辑屏幕内容与演讲者备注。' : '选择版式和全局视觉预设。'}
      />
      {stage === 'outline' && project.analysis && (
        <div className="presentation-analysis-card presentation-outline-logic">
          <span className="settings-page-eyebrow">分析逻辑</span>
          <ol>
            <li>先冻结听众、决策目标和非治疗边界</li>
            <li>从资料中提取可核验事实与证据限制</li>
            <li>按“问题与证据 → 判断 → 行动”组织正文</li>
            <li>固定封面、目录、正文、收尾，并控制每页一个结论</li>
          </ol>
          <strong>本次叙事主线</strong>
          <p>{project.analysis.narrative}</p>
          <small>当前页带入 {slide.sources.length} 条原文证据；无法在原文中逐字匹配的摘录不会保存。</small>
        </div>
      )}
      {stage === 'design' && (
        <>
          <label>视觉预设<select value={project.styleId} onChange={(event) => onProjectChange({ styleId: event.target.value as PresentationStyleId })}>{PRESENTATION_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label} · {style.description}</option>)}</select></label>
          <label>当前页版式<select value={slide.layout} onChange={(event) => onSlideChange({ layout: event.target.value as PresentationSlideLayout })}><option value="statement">大字结论</option><option value="title-body">标题正文</option><option value="two-column">双栏对照</option></select></label>
        </>
      )}
      <label>页面标题<input value={slide.title} maxLength={180} onChange={(event) => onSlideChange({ title: event.target.value })} /></label>
      <label>副标题<textarea rows={2} value={slide.subtitle} maxLength={300} onChange={(event) => onSlideChange({ subtitle: event.target.value })} /></label>
      <label>要点（每行一条）<textarea rows={8} value={slide.bullets.join('\n')} onChange={(event) => onSlideChange({ bullets: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 12) })} /></label>
      {stage === 'draft' && <label>演讲者备注<textarea rows={6} value={slide.speakerNotes} maxLength={4_000} onChange={(event) => onSlideChange({ speakerNotes: event.target.value })} /></label>}
    </div>
  )
}

function InspectorHeading({ stage, title, detail }: { stage: PresentationStage; title: string; detail: string }): React.JSX.Element {
  return <header><span className="settings-page-eyebrow">{stageLabel(stage).toUpperCase()}</span><h2>{title}</h2><p>{detail}</p></header>
}

function SlideCanvas({ project, slide }: { project: PresentationProject; slide: PresentationSlide }): React.JSX.Element {
  const style = PRESENTATION_STYLES.find((item) => item.id === project.styleId) ?? PRESENTATION_STYLES[0]
  const canvasStyle = {
    '--ppt-canvas': style.canvas,
    '--ppt-ink': style.ink,
    '--ppt-accent': style.accent,
    '--ppt-muted': style.muted
  } as CSSProperties
  const columns = slide.layout === 'two-column'
    ? [slide.bullets.filter((_, index) => index % 2 === 0), slide.bullets.filter((_, index) => index % 2 === 1)]
    : [slide.bullets]
  const titleDensity = slide.title.length > 72
    ? 'is-title-very-long'
    : slide.title.length > 42
      ? 'is-title-long'
      : ''
  return (
    <article className={`presentation-slide-canvas is-${slide.layout} ${titleDensity}`} style={canvasStyle} aria-label={`页面预览：${slide.title}`}>
      <i className="presentation-slide-accent" />
      <div className="presentation-slide-content">
        <span className="presentation-slide-kicker">ROVAI PRESENTATION</span>
        <h2>{slide.title || '未命名页面'}</h2>
        {slide.subtitle && <p>{slide.subtitle}</p>}
        {slide.bullets.length > 0 && <div className="presentation-slide-bullets">{columns.map((items, columnIndex) => <ul key={columnIndex}>{items.map((bullet, index) => <li key={`${columnIndex}-${index}`}>{bullet}</li>)}</ul>)}</div>}
      </div>
      <footer><span>{project.title || '未命名演示'}</span><span>{project.slides.findIndex((item) => item.id === slide.id) + 1} / {project.slides.length}</span></footer>
    </article>
  )
}

function SlideMiniature({ project, slide }: { project: PresentationProject; slide: PresentationSlide }): React.JSX.Element {
  const style = PRESENTATION_STYLES.find((item) => item.id === project.styleId) ?? PRESENTATION_STYLES[0]
  return <i className="presentation-slide-miniature" style={{ background: style.canvas, color: style.ink, borderColor: style.accent }}><b style={{ background: style.accent }} /><span>{slide.title}</span></i>
}

function PresentationPlayer({
  project,
  index,
  onIndexChange,
  onClose
}: {
  project: PresentationProject
  index: number
  onIndexChange(index: number): void
  onClose(): void
}): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1))
      if (event.key === 'ArrowRight') onIndexChange(Math.min(project.slides.length - 1, index + 1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, onClose, onIndexChange, project.slides.length])
  const slide = project.slides[index] ?? project.slides[0]
  return (
    <div className="presentation-player" role="dialog" aria-modal="true" aria-label="PPT 放映模式">
      <div className="presentation-player-toolbar"><span>{index + 1} / {project.slides.length}</span><button className="quiet-button" type="button" onClick={onClose}>退出放映</button></div>
      <button type="button" aria-label="上一页" onClick={() => onIndexChange(Math.max(0, index - 1))} disabled={index <= 0}>‹</button>
      <SlideCanvas project={project} slide={slide} />
      <button type="button" aria-label="下一页" onClick={() => onIndexChange(Math.min(project.slides.length - 1, index + 1))} disabled={index >= project.slides.length - 1}>›</button>
    </div>
  )
}

function stageLabel(stage: PresentationStage): string {
  return PRESENTATION_STAGES.find((item) => item.id === stage)?.label ?? stage
}

function stageHandoffCopy(stage: PresentationStage): string {
  if (stage === 'brief') return '下一步把需求拆成逐页叙事。'
  if (stage === 'outline') return '下一步为每一页建立独立资料池。'
  if (stage === 'research') return '下一步把证据整理为可讲述的页面初稿。'
  if (stage === 'draft') return '下一步选择版式、视觉预设并检查放映。'
  return '检查所有页面后即可导出可编辑的 PowerPoint 文件。'
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatFileSize(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function looksLikeDocumentPath(value: string): boolean {
  return /(?:[a-z]:\\|\\\\|\/)[^\r\n]+\.(?:docx|md|markdown|txt)\b/i.test(value)
}

function safeHttpUrl(value: string): string | null {
  if (!value.trim()) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
