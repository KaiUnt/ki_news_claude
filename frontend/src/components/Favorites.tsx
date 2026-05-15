import type { FavoriteWeek, Story } from '../types'
import { StoryCard } from './StoryCard'

interface Props {
  weeks: FavoriteWeek[]
  loading: boolean
  error: string | null
  onSelectStory: (id: number) => void
  onToggleFavorite: (story: Story, next: boolean) => Promise<void>
}

export function Favorites({
  weeks,
  loading,
  error,
  onSelectStory,
  onToggleFavorite,
}: Props) {
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20 text-red-400 text-sm">
        {error}
      </div>
    )
  }

  if (weeks.length === 0) {
    return (
      <div className="text-center py-20 text-slate-500 text-sm">
        Noch keine Favoriten. Markiere Stories mit dem Herz, dann erscheinen sie hier pro Woche.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {weeks.map(week => (
        <section key={week.week_start} className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-800 pb-3">
            <h2 className="text-sm uppercase tracking-wider text-slate-500 font-medium m-0">
              {week.label}
            </h2>
            <span className="text-xs text-slate-600">
              {week.items.length} {week.items.length === 1 ? 'Story' : 'Stories'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {week.items.map(item => (
              <StoryCard
                key={item.favorite_id}
                story={item.story}
                onSelect={onSelectStory}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
