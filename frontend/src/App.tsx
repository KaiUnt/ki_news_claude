import { useState, useEffect } from 'react'
import { FilterBar } from './components/FilterBar'
import { StoryCard } from './components/StoryCard'
import { StoryDetailModal } from './components/StoryDetailModal'
import { HeaderTabs } from './components/HeaderTabs'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/Settings'
import { Favorites } from './components/Favorites'
import { useStories } from './hooks/useStories'
import { useDigest } from './hooks/useDigest'
import { useDashboardStories } from './hooks/useDashboardStories'
import { useFavorites } from './hooks/useFavorites'
import { usePersistedFilters } from './hooks/usePersistedFilters'
import { usePersistedView } from './hooks/usePersistedView'
import { addFavorite, fetchStats, removeFavorite, triggerFetch } from './api'
import type { Filters, Story } from './types'

const DEFAULT_FILTERS: Filters = {
  tags: [],
  sources: [],
  dateFrom: '',
  dateTo: '',
  search: '',
  sort: 'date_desc',
}

export default function App() {
  const [view, setView]                       = usePersistedView('dashboard')
  const [filters, setFilters]                 = usePersistedFilters(DEFAULT_FILTERS)
  const [stats, setStats]                     = useState<{ total_stories: number; total_articles: number } | null>(null)
  const [refreshing, setRefreshing]           = useState(false)
  const [selectedStoryId, setSelectedStoryId] = useState<number | null>(null)
  const [favoriteRefreshKey, setFavoriteRefreshKey] = useState(0)
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0)

  const stories = useStories(filters)
  const digest  = useDigest()
  const researchStories = useDashboardStories('research', view === 'dashboard', dashboardRefreshKey)
  const paperStories = useDashboardStories('paper', view === 'dashboard', dashboardRefreshKey)
  const favorites = useFavorites(view === 'favorites', favoriteRefreshKey)

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {})
  }, [])

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await triggerFetch()
      stories.refresh()
      digest.refresh()
      setDashboardRefreshKey(k => k + 1)
      const s = await fetchStats()
      setStats(s)
    } catch {
      // Fehler werden in den jeweiligen Views sichtbar
    } finally {
      setRefreshing(false)
    }
  }

  async function handleToggleFavorite(story: Story, next: boolean) {
    if (next) {
      await addFavorite(story.id)
    } else {
      await removeFavorite(story.id)
    }
    stories.setStoryFavorite(story.id, next)
    digest.setStoryFavorite(story.id, next)
    researchStories.setStoryFavorite(story.id, next)
    paperStories.setStoryFavorite(story.id, next)
    favorites.setStoryFavorite(story.id, next)
    setFavoriteRefreshKey(k => k + 1)
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-100">

      <header className="border-b border-slate-800 px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <h1 className="text-lg font-bold text-slate-100 m-0 tracking-tight">
              KI-News Dashboard
            </h1>
          </div>

          <HeaderTabs view={view} onChange={setView} />

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
              title="Neue Artikel holen, clustern, summarisieren und Digest erzeugen"
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

      {view === 'all' && (
        <div className="max-w-7xl mx-auto">
          <FilterBar filters={filters} onChange={setFilters} total={stories.total} />
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6">

        {view === 'dashboard' && (
          <Dashboard
            digest={digest.digest}
            loading={digest.loading}
            error={digest.error}
            researchStories={researchStories.stories}
            researchLoading={researchStories.loading}
            researchError={researchStories.error}
            paperStories={paperStories.stories}
            paperLoading={paperStories.loading}
            paperError={paperStories.error}
            onSelectStory={setSelectedStoryId}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {view === 'favorites' && (
          <Favorites
            weeks={favorites.weeks}
            loading={favorites.loading}
            error={favorites.error}
            onSelectStory={setSelectedStoryId}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {view === 'settings' && <Settings />}

        {view === 'all' && (
          <>
            {stories.loading && (
              <div className="flex justify-center py-20">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {stories.error && (
              <div className="text-center py-20 text-red-400 text-sm">
                {stories.error} — läuft das Backend?{' '}
                <code className="text-xs bg-slate-800 px-1 rounded">./start.sh</code>
              </div>
            )}

            {!stories.loading && !stories.error && stories.stories.length === 0 && (
              <div className="text-center py-20 text-slate-500 text-sm">
                Keine Stories gefunden. Filter anpassen?
              </div>
            )}

            {!stories.loading && stories.stories.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {stories.stories.map(story => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    onSelect={setSelectedStoryId}
                    onToggleFavorite={handleToggleFavorite}
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
          </>
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
