import {
  auditPresentationProject,
  extractPresentationMetrics,
  presentationSourceNotes,
  safePresentationLayout,
  splitPresentationBullets
} from './presentation-design'
import type { PresentationProject, PresentationSlide } from './presentation-workbench-model'
import {
  PRESENTATION_STYLES,
  sanitizePresentationFileName
} from './presentation-workbench-model'

const SLIDE_WIDTH = 13.333
const SLIDE_HEIGHT = 7.5
const FONT_HEAD = 'Microsoft YaHei'
const FONT_BODY = 'Microsoft YaHei'

type PptxInstance = InstanceType<(typeof import('pptxgenjs'))['default']>
type PptxSlide = ReturnType<PptxInstance['addSlide']>
type PresentationStyle = (typeof PRESENTATION_STYLES)[number]
type DesignPalette = {
  canvas: string
  ink: string
  accent: string
  muted: string
  surface: string
  faint: string
  reverseInk: string
}

export async function exportPresentationProject(project: PresentationProject): Promise<string> {
  const audit = auditPresentationProject(project)
  if (audit.errors.length > 0) throw new Error(audit.errors.join('；'))

  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  const style = PRESENTATION_STYLES.find((item) => item.id === project.styleId)
    ?? PRESENTATION_STYLES[0]
  const palette = designPalette(style)
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Rovai AI'
  pptx.company = 'Rovai AI'
  pptx.subject = project.objective
  pptx.title = project.title
  pptx.theme = {
    headFontFace: FONT_HEAD,
    bodyFontFace: FONT_BODY
  }

  project.slides.forEach((item, index) => {
    const slide = pptx.addSlide()
    const layout = safePresentationLayout(item)
    addSlideFrame(slide, palette, item.kind === 'cover')
    if (item.kind === 'cover') addCover(slide, project, item, palette)
    else if (item.kind === 'closing') addClosing(slide, project, item, palette)
    else if (layout === 'statement') addStatement(slide, item, palette)
    else if (layout === 'metric') addMetric(slide, item, palette)
    else if (layout === 'process') addProcess(slide, item, palette)
    else if (layout === 'comparison') addComparison(slide, item, palette)
    else if (layout === 'evidence') addEvidence(slide, item, palette)
    else if (layout === 'two-column') addTwoColumn(slide, item, palette)
    else addTitleBody(slide, item, palette)
    if (item.kind !== 'cover') addFooter(slide, project, index, palette, item.kind === 'closing')

    const notes = [item.speakerNotes.trim(), presentationSourceNotes(project, item)]
      .filter(Boolean)
      .join('\n\n')
    if (notes) slide.addNotes(notes)
  })

  const fileName = `${sanitizePresentationFileName(project.title)}.pptx`
  await pptx.writeFile({ fileName })
  return fileName
}

function addSlideFrame(slide: PptxSlide, palette: DesignPalette, cover: boolean): void {
  slide.background = { color: palette.canvas }
  if (cover) return
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH,
    h: 0.09,
    line: { color: palette.accent, transparency: 100 },
    fill: { color: palette.accent }
  })
}

function addCover(
  slide: PptxSlide,
  project: PresentationProject,
  item: PresentationSlide,
  palette: DesignPalette
): void {
  slide.addShape('rect', {
    x: 10.78,
    y: 0,
    w: 2.553,
    h: SLIDE_HEIGHT,
    line: { color: palette.accent, transparency: 100 },
    fill: { color: palette.accent }
  })
  slide.addShape('ellipse', {
    x: 9.35,
    y: 0.6,
    w: 3.65,
    h: 3.65,
    line: { color: palette.reverseInk, transparency: 80, width: 1.5 },
    fill: { color: palette.reverseInk, transparency: 92 }
  })
  slide.addText('ROVAI  /  DECISION DECK', {
    x: 0.82,
    y: 0.7,
    w: 5.4,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 16,
    bold: true,
    charSpacing: 1.6,
    color: palette.accent,
    margin: 0
  })
  slide.addText(item.title, {
    x: 0.82,
    y: 1.35,
    w: 9.25,
    h: 3.4,
    fontFace: FONT_HEAD,
    fontSize: 50,
    bold: true,
    color: palette.ink,
    margin: 0,
    valign: 'middle',
    breakLine: false,
    fit: 'shrink'
  })
  slide.addShape('line', {
    x: 0.82,
    y: 5.08,
    w: 1.4,
    h: 0,
    line: { color: palette.accent, width: 4 }
  })
  if (item.subtitle) {
    slide.addText(item.subtitle, {
      x: 0.82,
      y: 5.33,
      w: 8.8,
      h: 0.62,
      fontFace: FONT_BODY,
      fontSize: 24,
      color: palette.muted,
      margin: 0,
      fit: 'shrink'
    })
  }
  slide.addText(project.audience ? `面向 ${project.audience}` : '管理决策简报', {
    x: 0.82,
    y: 6.55,
    w: 5.5,
    h: 0.28,
    fontFace: FONT_BODY,
    fontSize: 16,
    color: palette.muted,
    margin: 0
  })
  slide.addText('01', {
    x: 11.12,
    y: 5.95,
    w: 1.5,
    h: 0.65,
    fontFace: FONT_HEAD,
    fontSize: 36,
    bold: true,
    color: palette.reverseInk,
    margin: 0,
    align: 'right'
  })
}

