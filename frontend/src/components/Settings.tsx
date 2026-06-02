import { useEffect, useRef, useState } from 'react'
import {
  fetchManagedSources, createManagedSource, updateManagedSource, deleteManagedSource,
  fetchCategories, createCategory, updateCategory,
  fetchPrompts, updatePrompt,
  fetchSystemSettings, updateSystemSettings,
} from '../api'
import type { ManagedSource, Category, PromptSetting, SystemSettings } from '../types'

// ── Shared helpers ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
        checked ? 'bg-indigo-500' : 'bg-slate-700'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    rss:        'bg-sky-500/10 text-sky-400 border-sky-500/30',
    newsletter: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    hackernews: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  }
  const labels: Record<string, string> = { rss: 'RSS', newsletter: 'NL', hackernews: 'HN' }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${styles[type] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/30'}`}>
      {labels[type] ?? type}
    </span>
  )
}

function CategoryDot({ color }: { color: string | null }) {
  return (
    <span
      className="w-2.5 h-2.5 rounded-full shrink-0 inline-block"
      style={{ background: color ?? '#6366f1' }}
    />
  )
}

// ── Category section ──────────────────────────────────────────────────────────

function CategorySection({
  categories,
  setCategories,
  loading,
  error,
}: {
  categories: Category[]
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>
  loading: boolean
  error: string | null
}) {
  const [showForm, setShowForm] = useState(false)
  const [formSlug, setFormSlug] = useState('')
  const [formName, setFormName] = useState('')
  const [formIcon, setFormIcon] = useState('')
  const [formColor, setFormColor] = useState('#6366f1')
  const [formPremium, setFormPremium] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)

  async function handleToggleActive(cat: Category) {
    setTogglingId(cat.id)
    setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, active: !c.active } : c))
    try {
      const updated = await updateCategory(cat.id, { active: !cat.active })
      setCategories(prev => prev.map(c => c.id === cat.id ? updated : c))
    } catch {
      setCategories(prev => prev.map(c => c.id === cat.id ? cat : c))
    } finally {
      setTogglingId(null)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!formSlug.trim() || !formName.trim()) return
    setSaving(true)
    setFormError(null)
    try {
      const created = await createCategory({
        slug: formSlug.trim().toLowerCase(),
        name: formName.trim(),
        icon: formIcon.trim() || undefined,
        color: formColor,
        is_premium: formPremium,
      })
      setCategories(prev => [...prev, created])
      setShowForm(false)
      setFormSlug(''); setFormName(''); setFormIcon(''); setFormColor('#6366f1'); setFormPremium(false)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Fehler beim Erstellen.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
      <div className="flex items-center justify-between gap-4 mb-1">
        <h3 className="text-sm uppercase tracking-[0.18em] text-slate-500 font-medium m-0">
          Kategorien
        </h3>
        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {showForm ? 'Abbrechen' : '+ Neu'}
        </button>
      </div>
      <p className="text-xs text-slate-500 m-0 mb-5">
        Gruppieren Quellen und Dashboard-Bereiche. Neue Kategorien (IT-Security, Hardware…) können jederzeit hinzugefügt werden.
      </p>

      {loading && <p className="text-xs text-slate-500">Lade…</p>}
      {error   && <p className="text-xs text-red-400">{error}</p>}

      {!loading && !error && (
        <ul className="flex flex-col gap-2 m-0 p-0 list-none mb-4">
          {categories.map(cat => (
            <li
              key={cat.id}
              className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-800/50 border border-slate-700/50"
            >
              <CategoryDot color={cat.color} />
              <span className="text-base leading-none">{cat.icon ?? ''}</span>
              <span className="text-sm text-slate-100 font-medium flex-1">{cat.name}</span>
              <span className="text-xs text-slate-500 font-mono">{cat.slug}</span>
              {cat.is_premium && (
                <span className="text-xs px-1.5 py-0.5 rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
                  Premium
                </span>
              )}
              <Toggle
                checked={cat.active}
                onChange={() => handleToggleActive(cat)}
                disabled={togglingId === cat.id}
              />
            </li>
          ))}
          {categories.length === 0 && (
            <li className="text-sm text-slate-500 py-2">Keine Kategorien vorhanden.</li>
          )}
        </ul>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="border-t border-slate-800 pt-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400">Slug <span className="text-slate-600">(eindeutig, z.B. "it-security")</span></label>
              <input
                type="text"
                value={formSlug}
                onChange={e => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="ki"
                required
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400">Name</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Künstliche Intelligenz"
                required
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400">Icon <span className="text-slate-600">(Emoji)</span></label>
              <input
                type="text"
                value={formIcon}
                onChange={e => setFormIcon(e.target.value)}
                placeholder="🤖"
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400">Farbe</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formColor}
                  onChange={e => setFormColor(e.target.value)}
                  className="w-10 h-9 rounded border border-slate-700 bg-slate-800 cursor-pointer p-0.5"
                />
                <span className="text-xs text-slate-500 font-mono">{formColor}</span>
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formPremium}
              onChange={e => setFormPremium(e.target.checked)}
              className="accent-indigo-500"
            />
            <span className="text-sm text-slate-300">Premium-Kategorie</span>
          </label>
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <div>
            <button
              type="submit"
              disabled={saving || !formSlug.trim() || !formName.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm text-white font-medium transition-colors flex items-center gap-2"
            >
              {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {saving ? 'Erstelle…' : 'Kategorie erstellen'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

// ── Source section ────────────────────────────────────────────────────────────

function SourceSection({ categories }: { categories: Category[] }) {
  const [sources, setSources] = useState<ManagedSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState<'rss' | 'newsletter'>('rss')
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formCategoryId, setFormCategoryId] = useState<number | null>(categories[0]?.id ?? null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchManagedSources()
      .then(setSources)
      .catch(() => setError('Quellen konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (categories.length > 0 && formCategoryId === null) {
      setFormCategoryId(categories[0].id)
    }
  }, [categories, formCategoryId])

  async function handleToggle(source: ManagedSource) {
    setTogglingId(source.id)
    setSources(prev => prev.map(s => s.id === source.id ? { ...s, active: !s.active } : s))
    try {
      const updated = await updateManagedSource(source.id, { active: !source.active })
      setSources(prev => prev.map(s => s.id === source.id ? updated : s))
    } catch {
      setSources(prev => prev.map(s => s.id === source.id ? source : s))
    } finally {
      setTogglingId(null)
    }
  }

  async function handleCategoryChange(source: ManagedSource, categoryId: number | null) {
    setSources(prev => prev.map(s => s.id === source.id ? { ...s, category_id: categoryId } : s))
    try {
      const updated = await updateManagedSource(source.id, { category_id: categoryId })
      setSources(prev => prev.map(s => s.id === source.id ? updated : s))
    } catch {
      setSources(prev => prev.map(s => s.id === source.id ? source : s))
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id)
    try {
      await deleteManagedSource(id)
      setSources(prev => prev.filter(s => s.id !== id))
    } catch {
      // ignore
    } finally {
      setDeletingId(null)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim() || !formUrl.trim()) return
    setSaving(true)
    setFormError(null)
    try {
      const created = await createManagedSource({
        name: formName.trim(),
        source_type: formType,
        url: formUrl.trim(),
        category_id: formCategoryId,
      })
      setSources(prev => [...prev, created])
      setFormName(''); setFormUrl(''); setShowForm(false)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Fehler beim Speichern.')
    } finally {
      setSaving(false)
    }
  }

  // Group sources by category
  const catMap = new Map(categories.map(c => [c.id, c]))
  const grouped: { catId: number | null; label: string; color: string | null; sources: ManagedSource[] }[] = []

  for (const cat of categories) {
    const catSources = sources.filter(s => s.category_id === cat.id)
    if (catSources.length > 0) {
      grouped.push({ catId: cat.id, label: `${cat.icon ?? ''} ${cat.name}`.trim(), color: cat.color, sources: catSources })
    }
  }
  const uncat = sources.filter(s => s.category_id === null || !catMap.has(s.category_id as number))
  if (uncat.length > 0) {
    grouped.push({ catId: null, label: 'Ohne Kategorie', color: null, sources: uncat })
  }

  const activeCount = sources.filter(s => s.active).length

  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
      <div className="flex items-center justify-between gap-4 mb-1">
        <h3 className="text-sm uppercase tracking-[0.18em] text-slate-500 font-medium m-0">
          Quellen
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{activeCount} / {sources.length} aktiv</span>
          <button
            type="button"
            onClick={() => setShowForm(v => !v)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {showForm ? 'Abbrechen' : '+ Neu'}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500 m-0 mb-5">
        Inaktive Quellen werden beim nächsten Fetch übersprungen. Eingebaute Quellen (🔒) können nicht gelöscht werden.
      </p>

      {loading && <p className="text-xs text-slate-500">Lade…</p>}
      {error   && <p className="text-xs text-red-400">{error}</p>}

      {!loading && !error && grouped.map(group => (
        <div key={group.catId ?? 'uncat'} className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            {group.color && <CategoryDot color={group.color} />}
            <span className="text-xs font-medium text-slate-400">{group.label}</span>
            <span className="text-xs text-slate-600">({group.sources.length})</span>
          </div>
          <ul className="flex flex-col gap-1 m-0 p-0 list-none">
            {group.sources.map(source => (
              <li
                key={source.id}
                className={`flex items-center gap-2 py-1.5 px-2 -mx-2 rounded hover:bg-slate-800/40 ${
                  !source.active ? 'opacity-50' : ''
                }`}
              >
                <Toggle
                  checked={source.active}
                  onChange={() => handleToggle(source)}
                  disabled={togglingId === source.id}
                />
                <TypeBadge type={source.source_type} />
                <span className="text-sm text-slate-100 font-medium min-w-[160px] shrink-0">
                  {source.is_builtin && <span className="text-slate-600 mr-1" title="Eingebaut">🔒</span>}
                  {source.name}
                </span>
                <span className="text-xs text-slate-600 truncate flex-1 font-mono hidden sm:block" title={source.url}>
                  {source.url}
                </span>
                {source.story_kind === 'paper' && (
                  <span className="text-xs px-1.5 py-0.5 rounded border bg-violet-500/10 text-violet-400 border-violet-500/30 shrink-0">
                    Paper
                  </span>
                )}
                <select
                  value={source.category_id ?? ''}
                  onChange={e => handleCategoryChange(source, e.target.value ? Number(e.target.value) : null)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/60 shrink-0"
                >
                  <option value="">Keine</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                  ))}
                </select>
                {!source.is_builtin && (
                  <button
                    type="button"
                    onClick={() => handleDelete(source.id)}
                    disabled={deletingId === source.id}
                    title="Löschen"
                    className="text-slate-600 hover:text-red-400 transition-colors disabled:opacity-40 shrink-0 text-sm leading-none w-5 text-center"
                  >
                    {deletingId === source.id ? '…' : '✕'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {showForm && (
        <form onSubmit={handleAdd} className="border-t border-slate-800 pt-5 flex flex-col gap-4 mt-2">
          <div className="flex gap-1">
            {(['rss', 'newsletter'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setFormType(t)}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                  formType === t
                    ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                    : 'text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                {t === 'rss' ? 'RSS-Feed' : 'Newsletter'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400">Name</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="z.B. Mein KI-Blog"
                required
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400">{formType === 'newsletter' ? 'Absender-E-Mail' : 'Feed-URL'}</label>
              <input
                type={formType === 'newsletter' ? 'email' : 'url'}
                value={formUrl}
                onChange={e => setFormUrl(e.target.value)}
                placeholder={formType === 'newsletter' ? 'newsletter@example.com' : 'https://example.com/feed.xml'}
                required
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400">Kategorie</label>
              <select
                value={formCategoryId ?? ''}
                onChange={e => setFormCategoryId(e.target.value ? Number(e.target.value) : null)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/60"
              >
                <option value="">Keine Kategorie</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                ))}
              </select>
            </div>
          </div>
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <div>
            <button
              type="submit"
              disabled={saving || !formName.trim() || !formUrl.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm text-white font-medium transition-colors flex items-center gap-2"
            >
              {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {saving ? 'Speichern…' : '+ Hinzufügen'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

// ── Prompt section ────────────────────────────────────────────────────────────

function PromptCard({ prompt, onSave }: { prompt: PromptSetting; onSave: (key: string, value: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false)
  const [value, setValue] = useState(prompt.value)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave(prompt.key, value)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern.')
    } finally {
      setSaving(false)
    }
  }

  const changed = value !== prompt.value

  return (
    <div className="border border-slate-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start justify-between gap-4 p-4 text-left hover:bg-slate-800/30 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100 m-0">{prompt.name}</p>
          {prompt.description && (
            <p className="text-xs text-slate-500 m-0 mt-0.5">{prompt.description}</p>
          )}
        </div>
        <span className="text-slate-600 shrink-0 text-sm mt-0.5">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-800 p-4 flex flex-col gap-3 bg-slate-900/20">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={12}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500/60 resize-y leading-relaxed"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !changed}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm text-white font-medium transition-colors flex items-center gap-2"
            >
              {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {saving ? 'Speichern…' : saved ? '✓ Gespeichert' : 'Speichern'}
            </button>
            {changed && !saving && (
              <button
                type="button"
                onClick={() => setValue(prompt.value)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Zurücksetzen
              </button>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function PromptSection() {
  const [prompts, setPrompts] = useState<PromptSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchPrompts()
      .then(setPrompts)
      .catch(() => setError('Prompts konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(key: string, value: string) {
    const updated = await updatePrompt(key, value)
    setPrompts(prev => prev.map(p => p.key === key ? updated : p))
  }

  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
      <h3 className="text-sm uppercase tracking-[0.18em] text-slate-500 font-medium m-0 mb-1">
        KI-Prompts
      </h3>
      <p className="text-xs text-slate-500 m-0 mb-2">
        Steuern wie Claude News zusammenfasst, clustert und kuratiert.
      </p>
      <p className="text-xs text-amber-500/80 m-0 mb-5">
        ⚠ Änderungen gelten global für alle Nutzer und werden sofort beim nächsten Pipeline-Lauf aktiv.
      </p>

      {loading && <p className="text-xs text-slate-500">Lade…</p>}
      {error   && <p className="text-xs text-red-400">{error}</p>}

      {!loading && !error && (
        <div className="flex flex-col gap-2">
          {prompts.map(p => (
            <PromptCard key={p.key} prompt={p} onSave={handleSave} />
          ))}
        </div>
      )}
    </section>
  )
}

// ── System settings panel ─────────────────────────────────────────────────────

function SystemSettingsPanel() {
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchSystemSettings().then(setSettings).catch(() => {})
  }, [])

  async function handleToggle(key: keyof SystemSettings) {
    if (!settings) return
    const next = { ...settings, [key]: !settings[key] }
    setSettings(next)
    setSaving(true)
    try {
      const saved = await updateSystemSettings({ [key]: next[key] })
      setSettings(saved)
    } catch {
      setSettings(settings)
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return null

  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
      <h3 className="text-sm uppercase tracking-[0.18em] text-slate-500 font-medium m-0 mb-1">
        Verarbeitung
      </h3>
      <p className="text-xs text-slate-500 m-0 mb-5">
        Steuerung der automatischen News-Pipeline.
      </p>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-100 font-medium m-0">Story-Merge</p>
            <p className="text-xs text-slate-500 m-0 mt-0.5">
              Nach dem Clustering semantisch gleiche Stories automatisch zusammenführen.
            </p>
          </div>
          <Toggle
            checked={settings.story_merge_enabled}
            onChange={() => handleToggle('story_merge_enabled')}
            disabled={saving}
          />
        </div>
      </div>
    </section>
  )
}

// ── Main Settings component ───────────────────────────────────────────────────

export function Settings() {
  const [categories, setCategories] = useState<Category[]>([])
  const [catsLoading, setCatsLoading] = useState(true)
  const [catsError, setCatsError] = useState<string | null>(null)

  useEffect(() => {
    setCatsLoading(true)
    fetchCategories()
      .then(setCategories)
      .catch(() => setCatsError('Kategorien konnten nicht geladen werden.'))
      .finally(() => setCatsLoading(false))
  }, [])

  return (
    <div className="flex flex-col gap-8">
      <CategorySection
        categories={categories}
        setCategories={setCategories}
        loading={catsLoading}
        error={catsError}
      />
      <SourceSection categories={categories} />
      <PromptSection />
      <SystemSettingsPanel />
    </div>
  )
}
