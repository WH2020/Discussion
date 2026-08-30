---
document_type: ui-component-spec
authority: renderer-component-contract
status: accepted
last_updated: 2026-08-30
---

# PPT 工作台

PPT 工作台是 Rovai 一级导航中的独立本机创作表面。它吸收
[`zhx47/ppt-agent`](https://github.com/zhx47/ppt-agent) 的阶段化工作流思想，把一份演示拆成可观察、
可修改和可回放的项目；它不是 Camp 内嵌面板，也不启动第二个 FastAPI、Python 或数据库服务。

## 信息架构

- 项目库负责新建需求、最近项目和本机删除；进入项目后不再显示 Camp 时间线或 Inspector。
- 工作区固定包含页面缩略图轨、中央 16:9 画布和当前阶段 Inspector；最小窗口下仍保持当前页可编辑，
  不产生应用级横向滚动。
- 顶部五个阶段依次为“需求 / 大纲 / 资料 / 初稿 / 设计”。用户可以直接回到任一阶段修订，前一阶段
  内容不会因切换而被清空。
- “资料”严格按页保存标题、URL 和可引用结论，不把其他页来源自动混入当前页。
- “设计”提供瓷白、深钢、暖灰三个同构预设以及大字结论、标题正文、双栏对照三种版式。
- 放映模式支持按钮、左右方向键和 Escape；导出生成标准 `.pptx`，保留页面文本和演讲者备注。

## 本机持久化与恢复

- 工作台项目使用版本化 Renderer 本机库 `rovai.presentation-workbench.v1`；项目上限、页面上限、文本长度、
  enum 和来源数量在读取边界校验。
- 无效或损坏的原始快照保存到独立 recovery key，再以空项目库继续；不得用部分解析值猜测项目状态。
- 该库是用户创作草稿，不是 Camp、Task、AgentRun、Evidence 或 Runtime 事实。它不进入 Core SQLite、
  ContextManifest、Memory、消息投递或通知。
- 新建、切换阶段和编辑页面不会自动发送 Camp 消息、启动 Agent、访问网络或调用模型。需要团队研究时，
  用户仍通过现有 Discussion/Camp 工作流显式发起。

## 安全与交付边界

- 来源链接只对 `http` 和 `https` 提供可点击打开；任意其他协议只作为不可执行文本保存。
- 项目和项目库删除必须二次确认；PPTX 导出是显式用户动作，失败保持项目原状并提供可重试提示。
- 页面预览使用安全 React 文本节点，不执行用户输入的 HTML、SVG、脚本或远程嵌入内容。
- 视觉继续使用 Porcelain Day / Steel Night 的语义 Token；演示预设只影响幻灯片画布，不改变应用主题。

## 验收

- 空项目库能创建 4–24 页的首版大纲，项目重启后可恢复；损坏快照不阻断进入工作台。
- 页面增删、排序、逐页来源、文本、备注、版式和预设可编辑并持久保存。
- 五个阶段、页面轨、中央画布、Inspector、放映和 PPTX 导出均可键盘访问。
- `1040×700`、200% zoom、Day/Night 和 reduced-motion 下不丢失主要操作，也不新增全局横向滚动。
