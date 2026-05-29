export type StoryKind = 'general' | 'paper'

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
  story_kind: StoryKind
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
  story_kind: StoryKind
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

export type View = 'dashboard' | 'all' | 'favorites' | 'reddit' | 'archive' | 'settings'

export interface RedditPost {
  id: number
  reddit_id: string
  subreddit: string
  title: string
  permalink: string
  external_url: string
  is_self: boolean
  score: number
  upvote_ratio: number
  num_comments: number
  flair: string | null
  sentiment: string
  created_utc: string
  fetched_at: string
}

export interface RedditPostsResponse {
  total: number
  offset: number
  limit: number
  items: RedditPost[]
}

export interface RedditSubredditStats {
  subreddit: string
  count: number
  avg_score: number
  avg_ratio: number
}

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