function addClosing(
  slide: PptxSlide,
  project: PresentationProject,
  item: PresentationSlide,
  palette: DesignPalette
): void {
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 4.25,
    h: SLIDE_HEIGHT,
    line: { color: palette.accent, transparency: 100 },
    fill: { color: palette.accent }
  })
  slide.addText('NEXT', {
    x: 0.72,
    y: 0.72,
    w: 2.2,
    h: 0.35,
    fontFace: FONT_BODY,
    fontSize: 17,
    bold: true,
    charSpacing: 2,
    color: palette.reverseInk,
    margin: 0
  })
  slide.addText('→', {
    x: 0.68,
    y: 2.05,
    w: 2.3,
    h: 1.2,
    fontFace: FONT_HEAD,
    fontSize: 72,
    color: palette.reverseInk,
    margin: 0
  })
  slide.addText(item.title, {
    x: 4.92,
    y: 1.25,
    w: 7.8,
    h: 1.7,
    fontFace: FONT_HEAD,
    fontSize: 36,
    bold: true,
    color: palette.ink,
    margin: 0,
    fit: 'shrink',
    valign: 'middle'
  })
  if (item.subtitle) {
    slide.addText(item.subtitle, {
      x: 4.95,
      y: 3.08,
      w: 6.8,
      h: 0.6,
      fontFace: FONT_BODY,
      fontSize: 22,
      color: palette.muted,
      margin: 0,
      fit: 'shrink'
    })
  }
  addPlainList(slide, item.bullets.slice(0, 4), {
    x: 4.95,
    y: 4.05,
    w: 6.95,
    itemHeight: 0.52,
    fontSize: 18,
    palette
  })
  slide.addText(project.objective, {
    x: 0.72,
    y: 5.35,
    w: 2.82,
    h: 1.25,
    fontFace: FONT_BODY,
    fontSize: 16,
    color: palette.reverseInk,
    margin: 0,
    fit: 'shrink',
    valign: 'bottom'
  })
}

function addStatement(slide: PptxSlide, item: PresentationSlide, palette: DesignPalette): void {
  slide.addText('CORE STATEMENT', {
    x: 0.82,
    y: 0.72,
    w: 3.4,
    h: 0.28,
    fontFace: FONT_BODY,
    fontSize: 15,
    bold: true,
    charSpacing: 1.5,
    color: palette.accent,
    margin: 0
  })
  slide.addText(item.title, {
    x: 0.82,
    y: 1.35,
    w: 11.65,
    h: 2.75,
    fontFace: FONT_HEAD,
    fontSize: 44,
    bold: true,
    color: palette.ink,
    margin: 0,
    fit: 'shrink',
    valign: 'middle'
  })
  slide.addShape('line', {
    x: 0.82,
    y: 4.38,
    w: 11.65,
    h: 0,
    line: { color: palette.accent, width: 2 }
  })
  const supporting = [item.subtitle, ...item.bullets].filter(Boolean).slice(0, 3)
  addPlainList(slide, supporting, {
    x: 0.85,
    y: 4.75,
    w: 10.8,
    itemHeight: 0.55,
    fontSize: 18,
    palette
  })
}

