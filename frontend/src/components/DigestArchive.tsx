import type { DigestLatest, DigestSummary, Story } from '../types'
import { TopStoryCard } from './TopStoryCard'

interface Props {
  items: DigestSummary[]
  selectedId: number | null
  selected: DigestLatest | null
  listLoading: boolean
  detailLoading: boolean
  error: string | null
  onSelectDigest: (id: number) => void
  onSelectStory: (id: number) => void
  onToggleFavorite: (story: Story, next: boolean) => Promise<void>
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('de-AT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const fmt: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
  return `${start.toLocaleString('de-AT', fmt)} – ${end.toLocaleString('de-AT', fmt)}`
}

export function DigestArchive({
  items,
  selectedId,
  selected,
  listLoading,
  detailLoading,
  error,
  onSelectDigest,
  onSelectStory,
  onToggleFavorite,
}: Props) {
  if (listLoading && items.length === 0) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error && items.length === 0) {
    return <div className="text-center py-20 text-red-400 text-sm">{error}</div>
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-20 text-slate-500 text-sm">
        Noch keine Digests im Verlauf.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <aside className="bg-slate-900/40 border border-slate-800 rounded-2xl p-3 max-h-[calc(100vh-12rem)] overflow-y-auto">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500 px-2 py-2">
          {items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'}
        </div>
        <ul className="flex flex-col gap-1">
          {items.map(item => {
            const active = item.id === selectedId
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelectDigest(item.id)}
                  aria-current={active ? 'true' : undefined}
                  className={
                    'w-full text-left px-3 py-2.5 rounded-lg border transition-colors ' +
                    (active
                      ? 'bg-indigo-500/10 border-indigo-500/40 text-slate-100'
                      : 'border-transparent hover:bg-slate-800/60 hover:border-slate-700 text-slate-300')
                  }
                >
                  <div className="text-sm font-medium leading-snug">
                    {formatDate(item.generated_at)}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {item.top_story_count} {item.top_story_count === 1 ? 'Story' : 'Stories'}
                  </div>
                  {item.meta_summary_de && (
                    <div className="text-xs text-slate-400 mt-1.5 line-clamp-2 leading-snug">
                      {item.meta_summary_de}
                    </div>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <section className="min-w-0">
        {detailLoading && !selected ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : selected ? (
          <div className="flex flex-col gap-6">
            <header className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                <span>Digest vom {formatDate(selected.generated_at)}</span>
              </div>
              <div className="text-xs text-slate-500 mb-4">
                Zeitfenster: {formatWindow(selected.window_start, selected.window_end)}
              </div>
              {selected.meta_summary_de ? (
                <div className="text-slate-200 text-base leading-relaxed whitespace-pre-line">
                  {selected.meta_summary_de}
                </div>
              ) : (
                <div className="text-slate-500 text-sm italic">
                  Keine Zusammenfassung verfügbar.
                </div>
              )}
            </header>

            {selected.top_stories.length > 0 ? (
              <div>
                <h2 className="text-sm uppercase tracking-wider text-slate-500 font-medium mb-4">
                  Top-Stories
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {selected.top_stories.map(entry => (
                    <TopStoryCard
                      key={entry.story.id}
                      entry={entry}
                      onSelect={onSelectStory}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-slate-500 text-sm">
                Keine Top-Stories in diesem Digest.
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-20 text-slate-500 text-sm">
            Digest auswählen, um Details zu sehen.
          </div>
        )}
      </section>
    </div>
  )
}
