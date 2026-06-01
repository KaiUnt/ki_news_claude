import { useEffect, useState } from 'react'
import { FilterBar } from './FilterBar'
import { StoryCard } from './StoryCard'
import { useStories } from '../hooks/useStories'
import type { Story, Filters } from '../types'

// Muss mit NEWSLETTER_SOURCES in backend/config.py übereinstimmen
const NEWSLETTER_SOURCES: { name: string; label: string }[] = [
  { name: 'KI-Newsletter Jens Polomski', label: 'Jens Polomski' },
]

const ALL_NEWSLETTER_NAMES = NEWSLETTER_SOURCES.map(s => s.name)

const EMPTY_FILTERS: Filters = {
  tags: [],
  excludeTags: [],
  sources: ALL_NEWSLETTER_NAMES,
  dateFrom: '',
  dateTo: '',
  search: '',
  sort: 'date_desc',
}

interface Props {
  onSelectStory: (id: number) => void
  onToggleFavorite: (story: Story, next: boolean) => Promise<void>
}

export function Newsletter({ onSelectStory, onToggleFavorite }: Props) {
  const [selected, setSelected] = useState('')  // '' = alle Newsletter
  const [filters, setFilters]   = useState<Filters>(EMPTY_FILTERS)

  // Wenn sich die Newsletter-Auswahl ändert, sources im Filter aktualisieren
  useEffect(() => {
    setFilters(prev => ({
      ...prev,
      sources: selected ? [selected] : ALL_NEWSLETTER_NAMES,
    }))
  }, [selected])

  // Newsletter-sources immer als Basis behalten, andere Filter frei
  function handleFilterChange(next: Filters) {
    setFilters({
      ...next,
      sources: selected ? [selected] : ALL_NEWSLETTER_NAMES,
    })
  }

  const stories = useStories(filters)

  async function handleToggle(story: Story, next: boolean): Promise<void> {
    stories.setStoryFavorite(story.id, next)
    await onToggleFavorite(story, next)
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h2 className="text-base font-semibold text-slate-200">Newsletter · KI</h2>

        {/* Per-Newsletter-Filter — nur sichtbar wenn es mehrere gibt */}
        {NEWSLETTER_SOURCES.length > 1 && (
          <div className="flex items-center gap-1">
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
      </div>

      {/* FilterBar — gleich wie "Alle Stories", sources sind intern gelockt */}
      <div className="-mx-4 mb-6">
        <FilterBar
          filters={filters}
          onChange={handleFilterChange}
          total={stories.total}
        />
      </div>

      {stories.loading && (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {stories.error && (
        <div className="text-center py-20 text-red-400 text-sm">{stories.error}</div>
      )}

      {!stories.loading && !stories.error && stories.stories.length === 0 && (
        <div className="text-center py-20 text-slate-500 text-sm">
          Keine Newsletter-Stories gefunden. Filter anpassen oder "Aktualisieren" klicken.
        </div>
      )}

      {!stories.loading && stories.stories.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stories.stories.map(story => (
            <StoryCard
              key={story.id}
              story={story}
              onSelect={onSelectStory}
              onToggleFavorite={handleToggle}
            />
          ))}
        </div>
      )}

      {stories.hasMore && !stories.loading && (
        <div className="flex justify-center mt-8">
          <button
            type="button"
            onClick={stories.loadMore}
            disabled={stories.loadingMore}
            className="px-6 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-300 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {stories.loadingMore && (
              <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin" />
            )}
            {stories.loadingMore
              ? 'Lade…'
              : `Mehr laden (${stories.total - stories.stories.length} übrig)`}
          </button>
        </div>
      )}
    </div>
  )
}
