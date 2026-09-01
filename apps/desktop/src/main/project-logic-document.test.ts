import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeDocxProjectLogic } from './project-logic-document'

const temporaryDirectories: string[] = []

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function paragraph(text: string, style?: string): string {
  const properties = style
    ? `<w:pPr><w:pStyle w:val="${escapeXml(style)}"/></w:pPr>`
    : ''
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function rawParagraph(xmlText: string, style?: string): string {
  const properties = style
    ? `<w:pPr><w:pStyle w:val="${escapeXml(style)}"/></w:pPr>`
    : ''
  return `<w:p>${properties}<w:r><w:t>${xmlText}</w:t></w:r></w:p>`
}

function table(cells: string[]): string {
  return `<w:tbl><w:tr>${cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join('')}</w:tr></w:tbl>`
}

function documentXml(body: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    ...body,
    '<w:sectPr/>',
    '</w:body>',
    '</w:document>'
  ].join('')
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-docx-logic-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeDocx(xml: string, fileName = 'requirements.docx'): Promise<string> {
  const directory = await createTemporaryDirectory()
  const absolutePath = join(directory, fileName)
  const archive = zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
    ),
    'word/document.xml': strToU8(xml)
  }, { level: 6 })
  await writeFile(absolutePath, archive)
  return absolutePath
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('analyzeDocxProjectLogic', () => {
  it('按具体 PRD 规则生成五张可切换业务图，并保留表格和正文证据', async () => {
    const xml = documentXml([
      rawParagraph('通用治疗产品 PRD &amp; 验证', 'Title'),
      paragraph('系统角色与控制边界', 'Heading1'),
      paragraph('用户通过用户 APP 控制设备，设备负责本地刺激和安全的最终校验与最终裁决。'),
      paragraph('医生 APP 与云端同步方案和记录；云端不进入实时刺激闭环。'),
      paragraph('注册、绑定与自愿入组', 'Heading1'),
      paragraph('用户在用户 APP 注册后绑定设备，可独立使用；若自愿入组，必须校验邀请码并确认共享范围，确认后入组生效。'),
      paragraph('用户退出后，医生方案停用，历史记录只读。'),
      paragraph('方案与参数权限', 'Heading1'),
      paragraph('系统提供默认方案与医生方案。用户仅可调节每通道幅值和全局时间包络，专业参数由医生设置。设备最终校验方案参数，治疗中不可热切换方案。'),
      paragraph('治疗与可选测量', 'Heading1'),
      paragraph('用户选择方案，在包络内调整，然后选择是否测量 HR/HRV，并在设备本地 START 后执行启动检查。'),
      paragraph('不测量时，治疗结束生成普通记录；选择测量时按 PRE→倒计时→治疗→POST 顺序执行并生成成对结果。'),
      paragraph('安全、记录与同步', 'Heading1'),
      table([
        'STOP、故障、接触异常、USB-C 插入或计时结束时必须先将输出归零。',
        '治疗中止不执行 POST；POST 无效时仍保留治疗记录。',
        'BLE 断连时本地缓存，重连后补传；记录归属按 START 时的授权快照确定。'
      ])
    ])
    const absolutePath = await writeDocx(xml)
    const input = {
      absolutePath,
      relativePath: 'docs/product-requirements.docx',
      projectName: '治疗产品'
    }

    const result = await analyzeDocxProjectLogic(input)

    expect(result.title).toBe('通用治疗产品 PRD & 验证')
    expect(result.diagrams.map((diagram) => diagram.id)).toEqual([
      'system-control-boundary',
      'enrollment-lifecycle',
      'plan-parameter-permissions',
      'treatment-optional-measurement',
      'safety-exception-record-sync'
    ])
    expect(result.diagrams.map((diagram) => diagram.title)).toEqual([
      '系统角色与控制边界',
      '注册、绑定、独立使用与自愿入组',
      '方案与参数权限',
      '治疗与可选 HR/HRV 测量',
      '安全、异常、记录与离线同步'
    ])
    expect(result.diagrams.every((diagram) => diagram.nodes.length <= 24)).toBe(true)
    expect(result.diagrams.every((diagram) => diagram.nodes.length > 0)).toBe(true)

    for (const diagram of result.diagrams) {
      const nodeIds = new Set(diagram.nodes.map((node) => node.id))
      expect(new Set(nodeIds).size).toBe(diagram.nodes.length)
      expect(diagram.nodes.every((node) =>
        node.sources.length > 0
        && node.sources.every((source) =>
          source.path === input.relativePath
          && source.line === null
          && source.reason.startsWith('PRD ')
        )
      )).toBe(true)
      expect(diagram.edges.every((edge) =>
        nodeIds.has(edge.from)
        && nodeIds.has(edge.to)
        && edge.sources.length > 0
        && edge.evidenceCount === edge.sources.length
        && edge.sources.every((source) =>
          source.path === input.relativePath
          && source.line === null
          && source.reason.startsWith('PRD ')
        )
      )).toBe(true)
      for (let index = 1; index < diagram.primaryPath.length; index += 1) {
        expect(diagram.edges.some((edge) =>
          edge.from === diagram.primaryPath[index - 1]
          && edge.to === diagram.primaryPath[index]
        )).toBe(true)
      }
    }

    const boundary = result.diagrams[0]
    expect(boundary.nodes.map((node) => node.label)).toEqual(expect.arrayContaining([
      '用户', '用户 APP', '医生 APP', '云端', '设备', '本地刺激执行', '本地安全裁决'
    ]))
    expect(boundary.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'doc:system-control-boundary:cloud',
        to: 'doc:system-control-boundary:device',
        relation: 'controls'
      })
    ]))

    const enrollment = result.diagrams[1]
    expect(enrollment.nodes.map((node) => node.label)).toEqual(expect.arrayContaining([
      '邀请码校验', '确认共享范围', '入组生效', '医生方案停用', '历史记录只读'
    ]))

    const permissions = result.diagrams[2]
    expect(permissions.nodes.map((node) => node.label)).toEqual(expect.arrayContaining([
      '默认方案', '医生方案', '每通道幅值', '全局时间包络', '专业参数', '设备最终校验', '治疗中禁止热切换'
    ]))

    const treatment = result.diagrams[3]
    expect(treatment.nodes.map((node) => node.label)).toEqual(expect.arrayContaining([
      '本地 START', '启动检查', 'PRE 测量', '倒计时', '治疗', 'POST 测量', '成对结果', '普通治疗记录'
    ]))

    const safety = result.diagrams[4]
    expect(safety.nodes.map((node) => node.label)).toEqual(expect.arrayContaining([
      'STOP', '接触异常', 'USB-C 事件', '输出先归零', '不执行 POST', '保留治疗记录',
      '本地缓存', '记录补传', 'START 授权快照', '记录归属'
    ]))
    expect(safety.nodes.flatMap((node) => node.sources).some((source) =>
      source.reason.includes('表格单元格')
    )).toBe(true)
  })

  it('对同一 DOCX 产生稳定的图顺序、节点 ID、边 ID 和主路径', async () => {
    const absolutePath = await writeDocx(documentXml([
      paragraph('稳定性 PRD', 'Title'),
      paragraph('治疗流程', 'Heading1'),
      paragraph('用户选择方案并在包络内调整，然后选择是否测量 HR/HRV，在设备本地 START 后执行启动检查。'),
      paragraph('选择测量时执行 PRE、倒计时、治疗、POST，并生成成对结果。')
    ]))
    const input = {
      absolutePath,
      relativePath: 'prd/stable.docx',
      projectName: '稳定性项目'
    }

    const first = await analyzeDocxProjectLogic(input)
    const second = await analyzeDocxProjectLogic(input)

    expect(second).toEqual(first)
    expect(first.diagrams).toHaveLength(1)
    expect(first.diagrams[0].id).toBe('treatment-optional-measurement')
    expect(new Set(first.diagrams[0].nodes.map((node) => node.id)).size).toBe(first.diagrams[0].nodes.length)
    expect(new Set(first.diagrams[0].edges.map((edge) => edge.id)).size).toBe(first.diagrams[0].edges.length)
  })

  it('没有具体业务流程时按 Heading 1 生成结构图，解码实体并排除隐藏工具目录标题', async () => {
    const absolutePath = await writeDocx(documentXml([
      rawParagraph('研发 &amp; 验证手册', 'Title'),
      rawParagraph('范围 &lt;第一阶段&gt;', 'Heading1'),
      paragraph('这里只描述背景和范围。'),
      paragraph('.claude', 'Heading1'),
      paragraph('.codex/notes', 'Heading1'),
      rawParagraph('交付&#x4E0E;验收', 'Heading1')
    ]), 'structure.docx')

    const result = await analyzeDocxProjectLogic({
      absolutePath,
      relativePath: 'docs/structure.docx',
      projectName: '结构项目'
    })

    expect(result.title).toBe('研发 & 验证手册')
    expect(result.diagrams).toHaveLength(1)
    expect(result.diagrams[0].id).toBe('document-structure')
    expect(result.diagrams[0].nodes.map((node) => node.label)).toEqual([
      '研发 & 验证手册',
      '范围 <第一阶段>',
      '交付与验收'
    ])
    expect(result.diagrams[0].edges).toHaveLength(2)
    expect(result.diagrams[0].primaryPath).toEqual([])
    expect(result.warnings).toContain('未识别到由具体业务规则支撑的语义流程，已生成文档结构图。')
  })

  it('对损坏 DOCX 和超过压缩包或 XML 上限的输入返回可诊断错误', async () => {
    const directory = await createTemporaryDirectory()
    const damagedPath = join(directory, 'damaged.docx')
    const oversizedPath = join(directory, 'oversized.docx')
    const oversizedXmlPath = join(directory, 'oversized-xml.docx')
    await writeFile(damagedPath, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]))
    await writeFile(oversizedPath, new Uint8Array(16 * 1024 * 1024 + 1))

    const oversizedXmlArchive = zipSync({
      'word/document.xml': strToU8(documentXml([paragraph('small payload')]))
    })
    const centralDirectoryOffset = oversizedXmlArchive.findIndex((value, index, archive) =>
      value === 0x50
      && archive[index + 1] === 0x4b
      && archive[index + 2] === 0x01
      && archive[index + 3] === 0x02
    )
    expect(centralDirectoryOffset).toBeGreaterThanOrEqual(0)
    new DataView(
      oversizedXmlArchive.buffer,
      oversizedXmlArchive.byteOffset,
      oversizedXmlArchive.byteLength
    ).setUint32(centralDirectoryOffset + 24, 32 * 1024 * 1024 + 1, true)
    await writeFile(oversizedXmlPath, oversizedXmlArchive)

    await expect(analyzeDocxProjectLogic({
      absolutePath: damagedPath,
      relativePath: 'docs/damaged.docx',
      projectName: '损坏文档'
    })).rejects.toThrow(/DOCX 压缩包损坏|无法解压 document\.xml/)

    await expect(analyzeDocxProjectLogic({
      absolutePath: oversizedPath,
      relativePath: 'docs/oversized.docx',
      projectName: '超限文档'
    })).rejects.toThrow('DOCX 压缩文件超过 16 MiB 安全上限。')

    await expect(analyzeDocxProjectLogic({
      absolutePath: oversizedXmlPath,
      relativePath: 'docs/oversized-xml.docx',
      projectName: 'XML 超限文档'
    })).rejects.toThrow('DOCX 的 document.xml 超过 32 MiB 安全上限。')
  })
})
