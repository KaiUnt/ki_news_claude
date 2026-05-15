import { useState } from 'react'
import type { DigestTopStory, Story } from '../types'
import { TagBadge } from './TagBadge'
import { FavoriteButton } from './FavoriteButton'

interface Props {
  entry: DigestTopStory
  onSelect: (id: number) => void
  onToggleFavorite: (story: Story, next: boolean) => Promise<void>
}

export function TopStoryCard({ entry, onSelect, onToggleFavorite }: Props) {
  const { rank, why, story } = entry
  const [showWhy, setShowWhy] = useState(false)
  const headline = story.primary_title || story.title_de
  const laneLabel = story.story_kind === 'paper'
    ? 'Paper'
    : story.story_kind === 'research'
      ? 'Forschung'
      : null

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
      aria-label={`Story öffnen: ${headline}`}
      className="bg-slate-900 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-2.5 hover:border-slate-600 cursor-pointer transition-colors focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
    >
      <div className="flex items-start gap-3">
        <span
          className="shrink-0 w-7 h-7 rounded-full bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 text-xs font-semibold flex items-center justify-center"
          aria-label={`Rang ${rank}`}
        >
          {rank}
        </span>
        <h3 className="text-slate-100 font-semibold text-base leading-snug m-0 flex-1">
          {headline}
        </h3>
        <FavoriteButton
          isFavorite={story.is_favorite}
          onToggle={next => onToggleFavorite(story, next)}
        />
      </div>

      {story.summary_de && (
        <p className="text-slate-400 text-sm leading-relaxed m-0 line-clamp-3">
          {story.summary_de}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {laneLabel && (
          <span className="px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-[11px]">
            {laneLabel}
          </span>
        )}
        {story.has_primary_source && (
          <span className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-[11px]">
            Primarquelle
          </span>
        )}
        {story.has_broad_source && (
          <span className="px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[11px]">
            Breiter Feed
          </span>
        )}
        {story.tags.map(t => <TagBadge key={t} tag={t} />)}
      </div>

      {why && (
        <div className="pt-2 border-t border-slate-700/50 -mx-4 px-4">
          <button
            type="button"
            onClick={e => {
              e.stopPropagation()
              setShowWhy(v => !v)
            }}
            className="text-xs text-indigo-400/80 hover:text-indigo-300 transition-colors"
            aria-expanded={showWhy}
          >
            {showWhy ? 'Begründung ausblenden' : 'Warum heute relevant?'}
          </button>
          {showWhy && (
            <p className="text-xs text-slate-400 mt-2 leading-relaxed m-0 italic">
              {why}
            </p>
          )}
        </div>
      )}

      <div className="text-xs text-slate-500 flex items-center gap-1.5">
        <span>{story.source_count} {story.source_count === 1 ? 'Quelle' : 'Quellen'}</span>
        <span className="text-slate-600">·</span>
        <span className="text-indigo-400/70">Details ansehen →</span>
      </div>
    </article>
  )
}
