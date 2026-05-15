import { useState, useEffect } from 'react'
import type { View } from '../types'

const STORAGE_KEY = 'kinews:view'
const VALID: View[] = ['dashboard', 'all', 'favorites', 'settings']

export function usePersistedView(defaultView: View): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw && (VALID as string[]).includes(raw)) return raw as View
    } catch {
      // ignore
    }
    return defaultView
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, view)
    } catch {
      // localStorage quota / disabled — ignore
    }
  }, [view])

  return [view, setView]
}
