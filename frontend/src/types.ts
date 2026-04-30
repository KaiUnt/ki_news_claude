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
