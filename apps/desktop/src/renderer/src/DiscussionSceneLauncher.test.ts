import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile } from '@contracts'
import { DiscussionSceneLauncher } from './DiscussionSceneLauncher'

describe('DiscussionSceneLauncher', () => {
  it('exposes the built-in engineering scenes and an explicit local customization entry', () => {
    const markup = renderToStaticMarkup(createElement(DiscussionSceneLauncher, {
      participants: [
        { agentId: 'agent-a', displayName: '沐瓦', teamRole: '产品负责人', isDefaultLead: true },
        { agentId: 'agent-b', displayName: '洛克', teamRole: '系统架构师', isDefaultLead: false },
        { agentId: 'agent-c', displayName: '绵枝', teamRole: '验证负责人', isDefaultLead: false }
      ],
      agents: [profile('agent-a', '沐瓦'), profile('agent-b', '洛克'), profile('agent-c', '绵枝')],
      composerSkills: [{
        id: 'skill-campfire',
        name: 'campfire',
        description: '多人讨论',
        origin: 'official'
      }],
      skillCatalogStatus: 'ready',
      composerDraftStatus: 'ready',
      hasExistingDraft: false,
      onApply: () => undefined
    }))

    expect(markup).toContain('工程讨论场景')
    expect(markup).toContain('算法方案评审')
    expect(markup).toContain('产品 PRD 评审')
    expect(markup).toContain('软件架构评审')
    expect(markup).toContain('设计原型评审')
    expect(markup).toContain('管理场景与小队')
    expect(markup).toContain('由负责人组织多角色讨论')
  })

  it('states the honest solo fallback when fewer than two members are present', () => {
    const markup = renderToStaticMarkup(createElement(DiscussionSceneLauncher, {
      participants: [{ agentId: 'agent-a', displayName: '沐瓦', teamRole: '产品负责人', isDefaultLead: true }],
      agents: [profile('agent-a', '沐瓦')],
      composerSkills: [],
      skillCatalogStatus: 'ready',
      composerDraftStatus: 'ready',
      hasExistingDraft: false,
      onApply: () => undefined
    }))
    expect(markup).toContain('当前不足 2 位在队成员，将生成单人多视角提纲')
  })

  it('does not claim Campfire orchestration when the default Lead is unavailable', () => {
    const markup = renderToStaticMarkup(createElement(DiscussionSceneLauncher, {
      participants: [
        { agentId: 'agent-a', displayName: '洛克', teamRole: '系统架构师', isDefaultLead: false },
        { agentId: 'agent-b', displayName: '绵枝', teamRole: '验证负责人', isDefaultLead: false },
        { agentId: 'agent-c', displayName: '青河', teamRole: '产品负责人', isDefaultLead: false }
      ],
      agents: [profile('agent-a', '洛克'), profile('agent-b', '绵枝'), profile('agent-c', '青河')],
      composerSkills: [{
        id: 'skill-campfire',
        name: 'campfire',
        description: '多人讨论',
        origin: 'official'
      }],
      skillCatalogStatus: 'ready',
      composerDraftStatus: 'ready',
      hasExistingDraft: false,
      onApply: () => undefined
    }))
    expect(markup).toContain('当前默认负责人不可用')
    expect(markup).not.toContain('由负责人组织多角色讨论')
  })

  it('keeps every scene action disabled until the authoritative Composer Draft is loaded', () => {
    const markup = renderToStaticMarkup(createElement(DiscussionSceneLauncher, {
      participants: [{ agentId: 'agent-a', displayName: '沐瓦', teamRole: '负责人', isDefaultLead: true }],
      agents: [profile('agent-a', '沐瓦')],
      composerSkills: [],
      skillCatalogStatus: 'loading',
      composerDraftStatus: 'loading',
      hasExistingDraft: false,
      onApply: () => undefined
    }))
    expect(markup).toContain('正在读取当前草稿')
    expect(markup.match(/disabled=""/g)?.length).toBe(4)
  })
})

function profile(agentId: string, displayName: string): AgentProfile {
  return {
    agentId,
    displayName,
    avatarRef: null,
    accent: null,
    teamRole: '队员',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'present',
    runtimeConfiguration: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder: 0,
    version: 1,
    createdAt: '2026-08-25T00:00:00Z',
    updatedAt: '2026-08-25T00:00:00Z',
    removedAt: null
  }
}
