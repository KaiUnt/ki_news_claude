import { useEffect, useState } from 'react'
import { fetchStories } from '../api'
import type { Story } from '../types'

export type DashboardMode = 'paper' | 'forschung'

const BASE_FILTERS = {
  excludeTags: [],
  sources: [],
  dateFrom: '',
  dateTo: '',
  search: '',
  sort: 'date_desc' as const,
}

export function useDashboardStories(
  mode: DashboardMode,
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

      const filters = {
        ...BASE_FILTERS,
        tags: mode === 'forschung' ? ['type:forschung'] : [],
      }
      const options = mode === 'paper' ? { storyKind: 'paper' as const } : {}

      fetchStories(filters, 0, limit, ac.signal, options)
        .then(data => {
          if (!ac.signal.aborted) setStories(data.items)
        })
        .catch(e => {
          if (e.name !== 'AbortError') {
            setError(mode === 'paper'
              ? 'Fehler beim Laden der Paper-Stories'
              : 'Fehler beim Laden der Forschungs-Stories')
          }
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false)
        })
    })

    return () => ac.abort()
  }, [enabled, limit, refreshKey, mode])

  function setStoryFavorite(storyId: number, isFavorite: boolean) {
    setStories(prev => prev.map(story => (
      story.id === storyId ? { ...story, is_favorite: isFavorite } : story
    )))
  }

  return { stories, loading, error, setStoryFavorite }
}
