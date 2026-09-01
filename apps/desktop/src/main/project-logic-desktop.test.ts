import { describe, expect, it } from 'vitest'
import {
  canonicalProjectLogicRoot,
  parseProjectLogicExportRequest,
  projectLogicPathIsWithinRoot,
  projectLogicPathsMatch,
  resolveProjectLogicSourcePath
} from './project-logic-desktop'

describe('project logic desktop boundary', () => {
  it('accepts only bounded, script-free SVG exports', () => {
    expect(parseProjectLogicExportRequest({ suggestedName: 'Demo: map', svg: '<svg></svg>' })).toEqual({
      suggestedName: 'Demo- map.svg',
      svg: '<svg></svg>'
    })
    expect(parseProjectLogicExportRequest({ suggestedName: 'demo.svg', svg: '<svg><script /></svg>' })).toBeNull()
    expect(parseProjectLogicExportRequest({ suggestedName: '../demo.svg', svg: '<svg></svg>', extra: true })).toBeNull()
    expect(parseProjectLogicExportRequest(null)).toBeNull()
  })

  it('rejects relative roots and source traversal', () => {
    expect(canonicalProjectLogicRoot('relative/project')).toBeNull()
    const root = process.platform === 'win32' ? 'C:\\workspace\\demo' : '/workspace/demo'
    expect(resolveProjectLogicSourcePath(root, 'src/main.ts')).not.toBeNull()
    expect(resolveProjectLogicSourcePath(root, '../secret.txt')).toBeNull()
    expect(resolveProjectLogicSourcePath(root, root)).toBeNull()
  })

  it('uses platform-aware root identity and containment', () => {
    expect(projectLogicPathsMatch('C:\\Work\\Demo', 'c:\\work\\demo', 'win32')).toBe(true)
    expect(projectLogicPathsMatch('/Work/Demo', '/work/demo', 'linux')).toBe(false)
    const root = process.platform === 'win32' ? 'C:\\workspace\\demo' : '/workspace/demo'
    const child = process.platform === 'win32' ? 'C:\\workspace\\demo\\src\\main.ts' : '/workspace/demo/src/main.ts'
    const outside = process.platform === 'win32' ? 'C:\\workspace\\other.txt' : '/workspace/other.txt'
    expect(projectLogicPathIsWithinRoot(root, child)).toBe(true)
    expect(projectLogicPathIsWithinRoot(root, outside)).toBe(false)
  })
})
