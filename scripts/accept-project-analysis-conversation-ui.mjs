import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'

const root = resolve(import.meta.dirname, '..')
const defaultWindowsApp = join(
  root,
  'dist',
  'deep-logic-release',
  'win-unpacked',
  'Rovai-ai.exe'
)
const appPath = resolve(process.argv[2] ?? defaultWindowsApp)
const projectPath = resolve(process.env.ROVAI_PROJECT_ANALYSIS_ACCEPT_PROJECT ?? root)
const outputDir = resolve(
  process.env.ROVAI_PROJECT_ANALYSIS_ACCEPT_OUTPUT_DIR
    ?? join(root, 'dist', 'deep-logic-release', 'acceptance')
)
const fixtureRoot = process.env.ROVAI_PROJECT_ANALYSIS_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-project-analysis-ui-'))
const dataDir = join(fixtureRoot, 'user-data')
const electronUserDataDir = process.platform === 'win32'
  ? join(dataDir, 'Electron', 'User Data')
  : dataDir
const port = Number(process.env.ROVAI_PROJECT_ANALYSIS_ACCEPT_DEBUG_PORT ?? 9587)
const question = '画出从逻辑图请求、代码证据检查、结构校验到画布回写的完整数据流，并标出失败回退。'

await mkdir(outputDir, { recursive: true })
if (process.platform === 'win32') {
  await runProcess(packagedCoreExecutable(), ['--prepare-windows-data-root', dataDir])
} else {
  await mkdir(dataDir, { recursive: true })
}
seedCompletedOnboardingForAcceptance(electronUserDataDir)

