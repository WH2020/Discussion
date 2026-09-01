import { describe, expect, it, vi } from 'vitest'
import type { CampComposerDraftView } from '@contracts'
import {
  buildProjectAnalysisConversationContent,
  createProjectAnalysisConversationRequest,
  projectAnalysisConversationName,
  projectAnalysisSceneId,
  seedProjectAnalysisComposerDraft
} from './project-analysis-conversation'

function emptyDraft(campId = 'camp-1'): CampComposerDraftView {
  return {
    campId,
    body: '',
    content: [],
    revision: 0,
    attachments: [],
    replyIntent: null,
    continuationIntent: null,
    updatedAt: null,
    expiresAt: null
  }
}

describe('project analysis conversation', () => {
  it('builds an evidence-backed algorithm framework prompt from the active diagram', () => {
    const request = createProjectAnalysisConversationRequest({
      mode: 'algorithm-framework',
      question: '只分析多通道刺激剂量计算和安全限幅算法。',
      projectName: 'NueroLeap',
      diagram: {
        id: 'plan-parameter-permissions',
        title: '方案与参数权限',
        description: '区分用户、医生和设备的参数权限。',
        nodeLabels: ['医生方案', '设备最终校验', '医生方案']
      },
      focusNode: {
        id: 'device-validation',
        label: '设备最终校验',
        path: 'src/safety/validation.ts',
        summary: '在设备侧完成剂量限幅和权限校验。'
      }
    })

    expect(projectAnalysisSceneId(request.mode)).toBe('builtin:algorithm-design-review')
    expect(projectAnalysisConversationName(request)).toContain('算法专项')
    expect(request.diagram?.nodeLabels).toEqual(['医生方案', '设备最终校验'])
    const content = buildProjectAnalysisConversationContent(request)
    expect(content[0]).toEqual({ kind: 'all_members_mention' })
    expect(content[1]).toMatchObject({ kind: 'text' })
    const text = content[1].kind === 'text' ? content[1].text : ''
    expect(text).toContain('多通道刺激剂量计算和安全限幅算法')
    expect(text).toContain('当前选中节点：设备最终校验')
    expect(text).toContain('src/safety/validation.ts')
    expect(text).toContain('时间/空间复杂度')
    expect(text).toContain('Mermaid flowchart')
    expect(text).toContain('相对文件路径')
  })

  it('maps software analysis to the architecture scene and framework checks', () => {
    const request = createProjectAnalysisConversationRequest({
      mode: 'software-framework',
      question: '拆解设备通信和离线同步的软件框架。',
      projectName: 'NueroLeap'
    })
    expect(projectAnalysisSceneId(request.mode)).toBe('builtin:software-architecture-review')
    const content = buildProjectAnalysisConversationContent(request)
    const text = content.find((segment) => segment.kind === 'text')
    expect(text?.kind === 'text' ? text.text : '').toContain('并发模型、错误处理、降级恢复')
  })

  it('seeds only an empty draft and preserves its expected revision', async () => {
    const request = createProjectAnalysisConversationRequest({
      mode: 'software-framework',
      question: '分析模块边界。',
      projectName: 'Demo'
    })
    const loadDraft = vi.fn(async () => ({ ...emptyDraft(), revision: 3 }))
    const saved = { ...emptyDraft(), revision: 4 }
    const saveDraft = vi.fn(async () => saved)

    await expect(seedProjectAnalysisComposerDraft(
      'camp-1',
      request,
      loadDraft,
      saveDraft
    )).resolves.toBe(saved)
    expect(saveDraft).toHaveBeenCalledWith(3, expect.arrayContaining([
      { kind: 'all_members_mention' }
    ]))

    await expect(seedProjectAnalysisComposerDraft(
      'camp-1',
      request,
      async () => ({ ...emptyDraft(), body: '不要覆盖' }),
      saveDraft
    )).rejects.toThrow('未覆盖原草稿')
  })

  it('rejects an empty focus instead of opening a generic full-project discussion', () => {
    expect(() => createProjectAnalysisConversationRequest({
      mode: 'algorithm-framework',
      question: '   ',
      projectName: 'Demo'
    })).toThrow('请先说明希望分析的算法或软件范围')
  })
})
