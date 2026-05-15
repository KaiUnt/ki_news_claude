import { useState, useEffect, useCallback } from 'react'
import { fetchFavorites } from '../api'
import type { FavoriteWeek } from '../types'

export function useFavorites(enabled: boolean, refreshKey: number) {
  const [weeks, setWeeks] = useState<FavoriteWeek[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    fetchFavorites()
      .then(data => {
        if (!signal?.aborted) setWeeks(data.weeks)
      })
      .catch(e => {
        if (e.name !== 'AbortError') setError('Fehler beim Laden der Favoriten')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!enabled) return
    const ac = new AbortController()
    queueMicrotask(() => load(ac.signal))
    return () => ac.abort()
  }, [enabled, load, refreshKey])

  const setStoryFavorite = useCallback((storyId: number, isFavorite: boolean) => {
    setWeeks(prev => prev
      .map(week => ({
        ...week,
        items: isFavorite
          ? week.items.map(item => (
              item.story.id === storyId
                ? { ...item, story: { ...item.story, is_favorite: true } }
                : item
            ))
          : week.items.filter(item => item.story.id !== storyId),
      }))
      .filter(week => week.items.length > 0))
  }, [])

  return { weeks, loading, error, refresh: () => load(), setStoryFavorite }
}
