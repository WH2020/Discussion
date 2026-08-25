import { describe, expect, it } from 'vitest'
import {
  BUILTIN_DISCUSSION_SCENES,
  DISCUSSION_SCENE_DRAFT_TEXT_MAX_BYTES,
  DISCUSSION_SCENES_RECOVERY_KEY,
  DISCUSSION_SCENES_STORAGE_KEY,
  buildDiscussionSceneDraft,
  discussionSceneLineInputError,
  discussionScenePrompt,
  loadCustomDiscussionScenes,
  loadCustomDiscussionScenesResult,
  normalizeDiscussionScene,
  saveCustomDiscussionScenes,
  type DiscussionSceneStorage,
  type DiscussionSceneTemplate
} from './discussion-scenes'

class MemoryDiscussionSceneStorage implements DiscussionSceneStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const customScene: DiscussionSceneTemplate = {
  id: 'custom:test-scene',
  name: '嵌入式方案评审',
  category: 'architecture',
  summary: '检查实时性、资源、故障恢复和量产边界。',
  roles: ['固件负责人', '硬件负责人', '测试负责人'],
  agenda: ['确认硬件约束', '检查任务与中断时序', '设计故障注入'],
  deliverables: ['推荐方案', '风险与验证清单'],
  instructions: '额外关注看门狗、掉电和在线升级。'
}

