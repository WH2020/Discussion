import type {
  ProjectLogicDiagram,
  ProjectLogicEdge,
  ProjectLogicMap,
  ProjectLogicNode,
  ProjectLogicNodeKind,
  ProjectLogicRelation,
  ProjectLogicSourceEvidence
} from '@contracts'
import { analyzeDocxProjectLogic } from './project-logic-document'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path'

const MAX_CANDIDATE_FILES = 20_000
const MAX_DEPTH = 24
const MAX_FILE_BYTES = 512 * 1024
const MAX_NODES = 24

const IGNORED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.git',
  '.gradle',
  '.hg',
  '.mypy_cache',
  '.next',
  '.nuxt',
  '.parcel-cache',
  '.pnpm',
  '.pytest_cache',
  '.ruff_cache',
  '.svn',
  '.svelte-kit',
  '.turbo',
  '.tox',
  '.venv',
  '.vite',
  '.yarn',
  '__pycache__',
  '__generated__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor'
])

const CONTAINER_DIRECTORIES = new Set([
  'apps',
  'crates',
  'packages',
  'services'
])

const MODULE_DIRECTORIES = new Set([
  'config',
  'docs',
  'examples',
  'include',
  'public',
  'resources',
  'scripts',
  'src',
  'test',
  'tests',
  'tools'
])

const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp',
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx', '.mts', '.cts',
  '.py', '.pyi', '.rs'
])

const TS_JS_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx', '.mts', '.cts'
])

const RESOLVABLE_EXTENSIONS = [
  '', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.py', '.pyi', '.rs'
]

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.c': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cts': 'TypeScript',
  '.cxx': 'C++',
  '.go': 'Go',
  '.h': 'C/C++ Header',
  '.hpp': 'C++',
  '.java': 'Java',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.mjs': 'JavaScript',
  '.mts': 'TypeScript',
  '.php': 'PHP',
  '.py': 'Python',
  '.pyi': 'Python',
  '.rb': 'Ruby',
  '.rs': 'Rust',
  '.swift': 'Swift',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.vue': 'Vue'
}

interface FileRecord {
  absolutePath: string
  relativePath: string
  extension: string
  language: string | null
}

interface PackageDependency {
  name: string
  line: number
}

interface PackageManifest {
  rootPath: string
  sourcePath: string
  name: string | null
  dependencies: PackageDependency[]
  entryPaths: string[]
  workspacePatterns: string[]
}

interface TypeScriptPathAlias {
  configRoot: string
  sourcePath: string
  line: number
  pattern: string
  targets: string[]
  baseUrl: string
}

interface CargoDependency {
  name: string
  path: string | null
  line: number
  workspace: boolean
  workspaceDefinition: boolean
}

interface CargoManifest {
  rootPath: string
  sourcePath: string
  name: string | null
  dependencies: CargoDependency[]
  workspacePatterns: string[]
}

interface ModuleCandidate {
  path: string
  priority: number
}

interface MutableEdge {
  from: string
  to: string
  relation: ProjectLogicRelation
  sources: Map<string, ProjectLogicSourceEvidence>
}

interface ScanCounters {
  skippedFileCount: number
  largeFileCount: number
  unreadableFileCount: number
  invalidManifestCount: number
  symlinkCount: number
  depthTruncated: boolean
  fileLimitTruncated: boolean
  directoryReadFailureCount: number
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareEvidence(
  left: ProjectLogicSourceEvidence,
  right: ProjectLogicSourceEvidence
): number {
  return compareText(left.path, right.path)
    || (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.reason, right.reason)
}

function compareEdgeEvidence(
  left: ProjectLogicSourceEvidence,
  right: ProjectLogicSourceEvidence
): number {
  const priority = (evidence: ProjectLogicSourceEvidence): number => {
    const base = /(清单|路径别名|Cargo)/.test(evidence.reason)
      ? 0
      : evidence.reason === '真实目录层级' ? 2 : 1
    const testPenalty = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(evidence.path)
      ? 1
      : 0
    return base + testPenalty
  }
  return priority(left) - priority(right) || compareEvidence(left, right)
}

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === ''
    || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}

function isIgnoredDirectory(name: string): boolean {
  const normalized = name.toLocaleLowerCase('en-US')
  return IGNORED_DIRECTORY_NAMES.has(normalized)
    || normalized.startsWith('.')
    || normalized.startsWith('cmake-build-')
    || (/^\.(?:cache|generated|output|temp|tmp)(?:[-_.].*)?$/.test(normalized))
}

function pathContains(parentPath: string, childPath: string): boolean {
  if (parentPath === '.') {
    return true
  }
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`)
}

function lineAt(content: string, index: number): number {
  let line = 1
  for (let position = 0; position < index; position += 1) {
    if (content.charCodeAt(position) === 10) {
      line += 1
    }
  }
  return line
}

function findQuotedKeyLine(content: string, key: string): number {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`["']${escaped}["']\\s*:`).exec(content)
  return match ? lineAt(content, match.index) : 1
}

function parseWorkspacePatterns(value: unknown): string[] {
  const patterns = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { packages?: unknown }).packages)
      ? (value as { packages: unknown[] }).packages
      : []
  return patterns
    .filter((pattern): pattern is string => typeof pattern === 'string' && !pattern.startsWith('!'))
    .map((pattern) => pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''))
    .filter(Boolean)
    .sort(compareText)
}

