import { useEffect, useState } from 'react'
import { fetchStories } from '../api'
import type { Story, StoryKind } from '../types'

const DASHBOARD_FILTERS = {
  tags: [],
  sources: [],
  dateFrom: '',
  dateTo: '',
  search: '',
  sort: 'date_desc' as const,
}

export function useDashboardStories(
  storyKind: StoryKind,
  enabled: boolean,
  refreshKey: number,
  limit = 6,
) {
  const [stories, setStories] = useState<Story[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return

    const ac = new AbortController()
    queueMicrotask(() => {
      if (ac.signal.aborted) return
      setLoading(true)
      setError(null)

      fetchStories(
        DASHBOARD_FILTERS,
        0,
        limit,
        ac.signal,
        { section: 'research', storyKind },
      )
        .then(data => {
          if (!ac.signal.aborted) setStories(data.items)
        })
        .catch(e => {
          if (e.name !== 'AbortError') setError('Fehler beim Laden der Forschungs-Stories')
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false)
        })
    })

    return () => ac.abort()
  }, [enabled, limit, refreshKey, storyKind])

  function setStoryFavorite(storyId: number, isFavorite: boolean) {
    setStories(prev => prev.map(story => (
      story.id === storyId ? { ...story, is_favorite: isFavorite } : story
    )))
  }

  return { stories, loading, error, setStoryFavorite }
}
