import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { FavoriteWeek, Story, Source, Filters } from '../types'
import {
  fetchFavorites, fetchStories, fetchStoryDetail, addFavorite, removeFavorite,
  generatePost, fetchTeamsStatus, postToTeams, type TeamsBlock, type TeamsTarget,
} from '../api'
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

// ISO-8601 Kalenderwoche (Woche mit dem ersten Donnerstag des Jahres = KW 1)
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = (d.getUTCDay() + 6) % 7 // Mo=0 … So=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3) // auf den Donnerstag dieser Woche
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const ftDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3)
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604800000)
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

// Auswahl der letzten Wochen: aktuelle KW + 7 zurück (z.B. am Montag die Vorwoche posten)
function buildWeekOptions(): { week: number; label: string; start: Date; end: Date }[] {
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
  const thisMonday = mondayOf(new Date())
  const opts: { week: number; label: string; start: Date; end: Date }[] = []
  for (let i = 0; i < 8; i++) {
    const monday = new Date(thisMonday)
    monday.setDate(monday.getDate() - i * 7)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    opts.push({ week: isoWeek(monday), label: `KW ${isoWeek(monday)} (${fmt(monday)}–${fmt(sunday)})`, start: monday, end: sunday })
  }
  return opts
}

// Spiegelt die Backend-Headline (_teams_headline in app.py): "KI-Wochenschau <|°_°|> Juni 12-19"
const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function teamsHeadline(start: Date, end: Date): string {
  const range = start.getMonth() === end.getMonth()
    ? `${MONTHS_DE[start.getMonth()]} ${start.getDate()}-${end.getDate()}`
    : `${MONTHS_DE[start.getMonth()]} ${start.getDate()} - ${MONTHS_DE[end.getMonth()]} ${end.getDate()}`
  return `KI-Wochenschau <|°_°|> ${range}`
}

