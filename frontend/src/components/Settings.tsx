import { useEffect, useState } from 'react'
import { fetchSources } from '../api'
import type { SourceConfig } from '../types'

export function Settings() {
  const [sources, setSources] = useState<SourceConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    queueMicrotask(() => {
      if (ac.signal.aborted) return
      setLoading(true)
      setError(null)
      fetchSources()
        .then(data => {
          if (!ac.signal.aborted) setSources(data)
        })
        .catch(() => {
          if (!ac.signal.aborted) setError('Quellen konnten nicht geladen werden.')
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false)
        })
    })

    return () => ac.abort()
  }, [])

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

  const paperSources = sources.filter(s => s.story_kind === 'paper')
  const generalSources = sources.filter(s => s.story_kind !== 'paper')

  return (
    <div className="flex flex-col gap-8">
      <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 sm:p-8">
        <h2 className="text-base font-semibold text-slate-100 m-0 mb-2">
          Quelleninventar
        </h2>
        <p className="text-sm text-slate-400 m-0 max-w-3xl">
          Aktive Feeds. Paper-Quellen (ArXiv, HuggingFace Daily Papers) werden gesondert
          behandelt: sie landen direkt im Paper-Stream und überspringen die inhaltliche
          Klassifizierung durch Claude.
        </p>
      </section>

      {[
        { title: 'Allgemein', items: generalSources },
        { title: 'Papers', items: paperSources },
      ].map(group => {
        if (group.items.length === 0) return null
        return (
          <section
            key={group.title}
            className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 sm:p-8"
          >
            <div className="flex items-center justify-between gap-4 mb-5">
              <h3 className="text-sm uppercase tracking-[0.18em] text-slate-500 font-medium m-0">
                {group.title}
              </h3>
              <span className="text-xs text-slate-500">
                {group.items.length} Quellen
              </span>
            </div>

            <ul className="flex flex-col gap-1 m-0 p-0 list-none">
              {group.items.map(source => (
                <li
                  key={source.name}
                  className="flex items-center justify-between gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-slate-800/40"
                >
                  <span className="text-slate-100 text-sm font-medium shrink-0">
                    {source.name}
                  </span>
                  <span className="text-slate-500 text-xs truncate text-right" title={source.url}>
                    {source.url}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