function addTitleBody(slide: PptxSlide, item: PresentationSlide, palette: DesignPalette): void {
  addContentHeader(slide, item, palette, 'INSIGHT')
  const [lead, ...support] = item.bullets
  if (lead) {
    slide.addText(lead, {
      x: 0.84,
      y: 2.08,
      w: 7.45,
      h: 1.35,
      fontFace: FONT_HEAD,
      fontSize: 27,
      bold: true,
      color: palette.ink,
      margin: 0,
      fit: 'shrink',
      valign: 'middle'
    })
  }
  slide.addShape('rect', {
    x: 9.1,
    y: 2.02,
    w: 3.28,
    h: 3.68,
    line: { color: palette.accent, transparency: 100 },
    fill: { color: palette.surface }
  })
  slide.addText(String(Math.max(1, item.bullets.length)).padStart(2, '0'), {
    x: 9.42,
    y: 2.42,
    w: 2.35,
    h: 0.9,
    fontFace: FONT_HEAD,
    fontSize: 42,
    bold: true,
    color: palette.accent,
    margin: 0
  })
  slide.addText('个支撑要点', {
    x: 9.45,
    y: 3.28,
    w: 2.2,
    h: 0.35,
    fontFace: FONT_BODY,
    fontSize: 16,
    color: palette.muted,
    margin: 0
  })
  addPlainList(slide, support.slice(0, 4), {
    x: 0.88,
    y: 3.85,
    w: 7.35,
    itemHeight: 0.55,
    fontSize: 17,
    palette
  })
}

function addTwoColumn(slide: PptxSlide, item: PresentationSlide, palette: DesignPalette): void {
  addContentHeader(slide, item, palette, 'TWO LENSES')
  const [left, right] = splitPresentationBullets(item)
  slide.addShape('line', {
    x: 6.66,
    y: 2.02,
    w: 0,
    h: 3.82,
    line: { color: palette.muted, transparency: 62, width: 1 }
  })
  addColumn(slide, left, 0.83, 2.05, 5.35, '01', palette)
  addColumn(slide, right, 7.15, 2.05, 5.1, '02', palette)
}

function addMetric(slide: PptxSlide, item: PresentationSlide, palette: DesignPalette): void {
  addContentHeader(slide, item, palette, 'KEY NUMBERS')
  const metrics = extractPresentationMetrics(item)
  const width = 11.65 / Math.max(1, metrics.length)
  metrics.forEach((metric, index) => {
    const x = 0.84 + index * width
    if (index > 0) {
      slide.addShape('line', {
        x,
        y: 2.25,
        w: 0,
        h: 2.42,
        line: { color: palette.muted, transparency: 60, width: 1 }
      })
    }
    slide.addText(metric.value, {
      x: x + 0.25,
      y: 2.42,
      w: width - 0.5,
      h: 1.2,
      fontFace: FONT_HEAD,
      fontSize: metrics.length > 2 ? 38 : 48,
      bold: true,
      color: palette.accent,
      margin: 0,
      fit: 'shrink',
      align: 'center'
    })
    slide.addText(metric.label, {
      x: x + 0.32,
      y: 3.78,
      w: width - 0.64,
      h: 0.72,
      fontFace: FONT_BODY,
      fontSize: 16,
      color: palette.ink,
      margin: 0,
      fit: 'shrink',
      align: 'center',
      valign: 'middle'
    })
  })
  const nonMetric = item.bullets.filter((bullet) => !/\d/.test(bullet)).slice(0, 2)
  if (nonMetric.length > 0) addPlainList(slide, nonMetric, {
    x: 1.15,
    y: 5.18,
    w: 10.75,
    itemHeight: 0.48,
    fontSize: 16,
    palette
  })
}

function addProcess(slide: PptxSlide, item: PresentationSlide, palette: DesignPalette): void {
  addContentHeader(slide, item, palette, item.kind === 'agenda' ? 'NARRATIVE PATH' : 'SEQUENCE')
  const steps = item.bullets.slice(0, 6)
  const gap = 0.18
  const width = (11.65 - gap * Math.max(0, steps.length - 1)) / Math.max(1, steps.length)
  if (steps.length > 1) {
    slide.addShape('line', {
      x: 1.18,
      y: 3.02,
      w: 10.85,
      h: 0,
      line: { color: palette.accent, transparency: 35, width: 2 }
    })
  }
  steps.forEach((step, index) => {
    const x = 0.84 + index * (width + gap)
    slide.addShape('ellipse', {
      x: x + Math.max(0, (width - 0.56) / 2),
      y: 2.73,
      w: 0.56,
      h: 0.56,
      line: { color: palette.accent, width: 1.5 },
      fill: { color: index === 0 ? palette.accent : palette.canvas }
    })
    slide.addText(String(index + 1), {
      x: x + Math.max(0, (width - 0.56) / 2),
      y: 2.83,
      w: 0.56,
      h: 0.22,
      fontFace: FONT_BODY,
      fontSize: 12,
      bold: true,
      color: index === 0 ? palette.reverseInk : palette.accent,
      align: 'center',
      margin: 0
    })
    slide.addText(step, {
      x,
      y: 3.62,
      w: width,
      h: 1.42,
      fontFace: FONT_BODY,
      fontSize: steps.length > 4 ? 16 : 18,
      bold: true,
      color: palette.ink,
      margin: 0,
      fit: 'shrink',
      align: 'center',
      valign: 'top'
    })
  })
}

