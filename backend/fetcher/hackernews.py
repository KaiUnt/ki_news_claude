import httpx
from datetime import datetime, timedelta
from .base import BaseFetcher, RawArticle
from ..config import settings

_HN_SEARCH = "https://hn.algolia.com/api/v1/search"
_AI_KEYWORDS = [
    "LLM", "GPT", "Claude", "Gemini", "AI", "artificial intelligence",
    "machine learning", "deep learning", "neural", "OpenAI", "Anthropic",
    "Mistral", "Llama", "diffusion", "transformer", "benchmark",
]


class HackerNewsFetcher(BaseFetcher):
    def __init__(self, max_items: int = 30, days_back: int = 1):
        self.max_items = max_items
        self.days_back = days_back

    def fetch(self) -> list[RawArticle]:
        articles: list[RawArticle] = []
        since = int((datetime.utcnow() - timedelta(days=self.days_back)).timestamp())
        query = " OR ".join(_AI_KEYWORDS[:6])
        try:
            resp = httpx.get(
                _HN_SEARCH,
                params={
                    "query": "AI LLM",
                    "tags": "story",
                    "numericFilters": f"created_at_i>{since}",
                    "hitsPerPage": self.max_items,
                },
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            print(f"[HN] Fetch error: {exc}")
            return []

        seen_urls: set[str] = set()
        for hit in data.get("hits", []):
            url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit['objectID']}"
            title = (hit.get("title") or "").strip()
            if not url or not title or url in seen_urls:
                continue
            seen_urls.add(url)
            ts = hit.get("created_at_i")
            published_at = datetime.utcfromtimestamp(ts) if ts else None
            score = hit.get("points", 0) or 0
            num_comments = hit.get("num_comments", 0) or 0
            content = f"HN Score: {score} | Kommentare: {num_comments}"
            articles.append(
                RawArticle(
                    url=url,
                    title=title,
                    source_name="Hacker News",
                    source_type="hackernews",
                    content=content,
                    published_at=published_at,
                    tag_hint=None,
                )
            )
        return articles
