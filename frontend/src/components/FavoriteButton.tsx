import { useState } from 'react'

interface Props {
  isFavorite: boolean
  onToggle: (next: boolean) => Promise<void>
}

export function FavoriteButton({ isFavorite, onToggle }: Props) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const displayed = optimistic ?? isFavorite

  async function handleToggle() {
    if (pending) return
    const next = !displayed
    setOptimistic(next)
    setPending(true)
    try {
      await onToggle(next)
    } catch {
      setOptimistic(null)
    } finally {
      setOptimistic(null)
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation()
        void handleToggle()
      }}
      onKeyDown={e => e.stopPropagation()}
      disabled={pending}
      aria-pressed={displayed}
      aria-label={displayed ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufuegen'}
      title={displayed ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufuegen'}
      className={
        'shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center text-base transition-colors disabled:opacity-60 ' +
        (displayed
          ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 hover:text-rose-200'
          : 'bg-slate-950/30 border-slate-700 text-slate-500 hover:text-rose-300 hover:border-rose-500/40')
      }
    >
      <span aria-hidden="true">{displayed ? '♥' : '♡'}</span>
    </button>
  )
}