function ExternalLinkButton({ url }: { url?: string }) {
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Seite in neuem Tab öffnen (z.B. Paywall prüfen)"
      onClick={e => e.stopPropagation()}
      className="shrink-0 flex items-center justify-center w-7 h-7 rounded border border-slate-700 bg-slate-900 text-slate-400 hover:text-indigo-300 hover:border-indigo-500 transition-colors"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  )
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
    <div className="relative group pt-2 pr-2">
      {/* Badge top-right, outside the card border */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onToggle() }}
        title={isSelected ? 'Abwählen' : 'Auswählen'}
        className={`absolute top-0 right-0 z-20 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all shadow-md
          ${isSelected
            ? 'bg-indigo-500 border-indigo-500'
            : 'bg-slate-800 border-slate-600 opacity-0 group-hover:opacity-100 hover:border-indigo-400'}`}
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
  const effectiveUrl = selectedUrl ?? story?.primary_url ?? sources?.[0]?.url
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
        <div className="flex items-center gap-1.5">
          <select
            value={selectedUrl ?? ''}
            onChange={e => onSelectUrl(e.target.value)}
            className="flex-1 min-w-0 text-xs bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            {sources.map(src => (
              <option key={src.url} value={src.url}>
                {src.source_name} — {src.url.length > 55 ? src.url.slice(0, 55) + '…' : src.url}
              </option>
            ))}
          </select>
          <ExternalLinkButton url={effectiveUrl} />
        </div>
      ) : (
        <div className="flex items-center gap-1.5 pl-5">
          <p className="flex-1 min-w-0 text-xs text-slate-600 truncate">
            {effectiveUrl ?? 'Kein Link verfügbar'}
          </p>
          <ExternalLinkButton url={effectiveUrl} />
        </div>
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

interface TeamsPostProps {
  onToggleFavorite?: (story: Story, next: boolean) => Promise<void>
}

export function TeamsPost({ onToggleFavorite }: TeamsPostProps = {}) {
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

  const [editorOpen, setEditorOpen] = useState(false)

  const [header, setHeader] = useState('')
  const [footer, setFooter] = useState('Viel Spaß beim Lesen! 🤖')
  const weekOptions = useMemo(() => buildWeekOptions(), [])
  const [selectedWeek, setSelectedWeek] = useState<number>(() => isoWeek(new Date()))
  const selectedHeadline = useMemo(() => {
    const o = weekOptions.find(o => o.week === selectedWeek) ?? weekOptions[0]
    return o ? teamsHeadline(o.start, o.end) : `KI-Wochenschau <|°_°|> KW ${selectedWeek}`
  }, [weekOptions, selectedWeek])
  const [headerOpen, setHeaderOpen] = useState(false)
  const [footerOpen, setFooterOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const [teamsTargets, setTeamsTargets] = useState<TeamsTarget[]>([])
  const [selectedTarget, setSelectedTarget] = useState<string>('')
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [sendError, setSendError] = useState<string | null>(null)

  // Probe which Teams channels are configured server-side; preselect the default
  useEffect(() => {
    fetchTeamsStatus()
      .then(s => {
        setTeamsTargets(s.targets)
        setSelectedTarget(s.default ?? s.targets[0]?.key ?? '')
      })
      .catch(() => setTeamsTargets([]))
  }, [])

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
  const tagsKey = filters.tags.join(',')
  const sourcesKey = filters.sources.join(',')
  useEffect(() => {
    if (!moreOpen) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setMoreLoading(true)
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
    // filters wird absichtlich über die granularen Keys getrackt (Objekt-Identität
    // ändert sich pro Render); deshalb hier bewusst aus den Deps ausgeklammert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreOpen, filters.search, tagsKey, filters.sort, filters.dateFrom, filters.dateTo, sourcesKey])

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
    // 'heading' als Start-Zustand unterdrückt ein führendes <br>, falls kein Header.
    let html = ''
    let prevKind = 'heading'
    if (header.trim()) {
      html = `<p>${esc(header).replace(/\n/g, '<br>')}</p>`
      prevKind = 'header'
    }

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
    if (footer.trim()) {
      html += (prevKind === 'heading' ? '' : '<br>') + `<p>${esc(footer).replace(/\n/g, '<br>')}</p>`
    }
    return `<html><body>${html}</body></html>`
  }

  function buildTeamsText(): string {
    const parts: string[] = []
    if (header.trim()) parts.push(header)
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
    if (footer.trim()) parts.push(footer)
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

  async function handleGeneratePost() {
    const storyIds = blocks
      .filter((b): b is { kind: 'story'; storyId: number } => b.kind === 'story')
      .map(b => b.storyId)

    if (storyIds.length === 0) return

    if (blocks.length > 0) {
      const confirmed = window.confirm(
        'Der aktuelle Editor-Inhalt wird durch den KI-Bericht ersetzt. Fortfahren?'
      )
      if (!confirmed) return
    }

    setAiGenerating(true)
    setAiError(null)

    try {
      const result = await generatePost(storyIds)

      // Fetch sources for all story IDs in one go (parallel)
      const allStoryIds = result.clusters.flatMap(c => c.story_ids)
      await Promise.allSettled(
        allStoryIds
          .filter(id => !storySourcesMap.has(id))
          .map(async id => {
            setLoadingSources(prev => new Set(prev).add(id))
            try {
              const detail = await fetchStoryDetail(id)
              setStorySourcesMap(prev => new Map(prev).set(id, detail.sources))
              const story = storyMap.get(id)
              const defaultUrl = story?.primary_url ?? detail.sources[0]?.url
              if (defaultUrl) {
                setSelectedUrls(prev => prev.has(id) ? prev : new Map(prev).set(id, defaultUrl))
              }
            } catch { /* ignore */ } finally {
              setLoadingSources(prev => { const next = new Set(prev); next.delete(id); return next })
            }
          })
      )

      // Build the new block list from the clusters
      const newBlocks: typeof blocks = []
      for (const cluster of result.clusters) {
        newBlocks.push({ kind: 'heading', id: makeId(), content: cluster.title })
        newBlocks.push({ kind: 'text', id: makeId(), content: cluster.intro })
        for (const sid of cluster.story_ids) {
          if (storyMap.has(sid)) {
            newBlocks.push({ kind: 'story', storyId: sid })
          }
        }
      }
      setBlocks(newBlocks)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Unbekannter Fehler')
    } finally {
      setAiGenerating(false)
    }
  }

  // Maps the editor blocks into the API payload, resolving story title/summary/url.
  function buildTeamsBlocks(): TeamsBlock[] {
    const out: TeamsBlock[] = []
    for (const block of blocks) {
      if (block.kind === 'story') {
        const story = storyMap.get(block.storyId)
        if (!story) continue
        out.push({
          kind: 'story',
          title: story.primary_title || story.title_de,
          summary: story.summary_de ?? undefined,
          url: selectedUrls.get(block.storyId) ?? story.primary_url ?? undefined,
        })
      } else if (block.content.trim()) {
        out.push({ kind: block.kind, content: block.content })
      }
    }
    return out
  }

  async function handleSend() {
    setSendState('sending')
    setSendError(null)
    try {
      await postToTeams({ header, footer, blocks: buildTeamsBlocks(), week: selectedWeek, target: selectedTarget || undefined })
      setSendState('sent')
      setTimeout(() => setSendState('idle'), 3000)
    } catch (e) {
      setSendState('error')
      setSendError(e instanceof Error ? e.message : 'Senden fehlgeschlagen')
      setTimeout(() => setSendState('idle'), 5000)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const gridCols = editorOpen ? 'grid-cols-2' : 'grid-cols-3'

  async function handleLocalToggleFavorite(story: Story, next: boolean) {
    if (next) {
      await addFavorite(story.id)
    } else {
      await removeFavorite(story.id)
    }
    setWeeks(prev => prev.map(w => ({
      ...w,
      items: next
        ? w.items
        : w.items.filter(i => i.story.id !== story.id),
    })))
    onToggleFavorite?.(story, next)
  }

  return (
    <div className={`flex gap-6 h-[calc(100vh-9rem)] min-h-0`}>
      {/* Left: Article list */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* FilterBar + Teams Post Button */}
        <div className="shrink-0 flex items-start gap-3">
          <div className="flex-1">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              total={filteredWeeks.reduce((n, w) => n + w.items.length, 0)}
            />
          </div>
          <button
            type="button"
            onClick={() => setEditorOpen(o => !o)}
            className={`mt-1 shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              editorOpen
                ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40 hover:bg-slate-700/50'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-indigo-500/60 hover:text-indigo-300'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            {editorOpen ? 'Editor schließen' : 'Teams Post erstellen'}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-6 pb-4 mt-2">
          {/* Favoriten */}
          <section>
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
                    <div className={`grid ${gridCols} gap-3`}>
                      {week.items.map(item => (
                        editorOpen ? (
                          <SelectableStoryCard
                            key={item.story.id}
                            story={item.story}
                            isSelected={selectedStoryIds.includes(item.story.id)}
                            onToggle={() => toggleStory(item.story.id, item.story)}
                            onOpenDetail={setDetailStoryId}
                          />
                        ) : (
                          <div key={item.story.id} className="relative group pt-2 pr-2">
                            <StoryCard
                              story={item.story}
                              onSelect={setDetailStoryId}
                              onToggleFavorite={handleLocalToggleFavorite}
                            />
                          </div>
                        )
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
                <div className={`grid ${gridCols} gap-3`}>
                  {moreStories.map(story => (
                    editorOpen ? (
                      <SelectableStoryCard
                        key={story.id}
                        story={story}
                        isSelected={selectedStoryIds.includes(story.id)}
                        onToggle={() => toggleStory(story.id, story)}
                        onOpenDetail={setDetailStoryId}
                      />
                    ) : (
                      <div key={story.id} className="relative group pt-2 pr-2">
                        <StoryCard
                          story={story}
                          onSelect={setDetailStoryId}
                          onToggleFavorite={handleLocalToggleFavorite}
                        />
                      </div>
                    )
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

      {/* Right: Block editor — only visible when editorOpen */}
      {editorOpen && <div className="w-[460px] shrink-0 flex flex-col min-h-0">

        {/* Copy bar — outside scroll area so it never overlaps content */}
        <div className="flex-none pb-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              {selectedStoryIds.length === 0
                ? 'Noch keine Artikel ausgewählt'
                : `${selectedStoryIds.length} Artikel ausgewählt`}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* KI-Bericht Button */}
              <button
                type="button"
                onClick={handleGeneratePost}
                disabled={selectedStoryIds.length === 0 || aiGenerating}
                title="KI clustert die ausgewählten Stories automatisch in Themenabschnitte"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all
                  bg-violet-600/20 text-violet-300 border-violet-500/40 hover:bg-violet-600/30
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {aiGenerating ? (
                  <>
                    <div className="w-3.5 h-3.5 border border-violet-400 border-t-transparent rounded-full animate-spin" />
                    KI arbeitet…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                    KI-Bericht
                  </>
                )}
              </button>
              {/* Copy Button */}
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
              {/* An Teams senden: Ziel-Team-Auswahl + Button */}
              {teamsTargets.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {teamsTargets.length > 1 && (
                    <select
                      value={selectedTarget}
                      onChange={e => setSelectedTarget(e.target.value)}
                      disabled={sendState === 'sending'}
                      title="An welches Team senden?"
                      className="max-w-[160px] text-xs bg-slate-900 border border-teal-500/40 rounded px-2 py-1.5 text-teal-200 focus:outline-none focus:border-teal-500 disabled:opacity-30"
                    >
                      {teamsTargets.map(t => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={blocks.length === 0 || sendState === 'sending'}
                    title={sendError ?? undefined}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      sendState === 'sent'
                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/40'
                        : sendState === 'error'
                        ? 'bg-red-600/20 text-red-400 border border-red-600/40'
                        : 'bg-teal-600/20 text-teal-300 border border-teal-500/40 hover:bg-teal-600/30 disabled:opacity-30 disabled:cursor-not-allowed'
                    }`}
                  >
                    {sendState === 'sending' ? 'Sende…'
                      : sendState === 'sent' ? '✓ Gesendet!'
                      : sendState === 'error' ? '✕ Fehler'
                      : 'An Teams senden'}
                  </button>
                </div>
              )}
            </div>
          </div>
          {aiError && (
            <p className="text-xs text-red-400 text-right">Fehler: {aiError}</p>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-4">

        {/* Kalenderwoche — bestimmt die Überschrift "KI-Wochenschau <|°_°|> <Datumsbereich>" der Teams-Card */}
        <div className="flex items-center gap-2 px-3 py-2 border border-slate-700 rounded-lg">
          <span className="text-xs text-slate-500 shrink-0">📅 Kalenderwoche</span>
          <select
            value={selectedWeek}
            onChange={e => setSelectedWeek(Number(e.target.value))}
            className="flex-1 min-w-0 text-xs bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            {weekOptions.map(opt => (
              <option key={opt.week} value={opt.week}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Header collapsible */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setHeaderOpen(o => !o)}
            className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-800/50 transition-colors"
          >
            <span className={`text-[10px] text-slate-500 transition-transform duration-150 ${headerOpen ? 'rotate-90' : ''}`}>▶</span>
            <span className="text-xs text-slate-500 flex-1 truncate">{header.split('\n')[0] || 'kein Einstiegstext'}</span>
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
              <p className="font-bold text-slate-100">{selectedHeadline}</p>
              {header.trim() && <p className="text-slate-300 whitespace-pre-wrap">{header}</p>}
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
              {footer.trim() && <p className="text-slate-300 whitespace-pre-wrap">{footer}</p>}
            </div>
          </div>
        )}
        </div>{/* end scrollable content */}
      </div>}{/* end editorOpen */}

      {detailStoryId !== null && (
        <StoryDetailModal storyId={detailStoryId} onClose={() => setDetailStoryId(null)} />
      )}
    </div>
  )
}
