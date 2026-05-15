from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import httpx

from .base import BaseFetcher, RawArticle
from ..config import settings

_HN_SEARCH = "https://hn.algolia.com/api/v1/search"
_QUERY_TERMS = [
    "AI",
    "LLM",
    "GPT",
    "Claude",
    "Gemini",
    "OpenAI",
    "Anthropic",
    "Mistral",
    "Llama",
    "Copilot",
]
_STRONG_AI_TERMS = (
    "llm",
    "gpt",
    "claude",
    "gemini",
    "openai",
    "anthropic",
    "mistral",
    "llama",
    "copilot",
    "stable diffusion",
    "diffusion",
    "transformer",
    "ai agent",
    "agents",
    "model context",
    "rag",
    "benchmark",
)
_WEAK_AI_TERMS = (
    " ai ",
    "artificial intelligence",
    "machine learning",
    "deep learning",
    "neural",
    "inference",
    "fine-tuning",
    "fine tuning",
)
_BANNED_PREFIXES = (
    "show hn:",
    "ask hn:",
    "tell hn:",
    "launch hn:",
    "hiring",
    "who is hiring",
)


def _normalize(text: str) -> str:
    return f" {text.strip().lower()} "


def _title_keyword_score(title: str, url: str) -> int:
    haystack = _normalize(f"{title} {url}")
    score = 0
    for term in _STRONG_AI_TERMS:
        if term in haystack:
            score += 2
    for term in _WEAK_AI_TERMS:
        if term in haystack:
            score += 1
    return score


def _is_banned_title(title: str) -> bool:
    normalized = title.strip().lower()
    return any(normalized.startswith(prefix) for prefix in _BANNED_PREFIXES)


def _is_external_url(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    return bool(hostname and hostname != "news.ycombinator.com")


class HackerNewsFetcher(BaseFetcher):
    def __init__(
        self,
        max_items: int | None = None,
        days_back: int | None = None,
        min_points: int | None = None,
        min_comments: int | None = None,
    ):
        self.max_items = max_items or settings.hackernews_max_items
        self.days_back = days_back or settings.hackernews_days_back
        self.min_points = min_points if min_points is not None else settings.hackernews_min_points
        self.min_comments = (
            min_comments if min_comments is not None else settings.hackernews_min_comments
        )

    def fetch(self) -> list[RawArticle]:
        articles: list[tuple[int, int, int, RawArticle]] = []
        since = int((datetime.now(UTC) - timedelta(days=self.days_back)).timestamp())
        query = " ".join(_QUERY_TERMS)
        try:
            resp = httpx.get(
                _HN_SEARCH,
                params={
                    "query": query,
                    "tags": "story",
                    "numericFilters": f"created_at_i>{since}",
                    "hitsPerPage": max(self.max_items * settings.hackernews_fetch_multiplier, self.max_items),
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
            url = (hit.get("url") or "").strip()
            title = (hit.get("title") or "").strip()
            if not url or not title or url in seen_urls:
                continue
            if not _is_external_url(url) or _is_banned_title(title):
                continue

            keyword_score = _title_keyword_score(title, url)
            if keyword_score <= 0:
                continue

            score = hit.get("points", 0) or 0
            num_comments = hit.get("num_comments", 0) or 0
            if (
                score < self.min_points
                and num_comments < self.min_comments
                and keyword_score < 3
            ):
                continue

            seen_urls.add(url)
            ts = hit.get("created_at_i")
            published_at = datetime.fromtimestamp(ts, UTC).replace(tzinfo=None) if ts else None
            hostname = (urlparse(url).hostname or "").lower()
            content = (
                f"HN Score: {score} | Kommentare: {num_comments} | "
                f"Keyword-Score: {keyword_score} | Domain: {hostname}"
            )
            articles.append((
                keyword_score,
                score,
                num_comments,
                RawArticle(
                    url=url,
                    title=title,
                    source_name="Hacker News",
                    source_type="hackernews",
                    content=content,
                    published_at=published_at,
                    tag_hint=None,
                ),
            ))

        articles.sort(
            key=lambda item: (
                item[0],
                item[1],
                item[2],
                item[3].published_at or datetime.min,
            ),
            reverse=True,
        )
        return [article for _, _, _, article in articles[: self.max_items]]
