import type { PresentationProject, PresentationSlide } from './presentation-workbench-model'
import {
  PRESENTATION_STYLES,
  sanitizePresentationFileName
} from './presentation-workbench-model'

const SLIDE_WIDTH = 13.333
const SLIDE_HEIGHT = 7.5

export async function exportPresentationProject(project: PresentationProject): Promise<string> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  const style = PRESENTATION_STYLES.find((item) => item.id === project.styleId)
    ?? PRESENTATION_STYLES[0]
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Rovai AI'
  pptx.company = 'Rovai AI'
  pptx.subject = project.objective
  pptx.title = project.title
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos'
  }

  project.slides.forEach((item, index) => {
    const slide = pptx.addSlide()
    slide.background = { color: withoutHash(style.canvas) }
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.12,
      h: SLIDE_HEIGHT,
      line: { color: withoutHash(style.accent), transparency: 100 },
      fill: { color: withoutHash(style.accent) }
    })
    addSlideContent(slide, item, index, project.slides.length, style)
    if (item.speakerNotes.trim()) slide.addNotes(item.speakerNotes.trim())
  })

  const fileName = `${sanitizePresentationFileName(project.title)}.pptx`
  await pptx.writeFile({ fileName })
  return fileName
}

function addSlideContent(
  slide: ReturnType<InstanceType<(typeof import('pptxgenjs'))['default']>['addSlide']>,
  item: PresentationSlide,
  index: number,
  total: number,
  style: (typeof PRESENTATION_STYLES)[number]
): void {
  const ink = withoutHash(style.ink)
  const accent = withoutHash(style.accent)
  const muted = withoutHash(style.muted)
  if (item.kind === 'cover' || item.kind === 'closing' || item.layout === 'statement') {
    slide.addText(item.title, {
      x: 1.05,
      y: 2.15,
      w: 10.9,
      h: 1.25,
      fontFace: 'Aptos Display',
      fontSize: item.title.length > 28 ? 27 : 34,
      bold: true,
      color: ink,
      margin: 0,
      breakLine: false
    })
    slide.addShape('line', {
      x: 1.05,
      y: 3.65,
      w: 1.2,
      h: 0,
      line: { color: accent, width: 3 }
    })
    if (item.subtitle) {
      slide.addText(item.subtitle, {
        x: 1.05,
        y: 3.9,
        w: 9.8,
        h: 0.85,
        fontFace: 'Aptos',
        fontSize: 16,
        color: muted,
        margin: 0
      })
    }
  } else {
    slide.addText(item.title, {
      x: 0.85,
      y: 0.65,
      w: 11.4,
      h: 0.65,
      fontFace: 'Aptos Display',
      fontSize: item.title.length > 32 ? 21 : 26,
      bold: true,
      color: ink,
      margin: 0
    })
    if (item.subtitle) {
      slide.addText(item.subtitle, {
        x: 0.87,
        y: 1.38,
        w: 10.8,
        h: 0.45,
        fontFace: 'Aptos',
        fontSize: 11.5,
        color: muted,
        margin: 0
      })
    }
    const columns = item.layout === 'two-column' ? 2 : 1
    const perColumn = Math.max(1, Math.ceil(item.bullets.length / columns))
    item.bullets.forEach((bullet, bulletIndex) => {
      const column = Math.floor(bulletIndex / perColumn)
      const row = bulletIndex % perColumn
      const columnWidth = columns === 2 ? 5.35 : 10.9
      slide.addText(bullet, {
        x: 0.92 + column * 5.85,
        y: 2.05 + row * 0.82,
        w: columnWidth,
        h: 0.65,
        fontFace: 'Aptos',
        fontSize: 17,
        color: ink,
        margin: 0,
        bullet: { indent: 16 }
      })
    })
  }
  slide.addText(`${index + 1} / ${total}`, {
    x: 11.65,
    y: 7.02,
    w: 0.9,
    h: 0.25,
    fontFace: 'Aptos',
    fontSize: 8.5,
    color: muted,
    align: 'right',
    margin: 0
  })
}

function withoutHash(value: string): string {
  return value.replace(/^#/, '')
}
