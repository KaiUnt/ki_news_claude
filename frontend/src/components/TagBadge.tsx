const TAG_STYLES: Record<string, string> = {
  'Neue Modelle':            'bg-purple-950 text-purple-300 border-purple-700',
  'Tools & Produkte':        'bg-teal-950 text-teal-300 border-teal-700',
  'Technik & Infrastruktur': 'bg-orange-950 text-orange-300 border-orange-700',
  'Forschung / Paper':       'bg-blue-950 text-blue-300 border-blue-700',
  'Kosten & Business':       'bg-amber-950 text-amber-300 border-amber-700',
  'Open Source':             'bg-green-950 text-green-300 border-green-700',
  'Sonstiges':               'bg-slate-800 text-slate-400 border-slate-600',
}

const DEFAULT_STYLE = 'bg-slate-800 text-slate-400 border-slate-600'

interface Props {
  tag: string
  active?: boolean
  onClick?: () => void
}

export function TagBadge({ tag, active = false, onClick }: Props) {
  const base = TAG_STYLES[tag] ?? DEFAULT_STYLE
  const cursor = onClick ? 'cursor-pointer hover:opacity-80' : ''
  const ring = active ? 'ring-1 ring-white/30' : ''

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${base} ${cursor} ${ring} select-none transition-opacity`}
      onClick={onClick}
    >
      {tag}
    </span>
  )
}
