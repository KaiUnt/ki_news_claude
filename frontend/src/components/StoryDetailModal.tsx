import { useEffect, useState } from 'react'
import { fetchStoryDetail } from '../api'
import type { StoryDetail } from '../types'
import { TagBadge } from './TagBadge'

interface Props {
  storyId: number
  onClose: () => void
}

function sourceIcon(type: string) {
  return type === 'hackernews' ? '🔶' : '📰'
}

export function StoryDetailModal({ storyId, onClose }: Props) {
  const [detail, setDetail]   = useState<StoryDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setLoading(true)
      setError(null)
      setDetail(null)
      fetchStoryDetail(storyId)
        .then(data => {
          if (active) setDetail(data)
        })
        .catch(() => {
          if (active) setError('Fehler beim Laden der Story')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    })
    return () => {
      active = false
    }
  }, [storyId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-8 px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full shadow-2xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-detail-title"
      >
        {loading && (
          <div className="p-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="p-8 flex flex-col items-center gap-4">
            <p className="text-red-400 text-sm m-0">{error}</p>
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Schließen
            </button>
          </div>
        )}

        {detail && (
          <div className="p-6 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.map(t => <TagBadge key={t} tag={t} />)}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Schließen"
                className="shrink-0 w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center text-lg"
              >
                ✕
              </button>
            </div>

            <h2
              id="story-detail-title"
              className="text-xl font-bold text-slate-100 m-0 leading-snug"
            >
              {detail.primary_title || detail.title_de}
            </h2>

            {detail.summary_de && (
              <p className="text-slate-300 text-sm leading-relaxed m-0">
                {detail.summary_de}
              </p>
            )}

            <div className="border-t border-slate-800 pt-4 flex flex-col gap-2">
              <h3 className="text-xs uppercase tracking-wider text-slate-500 m-0 font-medium">
                Quellen ({detail.sources.length})
              </h3>
              <ul className="flex flex-col gap-0.5 m-0 p-0 list-none">
                {detail.sources.map(src => (
                  <li key={src.id}>
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-2 p-2 -mx-2 rounded-lg hover:bg-slate-800/60 transition-colors"
                    >
                      <span className="text-base shrink-0">{sourceIcon(src.source_type)}</span>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="text-indigo-400 group-hover:text-indigo-300 truncate text-sm font-medium">
                          {src.source_name}
                        </span>
                        <span className="text-slate-500 text-xs truncate" title={src.title}>
                          {src.title}
                        </span>
                      </div>
                      {src.published_at && (
                        <span className="text-slate-600 text-xs shrink-0">
                          {new Date(src.published_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })}
                        </span>
                      )}
                      <span className="shrink-0 opacity-40 group-hover:opacity-80 transition-opacity">↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
