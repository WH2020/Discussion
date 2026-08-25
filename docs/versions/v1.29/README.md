---
document_type: version-overview
version: v1.29
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-25
---

# Rovai-ai v1.29：本地工程讨论场景、预设小队与可编辑协作提纲

> 当前状态：场景预设小队、新建会话场景选择、当前会话临时加人和对应 Core RPC 已实现；
> TypeScript、Rust 定向测试、Desktop 构建、文档门禁、完整回归与开发版启动均通过。
> Windows packaged 视觉验收仍受 Electron 分发包下载边界影响，详见
> [实施计划](implementation-plan.md)。

前置版本：[v1.28 Grok Build + MiniMax M3 本地 Runtime 接入](../v1.28/README.md)已按冻结时事实转为 historical。

## 版本目标

让用户在本地 Camp 中快速发起面向算法结构、产品 PRD、软件架构和设计原型的工程讨论，并为每个场景
复用一支常用小队；用户仍可按本次会话临时增减队员。方案保留 Rovai 既有的长期队员身份、Skill 编排、
附件、可见执行和协作记忆，不创建第二套成员、消息或执行模型。

## 交付范围

- 空 Camp 增加“工程讨论场景”入口，内置算法方案评审、产品 PRD 评审、软件架构评审和设计原型评审；
- 每个场景定义用途说明、角色/视角、讨论议程、交付物和补充约束；
- 支持在本机创建、复制、编辑和二次确认删除自定义场景，损坏或不可读的本机数据安全降级为内置场景；
- 每个内置或自定义场景可保存由真实 Agent ID 组成的预设小队和预设负责人，损坏数据保留独立恢复副本；
- “创建新对话”支持选择场景，并以当前可用的预设队员和负责人初始化 Camp；场景 ID 不进入 Core 创建字段；
- 空 Camp 启动场景时自动补齐缺少的可用预设队员；Active Camp 的队员详情可临时增加只属于当前会话的成员；
- 场景角色只描述本轮需要覆盖的视角；长期角色、职责和 Runtime 配置不被模板或临时组队改写；
- 选择场景后生成一份包含输入占位、当前成员、角色缺口、证据规则、议程与结构化交付物的可编辑草稿；
- 草稿继续使用现有 `StructuredCampMessageContent` 和 Core-owned Composer Draft，用户发送前可以修改并加入
  PRD、代码目录、架构文档、图片或原型附件；
- 当前 Default Lead 可用 `campfire` 且至少存在 Lead 之外两位在队成员时，草稿带结构化 `/campfire`
  Skill token；否则明确显示 guided 或 solo 降级，不广播唤醒队员，也不伪造多人讨论已经开始；
- 所有路径均不自动发送、不启动 Runtime、不创建 Task/Memory 或修改工作区文件。

## 明确不做

- 不把场景模板或预设小队加入 Core SQLite、Camp Snapshot、ContextManifest、Runtime 输入或跨设备同步；
- 不增加场景专用 Camp 创建字段、数据库 Migration 或 `lead_coordinated` 模式；只暴露现有 Core 成员命令所需的 `camps.members.add` RPC；
- 不自动把场景角色映射为新的队员，不自动修改队员 Runtime、模型、权限、Skill 或 MCP 分配；
- 不在选择模板时自动发送消息或启动多轮执行；
- 不声称 Runtime 已经读取 Skill，也不在不足 Campfire 人数门槛时插入该 Skill token。

## 验收标准

- 四个内置场景均可从空 Camp 发现，并生成包含角色、议程、证据边界和最终交付要求的草稿；
- 自定义场景能在本机保存、重启后读取、编辑、复制和删除；无效或损坏数据不会阻断内置场景；
- 任一场景可保存、调整和清除预设小队；新建会话可应用预设并在提交前调整队员与负责人；
- 场景启动可补齐当前 Camp 的缺少成员，队员详情可临时加人，且均不修改 AgentProfile 或其他 Camp；
- 三名及以上在队成员且 Lead 可用 `campfire` 时生成结构化 Skill token；两名或单名成员分别诚实降级；
- 场景选择不发送消息，草稿仍可编辑、可附加文件，并在持久 Composer Draft 中保存；
- Day/Night、键盘焦点、最小窗口和 200% zoom 下入口、场景库、编辑表单与错误状态可用；
- TypeScript、相关 Renderer 测试、Desktop 构建、文档门禁和完整回归通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.28 按完成事实冻结为 historical；本概览、实施计划和版本索引建立唯一 current v1.29。 |
| Decisions | 确认无需更新 | 本版不改变 Core、Runtime、持久消息或安全边界；Renderer 本机模板只产生现有 Composer Draft，取舍由本概览和 UI 合同直接记录。 |
| Contracts | 已更新 | `CreateCampRequest` 保持不变；Contracts 增加 `AddCampMemberCommand`/`camps.members.add`，Pending Camp 合同明确仅用户可在首条消息前补齐成员。 |
| Architecture | 确认无需更新 | 复用现有 `CampMember` 和 CollaborationService，不增加进程、数据库表或场景领域对象；Renderer 本机模板与 Core 会话成员权威边界保持清晰。 |
| UI | 已更新 | [工程讨论场景](../../ui/components/discussion-scenes.md)、[Camp 会话工作区](../../ui/components/conversation-workspace.md)和组件索引记录入口、草稿、编排与降级边界。 |
| Runtime Activity | 确认无需更新 | 场景选择不启动 Runtime；后续发送继续使用既有 AgentRun 与 Canonical Activity 映射。 |
| Runtime compatibility | 确认无需更新 | Runtime 版本、模型、Skill 发现能力与平台资格结论没有变化。 |
| Documentation routing | 已更新 | 用户指南和 UI 组件索引新增工程讨论场景入口。 |
| Root README | 已更新 | 讨论场景成为本地团队协作的常青可见能力，英文与中文能力表同步说明。 |

## References

- [实施与验收计划](implementation-plan.md)
- [工程讨论场景 UI 合同](../../ui/components/discussion-scenes.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [操作指南](../../guides/operations.md)
