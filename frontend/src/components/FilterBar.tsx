import { useEffect, useRef, useState } from 'react'
import { fetchTags, fetchSources } from '../api'
import type { Filters, SortOrder, SourceConfig } from '../types'
import { TagBadge } from './TagBadge'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  total: number
}

export function FilterBar({ filters, onChange, total }: Props) {
  const [availableTags, setAvailableTags]       = useState<string[]>([])
  const [availableSources, setAvailableSources] = useState<SourceConfig[]>([])
  const [sourcesOpen, setSourcesOpen]           = useState(false)
  const searchTimer                             = useRef<ReturnType<typeof setTimeout>>()
  const [searchDraft, setSearchDraft]           = useState(filters.search)
  const sourcesRef                              = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchTags().then(setAvailableTags).catch(() => {})
    fetchSources().then(setAvailableSources).catch(() => {})
  }, [])

  // Close sources dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (sourcesRef.current && !sourcesRef.current.contains(e.target as Node)) {
        setSourcesOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value })
  }

  function toggleTag(tag: string) {
    const next = filters.tags.includes(tag)
      ? filters.tags.filter(t => t !== tag)
      : [...filters.tags, tag]
    setFilter('tags', next)
  }

  function toggleSource(name: string) {
    const next = filters.sources.includes(name)
      ? filters.sources.filter(s => s !== name)
      : [...filters.sources, name]
    setFilter('sources', next)
  }

  function handleSearch(val: string) {
    setSearchDraft(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setFilter('search', val), 400)
  }

  function clearAll() {
    setSearchDraft('')
    onChange({ tags: [], sources: [], dateFrom: '', dateTo: '', search: '', sort: 'date_desc' })
  }

  const hasFilters = filters.tags.length > 0 || filters.sources.length > 0
    || filters.dateFrom || filters.dateTo || filters.search

  return (
    <div className="sticky top-0 z-20 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex flex-col gap-3">

      {/* Row 1: Search + Sort + Clear */}
      <div className="flex gap-2 items-center">
        <input
          type="search"
          placeholder="Suche in Titeln und Summaries…"
          value={searchDraft}
          onChange={e => handleSearch(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />

        {/* Sort */}
        <select
          value={filters.sort}
          onChange={e => setFilter('sort', e.target.value as SortOrder)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          <option value="date_desc">Neueste zuerst</option>
          <option value="date_asc">Älteste zuerst</option>
        </select>

        {hasFilters && (
          <button
            onClick={clearAll}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors whitespace-nowrap"
          >
            Filter löschen
          </button>
        )}

        <span className="text-slate-600 text-xs whitespace-nowrap">
          {total} Stories
        </span>
      </div>

      {/* Row 2: Tags + Date + Sources */}
      <div className="flex flex-wrap gap-2 items-center">

        {/* Tag chips */}
        {availableTags.map(tag => (
          <TagBadge
            key={tag}
            tag={tag}
            active={filters.tags.includes(tag)}
            onClick={() => toggleTag(tag)}
          />
        ))}

        <div className="w-px h-4 bg-slate-700 mx-1" />

        {/* Date from */}
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => setFilter('dateFrom', e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
          title="Von Datum"
        />
        <span className="text-slate-600 text-xs">–</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => setFilter('dateTo', e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
          title="Bis Datum"
        />

        <div className="w-px h-4 bg-slate-700 mx-1" />

        {/* Sources dropdown */}
        <div className="relative" ref={sourcesRef}>
          <button
            onClick={() => setSourcesOpen(o => !o)}
            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${
              filters.sources.length > 0
                ? 'bg-indigo-950 border-indigo-700 text-indigo-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            Quellen {filters.sources.length > 0 && `(${filters.sources.length})`} ▾
          </button>

          {sourcesOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-30 py-1 max-h-72 overflow-y-auto">
              {availableSources.map(src => (
                <label
                  key={src.name}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700/50 cursor-pointer text-xs text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={filters.sources.includes(src.name)}
                    onChange={() => toggleSource(src.name)}
                    className="accent-indigo-500"
                  />
                  {src.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
