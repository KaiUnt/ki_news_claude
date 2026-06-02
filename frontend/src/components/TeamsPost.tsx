import { useState, useEffect, useCallback } from 'react'
import type { FavoriteWeek, Story, Source, Filters } from '../types'
import { fetchFavorites, fetchStories, fetchStoryDetail } from '../api'

type ContentBlock =
  | { kind: 'story'; storyId: number }
  | { kind: 'text'; id: string; content: string }

const DEFAULT_FILTERS: Filters = {
  tags: [], excludeTags: [], sources: [],
  dateFrom: '', dateTo: '', search: '', sort: 'date_desc',
}

function makeId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StorySelectRow({
  story, checked, onToggle,
}: { story: Story; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/70 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 shrink-0 accent-indigo-500 w-4 h-4"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 leading-snug line-clamp-2">
          {story.primary_title || story.title_de}
        </p>
        {story.summary_de && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{story.summary_de}</p>
        )}
      </div>
    </label>
  )
}

function InsertTextButton({ onInsert }: { onInsert: () => void }) {
  return (
    <div className="flex justify-center py-1">
      <button
        type="button"
        onClick={onInsert}
        className="text-xs text-slate-600 hover:text-indigo-400 hover:bg-slate-800 px-3 py-0.5 rounded transition-colors"
      >
        + Textabschnitt einfügen
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
        <p className="flex-1 text-sm text-slate-200 font-medium leading-snug line-clamp-2">{title}</p>
        <BlockControls index={index} total={total} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
      </div>
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
  const [favLoading, setFavLoading] = useState(true)
  const [favError, setFavError] = useState<string | null>(null)

  const [moreOpen, setMoreOpen] = useState(false)
  const [moreSearch, setMoreSearch] = useState('')
  const [moreStories, setMoreStories] = useState<Story[]>([])
  const [moreLoading, setMoreLoading] = useState(false)

  const [header, setHeader] = useState('Hallo Kollegen,\n\nhier wieder die brandaktuellen News zum Thema KI:')
  const [footer, setFooter] = useState('Viel Spaß beim Lesen! 🤖')
  const [copied, setCopied] = useState(false)

  // Load favorites on mount
  useEffect(() => {
    fetchFavorites()
      .then(data => {
        setWeeks(data.weeks)
        const map = new Map<number, Story>()
        data.weeks.forEach((w: FavoriteWeek) => w.items.forEach(item => map.set(item.story.id, item.story)))
        setStoryMap(map)
      })
      .catch(() => setFavError('Fehler beim Laden der Favoriten'))
      .finally(() => setFavLoading(false))
  }, [])

  // Load "Weitere Artikel" with debounce
  useEffect(() => {
    if (!moreOpen) return
    setMoreLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetchStories({ ...DEFAULT_FILTERS, search: moreSearch }, 0, 30, controller.signal)
        .then(data => {
          setMoreStories(data.items.filter(s => !s.is_favorite))
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
  }, [moreOpen, moreSearch])

  const selectedStoryIds = blocks
    .filter((b): b is { kind: 'story'; storyId: number } => b.kind === 'story')
    .map(b => b.storyId)

  const toggleStory = useCallback(async (id: number, story: Story) => {
    const isSelected = blocks.some(b => b.kind === 'story' && b.storyId === id)
    if (isSelected) {
      setBlocks(prev => prev.filter(b => !(b.kind === 'story' && b.storyId === id)))
      return
    }

    // Add to storyMap if not there yet
    setStoryMap(prev => prev.has(id) ? prev : new Map(prev).set(id, story))
    setBlocks(prev => [...prev, { kind: 'story', storyId: id }])

    // Fetch sources if not already loaded
    if (!storySourcesMap.has(id)) {
      setLoadingSources(prev => new Set(prev).add(id))
      try {
        const detail = await fetchStoryDetail(id)
        setStorySourcesMap(prev => new Map(prev).set(id, detail.sources))
        // Set default URL: primary_url from story, or first source
        const defaultUrl = story.primary_url ?? detail.sources[0]?.url
        if (defaultUrl) {
          setSelectedUrls(prev => prev.has(id) ? prev : new Map(prev).set(id, defaultUrl))
        }
      } catch {
        // ignore — story block still works, just no URL dropdown
      } finally {
        setLoadingSources(prev => { const next = new Set(prev); next.delete(id); return next })
      }
    }
  }, [blocks, storySourcesMap])

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
  const addTextBlock = (afterIndex: number) => {
    setBlocks(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, { kind: 'text', id: makeId(), content: '' })
      return next
    })
  }

  const updateTextBlock = (id: string, content: string) =>
    setBlocks(prev => prev.map(b => b.kind === 'text' && b.id === id ? { ...b, content } : b))

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
      await navigator.clipboard.writeText(buildTeamsText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* fallback ignored */ }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex gap-6 h-[calc(100vh-9rem)] overflow-hidden">
      {/* Left: Article selector */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-6 pb-4">

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
          {favError && <p className="text-xs text-red-400 px-3">{favError}</p>}
          {!favLoading && !favError && weeks.length === 0 && (
            <p className="text-xs text-slate-500 px-3">Noch keine Favoriten vorhanden.</p>
          )}
          {weeks.map(week => (
            <div key={week.week_start} className="mb-5">
              <p className="text-xs text-slate-500 px-3 mb-1 font-medium">{week.label}</p>
              <div className="space-y-0.5">
                {week.items.map(item => (
                  <StorySelectRow
                    key={item.story.id}
                    story={item.story}
                    checked={selectedStoryIds.includes(item.story.id)}
                    onToggle={() => toggleStory(item.story.id, item.story)}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Weitere Artikel */}
        <section>
          <button
            type="button"
            onClick={() => setMoreOpen(o => !o)}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors px-1"
          >
            <span className={`text-xs transition-transform duration-200 ${moreOpen ? 'rotate-90' : ''}`}>▶</span>
            Weitere Artikel
          </button>
          {moreOpen && (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                placeholder="Suchen…"
                value={moreSearch}
                onChange={e => setMoreSearch(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {moreLoading && (
                <div className="flex justify-center py-4">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <div className="space-y-0.5">
                {moreStories.map(story => (
                  <StorySelectRow
                    key={story.id}
                    story={story}
                    checked={selectedStoryIds.includes(story.id)}
                    onToggle={() => toggleStory(story.id, story)}
                  />
                ))}
                {!moreLoading && moreStories.length === 0 && (
                  <p className="text-xs text-slate-600 px-3 py-2">Keine weiteren Artikel gefunden.</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Right: Block editor */}
      <div className="w-[460px] shrink-0 flex flex-col overflow-y-auto pb-4">

        {/* Sticky header bar */}
        <div className="sticky top-0 z-10 bg-slate-900 pb-3 flex items-center justify-between">
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

        {/* Header */}
        <textarea
          value={header}
          onChange={e => setHeader(e.target.value)}
          rows={3}
          placeholder="Einleitung…"
          className="w-full px-3 py-2 text-sm bg-slate-800/60 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
        />

        {/* Insert before first block */}
        <InsertTextButton onInsert={() => addTextBlock(-1)} />

        {/* Blocks */}
        {blocks.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-600 border border-dashed border-slate-800 rounded-lg my-1">
            Artikel links anhaken um sie hier hinzuzufügen
          </div>
        )}
        {blocks.map((block, index) => (
          <div key={block.kind === 'story' ? `story-${block.storyId}` : block.id}>
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
            ) : (
              <TextBlock
                block={block}
                index={index}
                total={blocks.length}
                onUpdateText={content => updateTextBlock(block.id, content)}
                onMoveUp={() => moveBlock(index, -1)}
                onMoveDown={() => moveBlock(index, 1)}
                onRemove={() => removeBlock(index)}
              />
            )}
            <InsertTextButton onInsert={() => addTextBlock(index)} />
          </div>
        ))}

        {/* Footer */}
        <textarea
          value={footer}
          onChange={e => setFooter(e.target.value)}
          rows={2}
          placeholder="Abschluss…"
          className="w-full px-3 py-2 text-sm bg-slate-800/60 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 resize-none mt-1"
        />

        {/* Preview */}
        {blocks.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-slate-500 mb-1.5">Vorschau</p>
            <pre className="whitespace-pre-wrap text-xs text-slate-300 bg-slate-800/60 border border-slate-700 rounded-lg p-3 leading-relaxed">
              {buildTeamsText()}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
