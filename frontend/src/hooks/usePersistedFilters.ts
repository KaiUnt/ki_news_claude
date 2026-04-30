import { useState, useEffect } from 'react'
import type { Filters } from '../types'

const STORAGE_KEY = 'kinews:filters'

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
