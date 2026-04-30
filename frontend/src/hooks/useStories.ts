import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchStories } from '../api'
import type { Story, Filters } from '../types'

const PAGE_SIZE = 30

export function useStories(filters: Filters) {
  const [stories, setStories]         = useState<Story[]>([])
  const [total, setTotal]             = useState(0)
  const [loading, setLoading]         = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [refreshKey, setRefreshKey]   = useState(0)
  const offsetRef                     = useRef(0)

  // AbortController guards against stale responses when filters change rapidly.
  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)

    fetchStories(filters, 0, PAGE_SIZE, ac.signal)
      .then(data => {
        setTotal(data.total)
        setStories(data.items)
        offsetRef.current = data.items.length
      })
      .catch(e => {
        if (e.name !== 'AbortError') setError('Fehler beim Laden der Stories')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })

    return () => ac.abort()
  }, [filters, refreshKey])

  const loadMore = useCallback(() => {
    if (loadingMore || stories.length >= total) return
    setLoadingMore(true)
    fetchStories(filters, offsetRef.current, PAGE_SIZE)
      .then(data => {
        setStories(prev => [...prev, ...data.items])
        offsetRef.current += data.items.length
      })
      .catch(() => setError('Fehler beim Nachladen'))
      .finally(() => setLoadingMore(false))
  }, [filters, loadingMore, stories.length, total])

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  return {
    stories, total, loading, loadingMore, error, loadMore, refresh,
    hasMore: stories.length < total,
  }
}
