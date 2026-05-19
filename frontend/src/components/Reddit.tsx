import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchRedditPosts, fetchRedditStats, triggerRedditFetch } from '../api'
import type { RedditPost, RedditSubredditStats } from '../types'
import type { RedditSortOrder } from '../api'

const SUBREDDITS = ['anthropic', 'openai', 'CopilotStudio', 'AIAgentsinAction', 'singularity']

const SENTIMENT_STYLES: Record<string, string> = {
  'sehr positiv': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  'positiv':      'bg-green-500/15 text-green-400 border-green-500/30',
  'gemischt':     'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  'kontrovers':   'bg-red-500/15 text-red-400 border-red-500/30',
  'neutral':      'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

function ageStr(isoUtc: string): string {
  const delta = Date.now() - new Date(isoUtc + 'Z').getTime()
  const h = Math.floor(delta / 3_600_000)
  if (h < 1) return `${Math.floor(delta / 60_000)}m`
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function RatioBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100)
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className="h-full rounded-full bg-indigo-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-500">{pct}%</span>
    </div>
  )
}

function PostCard({ post }: { post: RedditPost }) {
  const sentimentClass = SENTIMENT_STYLES[post.sentiment] ?? SENTIMENT_STYLES['neutral']
  const targetUrl = post.is_self ? post.permalink : post.external_url

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 flex flex-col gap-3 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-indigo-400">r/{post.subreddit}</span>
        <span className="text-xs text-slate-500 shrink-0">{ageStr(post.created_utc)}</span>
      </div>

      <a
        href={targetUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-slate-100 hover:text-white leading-snug font-medium line-clamp-3"
      >
        {post.title}
      </a>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded border ${sentimentClass}`}>
          {post.sentiment}
        </span>
        {post.flair && (
          <span className="text-xs px-2 py-0.5 rounded border border-slate-700 text-slate-400">
            {post.flair}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-800">
        <div className="flex items-center gap-3">
          <span>↑ {post.score.toLocaleString()}</span>
          <span>💬 {post.num_comments.toLocaleString()}</span>
        </div>
        <RatioBar ratio={post.upvote_ratio} />
      </div>

      {!post.is_self && (
        <div className="flex items-center gap-2 text-xs">
          <a
            href={post.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300 truncate"
          >
            ↗ Artikel
          </a>
          <span className="text-slate-700">·</span>
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-slate-300"
          >
            Reddit-Thread
          </a>
        </div>
      )}
    </div>
  )
}

function StatsBar({ stats }: { stats: RedditSubredditStats[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {stats.map(s => (
        <div key={s.subreddit} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
          <div className="text-xs text-indigo-400 font-medium truncate">r/{s.subreddit}</div>
          <div className="text-lg font-bold text-slate-100">{s.count}</div>
          <div className="text-xs text-slate-500">⌀ {s.avg_score.toLocaleString()} pts</div>
        </div>
      ))}
    </div>
  )
}

export function Reddit() {
  const [posts, setPosts]           = useState<RedditPost[]>([])
  const [total, setTotal]           = useState(0)
  const [stats, setStats]           = useState<RedditSubredditStats[]>([])
  const [subreddit, setSubreddit]   = useState<string>('')
  const [sort, setSort]             = useState<RedditSortOrder>('score')
  const [loading, setLoading]       = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fetching, setFetching]     = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (sub: string, s: RedditSortOrder, offset = 0) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    if (offset === 0) setLoading(true)
    else setLoadingMore(true)
    setError(null)

    try {
      const data = await fetchRedditPosts(sub || undefined, s, 50, offset, ctrl.signal)
      if (offset === 0) {
        setPosts(data.items)
      } else {
        setPosts(prev => [...prev, ...data.items])
      }
      setTotal(data.total)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError('Fehler beim Laden — läuft das Backend?')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    load(subreddit, sort, 0)
    fetchRedditStats().then(setStats).catch(() => {})
  }, [subreddit, sort, load])

  async function handleFetch() {
    if (fetching) return
    setFetching(true)
    try {
      await triggerRedditFetch()
      await load(subreddit, sort, 0)
      const s = await fetchRedditStats()
      setStats(s)
    } catch {
      setError('Fetch fehlgeschlagen')
    } finally {
      setFetching(false)
    }
  }

  const hasMore = posts.length < total

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h2 className="text-base font-semibold text-slate-200">Reddit · KI-Community</h2>
        <button
          type="button"
          onClick={handleFetch}
          disabled={fetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-slate-100 text-xs disabled:opacity-50 transition-colors"
        >
          {fetching
            ? <span className="w-3 h-3 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin" />
            : <span aria-hidden>↻</span>}
          Aktualisieren
        </button>
      </div>

      {stats.length > 0 && <StatsBar stats={stats} />}

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => setSubreddit('')}
            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
              subreddit === ''
                ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                : 'text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            Alle
          </button>
          {SUBREDDITS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSubreddit(subreddit === s ? '' : s)}
              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                subreddit === s
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                  : 'text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              r/{s}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {(['score', 'date', 'ratio', 'comments'] as RedditSortOrder[]).map(o => (
            <button
              key={o}
              type="button"
              onClick={() => setSort(o)}
              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                sort === o
                  ? 'bg-slate-700 text-slate-200 border-slate-600'
                  : 'text-slate-500 border-slate-800 hover:text-slate-300'
              }`}
            >
              {o === 'score' ? 'Score' : o === 'date' ? 'Datum' : o === 'ratio' ? 'Ratio' : 'Kommentare'}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="text-center py-20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && posts.length === 0 && (
        <div className="text-center py-20 text-slate-500 text-sm">
          Keine Posts vorhanden. Klicke "Aktualisieren" um Daten zu laden.
        </div>
      )}

      {!loading && posts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {posts.map(post => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div className="flex justify-center mt-8">
          <button
            type="button"
            onClick={() => load(subreddit, sort, posts.length)}
            disabled={loadingMore}
            className="px-6 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-300 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loadingMore && (
              <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin" />
            )}
            {loadingMore ? 'Lade…' : `Mehr laden (${total - posts.length} übrig)`}
          </button>
        </div>
      )}
    </div>
  )
}
