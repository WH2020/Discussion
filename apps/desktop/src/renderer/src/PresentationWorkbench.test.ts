import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { PresentationWorkbench } from './PresentationWorkbench'

describe('PresentationWorkbench', () => {
  it('renders the document-backed Codex outline workflow', () => {
    const markup = renderToStaticMarkup(createElement(PresentationWorkbench, {
      initialLibrary: { schemaVersion: 1, projects: [] }
    }))

    expect(markup).toContain('PPT WORKBENCH / PHASE 3')
    expect(markup).toContain('选择资料')
    expect(markup).toContain('分析资料并建立大纲')
    expect(markup).toContain('当前已登录的 Codex CLI')
    expect(markup).toContain('最近项目')
  })
})
