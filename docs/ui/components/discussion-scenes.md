---
document_type: ui-component-contract
authority: renderer-local-discussion-scenes
status: accepted
last_updated: 2026-08-25
---

# 工程讨论场景

工程讨论场景是空 Camp 的本机起步工具，用于把重复的角色视角、议程、证据要求和
最终交付组织成可编辑的 Composer Draft。它不是新的执行器、会话类型或 Core 领域对象。

## 角色与权威边界

用户可在队员工作区自定义长期队员的名称、团队角色、专业职责与协作边界。场景中的
“算法负责人”、“目标用户代表”或“独立审阅者”只是本轮需要覆盖的临时视角：

- 实际参与者始终来自当前 Camp 的真实在队成员；
- Default Lead 按队员的长期角色和职责分工，一位队员可以覆盖多个视角；
- 没有合适队员的视角必须作为缺口报告，不创建虚构参与者；
- 场景不修改 `AgentProfile.teamRole`、Runtime、模型、权限、Skill 或 MCP 分配。

## 入口与场景库

普通空 Camp 在原有三个起步建议之后显示“工程讨论场景”。首次训练 Camp 继续使用专属
引导，不显示该入口。时间线已有消息或 Camp 已有 Run 时，空状态与场景入口一同退出。

首屏展示四个内置场景和最多两个最早保存的自定义场景：

- 算法方案评审；
- 产品 PRD 评审；
- 软件架构评审；
- 设计原型评审。

“管理自定义场景”打开完整场景库。内置场景只能“复制并编辑”；自定义场景可新建、
编辑和二次确认删除。字段包括名称、分类、说明、角色/视角、讨论议程、最终交付和可选补充要求。

## 本机存储

自定义场景是 Renderer 本机偏好，使用带 schema 版本的 `rovai.discussion-scenes.v1` 保存，最多 40 个。
它不进入 Core SQLite、Camp Snapshot、Runtime Context、团队记忆或跨设备同步，也不是可审计的项目事实。

编辑器对每组角色、议程和交付物限制为 12 项、每行 180 个字符，超限时原位报错而不静默截断。
读取时对 schema、字段长度、列表数量、重复项和标识进行校验。整体或部分数据损坏时，原始字符串先保存到
`rovai.discussion-scenes.recovery.v1`，再加载可用项并在 Dialog 报告；如果恢复副本也无法写入，后续保存失败封闭，
不覆盖唯一原数据。内置场景始终可用。普通写入失败时保留当前已保存列表，原位显示错误，不声称保存成功。

## 草稿与编排

选择场景会生成 `StructuredCampMessageContent`，并经现有 `changeMessage` 路径写入同一份
Core-owned Composer Draft。不建立第二份草稿，不发送 CampMessage，不启动 Runtime，不创建
Task/Memory，也不修改工作区文件。
在 `camp.composerDraft.get` 返回权威草稿前，场景卡和 Dialog 中的填充动作保持禁用；读取失败时继续禁用填充，
不用 Renderer 中的临时空值推断“没有旧草稿”。“管理自定义场景”仍可打开，因为本机模板 CRUD 不依赖 Core Draft。

草稿包含待补充的讨论对象、材料、约束和成功标准，并列出草稿生成时的在队成员、临时视角、议程、
事实/推断/假设/未知分界和最终交付。发送时的实际成员与 Default Lead 以 Camp 最新权威配置为准。
过长的自定义场景在生成草稿时按 UTF-8 字节上限精简，草稿显示提示，原模板不被改写。

| 真实在队成员与 Skill 状态 | 生成结果 |
|---|---|
| 1 位或更少 | 纯文本的单人多视角评审提纲 |
| 2 位 | 纯文本的双角色/guided 评审提纲 |
| 3 位及以上，Default Lead 在队且可用 `campfire` | 结构化 `/campfire` Skill token + 场景正文，发送后由 Lead 按 Skill 组织 |
| 3 位及以上，Skill 加载中或不可用 | 纯文本 guided 提纲，不伪造多人编排 |

`campfire` token 只能来自当前 Lead 可投递的 Skill 投影，不用手写 `/campfire` 文本伪装。人数不足时不用
`@all`、不广播唤醒队员。Skill 可用只表示草稿可引用它；真实执行仍在用户发送后由 Core 和 Runtime 校验。

如果输入框已有正文，首屏场景卡不直接覆盖；它先打开场景详情并说明影响，用户选择“覆盖并填入”
后才替换正文。已准备的附件保留，可继续添加 PRD、代码目录、架构文档、图片或原型材料。

## 键盘、焦点与状态

- 首屏场景卡和管理入口是原生 Button，可通过 Tab/Shift+Tab 到达；
- 场景库复用 App Dialog 的焦点限制、Escape 关闭和触发器焦点返回；
- 场景选择使用 Button + `aria-pressed`，不声称未实现方向键语义的 listbox；
- 保存错误、覆盖警告和删除确认使用文本与 `role="alert"`，不依赖颜色；
- 选择成功后焦点转到真实 Composer，状态文本明确说明尚需补充并手动发送；
- 入口、场景库、编辑表单和警告只使用语义主题 token，在 Day/Night、最小窗口与 200% zoom 下保持可操作。
