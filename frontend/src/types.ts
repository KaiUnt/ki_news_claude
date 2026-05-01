export interface Story {
  id: number
  title_de: string
  summary_de: string | null
  tags: string[]
  source_count: number
  first_seen: string
  last_updated: string
  is_processed: boolean
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
}

export type SortOrder = 'date_desc' | 'date_asc'

export interface Filters {
  tags: string[]
  sources: string[]
  dateFrom: string
  dateTo: string
  search: string
  sort: SortOrder
}

export type View = 'dashboard' | 'all' | 'settings'

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
