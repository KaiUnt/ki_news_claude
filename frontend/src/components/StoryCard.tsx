import { useState } from 'react'
import { fetchStoryDetail } from '../api'
import type { Story, Source } from '../types'
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

function sourceIcon(type: string) {
  if (type === 'hackernews') return '🔶'
  return '📰'
}

interface Props {
  story: Story
}

export function StoryCard({ story }: Props) {
  const [open, setOpen]       = useState(false)
  const [sources, setSources] = useState<Source[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (!open && sources === null) {
      setLoading(true)
      try {
        const detail = await fetchStoryDetail(story.id)
        setSources(detail.sources)
      } catch {
        setSources([])
      } finally {
        setLoading(false)
      }
    }
    setOpen(o => !o)
  }

  return (
    <div className="bg-slate-900 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-3 hover:border-slate-600 transition-colors">

      {/* Tags + timestamp */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {story.tags.map(t => <TagBadge key={t} tag={t} />)}
        </div>
        <span className="text-slate-500 text-xs whitespace-nowrap shrink-0 mt-0.5">
          {relativeTime(story.last_updated)}
        </span>
      </div>

      {/* Title */}
      <h2 className="text-slate-100 font-semibold text-base leading-snug m-0">
        {story.title_de}
      </h2>

      {/* Summary */}
      {story.summary_de && (
        <p className="text-slate-400 text-sm leading-relaxed m-0 line-clamp-3">
          {story.summary_de}
        </p>
      )}

      {/* Sources toggle */}
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-400 transition-colors mt-auto pt-1 border-t border-slate-700/50 -mx-4 px-4 text-left"
      >
        <span className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
        <span>
          {loading ? 'Lade…' : `${story.source_count} ${story.source_count === 1 ? 'Quelle' : 'Quellen'}`}
        </span>
      </button>

      {/* Sources list */}
      {open && sources && (
        <ul className="flex flex-col gap-1 -mt-1">
          {sources.map(src => (
            <li key={src.id} className="flex items-center gap-2 text-xs">
              <span className="text-base leading-none">{sourceIcon(src.source_type)}</span>
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 hover:underline truncate flex-1 min-w-0"
                title={src.title}
              >
                {src.source_name}
              </a>
              {src.published_at && (
                <span className="text-slate-600 shrink-0">
                  {new Date(src.published_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
