import { useEffect, useState } from 'react'
import { fetchSources } from '../api'
import type { SourceConfig } from '../types'

function groupLabel(source: SourceConfig): string {
  if (source.story_kind === 'paper') return 'Papers'
  if (source.section === 'research') return 'Forschung'
  return 'Allgemein'
}

function scopeLabel(scope: SourceConfig['feed_scope']): string {
  return scope === 'broad' ? 'breiter Feed' : 'fokussierter Feed'
}

function ingestionLabel(mode: SourceConfig['ingestion_mode']): string {
  switch (mode) {
    case 'api':
      return 'API'
    case 'scrape':
      return 'Scrape'
    case 'hybrid':
      return 'Hybrid'
    default:
      return 'RSS'
  }
}

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

  const groups = ['Allgemein', 'Forschung', 'Papers'] as const

  return (
    <div className="flex flex-col gap-8">
      <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 sm:p-8">
        <h2 className="text-base font-semibold text-slate-100 m-0 mb-2">
          Quelleninventar
        </h2>
        <p className="text-sm text-slate-400 m-0 max-w-3xl">
          Hier siehst du, wie das System Quellen aktuell einordnet: Bereich, Ingestion-Modell,
          Feed-Scope und ob es sich um eine Primarquelle handelt. Das ist die Basis fuer
          spaetere RSS-, Scrape- und Hybrid-Entscheidungen.
        </p>
      </section>

      {groups.map(group => {
        const items = sources.filter(source => groupLabel(source) === group)
        if (items.length === 0) return null

        return (
          <section
            key={group}
            className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 sm:p-8"
          >
            <div className="flex items-center justify-between gap-4 mb-5">
              <h3 className="text-sm uppercase tracking-[0.18em] text-slate-500 font-medium m-0">
                {group}
              </h3>
              <span className="text-xs text-slate-500">
                {items.length} Quellen
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {items.map(source => (
                <article
                  key={source.name}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-slate-100 font-semibold text-sm m-0">
                        {source.name}
                      </h4>
                      <div className="text-xs text-slate-500 mt-1 break-all">
                        {source.url}
                      </div>
                    </div>
                    {source.is_primary_source && (
                      <span className="px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-[11px] whitespace-nowrap">
                        Primarquelle
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className="px-2 py-1 rounded-full border border-slate-700 bg-slate-800/70 text-slate-300">
                      {ingestionLabel(source.ingestion_mode)}
                    </span>
                    <span className="px-2 py-1 rounded-full border border-slate-700 bg-slate-800/70 text-slate-300">
                      {scopeLabel(source.feed_scope)}
                    </span>
                    <span className="px-2 py-1 rounded-full border border-slate-700 bg-slate-800/70 text-slate-300">
                      {source.category}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
