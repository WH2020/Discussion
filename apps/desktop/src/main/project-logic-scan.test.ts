import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { scanProjectLogic } from './project-logic-scan'

const temporaryDirectories: string[] = []

async function makeProject(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(root)
  return root
}

async function writeProjectFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(root, ...path.split('/'))
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content, 'utf8')
  }
}

async function writeProjectBinary(root: string, path: string, content: Uint8Array): Promise<void> {
  const absolutePath = join(root, ...path.split('/'))
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content)
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('scanProjectLogic', () => {
  it('从 pnpm/Package 清单和 TS 源码合并工作区依赖证据', async () => {
    const root = await makeProject('rovai-logic-ts-')
    await writeProjectFiles(root, {
      'package.json': JSON.stringify({
        name: 'fixture-workspace',
        private: true,
        workspaces: ['apps/*', 'packages/*']
      }, null, 2),
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
      'tsconfig.json': [
        '{',
        '  // JSONC 注释和尾逗号必须被支持',
        '  "compilerOptions": {',
        '    "paths": { "@shared": ["./packages/shared/src/index.ts"], },',
        '  },',
        '}'
      ].join('\n'),
      'apps/web/package.json': JSON.stringify({
        name: '@fixture/web',
        dependencies: { '@fixture/shared': 'workspace:*' }
      }, null, 2),
      'apps/web/src/main.ts': [
        "import { shared } from '@fixture/shared'",
        "import { shared as aliasedShared } from '@shared'",
        "// import '@fixture/ghost'",
        'export const app = shared + aliasedShared'
      ].join('\n'),
      'packages/shared/package.json': JSON.stringify({
        name: '@fixture/shared',
        main: 'src/index.ts'
      }, null, 2),
      'packages/shared/src/index.ts': 'export const shared = 1\n',
      'docs/overview.md': '# Fixture\n'
    })

    const result = await scanProjectLogic(root)
    const webId = 'module:apps/web'
    const sharedId = 'module:packages/shared'

    expect(result.schemaVersion).toBe(1)
    expect(result.project).toEqual({
      name: 'fixture-workspace',
      projectPath: await realpath(root)
    })
    expect(result.diagrams?.[0]).toMatchObject({
      id: 'architecture',
      title: '文件结构图'
    })
    expect(result.nodes.length).toBeGreaterThanOrEqual(6)
    expect(result.nodes.length).toBeLessThanOrEqual(24)
    expect(result.nodes.find((node) => node.id === webId)).toMatchObject({
      kind: 'application',
      language: 'TypeScript',
      entry: true
    })
    expect(result.nodes.find((node) => node.id === sharedId)).toMatchObject({
      language: 'TypeScript',
      entry: true
    })
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: webId, to: sharedId, relation: 'depends_on' }),
      expect.objectContaining({ from: webId, to: sharedId, relation: 'imports' })
    ]))
    const importEdge = result.edges.find((edge) =>
      edge.from === webId && edge.to === sharedId && edge.relation === 'imports'
    )
    expect(importEdge?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'tsconfig.json',
        reason: 'TypeScript 路径别名 “@shared”'
      })
    ]))
    expect(result.edges.flatMap((edge) => edge.sources)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringContaining('ghost') })
    ]))
    expect(result.edges.every((edge) => edge.sources.length <= 3)).toBe(true)
    expect(result.primaryPath).not.toContain('module:root')
    expect(result.primaryPath).toEqual(expect.arrayContaining([webId, sharedId]))
    expect(result.scan.languages).toEqual(expect.arrayContaining([
      { name: 'TypeScript', fileCount: 2 }
    ]))
  })

  it('识别 Cargo workspace 的 Rust path dependency', async () => {
    const root = await makeProject('rovai-logic-rust-')
    await writeProjectFiles(root, {
      'Cargo.toml': [
        '[workspace]',
        'members = ["crates/*"]',
        'resolver = "2"',
        '',
        '[workspace.dependencies]',
        'fixture-core = { path = "crates/core" }'
      ].join('\n'),
      'crates/core/Cargo.toml': '[package]\nname = "fixture-core"\nversion = "0.1.0"\n',
      'crates/core/src/lib.rs': 'pub fn value() -> u8 { 1 }\n',
      'crates/api/Cargo.toml': [
        '[package]',
        'name = "fixture-api"',
        'version = "0.1.0"',
        '',
        '[dependencies]',
        'fixture-core = { path = "../core" }'
      ].join('\n'),
      'crates/api/src/main.rs': 'fn main() {}\n',
      'crates/worker/Cargo.toml': [
        '[package]',
        'name = "fixture-worker"',
        'version = "0.1.0"',
        '',
        '[dependencies]',
        'fixture-core = { workspace = true }'
      ].join('\n'),
      'crates/worker/src/lib.rs': 'pub fn work() {}\n',
      'apps/desktop/package.json': JSON.stringify({ name: '@fixture/desktop' }),
      'apps/desktop/src/main.ts': [
        "import { spawn } from 'node:child_process'",
        "const binary = sidecarExecutableName('fixture-core')",
        'spawn(binary, [])'
      ].join('\n'),
      'scripts/build-core.mjs': [
        "import { spawnSync } from 'node:child_process'",
        "const args = ['build', '--package', 'fixture-core']",
        "spawnSync('cargo', args)"
      ].join('\n')
    })

    const result = await scanProjectLogic(root)
    const dependency = result.edges.find((edge) =>
      edge.from === 'module:crates/api'
      && edge.to === 'module:crates/core'
      && edge.relation === 'depends_on'
    )

    expect(dependency).toBeDefined()
    expect(dependency?.sources[0]).toMatchObject({
      path: 'crates/api/Cargo.toml',
      line: 6
    })
    expect(result.nodes.find((node) => node.id === 'module:crates/api')).toMatchObject({
      kind: 'core',
      language: 'Rust',
      entry: true
    })
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'module:crates/worker',
        to: 'module:crates/core',
        relation: 'depends_on',
        sources: [expect.objectContaining({
          path: 'crates/worker/Cargo.toml',
          reason: expect.stringContaining('workspace path')
        })]
      })
    ]))
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'module:apps/desktop',
        to: 'module:crates/core',
        relation: 'depends_on',
        sources: [expect.objectContaining({
          path: 'apps/desktop/src/main.ts',
          reason: '进程启动引用 Cargo 目标 “fixture-core”'
        })]
      }),
      expect.objectContaining({
        from: 'module:scripts',
        to: 'module:crates/core',
        relation: 'builds'
      })
    ]))
  })

  it('忽略生成目录，并限制大文件内容读取', async () => {
    const root = await makeProject('rovai-logic-ignore-')
    await writeProjectFiles(root, {
      'package.json': JSON.stringify({ name: 'ignore-fixture' }),
      'src/index.ts': "export const real = 'source'\n",
      'src/large.ts': 'x'.repeat(512 * 1024 + 1),
      '.git/objects/generated.ts': 'export const gitObject = true\n',
      '.claude/settings.json': '{"runtime":"claude"}\n',
      '.codex/config.toml': 'model = "codex"\n',
      'node_modules/hidden/package.json': JSON.stringify({ name: '@hidden/pkg' }),
      'node_modules/hidden/index.ts': 'export const hidden = true\n',
      'dist/generated.js': 'export const generated = true\n',
      '.cache/generated.py': 'generated = True\n',
      'target/debug/generated.rs': 'pub fn generated() {}\n'
    })

    const result = await scanProjectLogic(root)

    expect(result.scan.scannedFileCount).toBe(3)
    expect(result.scan.languages).toEqual([{ name: 'TypeScript', fileCount: 2 }])
    expect(result.warnings).toContain('1 个超过 512 KiB 的文件未读取内容。')
    expect(result.nodes.every((node) => !/(node_modules|dist|target|\.cache|\.claude|\.codex)/.test(node.path))).toBe(true)
    expect(result.edges.flatMap((edge) => edge.sources).every((source) =>
      !/(node_modules|dist|target|\.cache|\.claude|\.codex)/.test(source.path)
    )).toBe(true)
  })

  it('对纯 PRD 项目忽略工具目录并按具体业务返回可切换流程图', async () => {
    const root = await makeProject('rovai-logic-prd-')
    await writeProjectFiles(root, {
      '.claude/settings.json': '{"runtime":"claude"}\n',
      '.codex/config.toml': 'model = "codex"\n'
    })
    const paragraphs = [
      ['Title', '医疗产品 PRD'],
      ['Heading1', '系统角色与控制边界'],
      ['', '用户通过用户 APP 操作设备，设备负责本地刺激和安全的最终校验与最终裁决。'],
      ['', '医生 APP 与云端同步方案和记录，云端不进入实时刺激闭环。'],
      ['Heading1', '注册绑定与自愿入组'],
      ['', '用户注册并绑定设备后可独立使用，也可自愿入组；邀请码需要核对，用户确认共享范围后入组生效。'],
      ['', '用户退出后医生方案停止，退出前共享记录保留只读。'],
      ['Heading1', '方案与参数权限'],
      ['', '默认方案和医生方案均需设备最终校验；用户仅调每通道幅值和全局治疗时间包络，频率和脉宽专业参数由医生设置，活动疗程中不热切换。'],
      ['Heading1', '治疗与测量'],
      ['', '选择方案并在包络内调整，选择是否测量 HR/HRV，然后设备本地 START 并执行安全检查。'],
      ['', '测量路径执行 PRE、倒计时、治疗、POST，形成成对结果；不测量正常完成则生成普通使用记录。'],
      ['Heading1', '安全记录与同步'],
      ['', 'STOP、故障、USB-C 插入和计时结束时先将刺激输出归零；接触异常时暂停全部通道，修复后仍需明确恢复。'],
      ['', '治疗中止不执行 POST；POST 无效仍保留治疗记录；BLE 断连时本地缓存，重连后补传；记录归属按 START 时授权快照。']
    ].map(([style, text]) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
    const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`
    await writeProjectBinary(root, '产品需求说明书.docx', zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'word/document.xml': strToU8(xml)
    }))

    const result = await scanProjectLogic(root)

    expect(result.analysisKind).toBe('product-document')
    expect(result.scan.scannedFileCount).toBe(1)
    expect(result.scan.languages).toEqual([{ name: 'DOCX 产品文档', fileCount: 1 }])
    expect(result.diagrams?.map((diagram) => diagram.id)).toEqual([
      'system-control-boundary',
      'enrollment-lifecycle',
      'plan-parameter-permissions',
      'treatment-optional-measurement',
      'safety-exception-record-sync'
    ])
    expect(result.nodes).toEqual(result.diagrams?.[0].nodes)
    expect(JSON.stringify(result)).not.toMatch(/\.claude|\.codex/)
  })

  it('拒绝相对路径和文件路径，且不跟随越界符号链接', async () => {
    const root = await makeProject('rovai-logic-boundary-')
    const outside = await makeProject('rovai-logic-outside-')
    await writeProjectFiles(root, {
      'src/index.ts': 'export const inside = true\n',
      'project-file.txt': 'not a directory\n'
    })
    await writeProjectFiles(outside, {
      'package.json': JSON.stringify({ name: 'outside-secret' }),
      'src/secret.ts': 'export const secret = true\n'
    })

    await expect(scanProjectLogic('relative-project')).rejects.toThrow('项目路径必须是绝对路径。')
    await expect(scanProjectLogic(join(root, 'project-file.txt'))).rejects.toThrow('项目路径必须指向真实目录。')

    try {
      await symlink(outside, join(root, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
        return
      }
      throw error
    }

    const result = await scanProjectLogic(root)
    expect(result.nodes.every((node) => !node.path.includes('external-link'))).toBe(true)
    expect(JSON.stringify(result)).not.toContain('outside-secret')
    expect(result.warnings).toContain('1 个符号链接未跟随。')

    const aliasContainer = await makeProject('rovai-logic-alias-')
    const rootAlias = join(aliasContainer, 'project-link')
    await symlink(root, rootAlias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(scanProjectLogic(rootAlias)).rejects.toThrow('项目路径必须指向真实目录。')
  })

  it('对相同文件系统输入产生确定排序和稳定逻辑结果', async () => {
    const root = await makeProject('rovai-logic-stable-')
    await writeProjectFiles(root, {
      'package.json': JSON.stringify({ name: 'stable-fixture', workspaces: ['packages/*'] }),
      'packages/b/package.json': JSON.stringify({ name: '@fixture/b' }),
      'packages/b/src/index.ts': 'export const b = 2\n',
      'packages/a/package.json': JSON.stringify({
        name: '@fixture/a',
        dependencies: { '@fixture/b': 'workspace:*' }
      }),
      'packages/a/src/index.ts': "export { b } from '@fixture/b'\n",
      'tests/a.test.ts': "import '@fixture/a'\n"
    })

    const first = await scanProjectLogic(root)
    const second = await scanProjectLogic(root)
    const stableProjection = (value: typeof first) => ({
      project: value.project,
      nodes: value.nodes,
      edges: value.edges,
      primaryPath: value.primaryPath,
      warnings: value.warnings,
      scan: {
        scannedFileCount: value.scan.scannedFileCount,
        skippedFileCount: value.scan.skippedFileCount,
        truncated: value.scan.truncated,
        languages: value.scan.languages
      }
    })

    expect(stableProjection(second)).toEqual(stableProjection(first))
    expect(new Set(first.nodes.map((node) => node.id)).size).toBe(first.nodes.length)
    expect(new Set(first.edges.map((edge) => edge.id)).size).toBe(first.edges.length)
    const nodeIds = new Set(first.nodes.map((node) => node.id))
    expect(first.edges.every((edge) =>
      edge.from !== edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to)
    )).toBe(true)
    for (let index = 1; index < first.primaryPath.length; index += 1) {
      expect(first.edges.some((edge) =>
        edge.from === first.primaryPath[index - 1] && edge.to === first.primaryPath[index]
      )).toBe(true)
    }
  })

  it('为空项目返回事实节点，并在超过最大深度时报告截断', async () => {
    const emptyRoot = await makeProject('rovai-logic-empty-')
    const empty = await scanProjectLogic(emptyRoot)

    expect(empty.nodes).toHaveLength(1)
    expect(empty.nodes[0]).toMatchObject({ id: 'module:root', path: '.', fileCount: 0 })
    expect(empty.edges).toEqual([])
    expect(empty.primaryPath).toEqual([])
    expect(empty.warnings).toContain('未发现可扫描文件。')

    const deepRoot = await makeProject('rovai-logic-depth-')
    let deepDirectory = deepRoot
    for (let depth = 0; depth < 27; depth += 1) {
      deepDirectory = join(deepDirectory, `d${String(depth).padStart(2, '0')}`)
    }
    await mkdir(deepDirectory, { recursive: true })
    await writeFile(join(deepDirectory, 'unreachable.ts'), 'export const deep = true\n')

    const truncated = await scanProjectLogic(deepRoot)
    expect(truncated.scan.truncated).toBe(true)
    expect(truncated.scan.scannedFileCount).toBe(0)
    expect(truncated.warnings).toContain('目录深度超过 24 层，扫描已截断。')
  })
})