let app = null
try {
  app = await launchApp()
  await setTheme(app.cdp, 'night')

  const preflight = await request(app.cdp, 'camps.creationPreflight')
  assert(preflight.admissible && preflight.presentMembers.length > 0,
    `Project analysis acceptance needs at least one present member: ${JSON.stringify(preflight)}`)
  const workspace = await request(app.cdp, 'workspaces.inspect', { path: projectPath })
  const profiles = await request(app.cdp, 'members.list')
  for (const profile of profiles.filter((candidate) => candidate.runtimeConfiguration !== null)) {
    const cleared = await request(app.cdp, 'members.runtime.clear', {
      commandId: crypto.randomUUID(),
      command: { agentId: profile.agentId, expectedVersion: profile.version }
    })
    assert(cleared.status === 'applied', `Could not isolate Runtime fallback: ${JSON.stringify(cleared)}`)
  }
  const isolatedPreflight = await request(app.cdp, 'camps.creationPreflight')
  assert(isolatedPreflight.presentMembers.every((member) => (
    member.runtimeReadiness !== 'ready' && member.runtimeReadiness !== 'light_ready'
  )), `Runtime fallback fixture was not isolated: ${JSON.stringify(isolatedPreflight)}`)

  const created = await request(app.cdp, 'camps.create', {
    commandId: crypto.randomUUID(),
    name: '专项分析界面验收项目',
    workspace: { projectPath: workspace.projectPath },
    memberAgentIds: preflight.presentMembers.map((member) => member.agentId),
    defaultLeadAgentId: isolatedPreflight.initialLeadAgentId,
    collaborationMode: 'peer',
    activationState: 'active'
  })
  assert(created.status === 'applied', `Could not create project fixture: ${JSON.stringify(created)}`)

  await waitForExpression(app.cdp, `(() => {
    const rows = [...document.querySelectorAll('.navigation-projects .project-select-row')]
    return rows.some((row) => row.title === ${JSON.stringify(workspace.name)})
  })()`, 15_000)
  const selectedProject = await evaluate(app.cdp, `(() => {
    const row = [...document.querySelectorAll('.navigation-projects .project-select-row')]
      .find((candidate) => candidate.title === ${JSON.stringify(workspace.name)})
    row?.click()
    return Boolean(row)
  })()`)
  assert(selectedProject, 'Could not select the fixture project in the sidebar')

  const openedLogic = await evaluate(app.cdp, `(() => {
    const button = document.querySelector('button[aria-label="项目逻辑图"]')
    button?.click()
    return Boolean(button)
  })()`)
  assert(openedLogic, 'Project Logic navigation was unavailable')
  await waitForExpression(app.cdp,
    `Boolean((document.querySelector('.project-logic-summary')
      && document.querySelector('.project-logic-diagram-intro'))
      || document.querySelector('.project-logic-error'))`, 60_000)
  const scanError = await evaluate(app.cdp,
    `document.querySelector('.project-logic-error')?.textContent?.trim() ?? null`)
  assert(!scanError, `Project Logic scan rendered an error: ${scanError}`)

  const initialStructureState = await evaluate(app.cdp, `(() => ({
    activeTitle: document.querySelector('.project-logic-diagram-intro strong')?.textContent?.trim(),
    stageText: document.querySelector('.project-logic-stages')?.textContent,
    analysisPanelOpen: Boolean(document.querySelector('.project-logic-analysis')),
    manualEntry: [...document.querySelectorAll('.project-logic-header-actions button')]
      .some((button) => button.textContent?.trim() === '按需深度分析')
  }))()`)
  assert(initialStructureState.activeTitle === '文件结构图'
    && initialStructureState.stageText?.includes('本地静态扫描已完成，不启动 Runtime')
    && initialStructureState.stageText?.includes('提交具体目标后才会启动 Runtime')
    && !initialStructureState.analysisPanelOpen
    && initialStructureState.manualEntry,
  `Project selection did not stop at the local structure stage: ${JSON.stringify(initialStructureState)}`)

  await clickButton(app.cdp, '.project-logic-header-actions button', '按需深度分析')
  await waitForExpression(app.cdp, `Boolean(document.querySelector('.project-logic-analysis'))`)
  await waitForExpression(app.cdp,
    `document.querySelector('.project-logic-analysis-status')?.textContent?.includes('等待 Runtime') === true`)
  await clickButton(app.cdp, '.project-logic-analysis-modes button', '自定义图')
  await setTextarea(app.cdp, '.project-logic-analysis textarea', question)

  const fallbackState = await evaluate(app.cdp, `(() => {
    const panel = document.querySelector('.project-logic-analysis')
    const rect = panel?.getBoundingClientRect()
    return {
      modes: [...panel.querySelectorAll('.project-logic-analysis-modes button')]
        .map((button) => button.textContent?.trim()),
      customActive: [...panel.querySelectorAll('.project-logic-analysis-modes button')]
        .find((button) => button.textContent?.trim() === '自定义图')?.getAttribute('aria-pressed'),
      question: panel.querySelector('textarea')?.value,
      submitDisabled: panel.querySelector('button[type="submit"]')?.disabled,
      configureRuntime: [...panel.querySelectorAll('button')]
        .some((button) => button.textContent?.trim() === '配置 Runtime'),
      staticCanvas: Boolean(document.querySelector('.project-logic-canvas')),
      evidenceBoundary: panel.querySelector('.project-logic-analysis-note')?.textContent,
      overflow: Boolean(rect && (rect.left < 0 || rect.right > window.innerWidth))
    }
  })()`)
  assert.deepEqual(fallbackState.modes, ['软件架构图', '算法架构图', '自定义图'])
  assert(fallbackState.customActive === 'true' && fallbackState.question === question,
    `In-map generation composer did not retain the request: ${JSON.stringify(fallbackState)}`)
  assert(fallbackState.submitDisabled && fallbackState.configureRuntime && fallbackState.staticCanvas,
    `Runtime fallback did not preserve the static graph: ${JSON.stringify(fallbackState)}`)
  assert(fallbackState.evidenceBoundary?.includes('每个节点和关系')
    && fallbackState.evidenceBoundary?.includes('不再添加固定执行时限')
    && fallbackState.evidenceBoundary?.includes('应用修改并继续')
    && !fallbackState.overflow,
    `Evidence boundary or layout was invalid: ${JSON.stringify(fallbackState)}`)

  const fallbackCapture = join(outputDir, 'project-logic-generation-runtime-fallback.png')
  await capture(app.cdp, fallbackCapture)

  const scan = await evaluate(
    app.cdp,
    `window.rovai.projectLogic.scan(${JSON.stringify(workspace.projectPath)})`,
    true
  )
  const scanFingerprint = projectLogicScanFingerprint(scan)
  const cacheKey = projectLogicGenerationCacheKey(workspace.projectPath, scanFingerprint)
  const cachedDiagram = acceptanceDiagram()
  const previousCachedDiagram = {
    ...acceptanceDiagram(),
    id: 'ai-algorithm-architecture-acceptance-first',
    title: '验收：第一轮算法架构图'
  }
  const cacheEntry = {
    schemaVersion: 1,
    projectPath: workspace.projectPath,
    scanFingerprint,
    diagram: cachedDiagram,
    diagrams: [previousCachedDiagram, cachedDiagram],
    campId: null,
    messageSummaries: [
      { role: 'user', content: question },
      { role: 'assistant', content: '已依据真实代码证据生成并通过结构校验。' }
    ],
    savedAt: new Date().toISOString()
  }
  await evaluate(app.cdp,
    `localStorage.setItem(${JSON.stringify(cacheKey)}, ${JSON.stringify(JSON.stringify(cacheEntry))})`)

  const openedMemory = await evaluate(app.cdp, `(() => {
    const button = [...document.querySelectorAll('.unified-primary-nav button')]
      .find((candidate) => candidate.getAttribute('aria-label')?.startsWith('记忆'))
    button?.click()
    return Boolean(button)
  })()`)
  assert(openedMemory, 'Could not leave the Logic Map before cache hydration')
  await waitForExpression(app.cdp, `Boolean(document.querySelector('.memory-library'))`)
  await evaluate(app.cdp, `document.querySelector('button[aria-label="项目逻辑图"]')?.click()`)
  await waitForExpression(app.cdp, `(() => {
    const titles = [...document.querySelectorAll('.project-logic-diagram-tabs button strong')]
      .map((node) => node.textContent?.trim())
    return document.querySelector('.project-logic-diagram-intro strong')?.textContent?.trim() === '文件结构图'
      && titles.includes(${JSON.stringify(previousCachedDiagram.title)})
      && titles.includes(${JSON.stringify(cachedDiagram.title)})
  })()`, 30_000)

  const hydratedState = await evaluate(app.cdp, `(() => ({
    tabs: [...document.querySelectorAll('.project-logic-diagram-tabs button strong')]
      .map((node) => node.textContent?.trim()),
    activeTitle: document.querySelector('.project-logic-diagram-intro strong')?.textContent?.trim(),
    structureBadge: document.querySelector('.project-logic-diagram-intro small')?.textContent?.trim(),
    analysisPanelOpen: Boolean(document.querySelector('.project-logic-analysis'))
  }))()`)
  assert(hydratedState.tabs.includes('文件结构图')
    && hydratedState.tabs.includes(previousCachedDiagram.title)
    && hydratedState.tabs.includes(cachedDiagram.title)
    && hydratedState.activeTitle === '文件结构图'
    && hydratedState.structureBadge === '本地结构底图'
    && !hydratedState.analysisPanelOpen,
  `Cached analysis did not preserve the structure-first entry state: ${JSON.stringify(hydratedState)}`)

  const selectedCachedDiagram = await evaluate(app.cdp, `(() => {
    const title = [...document.querySelectorAll('.project-logic-diagram-tabs button strong')]
      .find((node) => node.textContent?.trim() === ${JSON.stringify(cachedDiagram.title)})
    const button = title?.closest('button')
    button?.click()
    return Boolean(button)
  })()`)
  assert(selectedCachedDiagram, 'Could not select the restored generated diagram')
  await clickButton(app.cdp, '.project-logic-header-actions button', '按需深度分析')
  await waitForExpression(app.cdp,
    `document.querySelector('.project-logic-diagram-intro strong')?.textContent?.trim()
      === ${JSON.stringify(cachedDiagram.title)}
      && Boolean(document.querySelector('.project-logic-analysis-history'))`)

  const generatedState = await evaluate(app.cdp, `(() => ({
    tabs: [...document.querySelectorAll('.project-logic-diagram-tabs button strong')]
      .map((node) => node.textContent?.trim()),
    activeTitle: document.querySelector('.project-logic-diagram-intro strong')?.textContent?.trim(),
    aiBadge: document.querySelector('.project-logic-diagram-intro small')?.textContent?.trim(),
    status: document.querySelector('.project-logic-analysis-status')?.textContent,
    history: document.querySelector('.project-logic-analysis-history')?.textContent,
    nodes: document.querySelectorAll('.project-logic-node').length,
    evidenceSources: document.querySelectorAll('.project-logic-source-list button').length,
    relationshipLabels: document.querySelectorAll('.project-logic-edge-label').length,
    relationshipLabelBackgrounds: document.querySelectorAll('.project-logic-edge-label rect').length,
    labelsAfterNodes: (() => {
      const nodes = document.querySelector('.project-logic-nodes')
      const labels = document.querySelector('.project-logic-edge-labels')
      return Boolean(nodes && labels && (nodes.compareDocumentPosition(labels) & Node.DOCUMENT_POSITION_FOLLOWING))
    })(),
    relationshipLabelNodeOverlaps: (() => {
      const labels = [...document.querySelectorAll('.project-logic-edge-label')]
      const nodes = [...document.querySelectorAll('.project-logic-node')]
      return labels.filter((label) => {
        const labelRect = label.getBoundingClientRect()
        return nodes.some((node) => {
          const nodeRect = node.getBoundingClientRect()
          return labelRect.left < nodeRect.right && labelRect.right > nodeRect.left
            && labelRect.top < nodeRect.bottom && labelRect.bottom > nodeRect.top
        })
      }).length
    })()
  }))()`)
  assert(generatedState.tabs.includes('文件结构图') && generatedState.tabs.includes(cachedDiagram.title),
    `Generated diagram was not added beside the static map: ${JSON.stringify(generatedState)}`)
  assert(generatedState.activeTitle === cachedDiagram.title && generatedState.aiBadge === 'AI 深度分析',
    `Generated diagram was not selected or labelled: ${JSON.stringify(generatedState)}`)
  assert(generatedState.status?.includes('深度分析已完成')
    && generatedState.history?.includes('通过结构校验')
    && generatedState.nodes === 2
    && generatedState.evidenceSources > 0,
  `Generated graph evidence or conversation was not rendered: ${JSON.stringify(generatedState)}`)
  assert(generatedState.relationshipLabels === 1
    && generatedState.relationshipLabelBackgrounds === 1
    && generatedState.labelsAfterNodes
    && generatedState.relationshipLabelNodeOverlaps === 0,
  `Relationship labels were obscured or intersected node cards: ${JSON.stringify(generatedState)}`)

  const generatedCapture = join(outputDir, 'project-logic-generation-cached-result.png')
  await capture(app.cdp, generatedCapture)
  process.stdout.write(`${JSON.stringify({
    ok: true,
    app: basename(appPath),
    project: workspace.projectPath,
    fixtureRoot,
    verified: {
      structureGraphShownBeforeAnalysis: true,
      analysisStartsOnlyFromManualEntry: true,
      staticGraphPreservedWithoutRuntime: true,
      softwareAlgorithmAndCustomModesVisible: true,
      cachedDiagramRestoredWithoutReplacingStructureEntry: true,
      multipleAnalysisDiagramsRestored: true,
      generatedDiagramEvidenceVisible: true,
      inMapConversationHistoryVisible: true,
      noLogicMapSpecificExecutionLimit: true,
      pauseAndReviseGuidanceVisible: true,
      relationshipLabelsVisibleAboveLinesAndOutsideNodes: true
    },
    captures: {
      fallback: fallbackCapture,
      generated: generatedCapture
    }
  }, null, 2)}\n`)
} finally {
  if (app) await closeApp(app)
}

