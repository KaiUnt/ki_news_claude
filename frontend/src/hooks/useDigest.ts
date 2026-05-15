import { useState, useEffect, useCallback } from 'react'
import { fetchDigestLatest } from '../api'
import type { DigestLatest } from '../types'

export function useDigest() {
  const [digest, setDigest]     = useState<DigestLatest | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    queueMicrotask(() => {
      if (ac.signal.aborted) return
      setLoading(true)
      setError(null)

      fetchDigestLatest()
        .then(data => {
          if (!ac.signal.aborted) setDigest(data)
        })
        .catch(e => {
          if (e.name !== 'AbortError') setError('Fehler beim Laden des Digest')
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false)
        })
    })

    return () => ac.abort()
  }, [refreshKey])

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])
  const setStoryFavorite = useCallback((storyId: number, isFavorite: boolean) => {
    setDigest(prev => {
      if (!prev) return prev
      return {
        ...prev,
        top_stories: prev.top_stories.map(entry => (
          entry.story.id === storyId
            ? { ...entry, story: { ...entry.story, is_favorite: isFavorite } }
            : entry
        )),
      }
    })
  }, [])

  return { digest, loading, error, refresh, setStoryFavorite }
}
