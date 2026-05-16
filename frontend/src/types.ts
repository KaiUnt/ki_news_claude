export type StorySection = 'general' | 'research'
export type StoryKind = 'general' | 'research' | 'paper'
export type SourceCategory = 'official' | 'media' | 'community' | 'policy' | 'papers'
export type IngestionMode = 'rss' | 'api' | 'scrape' | 'hybrid'
export type FeedScope = 'focused' | 'broad'

export interface Story {
  id: number
  title_de: string
  primary_title: string | null
  summary_de: string | null
  tags: string[]
  source_count: number
  first_seen: string
  last_updated: string
  is_processed: boolean
  is_favorite: boolean
  section: StorySection
  story_kind: StoryKind
  has_primary_source: boolean
  has_broad_source: boolean
  source_categories: SourceCategory[]
  source_ingestion_modes: IngestionMode[]
}

export interface Source {
  id: number
  url: string
  title: string
  source_name: string
  source_type: string
  published_at: string | null
}

export interface StoryDetail extends Story {
  sources: Source[]
}

export interface StoriesResponse {
  total: number
  offset: number
  limit: number
  items: Story[]
}

export interface SourceConfig {
  name: string
  url: string
  type: string
  section: StorySection
  story_kind: StoryKind
  category: SourceCategory
  ingestion_mode: IngestionMode
  feed_scope: FeedScope
  is_primary_source: boolean
}

export type SortOrder = 'date_desc' | 'date_asc'

export interface Filters {
  tags: string[]
  excludeTags: string[]
  sources: string[]
  dateFrom: string
  dateTo: string
  search: string
  sort: SortOrder
}

export type View = 'dashboard' | 'all' | 'favorites' | 'settings'

export interface DigestTopStory {
  rank: number
  why: string
  story: Story
}

export interface DigestLatest {
  id: number
  generated_at: string
  window_start: string
  window_end: string
  meta_summary_de: string
  model_id: string
  top_story_count: number
  top_stories: DigestTopStory[]
}

export interface DigestSummary {
  id: number
  generated_at: string
  window_start: string
  window_end: string
  meta_summary_de: string
  model_id: string
  top_story_count: number
}

export interface UserProfile {
  id: number
  name: string
  priority_prompt: string
  updated_at: string
}

export interface FavoriteItem {
  favorite_id: number
  favorited_at: string
  story: Story
}

export interface FavoriteWeek {
  week_start: string
  week_end: string
  label: string
  items: FavoriteItem[]
}

export interface FavoritesResponse {
  weeks: FavoriteWeek[]
}