function acceptanceDiagram() {
  const workspaceSource = 'apps/desktop/src/renderer/src/ProjectLogicWorkspace.tsx'
  const runnerSource = 'apps/desktop/src/renderer/src/project-logic-analysis-runner.ts'
  return {
    id: 'ai-software-architecture-acceptance',
    title: '验收：对话生成的软件架构图',
    description: '验证生成图可与静态图并存，并展示项目内证据。',
    nodes: [
      {
        id: 'logic-ui',
        label: '逻辑图对话界面',
        kind: 'application',
        path: workspaceSource,
        summary: '收集图类型和用户目标，并把验证结果写回画布。',
        language: 'TypeScript',
        fileCount: 1,
        entry: true,
        sources: [{
          path: workspaceSource,
          line: 1,
          reason: '事实：该文件实现逻辑图工作区与对话生成界面。'
        }]
      },
      {
        id: 'analysis-runner',
        label: '深度分析运行链路',
        kind: 'core',
        path: runnerSource,
        summary: '创建或复用项目会话，发送请求并跟踪对应分析轮次。',
        language: 'TypeScript',
        fileCount: 1,
        entry: false,
        sources: [{
          path: runnerSource,
          line: 1,
          reason: '事实：该文件实现项目分析会话的发送、轮询和失败交接。'
        }]
      }
    ],
    edges: [{
      id: 'ui-to-runner',
      from: 'logic-ui',
      to: 'analysis-runner',
      relation: 'flows_to',
      label: '提交结构化分析请求',
      evidenceCount: 1,
      sources: [{
        path: workspaceSource,
        line: 1,
        reason: '事实：工作区通过分析运行链路提交请求并接收结果。'
      }]
    }],
    primaryPath: ['logic-ui', 'analysis-runner']
  }
}

