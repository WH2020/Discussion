import type {
  ProjectLogicDiagram,
  ProjectLogicEdge,
  ProjectLogicNode,
  ProjectLogicNodeKind,
  ProjectLogicRelation,
  ProjectLogicSourceEvidence
} from '@contracts'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { unzipSync } from 'fflate'

const MAX_DOCX_BYTES = 16 * 1024 * 1024
const MAX_DOCUMENT_XML_BYTES = 32 * 1024 * 1024
const MAX_DIAGRAM_NODES = 24
const DOCUMENT_XML_PATH = 'word/document.xml'

type BlockKind = 'paragraph' | 'heading' | 'table-cell' | 'table-row'

interface DocumentBlock {
  kind: BlockKind
  text: string
  style: string | null
  headingLevel: number | null
  order: number
}

interface DocumentFact extends DocumentBlock {}

interface MutableParagraph {
  parts: string[]
  style: string | null
  outlineLevel: number | null
}

interface MutableCell {
  paragraphs: string[]
}

interface NodeDefinition {
  label: string
  kind: ProjectLogicNodeKind
  summary: string
  entry?: boolean
}

type EdgeEvidence = DocumentFact | readonly DocumentFact[] | null

interface AnalyzeDocxProjectLogicResult {
  title: string
  diagrams: ProjectLogicDiagram[]
  warnings: string[]
}

function diagnosticError(message: string, cause?: unknown): Error {
  return cause === undefined ? new Error(message) : new Error(message, { cause })
}

function normalizeText(value: string): string {
  return value
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[\u00a0\u3000 ]+/g, ' ')
    .trim()
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    const normalized = name.toLocaleLowerCase('en-US')
    if (normalized === 'amp') return '&'
    if (normalized === 'lt') return '<'
    if (normalized === 'gt') return '>'
    if (normalized === 'quot') return '"'
    if (normalized === 'apos') return "'"

    const radix = normalized.startsWith('#x') ? 16 : 10
    const digits = normalized.slice(radix === 16 ? 2 : 1)
    const codePoint = Number.parseInt(digits, radix)
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      throw diagnosticError(`document.xml 包含非法 XML 字符实体：${entity}`)
    }
    return String.fromCodePoint(codePoint)
  })
}

