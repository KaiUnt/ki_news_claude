import { useEffect, useRef, useState } from 'react'
import { fetchTagSchema, fetchSources } from '../api'
import type { Filters, SortOrder, SourceConfig } from '../types'
import type { TagSchema, TagAxis } from '../tagSchema'
import { EMPTY_SCHEMA, buildTag, tagLabel } from '../tagSchema'
import { TagBadge } from './TagBadge'

function isoLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function mondayOf(d: Date): Date {
  const r = new Date(d)
  const day = r.getDay()
  const diff = day === 0 ? 6 : day - 1
  r.setDate(r.getDate() - diff)
  return r
}

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  total: number
}

interface AxisConfig {
  axis: TagAxis
  label: string
  ids: string[]
}

export function FilterBar({ filters, onChange, total }: Props) {
  const [schema, setSchema]                     = useState<TagSchema>(EMPTY_SCHEMA)
  const [availableSources, setAvailableSources] = useState<SourceConfig[]>([])
  const [sourcesOpen, setSourcesOpen]           = useState(false)
  const [excludeOpen, setExcludeOpen]           = useState(false)
  const searchTimer                             = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [searchDraft, setSearchDraft]           = useState(filters.search)
  const sourcesRef                              = useRef<HTMLDivElement>(null)
  const excludeRef                              = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchTagSchema().then(setSchema).catch(() => {})
    fetchSources().then(setAvailableSources).catch(() => {})
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (sourcesRef.current && !sourcesRef.current.contains(e.target as Node)) {
        setSourcesOpen(false)
      }
      if (excludeRef.current && !excludeRef.current.contains(e.target as Node)) {
        setExcludeOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
  }, [])

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value })
  }

  function toggleTag(tag: string) {
    const next = filters.tags.includes(tag)
      ? filters.tags.filter(t => t !== tag)
      : [...filters.tags, tag]
    onChange({
      ...filters,
      tags: next,
      excludeTags: filters.excludeTags.filter(t => t !== tag),
    })
  }

  function toggleExcludeTag(tag: string) {
    const next = filters.excludeTags.includes(tag)
      ? filters.excludeTags.filter(t => t !== tag)
      : [...filters.excludeTags, tag]
    onChange({
      ...filters,
      tags: filters.tags.filter(t => t !== tag),
      excludeTags: next,
    })
  }

  function toggleSource(name: string) {
    const next = filters.sources.includes(name)
      ? filters.sources.filter(s => s !== name)
      : [...filters.sources, name]
    setFilter('sources', next)
  }

  function handleSearch(val: string) {
    setSearchDraft(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setFilter('search', val), 400)
  }

  function clearAll() {
    setSearchDraft('')
    onChange({
      tags: [],
      excludeTags: [],
      sources: [],
      dateFrom: '',
      dateTo: '',
      search: '',
      sort: 'date_desc',
    })
  }

  const today  = isoLocalDate(new Date())
  const monday = isoLocalDate(mondayOf(new Date()))
  const isToday = filters.dateFrom === today  && filters.dateTo === today
  const isWeek  = filters.dateFrom === monday && filters.dateTo === today

  function toggleToday() {
    if (isToday) onChange({ ...filters, dateFrom: '', dateTo: '' })
    else         onChange({ ...filters, dateFrom: today, dateTo: today })
  }

  function toggleWeek() {
    if (isWeek) onChange({ ...filters, dateFrom: '', dateTo: '' })
    else        onChange({ ...filters, dateFrom: monday, dateTo: today })
  }

  const hasFilters = filters.tags.length > 0 || filters.excludeTags.length > 0 || filters.sources.length > 0
    || filters.dateFrom || filters.dateTo || filters.search

  const quickActiveClass   = 'bg-indigo-950 border-indigo-700 text-indigo-300'
  const quickInactiveClass = 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'

  const axes: AxisConfig[] = [
    { axis: 'type',   label: 'Typ',     ids: schema.types   },
    { axis: 'domain', label: 'Domain',  ids: schema.domains },
    { axis: 'flag',   label: 'Flags',   ids: schema.flags   },
  ]

  return (
    <div className="sticky top-0 z-20 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex flex-col gap-2.5">

      {/* Row 1: Search + Sort + Clear + Total */}
      <div className="flex gap-2 items-center">
        <input
          type="search"
          placeholder="Suche in Titeln und Summaries…"
          value={searchDraft}
          onChange={e => handleSearch(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />

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
            type="button"
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

      {/* Rows 2–4: Tag axes (Typ / Domain / Flags) */}
      {axes.map(({ axis, label, ids }) => (
        <div key={axis} className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium w-14 shrink-0">
            {label}
          </span>
          {ids.map(id => {
            const tag = buildTag(axis, id)
            return (
              <TagBadge
                key={tag}
                tag={tag}
                active={filters.tags.includes(tag)}
                onClick={() => toggleTag(tag)}
              />
            )
          })}
        </div>
      ))}

      {/* Row 5: Ausblenden + Quick + Dates + Sources */}
      <div className="flex flex-wrap gap-2 items-center pt-1">

        <div className="relative" ref={excludeRef}>
          <button
            type="button"
            onClick={() => setExcludeOpen(o => !o)}
            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${
              filters.excludeTags.length > 0
                ? 'bg-rose-950 border-rose-700 text-rose-300'
                : quickInactiveClass
            }`}
          >
            Ausblenden {filters.excludeTags.length > 0 && `(${filters.excludeTags.length})`} ▾
          </button>

          {excludeOpen && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-30 py-1 max-h-80 overflow-y-auto">
              {axes.map(({ axis, label, ids }) => (
                <div key={axis} className="py-1">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-500 font-medium border-b border-slate-700/50">
                    {label}
                  </div>
                  {ids.map(id => {
                    const tag = buildTag(axis, id)
                    return (
                      <label
                        key={tag}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700/50 cursor-pointer text-xs text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={filters.excludeTags.includes(tag)}
                          onChange={() => toggleExcludeTag(tag)}
                          className="accent-rose-500"
                        />
                        {tagLabel(tag)}
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-slate-700 mx-1" />

        <button
          type="button"
          onClick={toggleToday}
          aria-pressed={isToday}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${isToday ? quickActiveClass : quickInactiveClass}`}
        >
          Heute
        </button>
        <button
          type="button"
          onClick={toggleWeek}
          aria-pressed={isWeek}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${isWeek ? quickActiveClass : quickInactiveClass}`}
        >
          Diese Woche
        </button>

        <div className="w-px h-4 bg-slate-700 mx-1" />

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

        <div className="relative" ref={sourcesRef}>
          <button
            type="button"
            onClick={() => setSourcesOpen(o => !o)}
            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${
              filters.sources.length > 0 ? quickActiveClass : quickInactiveClass
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
