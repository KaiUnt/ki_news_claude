import { useState, useEffect } from 'react'
import { FilterBar } from './components/FilterBar'
import { StoryCard } from './components/StoryCard'
import { StoryDetailModal } from './components/StoryDetailModal'
import { useStories } from './hooks/useStories'
import { usePersistedFilters } from './hooks/usePersistedFilters'
import { fetchStats, triggerFetch } from './api'
import type { Filters } from './types'

const DEFAULT_FILTERS: Filters = {
  tags: [],
  sources: [],
  dateFrom: '',
  dateTo: '',
  search: '',
  sort: 'date_desc',
}

export default function App() {
  const [filters, setFilters]                 = usePersistedFilters(DEFAULT_FILTERS)
  const [stats, setStats]                     = useState<{ total_stories: number; total_articles: number } | null>(null)
  const [refreshing, setRefreshing]           = useState(false)
  const [selectedStoryId, setSelectedStoryId] = useState<number | null>(null)
  const { stories, total, loading, loadingMore, error, loadMore, refresh, hasMore } = useStories(filters)

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {})
  }, [])

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await triggerFetch()
      refresh()
      const s = await fetchStats()
      setStats(s)
    } catch {
      // Fehler werden via useStories.error sichtbar
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-100">

      <header className="border-b border-slate-800 px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <h1 className="text-lg font-bold text-slate-100 m-0 tracking-tight">
              KI-News Dashboard
            </h1>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            {stats && (
              <>
                <span>{stats.total_stories} Stories</span>
                <span className="text-slate-700">·</span>
                <span>{stats.total_articles} Artikel</span>
                <span className="text-slate-700">·</span>
              </>
            )}
            <span>
              {new Date().toLocaleDateString('de-AT', {
                weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
              })}
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Neue Artikel holen, clustern und zusammenfassen"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-slate-100 disabled:opacity-50 transition-colors"
            >
              {refreshing ? (
                <span className="w-3 h-3 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin" />
              ) : (
                <span aria-hidden="true">↻</span>
              )}
              <span>Aktualisieren</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto">
        <FilterBar filters={filters} onChange={setFilters} total={total} />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">

        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-center py-20 text-red-400 text-sm">
            {error} — läuft das Backend?{' '}
            <code className="text-xs bg-slate-800 px-1 rounded">./start.sh</code>
          </div>
        )}

        {!loading && !error && stories.length === 0 && (
          <div className="text-center py-20 text-slate-500 text-sm">
            Keine Stories gefunden. Filter anpassen?
          </div>
        )}

        {!loading && stories.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {stories.map(story => (
              <StoryCard key={story.id} story={story} onSelect={setSelectedStoryId} />
            ))}
          </div>
        )}

        {hasMore && !loading && (
          <div className="flex justify-center mt-8">
            <button
              type="button"
              onClick={loadMore}
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
      </main>

      {selectedStoryId !== null && (
        <StoryDetailModal
          storyId={selectedStoryId}
          onClose={() => setSelectedStoryId(null)}
        />
      )}
    </div>
  )
}