function addComparison(slide: PptxSlide, item: PresentationSlide, palette: DesignPalette): void {
  addContentHeader(slide, item, palette, 'COMPARISON')
  const [left, right] = splitPresentationBullets(item)
  const [leftLabel, rightLabel] = comparisonLabels(item)
  addComparisonSide(slide, left, leftLabel, 0.84, palette.surface, palette)
  addComparisonSide(slide, right, rightLabel, 6.79, palette.faint, palette)
}

function addEvidence(slide: PptxSlide, item: PresentationSlide, palette: DesignPalette): void {
  addContentHeader(slide, item, palette, 'EVIDENCE')
  slide.addText(item.bullets[0] ?? item.subtitle, {
    x: 0.84,
    y: 2.08,
    w: 6.35,
    h: 1.52,
    fontFace: FONT_HEAD,
    fontSize: 27,
    bold: true,
    color: palette.ink,
    margin: 0,
    fit: 'shrink',
    valign: 'middle'
  })
  addPlainList(slide, item.bullets.slice(1, 4), {
    x: 0.88,
    y: 3.95,
    w: 6.1,
    itemHeight: 0.54,
    fontSize: 17,
    palette
  })
  const source = item.sources[0]
  slide.addShape('rect', {
    x: 7.68,
    y: 1.95,
    w: 4.7,
    h: 3.92,
    line: { color: palette.accent, transparency: 100 },
    fill: { color: palette.surface }
  })
  slide.addText('“', {
    x: 8.02,
    y: 2.18,
    w: 0.7,
    h: 0.7,
    fontFace: FONT_HEAD,
    fontSize: 42,
    bold: true,
    color: palette.accent,
    margin: 0
  })
  slide.addText(source?.note || '本页证据摘录待补。', {
    x: 8.08,
    y: 2.92,
    w: 3.82,
    h: 1.78,
    fontFace: FONT_BODY,
    fontSize: 18,
    color: palette.ink,
    margin: 0,
    fit: 'shrink',
    valign: 'middle'
  })
  slide.addShape('line', {
    x: 8.08,
    y: 5.02,
    w: 1.12,
    h: 0,
    line: { color: palette.accent, width: 2 }
  })
  slide.addText(source?.title || '待补来源', {
    x: 8.08,
    y: 5.18,
    w: 3.55,
    h: 0.32,
    fontFace: FONT_BODY,
    fontSize: 14,
    bold: true,
    color: palette.muted,
    margin: 0,
    fit: 'shrink'
  })
}

function addContentHeader(
  slide: PptxSlide,
  item: PresentationSlide,
  palette: DesignPalette,
  kicker: string
): void {
  slide.addText(kicker, {
    x: 0.84,
    y: 0.46,
    w: 3.8,
    h: 0.25,
    fontFace: FONT_BODY,
    fontSize: 13,
    bold: true,
    charSpacing: 1.35,
    color: palette.accent,
    margin: 0
  })
  slide.addText(item.title, {
    x: 0.84,
    y: 0.83,
    w: 11.62,
    h: 0.68,
    fontFace: FONT_HEAD,
    fontSize: 35,
    bold: true,
    color: palette.ink,
    margin: 0,
    fit: 'shrink',
    breakLine: false
  })
  if (item.subtitle) {
    slide.addText(item.subtitle, {
      x: 0.86,
      y: 1.55,
      w: 10.9,
      h: 0.36,
      fontFace: FONT_BODY,
      fontSize: 17,
      color: palette.muted,
      margin: 0,
      fit: 'shrink'
    })
  }
}

function addColumn(
  slide: PptxSlide,
  bullets: string[],
  x: number,
  y: number,
  width: number,
  marker: string,
  palette: DesignPalette
): void {
  slide.addText(marker, {
    x,
    y,
    w: 1.2,
    h: 0.65,
    fontFace: FONT_HEAD,
    fontSize: 30,
    bold: true,
    color: palette.accent,
    margin: 0
  })
  slide.addShape('line', {
    x,
    y: y + 0.82,
    w: width,
    h: 0,
    line: { color: palette.accent, transparency: 45, width: 1.2 }
  })
  addPlainList(slide, bullets, {
    x: x + 0.03,
    y: y + 1.14,
    w: width - 0.08,
    itemHeight: 0.67,
    fontSize: 18,
    palette
  })
}

