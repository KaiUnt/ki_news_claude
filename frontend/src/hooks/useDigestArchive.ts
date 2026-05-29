import { useState, useEffect, useCallback } from 'react'
import { fetchDigestById, fetchDigestList } from '../api'
import type { DigestLatest, DigestSummary } from '../types'

export function useDigestArchive(enabled: boolean, refreshKey: number) {
  const [items, setItems] = useState<DigestSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selected, setSelected] = useState<DigestLatest | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const ac = new AbortController()
    setListLoading(true)
    setError(null)
    fetchDigestList(50, 0, ac.signal)
      .then(data => {
        if (ac.signal.aborted) return
        setItems(data.items)
        if (data.items.length > 0) {
          setSelectedId(prev => prev ?? data.items[0].id)
        } else {
          setSelectedId(null)
          setSelected(null)
        }
      })
      .catch(e => {
        if (e.name !== 'AbortError') setError('Fehler beim Laden des Verlaufs')
      })
      .finally(() => {
        if (!ac.signal.aborted) setListLoading(false)
      })
    return () => ac.abort()
  }, [enabled, refreshKey])

  useEffect(() => {
    if (!enabled || selectedId === null) return
    const ac = new AbortController()
    setDetailLoading(true)
    fetchDigestById(selectedId, ac.signal)
      .then(data => {
        if (!ac.signal.aborted) setSelected(data)
      })
      .catch(e => {
        if (e.name !== 'AbortError') setError('Fehler beim Laden des Digests')
      })
      .finally(() => {
        if (!ac.signal.aborted) setDetailLoading(false)
      })
    return () => ac.abort()
  }, [enabled, selectedId])

  const setStoryFavorite = useCallback((storyId: number, isFavorite: boolean) => {
    setSelected(prev => {
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

  return {
    items,
    selectedId,
    selected,
    listLoading,
    detailLoading,
    error,
    selectDigest: setSelectedId,
    setStoryFavorite,
  }
}
