import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchStories } from '../api'
import type { Story, Filters } from '../types'

const PAGE_SIZE = 30

export function useStories(filters: Filters) {
  const [stories, setStories]     = useState<Story[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const offsetRef                 = useRef(0)
  const activeFilters             = useRef(filters)

  const load = useCallback(async (reset: boolean, currentFilters: Filters) => {
    const offset = reset ? 0 : offsetRef.current
    reset ? setLoading(true) : setLoadingMore(true)
    setError(null)
    try {
      const data = await fetchStories(currentFilters, offset, PAGE_SIZE)
      setTotal(data.total)
      setStories(prev => reset ? data.items : [...prev, ...data.items])
      offsetRef.current = offset + data.items.length
    } catch (e) {
      setError('Fehler beim Laden der Stories')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  // Reset & reload whenever filters change
  useEffect(() => {
    activeFilters.current = filters
    offsetRef.current = 0
    load(true, filters)
  }, [
    filters.tags.join(','),
    filters.sources.join(','),
    filters.dateFrom,
    filters.dateTo,
    filters.search,
    filters.sort,
  ])

  const loadMore = useCallback(() => {
    if (!loadingMore && stories.length < total) {
      load(false, activeFilters.current)
    }
  }, [load, loadingMore, stories.length, total])

  return { stories, total, loading, loadingMore, error, loadMore, hasMore: stories.length < total }
}
