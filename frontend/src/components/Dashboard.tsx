import type { DigestLatest } from '../types'
import { TopStoryCard } from './TopStoryCard'

interface Props {
  digest: DigestLatest | null
  loading: boolean
  error: string | null
  onSelectStory: (id: number) => void
}

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString('de-AT', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function Dashboard({ digest, loading, error, onSelectStory }: Props) {
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20 text-red-400 text-sm">
        {error}
      </div>
    )
  }

  if (!digest) {
    return (
      <div className="text-center py-20 text-slate-500 text-sm max-w-md mx-auto">
        Noch kein Digest. Klicke oben auf <span className="text-slate-300">Aktualisieren</span>,
        um den ersten zu erzeugen — oder warte auf den nächsten Tageslauf.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span>Tageszusammenfassung</span>
          <span className="text-slate-700">·</span>
          <span>{formatGeneratedAt(digest.generated_at)}</span>
        </div>
        {digest.meta_summary_de ? (
          <div className="text-slate-200 text-base leading-relaxed whitespace-pre-line">
            {digest.meta_summary_de}
          </div>
        ) : (
          <div className="text-slate-500 text-sm italic">
            Keine Zusammenfassung verfügbar (Fallback-Modus). Top-Stories nach Quellen-Anzahl.
          </div>
        )}
      </section>

      {digest.top_stories.length > 0 ? (
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
              />
            ))}
          </div>
        </section>
      ) : (
        <div className="text-center py-10 text-slate-500 text-sm">
          Keine Top-Stories im aktuellen Digest.
        </div>
      )}
    </div>
  )
}