function projectLogicScanFingerprint(map) {
  const semanticScan = {
    schemaVersion: map.schemaVersion,
    analysisKind: map.analysisKind ?? null,
    scan: {
      scannedFileCount: map.scan.scannedFileCount,
      skippedFileCount: map.scan.skippedFileCount,
      truncated: map.scan.truncated,
      languages: [...map.scan.languages]
        .map((language) => ({ name: language.name, fileCount: language.fileCount }))
        .sort((left, right) => compareText(left.name, right.name) || left.fileCount - right.fileCount)
    },
    nodes: [...map.nodes].map(fingerprintNode).sort(compareByStableJson),
    edges: [...map.edges].map(fingerprintEdge).sort(compareByStableJson),
    primaryPath: [...map.primaryPath],
    warnings: [...map.warnings].sort()
  }
  return `plg1-${stableHash(stableJson(semanticScan))}`
}

function projectLogicGenerationCacheKey(projectPath, scanFingerprint) {
  const normalizedPath = normalizeProjectPathForCache(projectPath)
  const normalizedFingerprint = normalizeInline(scanFingerprint, 160) || 'missing-fingerprint'
  return `rovai:project-logic-generation:v1:${stableHash(normalizedPath)}:${normalizedFingerprint}`
}

function fingerprintNode(node) {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    path: node.path.replaceAll('\\', '/'),
    summary: node.summary,
    language: node.language,
    fileCount: node.fileCount,
    entry: node.entry,
    sources: [...node.sources].map(fingerprintSource).sort(compareByStableJson)
  }
}

