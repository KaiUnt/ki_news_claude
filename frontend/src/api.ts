import type {
  StoriesResponse, StoryDetail, SourceConfig, Filters,
  DigestLatest, DigestSummary, UserProfile, FavoritesResponse, Story,
  StoryKind, StorySection,
} from './types'

const BASE = '/api'

export interface FetchStoriesOptions {
  section?: StorySection
  storyKind?: StoryKind
}

export async function fetchStories(
  filters: Filters,
  offset = 0,
  limit = 30,
  signal?: AbortSignal,
  options: FetchStoriesOptions = {},
): Promise<StoriesResponse> {
  const params = new URLSearchParams()
  if (filters.tags.length)    params.set('tags', filters.tags.join(','))
  if (filters.sources.length) params.set('sources', filters.sources.join(','))
  if (filters.dateFrom)       params.set('date_from', filters.dateFrom)
  if (filters.dateTo)         params.set('date_to', filters.dateTo)
  if (filters.search)         params.set('search', filters.search)
  if (options.section)        params.set('section', options.section)
  if (options.storyKind)      params.set('story_kind', options.storyKind)
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
  digest_id: number | null
}

export async function triggerFetch(): Promise<FetchResult> {
  const res = await fetch(`${BASE}/fetch`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchDigestLatest(): Promise<DigestLatest | null> {
  const res = await fetch(`${BASE}/digest/latest`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function regenerateDigest(): Promise<DigestSummary> {
  const res = await fetch(`${BASE}/digest/regenerate`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchProfile(): Promise<UserProfile> {
  const res = await fetch(`${BASE}/profile`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function updateProfile(
  body: Partial<Pick<UserProfile, 'name' | 'priority_prompt'>>,
): Promise<UserProfile> {
  const res = await fetch(`${BASE}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchFavorites(): Promise<FavoritesResponse> {
  const res = await fetch(`${BASE}/favorites`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function addFavorite(storyId: number): Promise<Story> {
  const res = await fetch(`${BASE}/favorites/${storyId}`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function removeFavorite(storyId: number): Promise<void> {
  const res = await fetch(`${BASE}/favorites/${storyId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