function addComparisonSide(
  slide: PptxSlide,
  bullets: string[],
  label: string,
  x: number,
  fill: string,
  palette: DesignPalette
): void {
  slide.addShape('rect', {
    x,
    y: 2.02,
    w: 5.7,
    h: 3.9,
    line: { color: palette.accent, transparency: 100 },
    fill: { color: fill }
  })
  slide.addText(label, {
    x: x + 0.36,
    y: 2.38,
    w: 4.85,
    h: 0.5,
    fontFace: FONT_HEAD,
    fontSize: 23,
    bold: true,
    color: palette.accent,
    margin: 0,
    fit: 'shrink'
  })
  addPlainList(slide, bullets, {
    x: x + 0.38,
    y: 3.18,
    w: 4.82,
    itemHeight: 0.64,
    fontSize: 17,
    palette
  })
}

function addPlainList(
  slide: PptxSlide,
  items: string[],
  options: {
    x: number
    y: number
    w: number
    itemHeight: number
    fontSize: number
    palette: DesignPalette
  }
): void {
  items.forEach((item, index) => {
    const y = options.y + index * options.itemHeight
    slide.addShape('ellipse', {
      x: options.x,
      y: y + 0.13,
      w: 0.12,
      h: 0.12,
      line: { color: options.palette.accent, transparency: 100 },
      fill: { color: options.palette.accent }
    })
    slide.addText(item, {
      x: options.x + 0.27,
      y,
      w: options.w - 0.27,
      h: options.itemHeight - 0.06,
      fontFace: FONT_BODY,
      fontSize: options.fontSize,
      color: options.palette.ink,
      margin: 0,
      fit: 'shrink',
      valign: 'middle'
    })
  })
}

function addFooter(
  slide: PptxSlide,
  project: PresentationProject,
  index: number,
  palette: DesignPalette,
  closing = false
): void {
  slide.addText(project.title, {
    x: 0.84,
    y: 7.05,
    w: 7.6,
    h: 0.2,
    fontFace: FONT_BODY,
    fontSize: 9,
    color: closing ? palette.reverseInk : palette.muted,
    margin: 0,
    fit: 'shrink'
  })
  slide.addText(String(index + 1).padStart(2, '0'), {
    x: 11.78,
    y: 6.98,
    w: 0.66,
    h: 0.28,
    fontFace: FONT_BODY,
    fontSize: 11,
    bold: true,
    color: palette.accent,
    align: 'right',
    margin: 0
  })
}

function comparisonLabels(item: PresentationSlide): [string, string] {
  const [left, right] = splitPresentationBullets(item)
  const fromBullet = (value: string | undefined): string => value
    ?.split(/强调|需要|必须|更关注|更重视|体现|表现为/)[0]
    ?.trim()
    .slice(0, 16) ?? ''
  const bulletLabels: [string, string] = [fromBullet(left[0]), fromBullet(right[0])]
  if (bulletLabels[0] && bulletLabels[1]) return bulletLabels
  const parts = item.title.split(/\s+(?:vs\.?|VS\.?)\s+|与|对比|相比|：|:/).map((value) => value.trim()).filter(Boolean)
  if (parts.length >= 2 && parts[0].length <= 16 && parts[1].length <= 16) {
    return [parts[0], parts[1]]
  }
  return ['观察一', '观察二']
}

function designPalette(style: PresentationStyle): DesignPalette {
  const canvas = withoutHash(style.canvas)
  const ink = withoutHash(style.ink)
  const accent = withoutHash(style.accent)
  const muted = withoutHash(style.muted)
  const dark = luminance(canvas) < 0.45
  return {
    canvas,
    ink,
    accent,
    muted,
    surface: mixHex(canvas, accent, dark ? 0.2 : 0.11),
    faint: mixHex(canvas, accent, dark ? 0.1 : 0.055),
    reverseInk: dark ? '11171B' : 'FFFFFF'
  }
}

function mixHex(base: string, overlay: string, weight: number): string {
  const a = hexRgb(base)
  const b = hexRgb(overlay)
  return [0, 1, 2]
    .map((index) => Math.round(a[index] * (1 - weight) + b[index] * weight).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function luminance(value: string): number {
  const [red, green, blue] = hexRgb(value).map((channel) => channel / 255)
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function hexRgb(value: string): [number, number, number] {
  const normalized = withoutHash(value).padEnd(6, '0').slice(0, 6)
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ]
}

function withoutHash(value: string): string {
  return value.replace(/^#/, '').toUpperCase()
}
