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

    return () => ac.abort()
  }, [refreshKey])

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  return { digest, loading, error, refresh }
}
