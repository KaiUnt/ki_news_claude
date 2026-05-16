import type { DigestLatest, Story } from '../types'
import { TopStoryCard } from './TopStoryCard'
import { StoryCard } from './StoryCard'

interface Props {
  digest: DigestLatest | null
  loading: boolean
  error: string | null
  researchStories: Story[]
  researchLoading: boolean
  researchError: string | null
  paperStories: Story[]
  paperLoading: boolean
  paperError: string | null
  onSelectStory: (id: number) => void
  onToggleFavorite: (story: Story, next: boolean) => Promise<void>
}

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString('de-AT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Dashboard({
  digest,
  loading,
  error,
  researchStories,
  researchLoading,
  researchError,
  paperStories,
  paperLoading,
  paperError,
  onSelectStory,
  onToggleFavorite,
}: Props) {
  const topStoryIds = new Set((digest?.top_stories ?? []).map(entry => entry.story.id))
  const visibleResearchStories = researchStories.filter(story => !topStoryIds.has(story.id))
  const visiblePaperStories = paperStories.filter(story => !topStoryIds.has(story.id))

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 sm:p-8">
        {digest ? (
          <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span>Tageszusammenfassung</span>
            <span className="text-slate-700">·</span>
            <span>{formatGeneratedAt(digest.generated_at)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span>Dashboard-Status</span>
          </div>
        )}

        {error ? (
          <div className="text-red-400 text-sm">
            {error}
          </div>
        ) : digest?.meta_summary_de ? (
          <div className="text-slate-200 text-base leading-relaxed whitespace-pre-line">
            {digest.meta_summary_de}
          </div>
        ) : digest ? (
          <div className="text-slate-500 text-sm italic">
            Keine Zusammenfassung verfügbar. Der Digest läuft im Fallback-Modus.
          </div>
        ) : (
          <div className="text-slate-500 text-sm max-w-md">
            Noch kein Digest. Klicke oben auf <span className="text-slate-300">Aktualisieren</span>,
            um den ersten zu erzeugen oder warte auf den nächsten Tageslauf.
          </div>
        )}
      </section>

      {digest && digest.top_stories.length > 0 ? (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-slate-500 font-medium mb-4">
            Top-Stories
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {digest.top_stories.map(entry => (
              <TopStoryCard
                key={entry.story.id}
                entry={entry}
                onSelect={onSelectStory}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        </section>
      ) : digest ? (
        <div className="text-center py-10 text-slate-500 text-sm">
          Keine Top-Stories im aktuellen Digest.
        </div>
      ) : null}

      <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-5 text-xs text-slate-500 uppercase tracking-[0.18em]">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          <span>Forschung & Papers</span>
        </div>

        <div className="flex flex-col gap-8">
          <div>
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-base font-semibold text-slate-100 m-0">
                Forschungs-News
              </h2>
              <span className="text-xs text-slate-500">
                Stories die inhaltlich als Forschung klassifiziert wurden
              </span>
            </div>

            {researchLoading && visibleResearchStories.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : researchError && visibleResearchStories.length === 0 ? (
              <div className="text-sm text-red-400">
                {researchError}
              </div>
            ) : visibleResearchStories.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {visibleResearchStories.map(story => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    onSelect={onSelectStory}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Noch keine separaten Forschungs-News verfügbar.
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-base font-semibold text-slate-100 m-0">
                Paper-Stream
              </h2>
              <span className="text-xs text-slate-500">
                Stories aus reinen Paper-Quellen (ArXiv, HuggingFace Daily Papers)
              </span>
            </div>

            {paperLoading && visiblePaperStories.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : paperError && visiblePaperStories.length === 0 ? (
              <div className="text-sm text-red-400">
                {paperError}
              </div>
            ) : visiblePaperStories.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {visiblePaperStories.map(story => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    onSelect={onSelectStory}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Noch keine separaten Paper-Stories verfügbar.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
