import { isAbsolute, relative, resolve } from 'node:path'

export const MAX_PROJECT_LOGIC_SVG_BYTES = 5 * 1024 * 1024

export interface ProjectLogicExportRequest {
  suggestedName: string
  svg: string
}

export function parseProjectLogicExportRequest(value: unknown): ProjectLogicExportRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'suggestedName' && key !== 'svg')) return null
  if (typeof record.suggestedName !== 'string' || typeof record.svg !== 'string') return null
  const name = sanitizeProjectLogicFileName(record.suggestedName)
  if (!name || Buffer.byteLength(record.svg, 'utf8') > MAX_PROJECT_LOGIC_SVG_BYTES) return null
  const trimmed = record.svg.trimStart()
  if (!trimmed.startsWith('<svg') && !(trimmed.startsWith('<?xml') && trimmed.includes('<svg'))) return null
  if (trimmed.toLocaleLowerCase().includes('<script')) return null
  return { suggestedName: name, svg: record.svg }
}

export function canonicalProjectLogicRoot(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !isAbsolute(value)) return null
  return resolve(value)
}

export function projectLogicRootKey(path: string, platform: NodeJS.Platform = process.platform): string {
  const canonical = resolve(path)
  return platform === 'win32' ? canonical.toLocaleLowerCase('en-US') : canonical
}

export function projectLogicPathsMatch(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return projectLogicRootKey(left, platform) === projectLogicRootKey(right, platform)
}

export function resolveProjectLogicSourcePath(root: string, relativePath: unknown): string | null {
  const canonicalRoot = canonicalProjectLogicRoot(root)
  if (
    !canonicalRoot
    || typeof relativePath !== 'string'
    || !relativePath.trim()
    || relativePath.length > 500
    || relativePath.includes('\0')
    || isAbsolute(relativePath)
  ) return null
  const target = resolve(canonicalRoot, relativePath)
  const remainder = relative(canonicalRoot, target)
  if (!remainder || remainder === '..' || remainder.startsWith(`..${pathSeparator()}`) || isAbsolute(remainder)) return null
  return target
}

export function projectLogicPathIsWithinRoot(root: string, target: string): boolean {
  const remainder = relative(resolve(root), resolve(target))
  return remainder === '' || (remainder !== '..' && !remainder.startsWith(`..${pathSeparator()}`) && !isAbsolute(remainder))
}

function sanitizeProjectLogicFileName(value: string): string | null {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
  if (!sanitized) return null
  return sanitized.toLocaleLowerCase().endsWith('.svg') ? sanitized : `${sanitized}.svg`
}

function pathSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/'
}
