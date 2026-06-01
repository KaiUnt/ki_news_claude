import { useEffect, useState } from 'react'
import { fetchSources, fetchManagedSources, createManagedSource, deleteManagedSource, fetchSystemSettings, updateSystemSettings } from '../api'
import type { SourceConfig, ManagedSource, SystemSettings } from '../types'

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
      setSettings(settings) // revert on error
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
          <button
            type="button"
            role="switch"
            aria-checked={settings.story_merge_enabled}
            onClick={() => handleToggle('story_merge_enabled')}
            disabled={saving}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
              settings.story_merge_enabled ? 'bg-indigo-500' : 'bg-slate-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                settings.story_merge_enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  )
}

// ── Source inventory (readonly) ───────────────────────────────────────────────

function SourceInventory() {
  const [sources, setSources] = useState<SourceConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    fetchSources()
      .then(data => { if (!ac.signal.aborted) setSources(data) })
      .catch(() => { if (!ac.signal.aborted) setError('Quellen konnten nicht geladen werden.') })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [])

  if (loading) return <div className="text-slate-500 text-sm py-4">Lade…</div>
  if (error)   return <div className="text-red-400 text-sm py-4">{error}</div>

  const newsletterSources = sources.filter(s => s.type === 'newsletter')
  const paperSources      = sources.filter(s => s.story_kind === 'paper')
  const generalSources    = sources.filter(s => s.story_kind !== 'paper' && s.type !== 'newsletter')

  const groups = [
    { title: 'Newsletter', items: newsletterSources, mono: true },
    { title: 'Allgemein',  items: generalSources,   mono: false },
    { title: 'Papers',     items: paperSources,      mono: false },
  ]

  return (
    <div className="flex flex-col gap-6">
      {groups.map(group => {
        if (group.items.length === 0) return null
        return (
          <section key={group.title} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h3 className="text-sm uppercase tracking-[0.18em] text-slate-500 font-medium m-0">
                {group.title}
              </h3>
              <span className="text-xs text-slate-500">{group.items.length} Quellen</span>
            </div>
            <ul className="flex flex-col gap-1 m-0 p-0 list-none">
              {group.items.map(source => (
                <li
                  key={source.name}
                  className="flex items-center justify-between gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-slate-800/40"
                >
                  <span className="text-slate-100 text-sm font-medium shrink-0">{source.name}</span>
                  <span
                    className={`text-slate-500 text-xs truncate text-right ${group.mono ? 'font-mono' : ''}`}
                    title={source.url}
                  >
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

// ── Managed sources form ──────────────────────────────────────────────────────

const TYPE_LABELS: Record<'rss' | 'newsletter', { label: string; fieldLabel: string; placeholder: string }> = {
  rss:        { label: 'RSS-Feed',   fieldLabel: 'Feed-URL',       placeholder: 'https://example.com/feed.xml' },
  newsletter: { label: 'Newsletter', fieldLabel: 'Absender-E-Mail', placeholder: 'newsletter@example.com' },
}

function ManagedSourcesForm() {
  const [managed, setManaged]   = useState<ManagedSource[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [type, setType]         = useState<'rss' | 'newsletter'>('rss')
  const [name, setName]         = useState('')
  const [url, setUrl]           = useState('')
  const [saving, setSaving]     = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchManagedSources()
      .then(setManaged)
      .catch(() => setError('Eigene Quellen konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    setSaving(true)
    setFormError(null)
    try {
      const created = await createManagedSource({ name: name.trim(), source_type: type, url: url.trim() })
      setManaged(prev => [...prev, created])
      setName('')
      setUrl('')
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Fehler beim Speichern.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id)
    try {
      await deleteManagedSource(id)
      setManaged(prev => prev.filter(s => s.id !== id))
    } catch {
      // ignore
    } finally {
      setDeletingId(null)
    }
  }

  const meta = TYPE_LABELS[type]

  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
      <h3 className="text-sm uppercase tracking-[0.18em] text-slate-500 font-medium m-0 mb-1">
        Quelle hinzufügen
      </h3>
      <p className="text-xs text-slate-500 m-0 mb-5">
        Eigene RSS-Feeds oder Newsletter-Adressen — werden beim nächsten Aktualisieren mitgefetcht.
      </p>

      <form onSubmit={handleAdd} className="flex flex-col gap-4">
        {/* Typ-Toggle */}
        <div className="flex gap-1">
          {(['rss', 'newsletter'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                type === t
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                  : 'text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              {TYPE_LABELS[t].label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="z.B. Mein KI-Blog"
              required
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400">{meta.fieldLabel}</label>
            <input
              type={type === 'newsletter' ? 'email' : 'url'}
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={meta.placeholder}
              required
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 font-mono"
            />
          </div>
        </div>

        {formError && (
          <p className="text-xs text-red-400">{formError}</p>
        )}

        <div>
          <button
            type="submit"
            disabled={saving || !name.trim() || !url.trim()}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm text-white font-medium transition-colors flex items-center gap-2"
          >
            {saving && (
              <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {saving ? 'Speichern…' : '+ Hinzufügen'}
          </button>
        </div>
      </form>

      {/* Existing managed sources */}
      {!loading && !error && managed.length > 0 && (
        <div className="mt-6 border-t border-slate-800 pt-5">
          <p className="text-xs text-slate-500 mb-3">Eigene Quellen ({managed.length})</p>
          <ul className="flex flex-col gap-2 m-0 p-0 list-none">
            {managed.map(s => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-slate-800/50 border border-slate-700/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${
                    s.source_type === 'newsletter'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                  }`}>
                    {s.source_type === 'newsletter' ? 'NL' : 'RSS'}
                  </span>
                  <span className="text-sm text-slate-100 font-medium shrink-0">{s.name}</span>
                  <span className="text-xs text-slate-500 truncate font-mono">{s.url}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(s.id)}
                  disabled={deletingId === s.id}
                  title="Löschen"
                  className="text-slate-600 hover:text-red-400 transition-colors disabled:opacity-40 shrink-0 text-base leading-none"
                >
                  {deletingId === s.id ? '…' : '✕'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && <p className="text-xs text-slate-500 mt-4">Lade…</p>}
      {error   && <p className="text-xs text-red-400 mt-4">{error}</p>}
    </section>
  )
}

// ── Main Settings component ───────────────────────────────────────────────────

export function Settings() {
  return (
    <div className="flex flex-col gap-8">
      <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 sm:p-8">
        <h2 className="text-base font-semibold text-slate-100 m-0 mb-2">Quelleninventar</h2>
        <p className="text-sm text-slate-400 m-0 max-w-3xl">
          Aktive Feeds. Paper-Quellen (ArXiv, HuggingFace Daily Papers) werden gesondert
          behandelt: sie landen direkt im Paper-Stream und überspringen die inhaltliche
          Klassifizierung durch Claude.
        </p>
      </section>

      <SystemSettingsPanel />

      <ManagedSourcesForm />

      <SourceInventory />
    </div>
  )
}