describe('discussion scenes', () => {
  it('ships the four requested engineering review scenes with complete role and output contracts', () => {
    expect(BUILTIN_DISCUSSION_SCENES.map((scene) => scene.name)).toEqual([
      '算法方案评审',
      '产品 PRD 评审',
      '软件架构评审',
      '设计原型评审'
    ])
    for (const scene of BUILTIN_DISCUSSION_SCENES) {
      expect(scene.roles.length).toBeGreaterThanOrEqual(4)
      expect(scene.agenda.length).toBeGreaterThanOrEqual(4)
      expect(scene.deliverables.length).toBeGreaterThanOrEqual(4)
      expect(scene.summary.length).toBeGreaterThan(15)
    }
  })

  it('validates and normalizes custom scene fields instead of trusting local data', () => {
    const normalized = normalizeDiscussionScene({
      ...customScene,
      name: '  嵌入式   方案评审  ',
      roles: ['固件负责人', '固件负责人', '  测试负责人  ']
    })
    expect(normalized.error).toBeNull()
    expect(normalized.scene).toMatchObject({
      name: '嵌入式 方案评审',
      roles: ['固件负责人', '测试负责人']
    })

    expect(normalizeDiscussionScene({ ...customScene, roles: [] })).toEqual({
      scene: null,
      error: '请至少填写一个讨论角色或视角。'
    })
    expect(discussionSceneLineInputError(
      Array.from({ length: 13 }, (_, index) => `视角 ${index}`).join('\n'),
      '角色 / 视角'
    )).toBe('角色 / 视角最多填写 12 项。')
    expect(discussionSceneLineInputError('🧪'.repeat(181), '讨论议程'))
      .toBe('讨论议程每行最多 180 个字符。')
  })

  it('persists only valid custom scenes and safely ignores damaged storage', () => {
    const storage = new MemoryDiscussionSceneStorage()
    expect(saveCustomDiscussionScenes([
      customScene,
      BUILTIN_DISCUSSION_SCENES[0]
    ], storage)).toBe(true)
    expect(loadCustomDiscussionScenes(storage)).toEqual([customScene])
    expect(storage.getItem(DISCUSSION_SCENES_RECOVERY_KEY)).toBeNull()

    const partiallyDamagedRaw = JSON.stringify({
      schemaVersion: 1,
      scenes: [customScene, { id: 'custom:broken' }]
    })
    storage.setItem(DISCUSSION_SCENES_STORAGE_KEY, partiallyDamagedRaw)
    const partiallyDamaged = loadCustomDiscussionScenesResult(storage)
    expect(partiallyDamaged.scenes).toEqual([customScene])
    expect(partiallyDamaged.warning).toContain('并加载可用项')
    expect(storage.getItem(DISCUSSION_SCENES_RECOVERY_KEY)).toBe(partiallyDamagedRaw)

    storage.setItem(DISCUSSION_SCENES_STORAGE_KEY, '{damaged')
    const damaged = loadCustomDiscussionScenesResult(storage)
    expect(damaged.scenes).toEqual([])
    expect(damaged.warning).toContain('已保留原始恢复副本')
    expect(storage.getItem(DISCUSSION_SCENES_RECOVERY_KEY)).toBe('{damaged')

    const writeBlockedStorage: DiscussionSceneStorage = {
      getItem: (key) => key === DISCUSSION_SCENES_STORAGE_KEY ? '{damaged-again' : null,
      setItem: () => { throw new Error('quota') }
    }
    expect(loadCustomDiscussionScenesResult(writeBlockedStorage).warning)
      .toContain('后续保存将被阻止')
    expect(saveCustomDiscussionScenes([customScene], writeBlockedStorage)).toBe(false)
  })

  it('builds an editable evidence-first prompt with actual team roles and required outputs', () => {
    const prompt = discussionScenePrompt(customScene, [
      { displayName: '沐瓦', teamRole: '系统架构师', isDefaultLead: true },
      { displayName: '洛克', teamRole: '固件工程师', isDefaultLead: false }
    ])
    expect(prompt).toContain('讨论主题或对象：［请在这里补充］')
    expect(prompt).toContain('沐瓦｜系统架构师，草稿生成时的默认负责人')
    expect(prompt).toContain('洛克｜固件工程师')
    expect(prompt).toContain('发送时以 Camp 最新配置为准')
    expect(prompt).toContain('严格区分已证实事实、基于证据的推断、待验证假设和当前未知')
    expect(prompt).toContain('额外关注看门狗、掉电和在线升级')
    expect(prompt).toContain('风险与验证清单')
  })

  it('uses the structured campfire Skill only for a real multi-member discussion', () => {
    const participants = [
      { displayName: '沐瓦', teamRole: '主持人', isDefaultLead: true },
      { displayName: '洛克', teamRole: '审阅者', isDefaultLead: false },
      { displayName: '绵枝', teamRole: '验证者', isDefaultLead: false }
    ]
    const campfire = buildDiscussionSceneDraft(customScene, participants, {
      id: 'skill-campfire',
      name: 'campfire'
    })
    expect(campfire.orchestration).toBe('campfire')
    expect(campfire.content[0]).toEqual({
      kind: 'skill_mention',
      skillId: 'skill-campfire',
      nameAtSend: 'campfire'
    })

    const solo = buildDiscussionSceneDraft(customScene, participants.slice(0, 1), {
      id: 'skill-campfire',
      name: 'campfire'
    })
    expect(solo.orchestration).toBe('solo')
    expect(solo.content).toHaveLength(1)
    expect(solo.content[0].kind).toBe('text')

    const pair = buildDiscussionSceneDraft(customScene, participants.slice(0, 2), {
      id: 'skill-campfire',
      name: 'campfire'
    })
    expect(pair.orchestration).toBe('guided')
    expect(pair.content[0].kind).toBe('text')

    const unavailableLead = buildDiscussionSceneDraft(customScene, participants.map((participant) => ({
      ...participant,
      isDefaultLead: false
    })), {
      id: 'skill-campfire',
      name: 'campfire'
    })
    expect(unavailableLead.orchestration).toBe('guided')
    expect(unavailableLead.content[0].kind).toBe('text')
  })

  it('compacts extreme Unicode input below the Camp message byte limit without losing the output contract', () => {
    const veryLongScene: DiscussionSceneTemplate = {
      ...customScene,
      name: '🧪'.repeat(180),
      roles: Array.from({ length: 12 }, (_, index) => `${index}-${'🧪'.repeat(180)}`),
      agenda: Array.from({ length: 12 }, (_, index) => `${index}-${'🧪'.repeat(180)}`),
      deliverables: Array.from({ length: 12 }, (_, index) => `${index}-${'🧪'.repeat(180)}`),
      instructions: '🧪'.repeat(2_000)
    }
    const participants = Array.from({ length: 20 }, (_, index) => ({
      displayName: `${index}-${'🧪'.repeat(180)}`,
      teamRole: '🧪'.repeat(180),
      isDefaultLead: index === 0
    }))
    const prompt = discussionScenePrompt(veryLongScene, participants)

    expect(new TextEncoder().encode(prompt).byteLength)
      .toBeLessThanOrEqual(DISCUSSION_SCENE_DRAFT_TEXT_MAX_BYTES)
    expect(prompt).toContain('已按消息字节上限精简')
    expect(prompt).toContain('## 最终纪要必须包含')
  })
})
