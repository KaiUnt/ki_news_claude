import { tagAxis, tagLabel } from '../tagSchema'

const AXIS_STYLES = {
  type:   'bg-indigo-950 text-indigo-300 border-indigo-700',
  domain: 'bg-teal-950 text-teal-300 border-teal-700',
  flag:   'bg-amber-950 text-amber-300 border-amber-700',
} as const

const DEFAULT_STYLE = 'bg-slate-800 text-slate-400 border-slate-600'

interface Props {
  tag: string
  active?: boolean
  onClick?: () => void
}

export function TagBadge({ tag, active = false, onClick }: Props) {
  const axis = tagAxis(tag)
  const base = axis ? AXIS_STYLES[axis] : DEFAULT_STYLE
  const label = tagLabel(tag)
  const baseClass = `inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${base} select-none`

  if (onClick) {
    const stateClass = active
      ? 'opacity-100 ring-2 ring-white/60'
      : 'opacity-40 hover:opacity-90'
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`${baseClass} ${stateClass} cursor-pointer transition-opacity`}
      >
        {label}
      </button>
    )
  }

  return <span className={baseClass}>{label}</span>
}
