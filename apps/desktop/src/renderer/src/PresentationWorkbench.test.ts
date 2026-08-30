import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { PresentationWorkbench } from './PresentationWorkbench'

describe('PresentationWorkbench', () => {
  it('renders the independent PPT project library and honest local execution boundary', () => {
    const markup = renderToStaticMarkup(createElement(PresentationWorkbench, {
      initialLibrary: { schemaVersion: 1, projects: [] }
    }))

    expect(markup).toContain('PPT WORKBENCH / PHASE 3')
    expect(markup).toContain('建立 PPT 项目')
    expect(markup).toContain('不会自动发送消息或调用外部模型')
    expect(markup).toContain('最近项目')
  })
})