function parsePackageManifest(
  sourcePath: string,
  content: string
): PackageManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const value = parsed as Record<string, unknown>
  const dependencies: PackageDependency[] = []
  for (const sectionName of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies'
  ]) {
    const section = value[sectionName]
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      continue
    }
    for (const name of Object.keys(section).sort(compareText)) {
      dependencies.push({ name, line: findQuotedKeyLine(content, name) })
    }
  }

  const entryPaths = new Set<string>()
  for (const field of ['main', 'module', 'types']) {
    if (typeof value[field] === 'string') {
      entryPaths.add(value[field] as string)
    }
  }
  if (typeof value.bin === 'string') {
    entryPaths.add(value.bin)
  } else if (value.bin && typeof value.bin === 'object' && !Array.isArray(value.bin)) {
    for (const path of Object.values(value.bin)) {
      if (typeof path === 'string') {
        entryPaths.add(path)
      }
    }
  }

  return {
    rootPath: sourcePath === 'package.json' ? '.' : sourcePath.slice(0, -'/package.json'.length),
    sourcePath,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null,
    dependencies,
    entryPaths: [...entryPaths].sort(compareText),
    workspacePatterns: parseWorkspacePatterns(value.workspaces)
  }
}

function parseTypeScriptPathAliases(
  sourcePath: string,
  content: string
): TypeScriptPathAlias[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonCommentsAndTrailingCommas(content))
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const compilerOptions = (parsed as Record<string, unknown>).compilerOptions
  if (!compilerOptions || typeof compilerOptions !== 'object' || Array.isArray(compilerOptions)) return []
  const options = compilerOptions as Record<string, unknown>
  const paths = options.paths
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return []
  const configRoot = sourcePath.includes('/')
    ? sourcePath.slice(0, sourcePath.lastIndexOf('/'))
    : '.'
  const baseUrl = typeof options.baseUrl === 'string' && options.baseUrl.trim()
    ? options.baseUrl.trim()
    : '.'
  return Object.entries(paths as Record<string, unknown>)
    .flatMap(([pattern, targets]) => {
      if (!pattern.trim() || !Array.isArray(targets)) return []
      const validTargets = targets
        .filter((target): target is string => typeof target === 'string' && target.trim().length > 0)
        .map((target) => target.trim().replace(/\\/g, '/'))
      if (validTargets.length === 0) return []
      return [{
        configRoot,
        sourcePath,
        line: findQuotedKeyLine(content, pattern),
        pattern,
        targets: validTargets,
        baseUrl
      }]
    })
    .sort((left, right) => compareText(left.pattern, right.pattern))
}

function stripJsonCommentsAndTrailingCommas(content: string): string {
  const output = [...content]
  let inString = false
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < output.length; index += 1) {
    const current = output[index]
    const next = output[index + 1]
    if (lineComment) {
      if (current === '\n') lineComment = false
      else output[index] = ' '
      continue
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        output[index] = ' '
        output[index + 1] = ' '
        index += 1
        blockComment = false
      } else if (current !== '\n' && current !== '\r') {
        output[index] = ' '
      }
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === '"') inString = false
      continue
    }
    if (current === '"') {
      inString = true
    } else if (current === '/' && next === '/') {
      output[index] = ' '
      output[index + 1] = ' '
      index += 1
      lineComment = true
    } else if (current === '/' && next === '*') {
      output[index] = ' '
      output[index + 1] = ' '
      index += 1
      blockComment = true
    }
  }
  return output.join('').replace(/,\s*([}\]])/g, '$1')
}

function parseCargoManifest(sourcePath: string, content: string): CargoManifest {
  const lines = content.split(/\r?\n/)
  let section = ''
  let name: string | null = null
  let tableDependency: { name: string; line: number; workspaceDefinition: boolean } | null = null
  const dependencies: CargoDependency[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const withoutComment = lines[index].replace(/\s+#.*$/, '').trim()
    const sectionMatch = /^\[([^\]]+)\]$/.exec(withoutComment)
    if (sectionMatch) {
      section = sectionMatch[1]
      const tableMatch = /(?:^|\.)(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)$/.exec(section)
      tableDependency = tableMatch
        ? {
            name: tableMatch[1],
            line: index + 1,
            workspaceDefinition: section.startsWith('workspace.dependencies.')
          }
        : null
      continue
    }
    if (section === 'package' && name === null) {
      const nameMatch = /^name\s*=\s*["']([^"']+)["']/.exec(withoutComment)
      if (nameMatch) {
        name = nameMatch[1]
      }
    }

    const dependencySection = /(?:^|\.)(?:dev-|build-)?dependencies$/.test(section)
    if (dependencySection) {
      const dependencyMatch = /^([A-Za-z0-9_-]+)\s*=\s*\{([^}]*)\}/.exec(withoutComment)
      const pathMatch = dependencyMatch && /\bpath\s*=\s*["']([^"']+)["']/.exec(dependencyMatch[2])
      const workspaceMatch = dependencyMatch && /\bworkspace\s*=\s*true\b/.exec(dependencyMatch[2])
      if (dependencyMatch && (pathMatch || workspaceMatch)) {
        dependencies.push({
          name: dependencyMatch[1],
          path: pathMatch?.[1] ?? null,
          line: index + 1,
          workspace: Boolean(workspaceMatch),
          workspaceDefinition: section === 'workspace.dependencies'
        })
      }
    } else if (tableDependency) {
      const pathMatch = /^path\s*=\s*["']([^"']+)["']/.exec(withoutComment)
      if (pathMatch) {
        dependencies.push({
          name: tableDependency.name,
          path: pathMatch[1],
          line: index + 1,
          workspace: false,
          workspaceDefinition: tableDependency.workspaceDefinition
        })
      } else if (/^workspace\s*=\s*true\b/.test(withoutComment)) {
        dependencies.push({
          name: tableDependency.name,
          path: null,
          line: index + 1,
          workspace: true,
          workspaceDefinition: false
        })
      }
    }
  }

  const workspaceMatch = /\bmembers\s*=\s*\[([\s\S]*?)\]/m.exec(content)
  const workspacePatterns = workspaceMatch
    ? [...workspaceMatch[1].matchAll(/["']([^"']+)["']/g)]
        .map((match) => match[1].replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''))
        .filter((pattern) => pattern && !pattern.startsWith('!'))
        .sort(compareText)
    : []

  return {
    rootPath: sourcePath === 'Cargo.toml' ? '.' : sourcePath.slice(0, -'/Cargo.toml'.length),
    sourcePath,
    name,
    dependencies,
    workspacePatterns
  }
}

