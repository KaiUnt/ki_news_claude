export type TagAxis = 'type' | 'domain' | 'flag'

export interface TagSchema {
  types: string[]
  domains: string[]
  flags: string[]
}

export const EMPTY_SCHEMA: TagSchema = { types: [], domains: [], flags: [] }

export const TYPE_LABELS: Record<string, string> = {
  release:        'Release',
  forschung:      'Forschung',
  tool:           'Tool',
  infrastruktur:  'Infrastruktur',
  business:       'Business',
  policy:         'Policy',
  demo:           'Demo',
}

export const DOMAIN_LABELS: Record<string, string> = {
  'llm-core':   'LLM-Core',
  coding:       'Coding',
  agenten:      'Agenten',
  'bild-video': 'Bild/Video',
  audio:        'Audio',
  robotik:      'Robotik',
  vertikal:     'Vertikal',
  sonstige:     'Sonstige',
}

export const FLAG_LABELS: Record<string, string> = {
  'open-source': 'Open Source',
  frontier:      'Frontier',
  'big-lab':     'Big Lab',
}

export function tagAxis(tag: string): TagAxis | null {
  const idx = tag.indexOf(':')
  if (idx < 0) return null
  const prefix = tag.slice(0, idx)
  if (prefix === 'type' || prefix === 'domain' || prefix === 'flag') return prefix
  return null
}

export function tagId(tag: string): string {
  const idx = tag.indexOf(':')
  return idx < 0 ? tag : tag.slice(idx + 1)
}

export function tagLabel(tag: string): string {
  const axis = tagAxis(tag)
  const id = tagId(tag)
  if (axis === 'type')   return TYPE_LABELS[id]   ?? id
  if (axis === 'domain') return DOMAIN_LABELS[id] ?? id
  if (axis === 'flag')   return FLAG_LABELS[id]   ?? id
  return tag
}

export function buildTag(axis: TagAxis, id: string): string {
  return `${axis}:${id}`
}
