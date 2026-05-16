import { useState, useEffect } from 'react'
import type { Filters } from '../types'

// v2: tag schema rewrite — old saved tag names ("Neue Modelle" etc.) no longer
// match the prefixed schema, so we invalidate the persisted filters once.
const STORAGE_KEY = 'kinews:filters:v2'

export function usePersistedFilters(defaults: Filters): [Filters, (f: Filters) => void] {
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return defaults
      const parsed = JSON.parse(raw)
      return { ...defaults, ...parsed }
    } catch {
      return defaults
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
    } catch {
      // localStorage quota / disabled — ignore
    }
  }, [filters])

  return [filters, setFilters]
}