function fingerprintEdge(edge) {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    label: edge.label,
    evidenceCount: edge.evidenceCount,
    sources: [...edge.sources].map(fingerprintSource).sort(compareByStableJson)
  }
}

function fingerprintSource(source) {
  return { path: source.path.replaceAll('\\', '/'), line: source.line, reason: source.reason }
}

function compareByStableJson(left, right) {
  return compareText(stableJson(left), stableJson(right))
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function stableHash(value) {
  const first = fnv1a32(value, 0x811c9dc5)
  const second = fnv1a32(value, 0x9e3779b9)
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

function fnv1a32(value, seed) {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

function normalizeProjectPathForCache(projectPath) {
  let nativePath = normalizeInline(projectPath, 2_000)
  if (/^\\\\\?\\unc\\/iu.test(nativePath)) {
    nativePath = `//${nativePath.slice(8)}`
  } else {
    nativePath = nativePath.replace(/^\\\\\?\\/u, '')
  }
  const slashPath = nativePath.replaceAll('\\', '/')
  const isUnc = slashPath.startsWith('//')
  let normalized = isUnc
    ? `//${slashPath.slice(2).replace(/\/+/gu, '/')}`
    : slashPath.replace(/\/+/gu, '/')
  if (normalized.length > 1 && !/^[a-zA-Z]:\/$/u.test(normalized)) {
    normalized = normalized.replace(/\/+$/gu, '')
  }
  if (/^[a-zA-Z]:\//u.test(normalized) || isUnc) normalized = normalized.toLowerCase()
  return normalized
}

function normalizeInline(value, maxLength) {
  return Array.from(value.trim().replace(/\s+/gu, ' ')).slice(0, maxLength).join('')
}

async function setTextarea(cdp, selector, value) {
  const changed = await evaluate(cdp, `(() => {
    const textarea = document.querySelector(${JSON.stringify(selector)})
    if (!textarea) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, ${JSON.stringify(value)})
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, `Could not update textarea ${selector}`)
}

async function clickButton(cdp, selector, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click enabled button ${JSON.stringify(label)} within ${selector}`)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp,
    `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(preference)}`)
}

async function launchApp() {
  const stderr = []
  const child = spawn(appPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
    },
    windowsHide: true
  })
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let cdp = null
  try {
    const target = await waitForTarget(stderr)
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Page.bringToFront')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 920,
      deviceScaleFactor: 1,
      mobile: false
    })
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    return { cdp, child }
  } catch (error) {
    cdp?.close()
    await terminateChild(child)
    throw error
  }
}

