import type { Story } from '../types'
import { TagBadge } from './TagBadge'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (h < 1)  return 'vor wenigen Minuten'
  if (h < 24) return `vor ${h}h`
  if (d < 7)  return `vor ${d}d`
  return new Date(iso).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })
}

interface Props {
  story: Story
  onSelect: (id: number) => void
}

export function StoryCard({ story, onSelect }: Props) {
  return (
    <article
      onClick={() => onSelect(story.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(story.id)
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Story öffnen: ${story.title_de}`}
      className="bg-slate-900 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-3 hover:border-slate-600 cursor-pointer transition-colors focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {story.tags.map(t => <TagBadge key={t} tag={t} />)}
        </div>
        <span className="text-slate-500 text-xs whitespace-nowrap shrink-0 mt-0.5">
          {relativeTime(story.last_updated)}
        </span>
      </div>

      <h2 className="text-slate-100 font-semibold text-base leading-snug m-0">
        {story.title_de}
      </h2>

      {story.summary_de && (
        <p className="text-slate-400 text-sm leading-relaxed m-0 line-clamp-3">
          {story.summary_de}
        </p>
      )}

      <div className="text-xs text-slate-500 mt-auto pt-2 border-t border-slate-700/50 -mx-4 px-4 flex items-center gap-1.5">
        <span>{story.source_count} {story.source_count === 1 ? 'Quelle' : 'Quellen'}</span>
        <span className="text-slate-600">·</span>
        <span className="text-indigo-400/70">Details ansehen →</span>
      </div>
    </article>
  )
}
