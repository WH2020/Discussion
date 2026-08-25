---
document_type: implementation-plan
version: v1.29
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-25
---

# v1.29 实施与验收计划

## Checkpoint 0：范围与边界

- [x] 复用现有队员身份、Camp、Composer Draft、结构化 Skill Mention 与 `campfire`；
- [x] 场景模板与预设小队保持 Renderer 本机偏好，复用 Core `CampMember`，不增加场景领域对象或 Migration；
- [x] 只新增会话成员所需的 `camps.members.add` RPC，场景 ID 不进入 `CreateCampRequest`；
- [x] 冻结“不自动发送、不广播唤醒、不修改长期队员身份”的产品边界；
- [x] 更新版本、UI 合同、用户指南和 README 路由。

## Checkpoint 1：场景模型与本机库

- [x] 定义场景分类、角色/视角、议程、交付物和补充要求；
- [x] 提供算法、PRD、软件架构和设计原型四个内置场景；
- [x] 支持自定义场景创建、复制、编辑、二次确认删除和本机持久化；
- [x] 支持每场景预设小队、预设负责人、独立 schema 校验和损坏数据恢复副本；
- [x] 对本机数据进行 schema、长度、数量、重复和损坏输入校验；
- [x] 生成区分事实、推断、假设和未知的结构化工程讨论提纲。

## Checkpoint 2：Camp 接入与交互

- [x] 在普通空 Camp 欢迎面增加场景入口，首次训练 Camp 保持既有专属起步内容；
- [x] 在创建新对话时选择场景，以可用预设小队初始化队员与负责人，并保留本次手工调整能力；
- [x] 场景启动前补齐缺少的预设队员，Active Camp 队员详情支持临时增加 present 队员；
- [x] Pending Camp 只允许 User 补齐成员且不追加普通成员领域事件，Agent/System 继续拒绝；
- [x] 选择场景后写入同一 Core-owned Composer Draft，并把焦点移动到输入框；
- [x] 三名及以上在队成员且 Lead 可用时插入结构化 `/campfire` token；
- [x] 两名或单名成员、Skill 未就绪和本机存储失败均显示可理解的诚实降级；
- [x] 场景库、编辑器、删除确认和响应式状态使用既有 App Dialog 与主题 token。
- [x] 提供 Windows 根目录双击启动入口，检查工具链、首次依赖并复用规范 `pnpm dev` 路径；

## Checkpoint 3：验证与交付

- [x] 场景模型、小队存储与选择计划、Prompt、Skill token、solo/guided 降级单元测试；
- [x] 场景入口静态渲染和 Pending/Active Camp 成员命令定向回归；
- [x] `pnpm typecheck`、`pnpm build:desktop`；
- [x] `pnpm docs:test`、`pnpm docs:check`；
- [x] `pnpm test` 完整回归；
- [x] 开发版 Desktop、Core sidecar 与 Renderer 启动检查；
- [x] `start-rovai.cmd --check` 与双击等价启动路径验证；
- [ ] 隔离 Desktop 双主题、键盘、最小窗口与 200% zoom 视觉验收；
- [x] 独立代码与产品边界复核。

## 当前验证结果

- `pnpm typecheck`：通过；
- 场景、小队和新建会话定向 Renderer 测试：14/14 通过；
- `cargo fmt --all --check` 与 `cargo check -p rovai-core --all-targets --features slow-tests`：通过；仅保留既有 `start_or_resume_session` dead-code warning；
- Pending Camp 用户加人/非用户拒绝测试 2/2 通过，Active Camp 加人/重新加入测试 1/1 通过；
- `pnpm build:desktop`：Main、Preload 和 Renderer 生产构建通过；
- `pnpm docs:test` 与 `pnpm docs:check`：文档测试、版本指针和 Decision governance 通过；
- `pnpm test`：Vitest 533 通过、3 项按既有条件跳过；后续 Node 脚本回归 219/219 通过；
- `pnpm dev`：开发版 Desktop 启动成功，Core sidecar 报告 ready，Renderer dev server 和 Camp 打开请求正常；
- `start-rovai.cmd --check`：常规 PATH 与仅保留系统 Node/Corepack、Cargo 的资源管理器等价 PATH 均通过；
- `start-rovai.cmd`：从根目录包装器完成 Core 增量构建、隔离 userData、Renderer dev server、Electron 窗口和 Core ready 启动，应用保持运行；
- `pnpm package:windows:x64`：Windows x64 Release Core 和 Desktop 构建成功；electron-builder 在下载 Electron 分发包时 600000 ms 超时，命令最终失败；
- 视觉专用的未签名打包尝试在同一 Electron 分发包下载边界阻塞并主动终止。因此 Day/Night、1040×700、200% zoom 和真实键盘焦点仍是未验证风险，本计划保持 `in_progress`。
- 独立只读复核发现 Draft 加载竞态、多行字段静默截断和损坏本机数据覆盖风险；修复后定向复核确认三项关闭。复核追加的“Draft 异常过度禁用本地场景管理”问题也已收窄为只禁用场景填充。
