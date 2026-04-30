import type { StoriesResponse, StoryDetail, SourceConfig, Filters } from './types'

const BASE = '/api'

export async function fetchStories(
  filters: Filters,
  offset = 0,
  limit = 30,
  signal?: AbortSignal,
): Promise<StoriesResponse> {
  const params = new URLSearchParams()
  if (filters.tags.length)    params.set('tags', filters.tags.join(','))
  if (filters.sources.length) params.set('sources', filters.sources.join(','))
  if (filters.dateFrom)       params.set('date_from', filters.dateFrom)
  if (filters.dateTo)         params.set('date_to', filters.dateTo)
  if (filters.search)         params.set('search', filters.search)
  params.set('sort', filters.sort)
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  const res = await fetch(`${BASE}/stories?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchStoryDetail(id: number): Promise<StoryDetail> {
  const res = await fetch(`${BASE}/stories/${id}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchTags(): Promise<string[]> {
  const res = await fetch(`${BASE}/tags`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.tags
}

export async function fetchSources(): Promise<SourceConfig[]> {
  const res = await fetch(`${BASE}/sources`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.sources
}

export async function fetchStats() {
  const res = await fetch(`${BASE}/stats`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface FetchResult {
  fetched: number
  new_saved: number
  clustered: number
  stories_summarized: number
}

export async function triggerFetch(): Promise<FetchResult> {
  const res = await fetch(`${BASE}/fetch`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