function attributeValue(token: string, localName: string): string | null {
  const pattern = new RegExp(`(?:^|\\s)(?:[A-Za-z_][\\w.-]*:)?${localName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i')
  const match = pattern.exec(token)
  return match ? decodeXmlEntities(match[2]) : null
}

function localTagName(qualifiedName: string): string {
  const separator = qualifiedName.indexOf(':')
  return (separator >= 0 ? qualifiedName.slice(separator + 1) : qualifiedName).toLocaleLowerCase('en-US')
}

function headingLevel(style: string | null, outlineLevel: number | null): number | null {
  if (style) {
    const compact = style.replace(/[\s_-]+/g, '')
    const match = /^(?:heading|head|标题)([1-6])$/i.exec(compact)
    if (match) {
      return Number(match[1])
    }
  }
  if (outlineLevel !== null && outlineLevel >= 0 && outlineLevel <= 5) {
    return outlineLevel + 1
  }
  return null
}

function decodeDocumentXml(bytes: Uint8Array): string {
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      const swapped = new Uint8Array(bytes.length - 2)
      for (let index = 2; index + 1 < bytes.length; index += 2) {
        swapped[index - 2] = bytes[index + 1]
        swapped[index - 1] = bytes[index]
      }
      return new TextDecoder('utf-16le', { fatal: true }).decode(swapped)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw diagnosticError('DOCX 的 document.xml 不是有效的 UTF-8/UTF-16 文本。', error)
  }
}

function parseDocumentBlocks(xml: string): DocumentBlock[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw diagnosticError('document.xml 包含不受支持的 DTD/实体声明。')
  }
  if (!/<(?:[A-Za-z_][\w.-]*:)?document\b/i.test(xml)
    || !/<(?:[A-Za-z_][\w.-]*:)?body\b/i.test(xml)) {
    throw diagnosticError('document.xml 缺少 WordprocessingML document/body 根结构。')
  }

  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '')
  const blocks: DocumentBlock[] = []
  let paragraph: MutableParagraph | null = null
  let cell: MutableCell | null = null
  let row: string[] | null = null
  let textDepth = 0
  let order = 0

  const finishParagraph = (): void => {
    if (!paragraph) return
    const text = normalizeText(paragraph.parts.join(''))
    if (text) {
      if (cell) {
        cell.paragraphs.push(text)
      } else {
        const level = headingLevel(paragraph.style, paragraph.outlineLevel)
        blocks.push({
          kind: level === null ? 'paragraph' : 'heading',
          text,
          style: paragraph.style,
          headingLevel: level,
          order: order++
        })
      }
    }
    paragraph = null
    textDepth = 0
  }

  const finishCell = (): void => {
    if (!cell) return
    const text = normalizeText(cell.paragraphs.join(' / '))
    if (text) {
      row?.push(text)
      blocks.push({
        kind: 'table-cell',
        text,
        style: null,
        headingLevel: null,
        order: order++
      })
    }
    cell = null
  }

  const finishRow = (): void => {
    if (!row) return
    const text = normalizeText(row.join(' / '))
    if (text) {
      blocks.push({
        kind: 'table-row',
        text,
        style: null,
        headingLevel: null,
        order: order++
      })
    }
    row = null
  }

  const tokenPattern = /<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g
  for (const match of withoutComments.matchAll(tokenPattern)) {
    const token = match[0]
    if (!token.startsWith('<')) {
      if (paragraph && textDepth > 0) {
        paragraph.parts.push(decodeXmlEntities(token))
      }
      continue
    }
    if (token.startsWith('<![CDATA[')) {
      if (paragraph && textDepth > 0) {
        paragraph.parts.push(token.slice(9, -3))
      }
      continue
    }
    if (/^<\?/.test(token) || /^<!/.test(token)) {
      continue
    }

    const closing = /^<\s*\/\s*([A-Za-z_][\w:.-]*)/.exec(token)
    if (closing) {
      const name = localTagName(closing[1])
      if (name === 't') {
        textDepth = Math.max(0, textDepth - 1)
      } else if (name === 'p') {
        finishParagraph()
      } else if (name === 'tc') {
        finishParagraph()
        finishCell()
      } else if (name === 'tr') {
        finishParagraph()
        finishCell()
        finishRow()
      }
      continue
    }

    const opening = /^<\s*([A-Za-z_][\w:.-]*)\b/.exec(token)
    if (!opening) continue
    const name = localTagName(opening[1])
    const selfClosing = /\/\s*>$/.test(token)
    if (name === 'tr') {
      finishParagraph()
      finishCell()
      finishRow()
      row = []
    } else if (name === 'tc') {
      finishCell()
      cell = { paragraphs: [] }
    } else if (name === 'p') {
      finishParagraph()
      paragraph = { parts: [], style: null, outlineLevel: null }
    } else if (name === 'pstyle' && paragraph) {
      paragraph.style = attributeValue(token, 'val')
    } else if (name === 'outlinelvl' && paragraph) {
      const value = attributeValue(token, 'val')
      const parsed = value === null ? Number.NaN : Number.parseInt(value, 10)
      paragraph.outlineLevel = Number.isFinite(parsed) ? parsed : null
    } else if (name === 't' && paragraph && !selfClosing) {
      textDepth += 1
    } else if ((name === 'tab' || name === 'br' || name === 'cr') && paragraph) {
      paragraph.parts.push(name === 'tab' ? '\t' : '\n')
    }
  }

  if (paragraph || cell || row || textDepth !== 0) {
    throw diagnosticError('document.xml 的段落或表格标签未正确闭合。')
  }
  return blocks.sort((left, right) => left.order - right.order)
}

function factMatches(fact: DocumentFact, all: RegExp[], any: RegExp[] = []): boolean {
  return all.every((pattern) => pattern.test(fact.text))
    && (any.length === 0 || any.some((pattern) => pattern.test(fact.text)))
}

function findFact(facts: DocumentFact[], all: RegExp[], any: RegExp[] = []): DocumentFact | null {
  return facts.find((fact) => factMatches(fact, all, any)) ?? null
}

function findAnyFact(facts: DocumentFact[], patterns: RegExp[]): DocumentFact | null {
  return findFact(facts, [], patterns)
}

function conciseFact(text: string): string {
  return text.length <= 120 ? text : `${text.slice(0, 117)}...`
}

function evidenceFor(
  relativePath: string,
  fact: DocumentFact,
  rule: string
): ProjectLogicSourceEvidence {
  const origin = fact.kind === 'table-cell'
    ? '表格单元格'
    : fact.kind === 'table-row' ? '表格行'
    : fact.kind === 'heading' ? `Heading ${fact.headingLevel ?? ''}`.trim() : '正文段落'
  return {
    path: relativePath,
    line: null,
    reason: `PRD ${origin}规则（${rule}）：“${conciseFact(fact.text)}”`
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function calculatePrimaryPath(nodes: ProjectLogicNode[], edges: ProjectLogicEdge[]): string[] {
  if (nodes.length === 0) return []
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) {
    if (edge.relation !== 'contains') {
      adjacency.get(edge.from)?.push(edge.to)
    }
  }
  for (const targets of adjacency.values()) {
    targets.sort(compareText)
  }

  let best: string[] = []
  const visit = (current: string, path: string[], visited: Set<string>): void => {
    if (path.length > best.length
      || (path.length === best.length && compareText(path.join('\u0000'), best.join('\u0000')) < 0)) {
      best = [...path]
    }
    for (const target of adjacency.get(current) ?? []) {
      if (visited.has(target)) continue
      visited.add(target)
      path.push(target)
      visit(target, path, visited)
      path.pop()
      visited.delete(target)
    }
  }

  for (const node of nodes) {
    visit(node.id, [node.id], new Set([node.id]))
  }
  return edges.some((edge) => edge.relation !== 'contains') ? best : []
}

class DiagramBuilder {
  private readonly nodes = new Map<string, ProjectLogicNode>()
  private readonly edges: ProjectLogicEdge[] = []

  constructor(
    private readonly id: string,
    private readonly title: string,
    private readonly description: string,
    private readonly relativePath: string
  ) {}

  addNode(key: string, definition: NodeDefinition, fact: DocumentFact | null, rule: string): string | null {
    if (!fact) return null
    const id = `doc:${this.id}:${key}`
    if (this.nodes.has(key)) return id
    if (this.nodes.size >= MAX_DIAGRAM_NODES) return null
    this.nodes.set(key, {
      id,
      label: definition.label,
      kind: definition.kind,
      path: this.relativePath,
      summary: definition.summary,
      language: null,
      fileCount: 1,
      entry: definition.entry ?? false,
      sources: [evidenceFor(this.relativePath, fact, rule)]
    })
    return id
  }

  addEdge(
    fromKey: string,
    toKey: string,
    relation: ProjectLogicRelation,
    label: string,
    fact: EdgeEvidence,
    rule: string
  ): void {
    if (!fact) return
    const facts = (Array.isArray(fact) ? fact : [fact])
      .filter((item, index, items) => items.findIndex((candidate) =>
        candidate.order === item.order
        && candidate.kind === item.kind
        && candidate.text === item.text
      ) === index)
      .sort((left, right) => left.order - right.order)
    if (facts.length === 0) return
    const from = this.nodes.get(fromKey)
    const to = this.nodes.get(toKey)
    if (!from || !to || from.id === to.id) return
    const id = `edge:${this.id}:${fromKey}:${relation}:${toKey}`
    if (this.edges.some((edge) => edge.id === id)) return
    this.edges.push({
      id,
      from: from.id,
      to: to.id,
      relation,
      label,
      evidenceCount: facts.length,
      sources: facts.map((item, index) => evidenceFor(
        this.relativePath,
        item,
        facts.length === 1 ? rule : `${rule}（证据 ${index + 1}/${facts.length}）`
      ))
    })
  }

  build(): ProjectLogicDiagram {
    const nodes = [...this.nodes.values()]
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      nodes,
      edges: [...this.edges],
      primaryPath: calculatePrimaryPath(nodes, this.edges)
    }
  }
}

function combineFacts(...facts: Array<DocumentFact | null>): DocumentFact[] | null {
  return facts.every((fact): fact is DocumentFact => fact !== null)
    ? facts
    : null
}

function systemBoundaryDiagram(facts: DocumentFact[], relativePath: string): ProjectLogicDiagram | null {
  const user = findAnyFact(facts, [/用户|患者/])
  const device = findAnyFact(facts, [/设备|治疗仪|刺激器/])
  const userApp = findAnyFact(facts, [/用户\s*APP|患者\s*APP|用户端/i])
  const doctorApp = findAnyFact(facts, [/医生\s*APP|医护\s*APP|医生端/i])
  const cloud = findAnyFact(facts, [/云端|云服务|服务端/])
  const deviceAuthority = findFact(facts, [
    /设备|治疗仪|刺激器/,
    /本地/,
    /刺激|治疗/,
    /安全/,
    /最终.{0,8}(?:裁决|校验|验证)|(?:裁决|校验|验证).{0,8}最终/
  ])
  const cloudBoundary = findFact(facts, [
    /云端|云服务|服务端/,
    /实时.{0,6}(?:刺激|治疗).{0,6}闭环|(?:刺激|治疗).{0,6}实时.{0,6}闭环/,
    /不(?:进入|参与|介入)|不得|禁止|不在/
  ])
  const roleCount = [user, device, userApp, doctorApp, cloud].filter(Boolean).length
  if ((!deviceAuthority && !cloudBoundary) || roleCount < 3) return null

  const userToApp = findFact(facts, [/用户|患者/, /用户\s*APP|患者\s*APP|用户端/i], [/通过|使用|操作|控制/]) ?? userApp
  const appToDevice = findFact(facts, [/用户\s*APP|患者\s*APP|用户端/i, /设备|治疗仪|刺激器/], [/控制|连接|下发|启动|调整/])
    ?? findFact(facts, [/用户\s*APP|患者\s*APP|用户端/i, /设备|治疗仪|刺激器/])
  const doctorToCloud = findFact(facts, [/医生\s*APP|医护\s*APP|医生端/i, /云端|云服务|服务端/], [/同步|上传|下发|方案|记录|协作/])
  const cloudToUserApp = findFact(facts, [/用户\s*APP|患者\s*APP|用户端/i, /云端|云服务|服务端/], [/同步|方案|授权|记录|协作/])

  const builder = new DiagramBuilder(
    'system-control-boundary',
    '系统角色与控制边界',
    '区分用户、应用、云端与设备本地实时域；设备保留刺激和安全的最终裁决权。',
    relativePath
  )
  builder.addNode('user', { label: '用户', kind: 'actor', summary: '设备治疗或测量的使用者。', entry: true }, user, '用户角色')
  builder.addNode('user-app', { label: '用户 APP', kind: 'application', summary: '承载用户操作、方案选择与记录查看。' }, userApp, '用户 APP 角色')
  builder.addNode('doctor-app', { label: '医生 APP', kind: 'application', summary: '承载医生侧方案与记录协作。' }, doctorApp, '医生 APP 角色')
  builder.addNode('cloud', {
    label: '云端',
    kind: 'service',
    summary: cloudBoundary ? '承担非实时协作，不进入实时刺激闭环。' : '承担文档明确的云端协作职责。'
  }, cloudBoundary ?? cloud, '云端职责与实时边界')
  builder.addNode('device', { label: '设备', kind: 'device', summary: '执行本地刺激，并对参数和安全作最终裁决。' }, deviceAuthority ?? device, '设备本地职责')
  builder.addNode('local-stimulation', { label: '本地刺激执行', kind: 'process', summary: '由设备本地执行的实时刺激过程。' }, deviceAuthority, '本地刺激执行归属')
  builder.addNode('safety-adjudication', { label: '本地安全裁决', kind: 'safety', summary: '设备侧最终安全校验与裁决。' }, deviceAuthority, '安全最终裁决归属')

  builder.addEdge('user', 'user-app', 'controls', '操作', userToApp, '用户通过用户 APP 操作')
  builder.addEdge('user-app', 'device', 'flows_to', '提交方案与操作', appToDevice, '用户 APP 向设备提交方案和操作，设备仍作本地校验')
  builder.addEdge('doctor-app', 'cloud', 'syncs', '同步方案与记录', doctorToCloud, '医生 APP 与云端协作')
  builder.addEdge('cloud', 'user-app', 'syncs', '同步方案与授权', cloudToUserApp, '云端与用户 APP 同步非实时业务数据')
  builder.addEdge('device', 'safety-adjudication', 'controls', '最终裁决', deviceAuthority, '设备负责安全最终裁决')
  builder.addEdge('safety-adjudication', 'local-stimulation', 'controls', '通过后执行', deviceAuthority, '本地安全校验通过后才允许刺激输出')
  return builder.build()
}

function enrollmentDiagram(facts: DocumentFact[], relativePath: string): ProjectLogicDiagram | null {
  const registration = findFact(facts, [/用户|患者/, /注册/])
  const binding = findFact(facts, [/绑定/, /设备|治疗仪|刺激器/])
  const independent = findFact(facts, [/独立使用|独立模式|未入组.{0,8}使用|不入组.{0,8}使用/])
  const voluntary = findFact(facts, [/入组|加入/, /自愿|主动选择|用户选择/])
  const invitation = findFact(facts, [/邀请码|邀请代码/, /校验|验证|核验|核对/])
  const sharing = findFact(facts, [/共享.{0,6}(?:范围|内容|数据)/, /确认|授权|同意/])
  const effective = findFact(facts, [/入组/, /生效|成功|完成/])
  const exit = findFact(facts, [
    /退出|退组/,
    /医生.{0,4}方案|处方方案/,
    /停止|停用|失效|不可用/,
    /历史.{0,4}(?:只读|可查看)|只读.{0,4}历史|共享.{0,8}记录.{0,8}(?:只读|保留)|记录.{0,8}保留只读/
  ])
  if (!voluntary && !invitation && !sharing && !effective && !exit) return null

  const registrationBinding = findFact(facts, [/注册/, /绑定/, /设备|治疗仪|刺激器/]) ?? binding
  const bindingIndependent = findFact(facts, [/绑定/, /独立使用|独立模式/]) ?? independent
  const independentVoluntary = findFact(facts, [/独立使用|独立模式/, /入组|加入/, /自愿|主动选择|用户选择/]) ?? voluntary
  const invitationSharing = findFact(facts, [/邀请码|邀请代码/, /校验|验证|核验|核对/, /共享.{0,6}(?:范围|内容|数据)/]) ?? sharing
  const sharingEffective = findFact(facts, [/共享.{0,6}(?:范围|内容|数据)/, /确认|授权|同意/, /入组/, /生效|成功|完成/]) ?? effective

  const user = findAnyFact(
    [registration, binding, independent, voluntary, invitation, sharing, effective, exit].filter((fact): fact is DocumentFact => fact !== null),
    [/用户|患者/]
  )
  const userApp = findFact(facts, [
    /用户\s*APP|患者\s*APP|用户端/i,
    /注册|绑定|入组|邀请码|共享范围/
  ])
  const builder = new DiagramBuilder(
    'enrollment-lifecycle',
    '注册、绑定、独立使用与自愿入组',
    '呈现从注册绑定到可选入组、共享授权和退出后的权限收敛。',
    relativePath
  )
  builder.addNode('user', { label: '用户', kind: 'actor', summary: '自主决定独立使用、入组或退出。', entry: true }, user, '用户自主参与')
  builder.addNode('user-app', { label: '用户 APP', kind: 'application', summary: '承载注册、绑定和入组确认。' }, userApp, '用户 APP 入组入口')
  builder.addNode('registration', { label: '用户注册', kind: 'process', summary: '建立用户账户或身份。' }, registration, '用户注册')
  builder.addNode('binding', { label: '绑定设备', kind: 'process', summary: '将设备与用户建立绑定关系。' }, binding, '设备绑定')
  builder.addNode('independent', { label: '独立使用', kind: 'decision', summary: '不入组时仍可按文档规则独立使用。' }, independent, '独立使用路径')
  builder.addNode('invitation', { label: '邀请码校验', kind: 'decision', summary: '验证入组邀请是否合法。' }, invitation, '邀请码必须校验')
  builder.addNode('sharing', { label: '确认共享范围', kind: 'decision', summary: '用户确认入组后允许共享的数据范围。' }, sharing, '共享范围确认')
  builder.addNode('effective', { label: '入组生效', kind: 'process', summary: '完成校验和确认后建立医生协作关系。' }, effective, '入组生效条件')
  builder.addNode('exit', { label: '用户退出', kind: 'decision', summary: '用户主动结束入组关系。' }, exit, '退出入组')
  builder.addNode('doctor-plan-disabled', { label: '医生方案停用', kind: 'safety', summary: '退出后停止继续使用医生方案。' }, exit, '退出后医生方案停用')
  builder.addNode('history-readonly', { label: '历史记录只读', kind: 'data', summary: '退出后保留历史查看但禁止改写。' }, exit, '退出后历史只读')

  builder.addEdge('user', 'user-app', 'flows_to', '发起', userApp, '用户在用户 APP 发起流程')
  builder.addEdge(userApp ? 'user-app' : 'user', 'registration', 'flows_to', '注册', registration, '注册入口')
  builder.addEdge('registration', 'binding', 'flows_to', '绑定设备', registrationBinding, '注册后绑定设备')
  builder.addEdge('binding', 'independent', 'branches_to', '可独立使用', bindingIndependent, '绑定后的独立使用路径')
  builder.addEdge('independent', 'invitation', 'branches_to', '选择自愿入组', independentVoluntary, '独立使用者可自愿入组')
  builder.addEdge('invitation', 'sharing', 'flows_to', '校验通过后确认', invitationSharing, '邀请码校验与共享确认')
  builder.addEdge('sharing', 'effective', 'authorizes', '确认后生效', sharingEffective, '共享确认后入组生效')
  builder.addEdge('effective', 'exit', 'branches_to', '主动退出', exit, '用户可退出入组')
  builder.addEdge('exit', 'doctor-plan-disabled', 'controls', '立即停用', exit, '退出后医生方案停用')
  builder.addEdge('exit', 'history-readonly', 'controls', '转为只读', exit, '退出后历史记录只读')
  return builder.build()
}

function planPermissionDiagram(facts: DocumentFact[], relativePath: string): ProjectLogicDiagram | null {
  const defaultPlan = findAnyFact(facts, [/默认方案|预置方案|内置方案/])
  const doctorPlan = findFact(facts, [
    /医生方案|处方方案|医嘱方案/
  ], [/默认方案|预置方案|专业参数|设置|配置|可选/])
  const userAdjustment = findFact(facts, [
    /用户|患者/,
    /每(?:个)?通道|逐通道/,
    /幅值|强度/,
    /全局/,
    /时间包络|时长包络|时长/
  ], [/仅|只能|只可|允许/])
  const professional = findFact(facts, [
    /专业参数|频率|脉宽|波形/,
    /医生|医护/
  ], [/设置|调整|配置|权限|负责/])
  const deviceValidation = findFact(facts, [
    /设备|治疗仪|刺激器/,
    /方案|参数/,
    /最终.{0,6}(?:校验|验证|裁决)|(?:校验|验证|裁决).{0,6}最终/
  ])
  const noHotSwitch = findFact(facts, [
    /治疗中|刺激中|运行中|疗程中|活动疗程/,
    /热切换|切换.{0,4}方案|方案.{0,4}切换/,
    /不|禁止|不得/
  ])
  if ((!defaultPlan && !doctorPlan)
    || (!userAdjustment && !professional && !deviceValidation && !noHotSwitch)) return null

  const user = findFact(facts, [/用户|患者/, /幅值|强度|时间包络|时长/])
  const doctor = professional ?? doctorPlan
  const device = findFact(facts, [/设备|治疗仪|刺激器/, /校验|验证|裁决/])
  const selectionEvidence = defaultPlan ?? doctorPlan
  const builder = new DiagramBuilder(
    'plan-parameter-permissions',
    '方案与参数权限',
    '拆分默认方案、医生方案、用户可调包络、专业参数权限和设备最终校验。',
    relativePath
  )
  builder.addNode('user', { label: '用户', kind: 'actor', summary: '仅在授权包络内进行有限调整。', entry: true }, user, '用户可调权限')
  builder.addNode('doctor', { label: '医生', kind: 'actor', summary: '负责专业治疗参数。', entry: true }, doctor, '医生专业参数权限')
  builder.addNode('device', { label: '设备', kind: 'device', summary: '对将要执行的方案参数作最终校验。' }, device, '设备最终校验')
  builder.addNode('default-plan', { label: '默认方案', kind: 'process', summary: '产品提供的默认或预置方案。' }, defaultPlan, '默认方案来源')
  builder.addNode('doctor-plan', { label: '医生方案', kind: 'process', summary: '由医生设置的专业治疗方案。' }, doctorPlan, '医生方案来源')
  builder.addNode('select-plan', { label: '选择方案', kind: 'decision', summary: '在可用的默认方案和医生方案间选择。' }, selectionEvidence, '方案类型选择')
  builder.addNode('channel-amplitude', { label: '每通道幅值', kind: 'process', summary: '用户可调整的逐通道幅值。' }, userAdjustment, '用户仅可调每通道幅值')
  builder.addNode('global-envelope', { label: '全局时间包络', kind: 'process', summary: '用户可调整的全局时间或时长包络。' }, userAdjustment, '用户仅可调全局时间包络')
  builder.addNode('professional-parameters', { label: '专业参数', kind: 'process', summary: '频率、脉宽或其他专业参数由医生管理。' }, professional, '专业参数归医生')
  builder.addNode('device-validation', { label: '设备最终校验', kind: 'safety', summary: '设备在执行前独立校验方案和参数。' }, deviceValidation, '设备最终校验参数')
  builder.addNode('switch-lock', { label: '治疗中禁止热切换', kind: 'safety', summary: '治疗期间锁定当前方案，禁止热切换。' }, noHotSwitch, '治疗中不可热切换')

  builder.addEdge('default-plan', 'select-plan', 'flows_to', '可选', defaultPlan, '默认方案可供选择')
  builder.addEdge('doctor-plan', 'select-plan', 'flows_to', '可选', doctorPlan, '医生方案可供选择')
  builder.addEdge('user', 'channel-amplitude', 'controls', '有限调整', userAdjustment, '用户仅可调整每通道幅值')
  builder.addEdge('user', 'global-envelope', 'controls', '有限调整', userAdjustment, '用户仅可调整全局时间包络')
  builder.addEdge('doctor', 'professional-parameters', 'controls', '专业设置', professional, '专业参数由医生设置')
  const professionalPlan = findFact(facts, [
    /医生方案|处方方案|医嘱方案/,
    /专业参数|频率|脉宽|波形/,
    /医生|医护/
  ])
  builder.addEdge('professional-parameters', 'doctor-plan', 'controls', '形成医生方案', professionalPlan, '专业参数归入医生方案')
  builder.addEdge('select-plan', 'device-validation', 'flows_to', '提交校验', deviceValidation, '所选方案须经设备校验')
  builder.addEdge('channel-amplitude', 'device-validation', 'flows_to', '提交校验', deviceValidation, '用户幅值调整须经设备校验')
  builder.addEdge('global-envelope', 'device-validation', 'flows_to', '提交校验', deviceValidation, '用户包络调整须经设备校验')
  builder.addEdge('device', 'device-validation', 'controls', '最终裁决', deviceValidation, '设备执行最终校验')
  builder.addEdge('device-validation', 'switch-lock', 'controls', '治疗期间锁定', noHotSwitch, '设备校验后治疗中禁止热切换方案')
  return builder.build()
}

function treatmentMeasurementDiagram(facts: DocumentFact[], relativePath: string): ProjectLogicDiagram | null {
  const selection = findFact(facts, [/选择|选定/, /方案/])
  const envelope = findFact(facts, [/包络/, /调整|调节/])
  const measurementChoice = findFact(facts, [
    /测量/,
    /HRV|HR|心率|心率变异/i
  ], [/是否|选择|可选|需要/])
  const localStart = findFact(facts, [
    /START/i,
    /本地|设备/,
    /(?:启动|安全).{0,4}(?:检查|校验)|(?:检查|校验).{0,4}(?:启动|安全)/
  ])
  const measuredSequence = findFact(facts, [
    /PRE/i,
    /倒计时/,
    /治疗|刺激/,
    /POST/i
  ])
  const regularRecord = findFact(facts, [
    /不测量|未测量|无需测量|未选择测量/,
    /普通.{0,6}(?:使用|治疗)?记录|常规.{0,4}记录/
  ])
  const pairedResult = findFact(facts, [
    /POST/i,
    /成对结果|配对结果|前后对比/
  ])
  const preMeasurement = findFact(facts, [/PRE/i], [/测量|有效|无效|接触|治疗前/]) ?? measuredSequence
  const countdown = findAnyFact(facts, [/倒计时/]) ?? measuredSequence
  const treatment = findFact(facts, [/治疗|刺激/], [/正常|执行|输出|疗程|完成/]) ?? measuredSequence ?? regularRecord
  const postMeasurement = findFact(facts, [/POST/i], [/测量|有效|无效|治疗后|尝试/]) ?? measuredSequence
  if ((!localStart && !preMeasurement && !postMeasurement)
    || (!selection && !envelope && !measurementChoice)) return null

  const preparationSequence = findFact(facts, [
    /选择|选定/,
    /方案/,
    /包络/,
    /调整|调节/,
    /测量/
  ])

  const builder = new DiagramBuilder(
    'treatment-optional-measurement',
    '治疗与可选 HR/HRV 测量',
    '从方案选择、包络内调整和本地启动检查分支到普通记录或 PRE/POST 成对测量。',
    relativePath
  )
  builder.addNode('select-plan', { label: '选择方案', kind: 'decision', summary: '选择本次治疗使用的可用方案。', entry: true }, selection, '治疗前选择方案')
  builder.addNode('adjust-envelope', { label: '包络内调整', kind: 'process', summary: '只在方案授权包络内调整。' }, envelope, '治疗前包络内调整')
  builder.addNode('measurement-choice', { label: '是否测量 HR/HRV', kind: 'decision', summary: '用户选择本次是否执行可选生理测量。' }, measurementChoice, 'HR/HRV 测量可选')
  builder.addNode('local-start', { label: '本地 START', kind: 'process', summary: '在设备本地形成治疗启动事件。' }, localStart, 'START 在本地发生')
  builder.addNode('start-check', { label: '启动检查', kind: 'safety', summary: 'START 后由设备执行启动前检查。' }, localStart, '本地 START 启动检查')
  builder.addNode('pre', { label: 'PRE 测量', kind: 'process', summary: '治疗前生理测量。' }, preMeasurement, '测量路径先执行 PRE')
  builder.addNode('countdown', { label: '倒计时', kind: 'process', summary: 'PRE 后进入治疗倒计时。' }, countdown, 'PRE 后倒计时')
  builder.addNode('treatment', { label: '治疗', kind: 'process', summary: '执行本次本地治疗或刺激。' }, treatment, '执行治疗')
  builder.addNode('post', { label: 'POST 测量', kind: 'process', summary: '治疗后生理测量。' }, postMeasurement, '治疗后执行 POST')
  builder.addNode('paired-result', { label: '成对结果', kind: 'data', summary: '由 PRE 与 POST 形成的成对测量结果。' }, pairedResult, 'PRE/POST 生成成对结果')
  builder.addNode('regular-record', { label: '普通治疗记录', kind: 'data', summary: '不测量时生成的常规治疗记录。' }, regularRecord, '不测量生成普通记录')

  builder.addEdge(
    'select-plan',
    'adjust-envelope',
    'flows_to',
    '调整',
    preparationSequence ?? combineFacts(selection, envelope),
    preparationSequence ? '选择方案后在包络内调整' : '跨段业务步骤：选择方案后在包络内调整'
  )
  builder.addEdge(
    'adjust-envelope',
    'measurement-choice',
    'flows_to',
    '选择测量',
    preparationSequence ?? combineFacts(envelope, measurementChoice),
    preparationSequence ? '调整后选择是否测量' : '跨段业务步骤：包络调整后选择是否测量'
  )
  builder.addEdge('measurement-choice', 'local-start', 'flows_to', '确认后 START', localStart, '测量选择后本地 START')
  builder.addEdge('local-start', 'start-check', 'flows_to', '执行检查', localStart, 'START 触发启动检查')
  builder.addEdge('start-check', 'pre', 'branches_to', '选择测量', preMeasurement, '测量分支进入 PRE')
  builder.addEdge('pre', 'countdown', 'flows_to', '完成后倒计时', countdown, 'PRE 后进入倒计时')
  builder.addEdge('countdown', 'treatment', 'flows_to', '开始治疗', treatment, '倒计时后治疗')
  builder.addEdge('treatment', 'post', 'flows_to', '完成后 POST', postMeasurement, '治疗后执行 POST')
  builder.addEdge('post', 'paired-result', 'records', '形成成对结果', pairedResult, 'PRE/POST 形成成对结果')
  builder.addEdge('start-check', 'treatment', 'branches_to', '不测量', regularRecord, '不测量直接执行治疗')
  builder.addEdge('treatment', 'regular-record', 'records', '生成普通记录', regularRecord, '不测量生成普通治疗记录')
  return builder.build()
}

function safetyAndSyncDiagram(facts: DocumentFact[], relativePath: string): ProjectLogicDiagram | null {
  const stop = findFact(facts, [/STOP/i, /归零|零输出/])
  const fault = findFact(facts, [/故障|异常故障/, /归零|零输出/])
  const contactZero = findFact(facts, [/接触异常|电极接触|阻抗异常/, /归零|零输出/])
  const contactPause = findFact(facts, [/接触异常|电极接触|阻抗异常/, /暂停.{0,6}(?:全部|所有).{0,4}通道|(?:全部|所有).{0,4}通道.{0,6}暂停/])
  const contact = contactPause ?? contactZero
  const explicitRecovery = findFact(facts, [
    /接触异常|电极接触|阻抗异常/,
    /修复|恢复接触|异常解除/,
    /明确.{0,4}恢复|再次.{0,4}(?:确认|操作)|不自动恢复/
  ]) ?? contactPause
  const usb = findFact(facts, [/USB[\s-]*C/i, /归零|零输出/])
  const timeout = findFact(facts, [/计时结束|时间结束|疗程结束/, /归零|零输出/])
  const firstZero = findFact(facts, [
    /STOP|故障|接触异常|USB[\s-]*C|计时结束|时间结束/i,
    /先.{0,24}(?:刺激输出|归零|零输出)|(?:归零|零输出).{0,32}(?:优先|首先|先处理)/
  ])
  const abortNoPost = findFact(facts, [
    /中止|终止|提前结束/,
    /POST/i,
    /不执行|不进行|跳过|无/
  ])
  const invalidPost = findFact(facts, [
    /POST/i,
    /无效|失败|不可用/,
    /保留|仍记录|不删除/,
    /治疗记录|刺激记录/
  ])
  const disconnectCache = findFact(facts, [
    /BLE|蓝牙/i,
    /断连|断开|离线/,
    /本地.{0,4}缓存|缓存.{0,4}本地/
  ])
  const reconnectUpload = findFact(facts, [
    /重连|恢复连接/,
    /补传|续传|重新上传/
  ])
  const authorizationSnapshot = findFact(facts, [
    /记录归属|记录.{0,4}归属/,
    /START/i,
    /授权快照|权限快照/
  ])
  if (!firstZero && !abortNoPost && !invalidPost
    && !disconnectCache && !reconnectUpload && !authorizationSnapshot) return null

  const offlineLifecycle = findFact(facts, [
    /BLE|蓝牙/i,
    /断连|断开|离线/,
    /本地.{0,4}缓存|缓存.{0,4}本地/,
    /重连|恢复连接/,
    /补传|续传|重新上传/
  ])

  const zeroEvidence = firstZero ?? stop ?? fault ?? contact ?? usb ?? timeout
  const builder = new DiagramBuilder(
    'safety-exception-record-sync',
    '安全、异常、记录与离线同步',
    '覆盖先归零安全原则、中止与 POST 记录语义、BLE 离线补传和 START 授权快照归属。',
    relativePath
  )
  builder.addNode('stop', { label: 'STOP', kind: 'safety', summary: '用户或系统 STOP 触发。', entry: true }, stop, 'STOP 先归零')
  builder.addNode('fault', { label: '设备故障', kind: 'safety', summary: '设备故障安全触发。', entry: true }, fault, '故障先归零')
  builder.addNode('contact', { label: '接触异常', kind: 'safety', summary: '电极接触或阻抗异常触发。', entry: true }, contact, contactPause ? '接触异常暂停全部通道' : '接触异常先归零')
  builder.addNode('pause-all', { label: '暂停全部通道', kind: 'safety', summary: '任一接触异常时暂停全部刺激通道。' }, contactPause, '接触异常暂停全部通道')
  builder.addNode('explicit-recovery', { label: '明确操作后恢复', kind: 'decision', summary: '异常修复后仍需用户再次明确操作，不自动恢复输出。' }, explicitRecovery, '修复后仍需明确恢复')
  builder.addNode('usb-c', { label: 'USB-C 事件', kind: 'safety', summary: 'USB-C 插入或连接状态触发。', entry: true }, usb, 'USB-C 事件先归零')
  builder.addNode('timer-end', { label: '计时结束', kind: 'safety', summary: '治疗计时结束触发。', entry: true }, timeout, '计时结束先归零')
  builder.addNode('zero-output', { label: '输出先归零', kind: 'safety', summary: '任何后续处理前先停止刺激输出。' }, zeroEvidence, '安全事件首先归零')
  builder.addNode('terminate', { label: '结束治疗', kind: 'process', summary: '归零后完成治疗结束处理。' }, firstZero, '先归零再结束')
  builder.addNode('abort', { label: '治疗中止', kind: 'decision', summary: '治疗未按正常路径完成。', entry: true }, abortNoPost, '治疗中止')
  builder.addNode('skip-post', { label: '不执行 POST', kind: 'safety', summary: '中止路径跳过 POST 测量。' }, abortNoPost, '中止不执行 POST')
  builder.addNode('invalid-post', { label: 'POST 无效', kind: 'decision', summary: 'POST 测量失败或结果无效。', entry: true }, invalidPost, 'POST 无效')
  builder.addNode('retain-record', { label: '保留治疗记录', kind: 'data', summary: 'POST 无效不删除既有治疗事实。' }, invalidPost, 'POST 无效仍保留治疗记录')
  builder.addNode('ble-disconnect', { label: 'BLE 断连', kind: 'decision', summary: '治疗或传输期间 BLE 连接中断。', entry: true }, disconnectCache, 'BLE 断连')
  builder.addNode('local-cache', { label: '本地缓存', kind: 'data', summary: '断连期间记录保存在本地。' }, disconnectCache, 'BLE 断连本地缓存')
  builder.addNode('reconnect', { label: 'BLE 重连', kind: 'process', summary: 'BLE 连接恢复。' }, reconnectUpload, 'BLE 重连')
  builder.addNode('supplement-upload', { label: '记录补传', kind: 'process', summary: '重连后上传离线期间缓存记录。' }, reconnectUpload, '重连后补传')
  builder.addNode('auth-snapshot', { label: 'START 授权快照', kind: 'data', summary: '在 START 时冻结记录授权上下文。', entry: true }, authorizationSnapshot, 'START 时授权快照')
  builder.addNode('record-ownership', { label: '记录归属', kind: 'data', summary: '按 START 时的授权快照确定归属。' }, authorizationSnapshot, '记录归属按 START 授权快照')

  for (const [key, fact] of [
    ['stop', stop],
    ['fault', fault],
    ['contact', contactZero],
    ['usb-c', usb],
    ['timer-end', timeout]
  ] as const) {
    builder.addEdge(key, 'zero-output', 'controls', '先归零', fact, `${builderLabel(key)}触发先归零`)
  }
  builder.addEdge('zero-output', 'terminate', 'flows_to', '再结束', firstZero, '输出先归零再结束治疗')
  builder.addEdge('contact', 'pause-all', 'controls', '暂停全部通道', contactPause, '接触异常时暂停全部通道')
  builder.addEdge('pause-all', 'explicit-recovery', 'flows_to', '修复后确认', explicitRecovery, '修复接触后仍需明确操作恢复')
  builder.addEdge('abort', 'skip-post', 'controls', '跳过 POST', abortNoPost, '中止不执行 POST')
  builder.addEdge('invalid-post', 'retain-record', 'records', '仍保留', invalidPost, 'POST 无效仍保留治疗记录')
  builder.addEdge('ble-disconnect', 'local-cache', 'records', '离线缓存', disconnectCache, 'BLE 断连时本地缓存')
  builder.addEdge('local-cache', 'reconnect', 'flows_to', '等待重连', offlineLifecycle, '缓存记录等待连接恢复')
  builder.addEdge('reconnect', 'supplement-upload', 'syncs', '补传', reconnectUpload, 'BLE 重连后补传')
  builder.addEdge('auth-snapshot', 'record-ownership', 'authorizes', '确定归属', authorizationSnapshot, 'START 授权快照决定记录归属')
  return builder.build()
}

function builderLabel(key: string): string {
  const labels: Record<string, string> = {
    stop: 'STOP',
    fault: '故障',
    contact: '接触异常',
    'usb-c': 'USB-C',
    'timer-end': '计时结束'
  }
  return labels[key] ?? key
}

function isHiddenToolingHeading(text: string): boolean {
  return /^(?:[./\\]*)\.(?:claude|codex)(?:[\s/\\:]|$)/i.test(text.trim())
}

function structureDiagram(
  blocks: DocumentBlock[],
  relativePath: string,
  title: string,
  warnings: string[]
): ProjectLogicDiagram {
  const headings = blocks.filter((block) =>
    block.kind === 'heading'
    && block.headingLevel === 1
    && !isHiddenToolingHeading(block.text)
  )
  const evidence = blocks.find((block) => block.style && /^(?:title|标题)$/i.test(block.style.trim()))
    ?? headings[0]
    ?? blocks[0]
    ?? {
    kind: 'paragraph' as const,
    text: title,
    style: null,
    headingLevel: null,
    order: 0
  }
  const builder = new DiagramBuilder(
    'document-structure',
    '文档结构',
    headings.length > 0 ? '按 Heading 1 展示 PRD 的一级章节。' : '文档没有可用的 Heading 1，仅展示文档根节点。',
    relativePath
  )
  builder.addNode('document', { label: title, kind: 'documentation', summary: 'DOCX 产品文档。', entry: true }, evidence, '文档结构根节点')
  for (const [index, heading] of headings.slice(0, MAX_DIAGRAM_NODES - 1).entries()) {
    const key = `heading-${String(index + 1).padStart(2, '0')}`
    builder.addNode(key, { label: heading.text, kind: 'documentation', summary: 'Heading 1 一级章节。' }, heading, 'Heading 1 章节')
    builder.addEdge('document', key, 'contains', '包含章节', heading, '文档包含该 Heading 1 章节')
  }
  if (headings.length >= MAX_DIAGRAM_NODES) {
    warnings.push(`Heading 1 章节超过 ${MAX_DIAGRAM_NODES - 1} 个，文档结构图已截断。`)
  }
  if (headings.length === 0) {
    warnings.push('未找到 Heading 1，文档结构图仅展示文档根节点。')
  }
  return builder.build()
}

function documentTitle(blocks: DocumentBlock[], projectName: string, warnings: string[]): string {
  const styledTitle = blocks.find((block) => block.style && /^(?:title|标题)$/i.test(block.style.trim()))
  if (styledTitle) return styledTitle.text
  const firstHeading = blocks.find((block) => block.kind === 'heading')
  if (firstHeading) return firstHeading.text
  warnings.push('未找到 Title 或 Heading 段落，标题使用项目名称。')
  return normalizeText(projectName) || '产品文档逻辑'
}

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === ''
    || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
}

async function readDocumentXml(absolutePath: string, projectRoot?: string): Promise<Uint8Array> {
  if (!isAbsolute(absolutePath)) {
    throw diagnosticError('DOCX 路径必须是绝对路径。')
  }

  let fileStat
  let canonicalFile: string
  try {
    fileStat = await lstat(absolutePath)
    canonicalFile = await realpath(absolutePath)
  } catch (error) {
    throw diagnosticError(`无法读取 DOCX 文件信息：${absolutePath}`, error)
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw diagnosticError('DOCX 路径必须指向普通文件。')
  }
  if (projectRoot) {
    const canonicalRoot = await realpath(projectRoot)
    if (!isWithinRoot(canonicalRoot, canonicalFile)) {
      throw diagnosticError('DOCX 文件必须位于项目目录内。')
    }
  }
  if (fileStat.size > MAX_DOCX_BYTES) {
    throw diagnosticError(`DOCX 压缩文件超过 ${MAX_DOCX_BYTES / 1024 / 1024} MiB 安全上限。`)
  }

  let archive: Uint8Array
  let handle
  try {
    handle = await open(canonicalFile, 'r')
    const openedStat = await handle.stat()
    if (!openedStat.isFile() || openedStat.size > MAX_DOCX_BYTES) {
      throw diagnosticError(openedStat.size > MAX_DOCX_BYTES
        ? `DOCX 压缩文件超过 ${MAX_DOCX_BYTES / 1024 / 1024} MiB 安全上限。`
        : 'DOCX 路径必须指向普通文件。')
    }
    archive = await handle.readFile()
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DOCX ')) throw error
    throw diagnosticError(`无法只读打开 DOCX：${absolutePath}`, error)
  } finally {
    await handle?.close()
  }

  let documentEntrySeen = false
  let documentEntryOversized = false
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(archive, {
      filter: (entry) => {
        if (entry.name.replace(/\\/g, '/') !== DOCUMENT_XML_PATH) return false
        documentEntrySeen = true
        if (entry.originalSize > MAX_DOCUMENT_XML_BYTES) {
          documentEntryOversized = true
          return false
        }
        return true
      }
    })
  } catch (error) {
    throw diagnosticError('DOCX 压缩包损坏、加密或使用了不受支持的压缩格式，无法解压 document.xml。', error)
  }
  if (documentEntryOversized) {
    throw diagnosticError(`DOCX 的 document.xml 超过 ${MAX_DOCUMENT_XML_BYTES / 1024 / 1024} MiB 安全上限。`)
  }
  if (!documentEntrySeen) {
    throw diagnosticError('DOCX 中缺少 word/document.xml，文件不是受支持的 Word 文档。')
  }
  const xml = unzipped[DOCUMENT_XML_PATH]
  if (!xml) {
    throw diagnosticError('DOCX 的 word/document.xml 无法提取。')
  }
  if (xml.byteLength > MAX_DOCUMENT_XML_BYTES) {
    throw diagnosticError(`DOCX 的 document.xml 超过 ${MAX_DOCUMENT_XML_BYTES / 1024 / 1024} MiB 安全上限。`)
  }
  return xml
}

export async function analyzeDocxProjectLogic(input: {
  absolutePath: string
  relativePath: string
  projectName: string
  projectRoot?: string
}): Promise<AnalyzeDocxProjectLogicResult> {
  const warnings: string[] = []
  const xmlBytes = await readDocumentXml(input.absolutePath, input.projectRoot)
  const blocks = parseDocumentBlocks(decodeDocumentXml(xmlBytes))
  const title = documentTitle(blocks, input.projectName, warnings)
  if (blocks.length === 0) {
    warnings.push('document.xml 未包含可分析的段落或表格单元格文本。')
  }

  const facts: DocumentFact[] = blocks
  const diagrams = [
    systemBoundaryDiagram(facts, input.relativePath),
    enrollmentDiagram(facts, input.relativePath),
    planPermissionDiagram(facts, input.relativePath),
    treatmentMeasurementDiagram(facts, input.relativePath),
    safetyAndSyncDiagram(facts, input.relativePath)
  ].filter((diagram): diagram is ProjectLogicDiagram => diagram !== null)

  if (diagrams.length === 0) {
    warnings.push('未识别到由具体业务规则支撑的语义流程，已生成文档结构图。')
    diagrams.push(structureDiagram(blocks, input.relativePath, title, warnings))
  }

  return { title, diagrams, warnings }
}
