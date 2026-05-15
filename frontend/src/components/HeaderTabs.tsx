import type { View } from '../types'

interface Props {
  view: View
  onChange: (v: View) => void
}

const TABS: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'all',       label: 'Alle Stories' },
  { id: 'favorites', label: 'Favoriten' },
  { id: 'settings',  label: 'Settings' },
]

export function HeaderTabs({ view, onChange }: Props) {
  return (
    <nav className="flex items-center gap-1" aria-label="Hauptnavigation">
      {TABS.map(tab => {
        const active = tab.id === view
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={active ? 'page' : undefined}
            className={
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors ' +
              (active
                ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200 border border-transparent hover:border-slate-700')
            }
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