function packagedCoreExecutable() {
  return process.platform === 'win32'
    ? join(resolve(appPath, '..'), 'resources', 'bin', 'rovai-core.exe')
    : join(appPath, 'Contents', 'Resources', 'bin', 'rovai-core')
}

function runProcess(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stderr = []
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} exited with ${code ?? signal}: ${stderr.join('')}`))
    })
  })
}

async function closeApp(instance) {
  try {
    await Promise.race([instance.cdp.send('Browser.close'), wait(1_000)])
  } catch {
    // The isolated acceptance instance may already be closed.
  }
  instance.cdp.close()
  await terminateChild(instance.child)
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(3_000)
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function capture(cdp, path) {
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(screenshot.result.data, 'base64'))
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  })
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      ?? response.result.exceptionDetails.text
      ?? `Evaluation failed: ${expression}`)
  }
  return response.result?.result?.value
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return
    await wait(100)
  }
  throw new Error(`Expression did not become true: ${expression}`)
}

async function waitForTarget(stderr) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 45_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`)
        .then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page')
      if (target) return target
    } catch {
      // Electron is still starting.
    }
    await wait(100)
  }
  throw new Error(`Electron DevTools target did not appear: ${stderr.join('')}`)
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const requestEntry = message.id ? pending.get(message.id) : null
    if (!requestEntry) return
    pending.delete(message.id)
    if (message.error) requestEntry.reject(new Error(message.error.message))
    else requestEntry.resolve(message)
  })
  return {
    send(method, params = {}) {
      return new Promise((resolveRequest, rejectRequest) => {
        const id = nextId++
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      socket.close()
    }
  }
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
