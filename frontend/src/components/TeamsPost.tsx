import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { FavoriteWeek, Story, Source, Filters } from '../types'
import { fetchFavorites, fetchStories, fetchStoryDetail } from '../api'
import { FilterBar } from './FilterBar'
import { StoryCard } from './StoryCard'
import { StoryDetailModal } from './StoryDetailModal'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type ContentBlock =
  | { kind: 'story'; storyId: number }
  | { kind: 'heading'; id: string; content: string }
  | { kind: 'text'; id: string; content: string }

const DEFAULT_FILTERS: Filters = {
  tags: [], excludeTags: [], sources: [],
  dateFrom: '', dateTo: '', search: '', sort: 'date_desc',
}

function makeId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function blockId(block: ContentBlock): string {
  return block.kind === 'story' ? `story-${block.storyId}` : block.id
}

function SortableBlockWrapper({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-1 ${isDragging ? 'opacity-40' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        tabIndex={-1}
        title="Verschieben"
        className="mt-3 px-0.5 text-slate-700 hover:text-slate-400 cursor-grab active:cursor-grabbing touch-none select-none"
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="2.5" r="1.5"/><circle cx="7" cy="2.5" r="1.5"/>
          <circle cx="3" cy="8"   r="1.5"/><circle cx="7" cy="8"   r="1.5"/>
          <circle cx="3" cy="13.5" r="1.5"/><circle cx="7" cy="13.5" r="1.5"/>
        </svg>
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SelectableStoryCard({
  story, isSelected, onToggle, onOpenDetail,
}: {
  story: Story; isSelected: boolean; onToggle: () => void; onOpenDetail: (id: number) => void
}) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onToggle() }}
        className={`absolute top-3 left-3 z-20 w-5 h-5 rounded border-2 flex items-center justify-center transition-all
          ${isSelected
            ? 'bg-indigo-500 border-indigo-500'
            : 'bg-slate-950/80 border-slate-600 group-hover:border-indigo-400'}`}
      >
        {isSelected && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      <div className={isSelected ? 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-slate-900 rounded-xl' : ''}>
        <StoryCard story={story} onSelect={onOpenDetail} onToggleFavorite={async () => {}} />
      </div>
    </div>
  )
}

function InsertBlockButtons({
  onInsertHeading, onInsertText,
}: { onInsertHeading: () => void; onInsertText: () => void }) {
  return (
    <div className="flex justify-center gap-2 py-1">
      <button
        type="button"
        onClick={onInsertHeading}
        className="text-xs text-slate-600 hover:text-teal-400 hover:bg-slate-800 px-2.5 py-0.5 rounded transition-colors"
      >
        + Überschrift
      </button>
      <button
        type="button"
        onClick={onInsertText}
        className="text-xs text-slate-600 hover:text-indigo-400 hover:bg-slate-800 px-2.5 py-0.5 rounded transition-colors"
      >
        + Textabschnitt
      </button>
    </div>
  )
}

function BlockControls({
  index, total, onMoveUp, onMoveDown, onRemove,
}: { index: number; total: number; onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button type="button" onClick={onMoveUp} disabled={index === 0}
        title="Nach oben"
        className="text-slate-600 hover:text-slate-300 disabled:opacity-20 px-1 py-0.5 text-xs leading-none rounded hover:bg-slate-700 transition-colors">↑</button>
      <button type="button" onClick={onMoveDown} disabled={index === total - 1}
        title="Nach unten"
        className="text-slate-600 hover:text-slate-300 disabled:opacity-20 px-1 py-0.5 text-xs leading-none rounded hover:bg-slate-700 transition-colors">↓</button>
      <button type="button" onClick={onRemove}
        title="Entfernen"
        className="text-slate-600 hover:text-red-400 px-1 py-0.5 text-xs leading-none rounded hover:bg-slate-700 transition-colors ml-0.5">×</button>
    </div>
  )
}

function StoryBlock({
  block, index, total, story, sources, isLoadingSources, selectedUrl,
  onSelectUrl, onMoveUp, onMoveDown, onRemove,
}: {
  block: { kind: 'story'; storyId: number }
  index: number
  total: number
  story?: Story
  sources?: Source[]
  isLoadingSources: boolean
  selectedUrl?: string
  onSelectUrl: (url: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const title = story?.primary_title || story?.title_de || `Story #${block.storyId}`
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-amber-400 text-xs mt-0.5 shrink-0">📌</span>
        <p className="flex-1 text-sm text-slate-200 font-bold leading-snug line-clamp-2">{title}</p>
        <BlockControls index={index} total={total} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
      </div>
      {/* Summary */}
      {story?.summary_de && (
        <p className="text-xs text-slate-400 leading-relaxed line-clamp-3 pl-5 italic">{story.summary_de}</p>
      )}
      {/* URL selector */}
      {isLoadingSources ? (
        <div className="flex items-center gap-2 pl-5">
          <div className="w-3 h-3 border border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-500">Quellen werden geladen…</span>
        </div>
      ) : sources && sources.length > 0 ? (
        <select
          value={selectedUrl ?? ''}
          onChange={e => onSelectUrl(e.target.value)}
          className="w-full text-xs bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          {sources.map(src => (
            <option key={src.url} value={src.url}>
              {src.source_name} — {src.url.length > 55 ? src.url.slice(0, 55) + '…' : src.url}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-slate-600 pl-5 truncate">
          {selectedUrl ?? story?.primary_url ?? 'Kein Link verfügbar'}
        </p>
      )}
    </div>
  )
}

function HeadingBlock({
  block, index, total,
  onUpdateText, onMoveUp, onMoveDown, onRemove,
}: {
  block: { kind: 'heading'; id: string; content: string }
  index: number
  total: number
  onUpdateText: (content: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  return (
    <div className="bg-teal-900/20 border border-teal-700/40 rounded-lg p-2.5 flex items-center gap-2">
      <span className="text-teal-500 text-xs shrink-0">H</span>
      <input
        type="text"
        value={block.content}
        onChange={e => onUpdateText(e.target.value)}
        placeholder="Überschrift…"
        className="flex-1 text-xl font-bold bg-transparent text-slate-100 placeholder:text-slate-600 focus:outline-none"
      />
      <BlockControls index={index} total={total} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
    </div>
  )
}

function TextBlock({
  block, index, total,
  onUpdateText, onMoveUp, onMoveDown, onRemove,
}: {
  block: { kind: 'text'; id: string; content: string }
  index: number
  total: number
  onUpdateText: (content: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  return (
    <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-lg p-2.5 flex items-start gap-2">
      <textarea
        value={block.content}
        onChange={e => onUpdateText(e.target.value)}
        rows={2}
        placeholder="Eigener Textabschnitt…"
        className="flex-1 text-sm bg-transparent text-slate-200 placeholder:text-slate-600 focus:outline-none resize-none"
      />
      <BlockControls index={index} total={total} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TeamsPost() {
  const [blocks, setBlocks] = useState<ContentBlock[]>([])
  const [storyMap, setStoryMap] = useState<Map<number, Story>>(new Map())
  const [selectedUrls, setSelectedUrls] = useState<Map<number, string>>(new Map())
  const [storySourcesMap, setStorySourcesMap] = useState<Map<number, Source[]>>(new Map())
  const [loadingSources, setLoadingSources] = useState<Set<number>>(new Set())

  const [weeks, setWeeks] = useState<FavoriteWeek[]>([])
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set())
  const [favLoading, setFavLoading] = useState(true)
  const [favError, setFavError] = useState<string | null>(null)

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [detailStoryId, setDetailStoryId] = useState<number | null>(null)

  const [moreOpen, setMoreOpen] = useState(false)
  const [moreStories, setMoreStories] = useState<Story[]>([])
  const [moreTotal, setMoreTotal] = useState(0)
  const [moreLoading, setMoreLoading] = useState(false)

  const [header, setHeader] = useState('Hallo Kollegen,\n\nhier wieder die brandaktuellen News zum Thema KI:')
  const [footer, setFooter] = useState('Viel Spaß beim Lesen! 🤖')
  const [headerOpen, setHeaderOpen] = useState(false)
  const [footerOpen, setFooterOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Load favorites on mount
  useEffect(() => {
    fetchFavorites()
      .then(data => {
        setWeeks(data.weeks)
        // Open only the most recent (first) week by default
        if (data.weeks.length > 0) {
          setOpenWeeks(new Set([data.weeks[0].week_start]))
        }
        const map = new Map<number, Story>()
        data.weeks.forEach((w: FavoriteWeek) => w.items.forEach(item => map.set(item.story.id, item.story)))
        setStoryMap(map)
      })
      .catch(() => setFavError('Fehler beim Laden der Favoriten'))
      .finally(() => setFavLoading(false))
  }, [])

  // Load "Weitere Artikel" with debounce, using shared filters
  useEffect(() => {
    if (!moreOpen) return
    setMoreLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetchStories(filters, 0, 40, controller.signal)
        .then(data => {
          setMoreStories(data.items.filter(s => !s.is_favorite))
          setMoreTotal(data.total)
          setStoryMap(prev => {
            const next = new Map(prev)
            data.items.forEach(s => next.set(s.id, s))
            return next
          })
        })
        .catch(() => {})
        .finally(() => setMoreLoading(false))
    }, 400)
    return () => { clearTimeout(timer); controller.abort() }
  }, [moreOpen, filters.search, filters.tags.join(','), filters.sort, filters.dateFrom, filters.dateTo, filters.sources.join(',')])

  const filteredWeeks = useMemo(() => {
    const s = filters.search.toLowerCase()
    const tags = filters.tags
    if (!s && !tags.length) return weeks
    return weeks.map(week => ({
      ...week,
      items: week.items.filter(({ story }) => {
        if (s && ![story.title_de, story.primary_title ?? '', story.summary_de ?? ''].join(' ').toLowerCase().includes(s)) return false
        if (tags.length && !tags.some(t => story.tags.includes(t))) return false
        return true
      }),
    })).filter(week => week.items.length > 0)
  }, [weeks, filters.search, filters.tags])

  const selectedStoryIds = blocks
    .filter((b): b is { kind: 'story'; storyId: number } => b.kind === 'story')
    .map(b => b.storyId)

  const toggleStory = useCallback(async (id: number, story: Story) => {
    const isSelected = blocks.some(b => b.kind === 'story' && b.storyId === id)
    if (isSelected) {
      setBlocks(prev => prev.filter(b => !(b.kind === 'story' && b.storyId === id)))
      return
    }

    setStoryMap(prev => prev.has(id) ? prev : new Map(prev).set(id, story))
    setBlocks(prev => [...prev, { kind: 'story', storyId: id }])

    if (!storySourcesMap.has(id)) {
      setLoadingSources(prev => new Set(prev).add(id))
      try {
        const detail = await fetchStoryDetail(id)
        setStorySourcesMap(prev => new Map(prev).set(id, detail.sources))
        const defaultUrl = story.primary_url ?? detail.sources[0]?.url
        if (defaultUrl) {
          setSelectedUrls(prev => prev.has(id) ? prev : new Map(prev).set(id, defaultUrl))
        }
      } catch { /* ignore */ } finally {
        setLoadingSources(prev => { const next = new Set(prev); next.delete(id); return next })
      }
    }
  }, [blocks, storySourcesMap])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setBlocks(prev => {
        const ids = prev.map(blockId)
        const oldIndex = ids.indexOf(String(active.id))
        const newIndex = ids.indexOf(String(over.id))
        return oldIndex !== -1 && newIndex !== -1 ? arrayMove(prev, oldIndex, newIndex) : prev
      })
    }
  }

  const moveBlock = (index: number, direction: -1 | 1) => {
    setBlocks(prev => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const removeBlock = (index: number) => setBlocks(prev => prev.filter((_, i) => i !== index))

  // afterIndex === -1 inserts at position 0
  const addBlock = (afterIndex: number, kind: 'heading' | 'text') => {
    setBlocks(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, { kind, id: makeId(), content: '' })
      return next
    })
  }

  const updateContentBlock = (id: string, content: string) =>
    setBlocks(prev => prev.map(b =>
      (b.kind === 'text' || b.kind === 'heading') && b.id === id ? { ...b, content } : b
    ))

  const toggleWeek = (weekStart: string) => {
    setOpenWeeks(prev => {
      const next = new Set(prev)
      if (next.has(weekStart)) next.delete(weekStart)
      else next.add(weekStart)
      return next
    })
  }

  function esc(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function buildTeamsHtml(): string {
    // Teams strips CSS margins — use explicit <br> for spacing.
    // Rule: blank line between blocks UNLESS the previous block was a heading.
    let html = `<p>${esc(header).replace(/\n/g, '<br>')}</p>`
    let prevKind = 'header'

    for (const block of blocks) {
      let section = ''
      if (block.kind === 'story') {
        const story = storyMap.get(block.storyId)
        if (!story) continue
        const title = story.primary_title || story.title_de
        const summary = story.summary_de
        const url = selectedUrls.get(block.storyId) ?? story.primary_url ?? ''
        let inner = `<strong>📌 ${esc(title)}</strong>`
        if (summary) inner += `<br><em>${esc(summary)}</em>`
        if (url) inner += `<br>🔗 ${esc(url)}`
        section = `<p>${inner}</p>`
      } else if (block.kind === 'heading' && block.content.trim()) {
        section = `<p><strong><span style="font-size:1.3em">${esc(block.content)}</span></strong></p>`
      } else if (block.kind === 'text' && block.content.trim()) {
        section = `<p>${esc(block.content).replace(/\n/g, '<br>')}</p>`
      }
      if (section) {
        html += (prevKind === 'heading' ? '' : '<br>') + section
        prevKind = block.kind
      }
    }
    html += (prevKind === 'heading' ? '' : '<br>') + `<p>${esc(footer).replace(/\n/g, '<br>')}</p>`
    return `<html><body>${html}</body></html>`
  }

  function buildTeamsText(): string {
    const parts: string[] = [header]
    for (const block of blocks) {
      if (block.kind === 'story') {
        const story = storyMap.get(block.storyId)
        if (!story) continue
        const title = story.primary_title || story.title_de
        const summary = story.summary_de ?? ''
        const url = selectedUrls.get(block.storyId) ?? story.primary_url ?? ''
        let entry = `📌 ${title}`
        if (summary) entry += `\n${summary}`
        if (url) entry += `\n🔗 ${url}`
        parts.push(entry)
      } else if (block.content.trim()) {
        parts.push(block.content)
      }
    }
    parts.push(footer)
    return parts.join('\n\n')
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([buildTeamsHtml()], { type: 'text/html' }),
          'text/plain': new Blob([buildTeamsText()], { type: 'text/plain' }),
        }),
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: plain text only
      try {
        await navigator.clipboard.writeText(buildTeamsText())
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex gap-6 h-[calc(100vh-9rem)] min-h-0">
      {/* Left: Article selector */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Shared FilterBar */}
        <div className="shrink-0">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            total={filteredWeeks.reduce((n, w) => n + w.items.length, 0)}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-6 pb-4 mt-2">
          {/* Favoriten */}
          <section>
            <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <span className="text-amber-400">★</span> Favoriten
            </h2>
            {favLoading && (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {favError && <p className="text-xs text-red-400 px-1">{favError}</p>}
            {!favLoading && !favError && filteredWeeks.length === 0 && (
              <p className="text-xs text-slate-500 px-1">
                {weeks.length === 0 ? 'Noch keine Favoriten vorhanden.' : 'Kein Favorit passt zum Filter.'}
              </p>
            )}
            {filteredWeeks.map(week => {
              const isOpen = openWeeks.has(week.week_start)
              return (
                <div key={week.week_start} className="mb-4">
                  <button
                    type="button"
                    onClick={() => toggleWeek(week.week_start)}
                    className="flex items-center gap-2 w-full text-left px-1 py-1.5 rounded-md hover:bg-slate-800/50 transition-colors mb-2"
                  >
                    <span className={`text-[10px] text-slate-500 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                    <span className="text-xs font-medium text-slate-400">{week.label}</span>
                    <span className="ml-auto text-xs text-slate-600">{week.items.length}</span>
                  </button>
                  {isOpen && (
                    <div className="grid grid-cols-1 gap-3">
                      {week.items.map(item => (
                        <SelectableStoryCard
                          key={item.story.id}
                          story={item.story}
                          isSelected={selectedStoryIds.includes(item.story.id)}
                          onToggle={() => toggleStory(item.story.id, item.story)}
                          onOpenDetail={setDetailStoryId}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </section>

          {/* Weitere Artikel */}
          <section>
            <button
              type="button"
              onClick={() => setMoreOpen(o => !o)}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors px-1 mb-2"
            >
              <span className={`text-xs transition-transform duration-200 ${moreOpen ? 'rotate-90' : ''}`}>▶</span>
              Weitere Artikel
              {moreOpen && moreTotal > 0 && (
                <span className="text-xs text-slate-600 ml-1">{moreTotal}</span>
              )}
            </button>
            {moreOpen && (
              <>
                {moreLoading && (
                  <div className="flex justify-center py-4">
                    <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3">
                  {moreStories.map(story => (
                    <SelectableStoryCard
                      key={story.id}
                      story={story}
                      isSelected={selectedStoryIds.includes(story.id)}
                      onToggle={() => toggleStory(story.id, story)}
                      onOpenDetail={setDetailStoryId}
                    />
                  ))}
                </div>
                {!moreLoading && moreStories.length === 0 && (
                  <p className="text-xs text-slate-600 px-1 py-2">Keine weiteren Artikel gefunden.</p>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {/* Right: Block editor */}
      <div className="w-[460px] shrink-0 flex flex-col min-h-0">

        {/* Copy bar — outside scroll area so it never overlaps content */}
        <div className="flex-none pb-3 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {selectedStoryIds.length === 0
              ? 'Noch keine Artikel ausgewählt'
              : `${selectedStoryIds.length} Artikel ausgewählt`}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            disabled={blocks.length === 0}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              copied
                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/40'
                : 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/30 disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
          >
            {copied ? '✓ Kopiert!' : 'In Zwischenablage kopieren'}
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-4">

        {/* Header collapsible */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setHeaderOpen(o => !o)}
            className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-800/50 transition-colors"
          >
            <span className={`text-[10px] text-slate-500 transition-transform duration-150 ${headerOpen ? 'rotate-90' : ''}`}>▶</span>
            <span className="text-xs text-slate-500 flex-1 truncate">{header.split('\n')[0]}</span>
            <span className="text-xs text-slate-600">Einleitung</span>
          </button>
          {headerOpen && (
            <textarea
              value={header}
              onChange={e => setHeader(e.target.value)}
              rows={3}
              placeholder="Einleitung…"
              className="w-full px-3 py-2 text-sm bg-slate-800/60 border-t border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none resize-none"
            />
          )}
        </div>

        <InsertBlockButtons
          onInsertHeading={() => addBlock(-1, 'heading')}
          onInsertText={() => addBlock(-1, 'text')}
        />

        {/* Blocks */}
        {blocks.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-600 border border-dashed border-slate-800 rounded-lg my-1">
            Artikel links anhaken um sie hier hinzuzufügen
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={blocks.map(blockId)} strategy={verticalListSortingStrategy}>
            {blocks.map((block, index) => (
              <React.Fragment key={blockId(block)}>
                <SortableBlockWrapper id={blockId(block)}>
                  {block.kind === 'story' ? (
                    <StoryBlock
                      block={block}
                      index={index}
                      total={blocks.length}
                      story={storyMap.get(block.storyId)}
                      sources={storySourcesMap.get(block.storyId)}
                      isLoadingSources={loadingSources.has(block.storyId)}
                      selectedUrl={selectedUrls.get(block.storyId)}
                      onSelectUrl={url => setSelectedUrls(prev => new Map(prev).set(block.storyId, url))}
                      onMoveUp={() => moveBlock(index, -1)}
                      onMoveDown={() => moveBlock(index, 1)}
                      onRemove={() => removeBlock(index)}
                    />
                  ) : block.kind === 'heading' ? (
                    <HeadingBlock
                      block={block}
                      index={index}
                      total={blocks.length}
                      onUpdateText={content => updateContentBlock(block.id, content)}
                      onMoveUp={() => moveBlock(index, -1)}
                      onMoveDown={() => moveBlock(index, 1)}
                      onRemove={() => removeBlock(index)}
                    />
                  ) : (
                    <TextBlock
                      block={block}
                      index={index}
                      total={blocks.length}
                      onUpdateText={content => updateContentBlock(block.id, content)}
                      onMoveUp={() => moveBlock(index, -1)}
                      onMoveDown={() => moveBlock(index, 1)}
                      onRemove={() => removeBlock(index)}
                    />
                  )}
                </SortableBlockWrapper>
                <InsertBlockButtons
                  onInsertHeading={() => addBlock(index, 'heading')}
                  onInsertText={() => addBlock(index, 'text')}
                />
              </React.Fragment>
            ))}
          </SortableContext>
        </DndContext>

        {/* Footer collapsible */}
        <div className="border border-slate-700 rounded-lg overflow-hidden mt-1">
          <button
            type="button"
            onClick={() => setFooterOpen(o => !o)}
            className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-800/50 transition-colors"
          >
            <span className={`text-[10px] text-slate-500 transition-transform duration-150 ${footerOpen ? 'rotate-90' : ''}`}>▶</span>
            <span className="text-xs text-slate-500 flex-1 truncate">{footer}</span>
            <span className="text-xs text-slate-600">Abschluss</span>
          </button>
          {footerOpen && (
            <textarea
              value={footer}
              onChange={e => setFooter(e.target.value)}
              rows={2}
              placeholder="Abschluss…"
              className="w-full px-3 py-2 text-sm bg-slate-800/60 border-t border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none resize-none"
            />
          )}
        </div>

        {/* Preview */}
        {blocks.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-slate-500 mb-1.5">Vorschau</p>
            <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 space-y-3 text-sm">
              <p className="text-slate-300 whitespace-pre-wrap">{header}</p>
              {blocks.map((block, i) => {
                if (block.kind === 'story') {
                  const story = storyMap.get(block.storyId)
                  if (!story) return null
                  const url = selectedUrls.get(block.storyId) ?? story.primary_url ?? ''
                  return (
                    <div key={i} className="space-y-0.5">
                      <p className="font-bold text-slate-100">📌 {story.primary_title || story.title_de}</p>
                      {story.summary_de && <p className="italic text-slate-400 text-xs leading-relaxed">{story.summary_de}</p>}
                      {url && <p className="text-slate-500 text-xs">🔗 {url}</p>}
                    </div>
                  )
                }
                if (block.kind === 'heading' && block.content.trim()) {
                  return <p key={i} className="text-xl font-bold text-slate-100">{block.content}</p>
                }
                if (block.kind === 'text' && block.content.trim()) {
                  return <p key={i} className="text-slate-300 whitespace-pre-wrap">{block.content}</p>
                }
                return null
              })}
              <p className="text-slate-300 whitespace-pre-wrap">{footer}</p>
            </div>
          </div>
        )}
        </div>{/* end scrollable content */}
      </div>

      {detailStoryId !== null && (
        <StoryDetailModal storyId={detailStoryId} onClose={() => setDetailStoryId(null)} />
      )}
    </div>
  )
}