function globMatchesPath(pattern: string, candidate: string): boolean {
  let expression = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        expression += '.*'
        index += 1
      } else {
        expression += '[^/]*'
      }
    } else if (character === '?') {
      expression += '[^/]'
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${expression}$`).test(candidate)
}

function nodeIdForPath(path: string): string {
  return path === '.' ? 'module:root' : `module:${path}`
}

function classifyNode(path: string): ProjectLogicNodeKind {
  if (path === '.') {
    return 'module'
  }
  const parts = path.toLocaleLowerCase('en-US').split('/')
  const leaf = parts.at(-1) ?? ''
  if (parts.some((part) => part === 'test' || part === 'tests' || part === '__tests__')) {
    return 'test'
  }
  if (parts.some((part) => part === 'docs' || part === 'documentation')) {
    return 'documentation'
  }
  if (parts.some((part) => part === 'scripts' || part === 'tools' || part === 'tooling')) {
    return 'tooling'
  }
  if (parts[0] === 'apps') {
    return 'application'
  }
  if (parts[0] === 'services') {
    return 'service'
  }
  if (parts[0] === 'crates' || leaf === 'core' || leaf.endsWith('-core')) {
    return 'core'
  }
  if (parts.some((part) => part === 'resources' || part === 'data')) {
    return 'data'
  }
  if (leaf === 'api' || leaf === 'interfaces' || leaf === 'include') {
    return 'interface'
  }
  if (leaf.includes('adapter') || leaf.includes('integration')) {
    return 'integration'
  }
  return 'module'
}

function kindDescription(kind: ProjectLogicNodeKind): string {
  const descriptions: Record<ProjectLogicNodeKind, string> = {
    actor: '业务参与者',
    application: '应用模块',
    device: '设备模块',
    process: '业务流程',
    decision: '业务判断',
    safety: '安全控制',
    interface: '接口模块',
    service: '服务模块',
    core: '核心模块',
    data: '数据与资源模块',
    integration: '集成模块',
    tooling: '工具模块',
    test: '测试模块',
    documentation: '文档模块',
    module: '项目模块'
  }
  return descriptions[kind]
}

function languageCounts(files: FileRecord[]): Array<{ name: string; fileCount: number }> {
  const counts = new Map<string, number>()
  for (const file of files) {
    if (file.language) {
      counts.set(file.language, (counts.get(file.language) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([name, fileCount]) => ({ name, fileCount }))
    .sort((left, right) => right.fileCount - left.fileCount || compareText(left.name, right.name))
}

function maskComments(content: string): string {
  const characters = [...content]
  let state: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' = 'code'
  let escaped = false
  for (let index = 0; index < characters.length; index += 1) {
    const current = characters[index]
    const next = characters[index + 1]
    if (state === 'line') {
      if (current === '\n') {
        state = 'code'
      } else {
        characters[index] = ' '
      }
      continue
    }
    if (state === 'block') {
      if (current === '*' && next === '/') {
        characters[index] = ' '
        characters[index + 1] = ' '
        index += 1
        state = 'code'
      } else if (current !== '\n' && current !== '\r') {
        characters[index] = ' '
      }
      continue
    }
    if (state !== 'code') {
      if (escaped) {
        escaped = false
      } else if (current === '\\') {
        escaped = true
      } else if (
        (state === 'single' && current === "'")
        || (state === 'double' && current === '"')
        || (state === 'template' && current === '`')
      ) {
        state = 'code'
      }
      continue
    }
    if (current === '/' && next === '/') {
      characters[index] = ' '
      characters[index + 1] = ' '
      index += 1
      state = 'line'
    } else if (current === '/' && next === '*') {
      characters[index] = ' '
      characters[index + 1] = ' '
      index += 1
      state = 'block'
    } else if (current === "'") {
      state = 'single'
    } else if (current === '"') {
      state = 'double'
    } else if (current === '`') {
      state = 'template'
    }
  }
  return characters.join('')
}

function extractTsJsImports(content: string): Array<{ specifier: string; line: number }> {
  const code = maskComments(content)
  const evidence = new Map<string, { specifier: string; line: number }>()
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'";\n]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^'";\n]*?\s+from\s+["']([^"']+)["']/g,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g
  ]
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const line = lineAt(code, match.index ?? 0)
      evidence.set(`${match[1]}\u0000${line}`, { specifier: match[1], line })
    }
  }
  return [...evidence.values()].sort((left, right) => left.line - right.line || compareText(left.specifier, right.specifier))
}

function extractPythonImports(content: string): Array<{ specifier: string; line: number; relative: boolean }> {
  const imports: Array<{ specifier: string; line: number; relative: boolean }> = []
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/#.*$/, '').trim()
    const fromMatch = /^from\s+([.A-Za-z_][.A-Za-z0-9_]*)\s+import\s+/.exec(line)
    if (fromMatch) {
      imports.push({ specifier: fromMatch[1], line: index + 1, relative: fromMatch[1].startsWith('.') })
      continue
    }
    const importMatch = /^import\s+([A-Za-z_][.A-Za-z0-9_]*)/.exec(line)
    if (importMatch) {
      imports.push({ specifier: importMatch[1], line: index + 1, relative: false })
    }
  }
  return imports
}

function quotedTokenLine(content: string, token: string): number | null {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`["']${escaped}["']`).exec(content)
  return match ? lineAt(content, match.index) : null
}

function edgeLabel(relation: ProjectLogicRelation): string {
  const labels: Record<ProjectLogicRelation, string> = {
    depends_on: '依赖',
    imports: '导入',
    contains: '包含',
    builds: '构建',
    tests: '测试',
    flows_to: '下一步',
    branches_to: '分支',
    controls: '控制',
    syncs: '同步',
    authorizes: '授权',
    records: '记录'
  }
  return labels[relation]
}

