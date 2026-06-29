import type {
  StoriesResponse, StoryDetail, SourceConfig, Filters,
  DigestLatest, DigestSummary, UserProfile, FavoritesResponse, Story,
  StoryKind, RedditPostsResponse, RedditSubredditStats, ManagedSource, SystemSettings,
  Category, PromptSetting,
} from './types'
import type { TagSchema } from './tagSchema'

const BASE = '/api'

export interface FetchStoriesOptions {
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
  if (filters.excludeTags.length) params.set('exclude_tags', filters.excludeTags.join(','))
  if (filters.sources.length) params.set('sources', filters.sources.join(','))
  if (filters.dateFrom)       params.set('date_from', filters.dateFrom)
  if (filters.dateTo)         params.set('date_to', filters.dateTo)
  if (filters.search)         params.set('search', filters.search)
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

export async function fetchTagSchema(): Promise<TagSchema> {
  const res = await fetch(`${BASE}/tags`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return {
    types:   data.types   ?? [],
    domains: data.domains ?? [],
    flags:   data.flags   ?? [],
  }
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
  stories_merged: number
  stories_summarized: number
  digest_id: number | null
  category_digest_ids: number[]
}

export interface FetchStatus {
  running: boolean
  started_at: string | null
  finished_at: string | null
  result: FetchResult | null
  error: string | null
}

// Startet die Pipeline im Hintergrund; Fortschritt via fetchFetchStatus().
export async function triggerFetch(): Promise<{ status: 'started' | 'already_running' }> {
  const res = await fetch(`${BASE}/fetch`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchFetchStatus(): Promise<FetchStatus> {
  const res = await fetch(`${BASE}/fetch/status`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchDigestLatest(): Promise<DigestLatest | null> {
  const res = await fetch(`${BASE}/digest/latest`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface DigestListResponse {
  offset: number
  limit: number
  items: DigestSummary[]
}

export async function fetchDigestList(
  limit = 30,
  offset = 0,
  signal?: AbortSignal,
): Promise<DigestListResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const res = await fetch(`${BASE}/digest?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchDigestById(id: number, signal?: AbortSignal): Promise<DigestLatest> {
  const res = await fetch(`${BASE}/digest/${id}`, { signal })
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

export interface GeneratedPostCluster {
  title: string
  intro: string
  story_ids: number[]
}

export interface GeneratedPost {
  clusters: GeneratedPostCluster[]
}

export async function generatePost(storyIds: number[]): Promise<GeneratedPost> {
  const res = await fetch(`${BASE}/favorites/generate-post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_ids: storyIds }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail?.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export type TeamsBlock =
  | { kind: 'story'; title: string; summary?: string; url?: string }
  | { kind: 'heading'; content: string }
  | { kind: 'text'; content: string }

export interface TeamsPostPayload {
  header: string
  footer: string
  blocks: TeamsBlock[]
  week?: number
}

export async function fetchTeamsStatus(): Promise<{ configured: boolean }> {
  const res = await fetch(`${BASE}/teams/status`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function postToTeams(payload: TeamsPostPayload): Promise<void> {
  const res = await fetch(`${BASE}/teams/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
}

export type RedditSortOrder = 'score' | 'date' | 'ratio' | 'comments'

export async function fetchRedditPosts(
  subreddit?: string,
  sort: RedditSortOrder = 'score',
  limit = 50,
  offset = 0,
  signal?: AbortSignal,
): Promise<RedditPostsResponse> {
  const params = new URLSearchParams()
  if (subreddit) params.set('subreddit', subreddit)
  params.set('sort', sort)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  const res = await fetch(`${BASE}/reddit/posts?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchRedditStats(): Promise<RedditSubredditStats[]> {
  const res = await fetch(`${BASE}/reddit/stats`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchManagedSources(): Promise<ManagedSource[]> {
  const res = await fetch(`${BASE}/admin/sources`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.sources
}

export async function createManagedSource(
  payload: { name: string; source_type: 'rss' | 'newsletter'; url: string; category_id?: number | null }
): Promise<ManagedSource> {
  const res = await fetch(`${BASE}/admin/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function updateManagedSource(
  id: number,
  patch: { active?: boolean; category_id?: number | null; name?: string; url?: string }
): Promise<ManagedSource> {
  const res = await fetch(`${BASE}/admin/sources/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function deleteManagedSource(id: number): Promise<void> {
  const res = await fetch(`${BASE}/admin/sources/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${BASE}/admin/categories`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.categories
}

export async function createCategory(
  payload: { slug: string; name: string; icon?: string; color?: string; sort_order?: number; is_premium?: boolean }
): Promise<Category> {
  const res = await fetch(`${BASE}/admin/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function updateCategory(
  id: number,
  patch: Partial<Pick<Category, 'name' | 'icon' | 'color' | 'sort_order' | 'is_premium' | 'active' | 'digest_prompt'>>
): Promise<Category> {
  const res = await fetch(`${BASE}/admin/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function deleteCategory(id: number): Promise<void> {
  const res = await fetch(`${BASE}/admin/categories/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
}

// ── Prompts ─────────────────────────────────────────────────────────────────

export async function fetchStoriesByCategory(
  categorySlug: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<StoriesResponse> {
  const params = new URLSearchParams({
    category_slug: categorySlug,
    sort: 'date_desc',
    limit: String(limit),
    offset: '0',
  })
  const res = await fetch(`${BASE}/stories?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchCategoryDigest(
  categorySlug: string,
  signal?: AbortSignal,
): Promise<DigestLatest | null> {
  const res = await fetch(`${BASE}/digest/latest?category_slug=${encodeURIComponent(categorySlug)}`, { signal })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchPrompts(): Promise<PromptSetting[]> {
  const res = await fetch(`${BASE}/admin/prompts`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.prompts
}

export async function updatePrompt(key: string, value: string): Promise<PromptSetting> {
  const res = await fetch(`${BASE}/admin/prompts/${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchSystemSettings(): Promise<SystemSettings> {
  const res = await fetch(`${BASE}/admin/settings`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function updateSystemSettings(patch: Partial<SystemSettings>): Promise<SystemSettings> {
  const res = await fetch(`${BASE}/admin/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

