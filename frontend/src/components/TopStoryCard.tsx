import { useState } from 'react'
import type { DigestTopStory } from '../types'
import { TagBadge } from './TagBadge'

interface Props {
  entry: DigestTopStory
  onSelect: (id: number) => void
}

export function TopStoryCard({ entry, onSelect }: Props) {
  const { rank, why, story } = entry
  const [showWhy, setShowWhy] = useState(false)
  const headline = story.primary_title || story.title_de

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
      </div>

      {story.summary_de && (
        <p className="text-slate-400 text-sm leading-relaxed m-0 line-clamp-3">
          {story.summary_de}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
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
