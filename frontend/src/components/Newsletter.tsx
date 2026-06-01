import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchStories } from '../api'
import { StoryCard } from './StoryCard'
import type { Story, Filters } from '../types'

// Muss mit NEWSLETTER_SOURCES in backend/config.py übereinstimmen
const NEWSLETTER_SOURCES: { name: string; label: string }[] = [
  { name: 'KI-Newsletter Jens Polomski', label: 'Jens Polomski' },
]

const EMPTY_FILTERS: Filters = {
  tags: [],
  excludeTags: [],
  sources: [],
  dateFrom: '',
  dateTo: '',
  search: '',
  sort: 'date_desc',
}

interface Props {
  onSelectStory: (id: number) => void
  onToggleFavorite: (story: Story, next: boolean) => void
}

export function Newsletter({ onSelectStory, onToggleFavorite }: Props) {
  const [stories, setStories]         = useState<Story[]>([])
  const [total, setTotal]             = useState(0)
  const [selected, setSelected]       = useState('')   // '' = alle Newsletter
  const [loading, setLoading]         = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (sourceName: string, offset = 0) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const sourceNames = sourceName
      ? [sourceName]
      : NEWSLETTER_SOURCES.map(s => s.name)

    const filters: Filters = {
      ...EMPTY_FILTERS,
      sources: sourceNames,
    }

    if (offset === 0) setLoading(true)
    else setLoadingMore(true)
    setError(null)

    try {
      const data = await fetchStories(filters, offset, 30, ctrl.signal)
      if (offset === 0) {
        setStories(data.items)
      } else {
        setStories(prev => [...prev, ...data.items])
      }
      setTotal(data.total)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError('Fehler beim Laden — läuft das Backend?')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    load(selected, 0)
  }, [selected, load])

  const hasMore = stories.length < total

  function handleToggle(story: Story, next: boolean) {
    setStories(prev =>
      prev.map(s => s.id === story.id ? { ...s, is_favorite: next } : s)
    )
    onToggleFavorite(story, next)
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h2 className="text-base font-semibold text-slate-200">Newsletter · KI</h2>
        <span className="text-xs text-slate-500">{total} Stories</span>
      </div>

      {/* Filter: nur anzeigen wenn es mehr als einen Newsletter gibt */}
      {NEWSLETTER_SOURCES.length > 1 && (
        <div className="flex items-center gap-1 mb-5 flex-wrap">
          <button
            type="button"
            onClick={() => setSelected('')}
            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
              selected === ''
                ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                : 'text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            Alle
          </button>
          {NEWSLETTER_SOURCES.map(s => (
            <button
              key={s.name}
              type="button"
              onClick={() => setSelected(selected === s.name ? '' : s.name)}
              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                selected === s.name
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                  : 'text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="text-center py-20 text-red-400 text-sm">{error}</div>
      )}

      {!loading && !error && stories.length === 0 && (
        <div className="text-center py-20 text-slate-500 text-sm">
          Noch keine Newsletter-Stories vorhanden. Klicke "Aktualisieren" um Daten zu laden.
        </div>
      )}

      {!loading && stories.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stories.map(story => (
            <StoryCard
              key={story.id}
              story={story}
              onSelect={onSelectStory}
              onToggleFavorite={handleToggle}
            />
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div className="flex justify-center mt-8">
          <button
            type="button"
            onClick={() => load(selected, stories.length)}
            disabled={loadingMore}
            className="px-6 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-300 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loadingMore && (
              <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin" />
            )}
            {loadingMore ? 'Lade…' : `Mehr laden (${total - stories.length} übrig)`}
          </button>
        </div>
      )}
    </div>
  )
}