function calculatePrimaryPath(nodes: ProjectLogicNode[], edges: ProjectLogicEdge[]): string[] {
  const flowEdges = edges.filter((edge) => edge.relation !== 'contains')
  if (flowEdges.length === 0) {
    return []
  }
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of flowEdges) {
    adjacency.get(edge.from)?.push(edge.to)
  }
  for (const targets of adjacency.values()) {
    targets.sort(compareText)
  }

  let best: string[] = []
  for (const start of nodes.map((node) => node.id).sort(compareText)) {
    const queue: string[][] = [[start]]
    const visited = new Set([start])
    while (queue.length > 0) {
      const path = queue.shift()!
      const current = path.at(-1)!
      for (const target of adjacency.get(current) ?? []) {
        if (visited.has(target)) {
          continue
        }
        visited.add(target)
        const candidate = [...path, target]
        queue.push(candidate)
        if (
          candidate.length > best.length
          || (candidate.length === best.length && compareText(candidate.join('\u0000'), best.join('\u0000')) < 0)
        ) {
          best = candidate
        }
      }
    }
  }
  return best
}

/**
 * 从本地项目的真实目录、项目清单和源码导入中构建高层逻辑图。
 */
export async function scanProjectLogic(projectPath: string): Promise<ProjectLogicMap> {
  const startedAt = Date.now()
  if (!isAbsolute(projectPath)) {
    throw new Error('项目路径必须是绝对路径。')
  }

  let rootMetadata: Awaited<ReturnType<typeof lstat>>
  let canonicalRoot: string
  try {
    rootMetadata = await lstat(projectPath)
    canonicalRoot = await realpath(projectPath)
  } catch {
    throw new Error('项目路径不存在或不可访问。')
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('项目路径必须指向真实目录。')
  }
  try {
    if (!(await stat(canonicalRoot)).isDirectory()) {
      throw new Error()
    }
  } catch {
    throw new Error('项目路径必须指向真实目录。')
  }

  const counters: ScanCounters = {
    skippedFileCount: 0,
    largeFileCount: 0,
    unreadableFileCount: 0,
    invalidManifestCount: 0,
    symlinkCount: 0,
    depthTruncated: false,
    fileLimitTruncated: false,
    directoryReadFailureCount: 0
  }
  const files: FileRecord[] = []
  const directories = new Set<string>(['.'])

  async function walk(directoryPath: string, depth: number): Promise<void> {
    let entries
    try {
      entries = await readdir(directoryPath, { withFileTypes: true })
    } catch {
      counters.directoryReadFailureCount += 1
      return
    }
    entries.sort((left, right) => compareText(left.name, right.name))
    for (const entry of entries) {
      if (counters.fileLimitTruncated) {
        return
      }
      const absolutePath = join(directoryPath, entry.name)
      if (!isWithinRoot(canonicalRoot, absolutePath)) {
        counters.skippedFileCount += 1
        continue
      }
      if (entry.isSymbolicLink()) {
        counters.symlinkCount += 1
        counters.skippedFileCount += 1
        continue
      }
      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) {
          continue
        }
        const relativePath = toPosix(relative(canonicalRoot, absolutePath))
        directories.add(relativePath)
        if (depth >= MAX_DEPTH) {
          counters.depthTruncated = true
          continue
        }
        await walk(absolutePath, depth + 1)
        continue
      }
      if (!entry.isFile()) {
        counters.skippedFileCount += 1
        continue
      }
      if (files.length >= MAX_CANDIDATE_FILES) {
        counters.fileLimitTruncated = true
        counters.skippedFileCount += 1
        return
      }
      const relativePath = toPosix(relative(canonicalRoot, absolutePath))
      const extension = extname(entry.name).toLocaleLowerCase('en-US')
      files.push({
        absolutePath,
        relativePath,
        extension,
        language: LANGUAGE_BY_EXTENSION[extension] ?? null
      })
    }
  }

  await walk(canonicalRoot, 0)
  files.sort((left, right) => compareText(left.relativePath, right.relativePath))

  const contentCache = new Map<string, string | null>()
  async function readText(record: FileRecord, cache = false): Promise<string | null> {
    if (cache && contentCache.has(record.relativePath)) {
      return contentCache.get(record.relativePath) ?? null
    }
    try {
      const canonicalFile = await realpath(record.absolutePath)
      if (!isWithinRoot(canonicalRoot, canonicalFile)) {
        counters.skippedFileCount += 1
        if (cache) contentCache.set(record.relativePath, null)
        return null
      }
      const handle = await open(canonicalFile, 'r')
      try {
        const metadata = await handle.stat()
        if (!metadata.isFile()) {
          counters.skippedFileCount += 1
          if (cache) contentCache.set(record.relativePath, null)
          return null
        }
        const buffer = Buffer.allocUnsafe(MAX_FILE_BYTES + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        if (bytesRead > MAX_FILE_BYTES) {
          counters.largeFileCount += 1
          counters.skippedFileCount += 1
          if (cache) contentCache.set(record.relativePath, null)
          return null
        }
        const content = buffer.toString('utf8', 0, bytesRead)
        if (cache) contentCache.set(record.relativePath, content)
        return content
      } finally {
        await handle.close()
      }
    } catch {
      counters.unreadableFileCount += 1
      counters.skippedFileCount += 1
      if (cache) contentCache.set(record.relativePath, null)
      return null
    }
  }

  const packageManifests: PackageManifest[] = []
  const cargoManifests: CargoManifest[] = []
  const typeScriptPathAliases: TypeScriptPathAlias[] = []
  const pnpmWorkspacePatterns: string[] = []
  for (const file of files) {
    const fileName = basename(file.relativePath)
    if (fileName === 'package.json') {
      const content = await readText(file, true)
      if (content === null) {
        continue
      }
      const manifest = parsePackageManifest(file.relativePath, content)
      if (manifest) {
        packageManifests.push(manifest)
      } else {
        counters.invalidManifestCount += 1
      }
    } else if (fileName === 'Cargo.toml') {
      const content = await readText(file, true)
      if (content !== null) {
        cargoManifests.push(parseCargoManifest(file.relativePath, content))
      }
    } else if (fileName === 'tsconfig.json' || fileName === 'jsconfig.json' || /^tsconfig\..+\.json$/i.test(fileName)) {
      const content = await readText(file, true)
      if (content !== null) {
        typeScriptPathAliases.push(...parseTypeScriptPathAliases(file.relativePath, content))
      }
    } else if (file.relativePath === 'pnpm-workspace.yaml' || file.relativePath === 'pnpm-workspace.yml') {
      const content = await readText(file, true)
      if (content !== null) {
        const lines = content.split(/\r?\n/)
        let packagesIndent: number | null = null
        for (const line of lines) {
          if (packagesIndent === null) {
            const packagesMatch = /^(\s*)packages\s*:\s*(?:#.*)?$/.exec(line)
            if (packagesMatch) {
              packagesIndent = packagesMatch[1].length
            }
            continue
          }
          if (!line.trim() || line.trimStart().startsWith('#')) {
            continue
          }
          const indentation = line.length - line.trimStart().length
          if (indentation <= packagesIndent) {
            break
          }
          const match = /^\s*-\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/.exec(line)
          if (match && !match[1].startsWith('!')) {
            pnpmWorkspacePatterns.push(
              match[1].replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
            )
          }
        }
      }
    }
  }
  packageManifests.sort((left, right) => compareText(left.rootPath, right.rootPath))
  cargoManifests.sort((left, right) => compareText(left.rootPath, right.rootPath))
  typeScriptPathAliases.sort((left, right) => {
    const rootDepthDifference = right.configRoot.split('/').length - left.configRoot.split('/').length
    return rootDepthDifference
      || right.pattern.replace('*', '').length - left.pattern.replace('*', '').length
      || compareText(left.sourcePath, right.sourcePath)
      || compareText(left.pattern, right.pattern)
  })

  const workspacePatterns = new Set<string>(pnpmWorkspacePatterns)
  for (const manifest of packageManifests) {
    if (manifest.rootPath === '.') {
      manifest.workspacePatterns.forEach((pattern) => workspacePatterns.add(pattern))
    }
  }
  const cargoWorkspacePatterns = new Set<string>()
  for (const manifest of cargoManifests) {
    if (manifest.rootPath === '.') {
      manifest.workspacePatterns.forEach((pattern) => cargoWorkspacePatterns.add(pattern))
    }
  }

  const moduleCandidates = new Map<string, ModuleCandidate>()
  function addModuleCandidate(path: string, priority: number): void {
    if (!directories.has(path) && path !== '.') {
      return
    }
    const existing = moduleCandidates.get(path)
    if (!existing || priority < existing.priority) {
      moduleCandidates.set(path, { path, priority })
    }
  }
  addModuleCandidate('.', 0)

  for (const directory of [...directories].sort(compareText)) {
    if (directory === '.') {
      continue
    }
    const parts = directory.split('/')
    if (parts.length === 1 && CONTAINER_DIRECTORIES.has(parts[0])) {
      addModuleCandidate(directory, 15)
    }
    if (parts.length === 2 && CONTAINER_DIRECTORIES.has(parts[0])) {
      addModuleCandidate(directory, 5)
    }
    if (parts.length === 1 && MODULE_DIRECTORIES.has(parts[0])) {
      addModuleCandidate(directory, 20)
    }
  }

  const allWorkspacePatterns = [...workspacePatterns].sort(compareText)
  const allCargoWorkspacePatterns = [...cargoWorkspacePatterns].sort(compareText)
  for (const manifest of packageManifests) {
    const workspaceMember = allWorkspacePatterns.some((pattern) => globMatchesPath(pattern, manifest.rootPath))
    const shallowManifest = manifest.rootPath.split('/').length <= 3
    if (manifest.rootPath !== '.' && (workspaceMember || shallowManifest)) {
      addModuleCandidate(manifest.rootPath, workspaceMember ? 4 : 10)
    }
  }
  for (const manifest of cargoManifests) {
    const workspaceMember = allCargoWorkspacePatterns.some((pattern) => globMatchesPath(pattern, manifest.rootPath))
    const underCrates = manifest.rootPath.startsWith('crates/') && manifest.rootPath.split('/').length === 2
    if (manifest.name && manifest.rootPath !== '.' && (workspaceMember || underCrates)) {
      addModuleCandidate(manifest.rootPath, workspaceMember ? 4 : 10)
    }
  }

  for (const directory of [...directories].sort(compareText)) {
    if (directory !== '.' && !directory.includes('/')) {
      addModuleCandidate(directory, 30)
    }
  }

  const selectedModulePaths = [...moduleCandidates.values()]
    .sort((left, right) => left.priority - right.priority || compareText(left.path, right.path))
    .slice(0, MAX_NODES)
    .map((candidate) => candidate.path)
    .sort((left, right) => compareText(left, right))
  function modulePathForFile(path: string): string {
    let best = '.'
    for (const modulePath of selectedModulePaths) {
      if (pathContains(modulePath, path) && modulePath.length > best.length) {
        best = modulePath
      }
    }
    return best
  }

  const rootPackage = packageManifests.find((manifest) => manifest.rootPath === '.')
  const rootCargo = cargoManifests.find((manifest) => manifest.rootPath === '.' && manifest.name)
  const projectName = rootPackage?.name ?? rootCargo?.name ?? basename(canonicalRoot)
  const manifestByRoot = new Map(packageManifests.map((manifest) => [manifest.rootPath, manifest]))
  const cargoByRoot = new Map(cargoManifests.map((manifest) => [manifest.rootPath, manifest]))
  const filesByPath = new Map(files.map((file) => [pathKey(file.relativePath), file]))

  function actualFile(path: string): string | null {
    const normalized = toPosix(path).replace(/^\.\//, '')
    const key = pathKey(normalized)
    return filesByPath.get(key)?.relativePath ?? null
  }

  function resolveTypeScriptPathAlias(
    source: FileRecord,
    specifier: string
  ): { file: string; alias: TypeScriptPathAlias } | null {
    for (const alias of typeScriptPathAliases) {
      if (!pathContains(alias.configRoot, source.relativePath)) continue
      const wildcardIndex = alias.pattern.indexOf('*')
      let wildcard = ''
      if (wildcardIndex < 0) {
        if (specifier !== alias.pattern) continue
      } else {
        const prefix = alias.pattern.slice(0, wildcardIndex)
        const suffix = alias.pattern.slice(wildcardIndex + 1)
        if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
        wildcard = specifier.slice(prefix.length, specifier.length - suffix.length)
      }
      const configDirectory = alias.configRoot === '.' ? canonicalRoot : resolve(canonicalRoot, alias.configRoot)
      const baseDirectory = resolve(configDirectory, alias.baseUrl)
      if (!isWithinRoot(canonicalRoot, baseDirectory)) continue
      for (const targetPattern of alias.targets) {
        const target = wildcardIndex < 0 ? targetPattern : targetPattern.replace(/\*/g, wildcard)
        const absoluteBase = resolve(baseDirectory, target)
        if (!isWithinRoot(canonicalRoot, absoluteBase)) continue
        const relativeBase = toPosix(relative(canonicalRoot, absoluteBase))
        for (const extension of RESOLVABLE_EXTENSIONS) {
          const direct = actualFile(`${relativeBase}${extension}`)
          if (direct) return { file: direct, alias }
        }
        for (const extension of RESOLVABLE_EXTENSIONS.slice(1)) {
          const indexFile = actualFile(`${relativeBase}/index${extension}`)
          if (indexFile) return { file: indexFile, alias }
        }
      }
    }
    return null
  }

  const nodes: ProjectLogicNode[] = selectedModulePaths.map((modulePath) => {
    const moduleFiles = files.filter((file) => pathContains(modulePath, file.relativePath))
    const languages = languageCounts(moduleFiles)
    const packageManifest = manifestByRoot.get(modulePath)
    const cargoManifest = cargoByRoot.get(modulePath)
    const kind = classifyNode(modulePath)
    const sources: ProjectLogicSourceEvidence[] = []
    let entry = false

    if (packageManifest) {
      sources.push({ path: packageManifest.sourcePath, line: 1, reason: 'Node 项目清单' })
      for (const entryPath of packageManifest.entryPaths) {
        const candidate = actualFile(toPosix(join(modulePath === '.' ? '' : modulePath, entryPath)))
        if (candidate && modulePathForFile(candidate) === modulePath) {
          entry = true
          sources.push({ path: candidate, line: 1, reason: 'package.json 声明的入口' })
        }
      }
    }
    if (cargoManifest) {
      sources.push({ path: cargoManifest.sourcePath, line: 1, reason: 'Cargo 项目清单' })
    }

    const conventionalEntries = moduleFiles
      .filter((file) => modulePathForFile(file.relativePath) === modulePath)
      .filter((file) => {
        const localPath = modulePath === '.'
          ? file.relativePath
          : file.relativePath.slice(modulePath.length + 1)
        return /^(?:src\/)?(?:main|index|lib)\.(?:[cm]?[jt]sx?|py|rs)$/.test(localPath)
          || /^__main__\.py$/.test(localPath)
      })
      .sort((left, right) => compareText(left.relativePath, right.relativePath))
    if (conventionalEntries.length > 0) {
      entry = true
      for (const file of conventionalEntries.slice(0, 2)) {
        sources.push({ path: file.relativePath, line: 1, reason: '约定入口文件' })
      }
    }

    const label = modulePath === '.'
      ? projectName
      : packageManifest?.name ?? cargoManifest?.name ?? basename(modulePath)
    const language = languages[0]?.name ?? null
    const summary = language
      ? `${kindDescription(kind)}，包含 ${moduleFiles.length} 个文件，主要语言为 ${language}。`
      : `${kindDescription(kind)}，包含 ${moduleFiles.length} 个文件。`
    return {
      id: nodeIdForPath(modulePath),
      label,
      kind,
      path: modulePath,
      summary,
      language,
      fileCount: moduleFiles.length,
      entry,
      sources: sources.sort(compareEvidence).slice(0, 3)
    }
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  const mutableEdges = new Map<string, MutableEdge>()
  function addEdge(
    fromPath: string,
    toPath: string,
    relation: ProjectLogicRelation,
    evidence: ProjectLogicSourceEvidence
  ): void {
    const from = nodeIdForPath(fromPath)
    const to = nodeIdForPath(toPath)
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) {
      return
    }
    const key = `${relation}\u0000${from}\u0000${to}`
    let edge = mutableEdges.get(key)
    if (!edge) {
      edge = { from, to, relation, sources: new Map() }
      mutableEdges.set(key, edge)
    }
    const evidenceKey = `${evidence.path}\u0000${evidence.line ?? ''}\u0000${evidence.reason}`
    edge.sources.set(evidenceKey, evidence)
  }

  for (const childPath of selectedModulePaths) {
    if (childPath === '.') {
      continue
    }
    const parentPath = selectedModulePaths
      .filter((candidate) => candidate !== childPath && pathContains(candidate, childPath))
      .sort((left, right) => right.length - left.length || compareText(left, right))[0]
    if (parentPath) {
      addEdge(parentPath, childPath, 'contains', {
        path: childPath,
        line: null,
        reason: '真实目录层级'
      })
    }
  }

  const packagesByName = new Map<string, PackageManifest[]>()
  for (const manifest of packageManifests) {
    if (!manifest.name) {
      continue
    }
    const existing = packagesByName.get(manifest.name) ?? []
    existing.push(manifest)
    packagesByName.set(manifest.name, existing)
  }
  for (const manifests of packagesByName.values()) {
    manifests.sort((left, right) => compareText(left.rootPath, right.rootPath))
  }

  for (const manifest of packageManifests) {
    const fromPath = modulePathForFile(manifest.sourcePath)
    for (const dependency of manifest.dependencies) {
      const targets = packagesByName.get(dependency.name)
      if (!targets || targets.length !== 1) {
        continue
      }
      const toPath = modulePathForFile(targets[0].sourcePath)
      addEdge(fromPath, toPath, 'depends_on', {
        path: manifest.sourcePath,
        line: dependency.line,
        reason: `package.json 声明工作区依赖 “${dependency.name}”`
      })
    }
  }

  const cargoWorkspaceDependencies = new Map<string, { path: string; rootPath: string }>()
  for (const manifest of cargoManifests) {
    for (const dependency of manifest.dependencies) {
      if (dependency.workspaceDefinition && dependency.path) {
        cargoWorkspaceDependencies.set(dependency.name, {
          path: dependency.path,
          rootPath: manifest.rootPath
        })
      }
    }
  }

  const cargoPackagesByName = new Map<string, CargoManifest[]>()
  for (const manifest of cargoManifests) {
    if (!manifest.name) continue
    const manifests = cargoPackagesByName.get(manifest.name) ?? []
    manifests.push(manifest)
    cargoPackagesByName.set(manifest.name, manifests)
  }
  for (const manifests of cargoPackagesByName.values()) {
    manifests.sort((left, right) => compareText(left.rootPath, right.rootPath))
  }

  for (const manifest of cargoManifests) {
    const fromPath = modulePathForFile(manifest.sourcePath)
    for (const dependency of manifest.dependencies) {
      if (dependency.workspaceDefinition) {
        continue
      }
      const inheritedDependency = dependency.workspace
        ? cargoWorkspaceDependencies.get(dependency.name)
        : null
      const dependencyPath = dependency.path ?? inheritedDependency?.path
      const dependencyBasePath = dependency.path ? manifest.rootPath : inheritedDependency?.rootPath
      if (!dependencyPath || dependencyBasePath === undefined) {
        continue
      }
      const dependencyAbsolutePath = resolve(
        canonicalRoot,
        dependencyBasePath === '.' ? '' : dependencyBasePath,
        dependencyPath
      )
      if (!isWithinRoot(canonicalRoot, dependencyAbsolutePath)) {
        continue
      }
      const dependencyRoot = toPosix(relative(canonicalRoot, dependencyAbsolutePath)) || '.'
      const targetManifest = cargoByRoot.get(dependencyRoot)
      if (!targetManifest || !targetManifest.name) {
        continue
      }
      addEdge(fromPath, modulePathForFile(targetManifest.sourcePath), 'depends_on', {
        path: manifest.sourcePath,
        line: dependency.line,
        reason: dependency.workspace
          ? `Cargo workspace path 依赖 “${dependency.name}”`
          : `Cargo path 依赖 “${dependency.name}”`
      })
    }
  }

  function resolveRelativeImport(source: FileRecord, specifier: string): string | null {
    const cleanSpecifier = specifier.split(/[?#]/, 1)[0]
    const absoluteBase = resolve(dirname(source.absolutePath), cleanSpecifier)
    if (!isWithinRoot(canonicalRoot, absoluteBase)) {
      return null
    }
    const relativeBase = toPosix(relative(canonicalRoot, absoluteBase))
    for (const extension of RESOLVABLE_EXTENSIONS) {
      const direct = actualFile(`${relativeBase}${extension}`)
      if (direct) {
        return direct
      }
    }
    for (const extension of RESOLVABLE_EXTENSIONS.slice(1)) {
      const indexFile = actualFile(`${relativeBase}/index${extension}`)
      if (indexFile) {
        return indexFile
      }
    }
    return null
  }

  function resolveWorkspaceImport(
    source: FileRecord,
    specifier: string
  ): { file: string; alias: TypeScriptPathAlias | null } | null {
    const matchingNames = [...packagesByName.keys()]
      .filter((name) => specifier === name || specifier.startsWith(`${name}/`))
      .sort((left, right) => right.length - left.length || compareText(left, right))
    const name = matchingNames[0]
    if (name) {
      const targets = packagesByName.get(name)
      if (targets?.length === 1) return { file: targets[0].sourcePath, alias: null }
    }
    return resolveTypeScriptPathAlias(source, specifier)
  }

  for (const file of files) {
    if (!SOURCE_EXTENSIONS.has(file.extension)) {
      continue
    }
    const content = await readText(file)
    if (content === null) {
      continue
    }
    const fromPath = modulePathForFile(file.relativePath)
    if (TS_JS_EXTENSIONS.has(file.extension)) {
      for (const imported of extractTsJsImports(content)) {
        const resolution = imported.specifier.startsWith('.')
          ? { file: resolveRelativeImport(file, imported.specifier), alias: null }
          : resolveWorkspaceImport(file, imported.specifier)
        if (!resolution?.file) {
          continue
        }
        const toPath = modulePathForFile(resolution.file)
        addEdge(fromPath, toPath, 'imports', {
          path: file.relativePath,
          line: imported.line,
          reason: `源码导入 “${imported.specifier}”`
        })
        if (resolution.alias) {
          addEdge(fromPath, toPath, 'imports', {
            path: resolution.alias.sourcePath,
            line: resolution.alias.line,
            reason: `TypeScript 路径别名 “${resolution.alias.pattern}”`
          })
        }
      }
      const code = maskComments(content)
      const launchesProcess = /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(/.test(code)
      if (launchesProcess) {
        const buildsCargoPackage = /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*["']cargo["']/.test(code)
        for (const [packageName, manifests] of cargoPackagesByName) {
          if (manifests.length !== 1) continue
          const line = quotedTokenLine(code, packageName)
          if (line === null) continue
          const targetPath = modulePathForFile(manifests[0].sourcePath)
          addEdge(fromPath, targetPath, buildsCargoPackage ? 'builds' : 'depends_on', {
            path: file.relativePath,
            line,
            reason: buildsCargoPackage
              ? `进程构建 Cargo 目标 “${packageName}”`
              : `进程启动引用 Cargo 目标 “${packageName}”`
          })
        }
      }
    } else if (file.extension === '.py' || file.extension === '.pyi') {
      for (const imported of extractPythonImports(content)) {
        let basePath: string
        if (imported.relative) {
          const dotCount = imported.specifier.match(/^\.+/)?.[0].length ?? 0
          let directory = dirname(file.absolutePath)
          for (let level = 1; level < dotCount; level += 1) {
            directory = dirname(directory)
          }
          basePath = resolve(directory, imported.specifier.slice(dotCount).replace(/\./g, sep))
        } else {
          basePath = resolve(canonicalRoot, imported.specifier.replace(/\./g, sep))
        }
        if (!isWithinRoot(canonicalRoot, basePath)) {
          continue
        }
        const relativeBase = toPosix(relative(canonicalRoot, basePath))
        const targetFile = actualFile(`${relativeBase}.py`)
          ?? actualFile(`${relativeBase}.pyi`)
          ?? actualFile(`${relativeBase}/__init__.py`)
        if (targetFile) {
          addEdge(fromPath, modulePathForFile(targetFile), 'imports', {
            path: file.relativePath,
            line: imported.line,
            reason: `Python 源码导入 “${imported.specifier}”`
          })
        }
      }
    }
  }

  const edges: ProjectLogicEdge[] = [...mutableEdges.values()]
    .map((edge) => {
      const sources = [...edge.sources.values()].sort(compareEdgeEvidence)
      return {
        id: `edge:${edge.relation}:${edge.from}->${edge.to}`,
        from: edge.from,
        to: edge.to,
        relation: edge.relation,
        label: edgeLabel(edge.relation),
        evidenceCount: sources.length,
        sources: sources.slice(0, 3)
      }
    })
    .sort((left, right) => compareText(left.from, right.from)
      || compareText(left.to, right.to)
      || compareText(left.relation, right.relation))

  const warnings: string[] = []
  if (counters.fileLimitTruncated) {
    warnings.push(`候选文件超过 ${MAX_CANDIDATE_FILES} 个，扫描已截断。`)
  }
  if (counters.depthTruncated) {
    warnings.push(`目录深度超过 ${MAX_DEPTH} 层，扫描已截断。`)
  }
  if (counters.largeFileCount > 0) {
    warnings.push(`${counters.largeFileCount} 个超过 512 KiB 的文件未读取内容。`)
  }
  if (counters.unreadableFileCount > 0) {
    warnings.push(`${counters.unreadableFileCount} 个文件无法读取，已跳过内容分析。`)
  }
  if (counters.directoryReadFailureCount > 0) {
    warnings.push(`${counters.directoryReadFailureCount} 个目录无法读取，相关内容未扫描。`)
  }
  if (counters.invalidManifestCount > 0) {
    warnings.push(`${counters.invalidManifestCount} 个 package.json 无法解析，已跳过清单分析。`)
  }
  if (counters.symlinkCount > 0) {
    warnings.push(`${counters.symlinkCount} 个符号链接未跟随。`)
  }
  if (files.length === 0) {
    warnings.push('未发现可扫描文件。')
  }

  const architectureDiagram: ProjectLogicDiagram = {
    id: 'architecture',
    title: '文件结构图',
    description: '根据本地文件、目录、项目清单、模块边界、静态导入和构建证据生成。',
    nodes,
    edges,
    primaryPath: calculatePrimaryPath(nodes, edges)
  }
  const hasSourceArchitecture = packageManifests.length > 0
    || cargoManifests.length > 0
    || files.some((file) => SOURCE_EXTENSIONS.has(file.extension))
  const documentCandidates = files
    .filter((file) => file.extension === '.docx')
    .sort((left, right) => {
      const priority = (file: FileRecord): number => /(?:prd|需求|requirement|spec)/i.test(file.relativePath) ? 0 : 1
      return priority(left) - priority(right) || compareText(left.relativePath, right.relativePath)
    })
  const documentDiagrams: ProjectLogicDiagram[] = []
  if (documentCandidates.length > 0) {
    const document = documentCandidates[0]
    try {
      const analysis = await analyzeDocxProjectLogic({
        absolutePath: document.absolutePath,
        relativePath: document.relativePath,
        projectName,
        projectRoot: canonicalRoot
      })
      documentDiagrams.push(...analysis.diagrams)
      warnings.push(...analysis.warnings)
      if (documentCandidates.length > 1) {
        warnings.push(`发现 ${documentCandidates.length} 份 DOCX，本次优先按 “${document.relativePath}” 拆解业务。`)
      }
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() ? error.message : '未知错误'
      warnings.push(`DOCX 业务分析失败：${detail}`)
    }
  }

  const diagrams = hasSourceArchitecture
    ? [architectureDiagram, ...documentDiagrams]
    : documentDiagrams.length > 0 ? documentDiagrams : [architectureDiagram]
  const primaryDiagram = diagrams[0]
  const analysisKind = hasSourceArchitecture && documentDiagrams.length > 0
    ? 'mixed' as const
    : documentDiagrams.length > 0 ? 'product-document' as const : 'source-code' as const
  const languages = languageCounts(files)
  if (languages.length === 0 && documentCandidates.length > 0) {
    languages.push({ name: 'DOCX 产品文档', fileCount: documentCandidates.length })
  }

  return {
    schemaVersion: 1,
    project: {
      name: projectName,
      projectPath: canonicalRoot
    },
    generatedAt: new Date().toISOString(),
    nodes: primaryDiagram.nodes,
    edges: primaryDiagram.edges,
    primaryPath: primaryDiagram.primaryPath,
    warnings,
    scan: {
      scannedFileCount: files.length,
      skippedFileCount: counters.skippedFileCount,
      truncated: counters.fileLimitTruncated || counters.depthTruncated,
      durationMs: Math.max(0, Date.now() - startedAt),
      languages
    },
    analysisKind,
    diagrams
  }
}
