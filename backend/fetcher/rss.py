import feedparser
import httpx
from datetime import datetime
from dateutil import parser as dateparser
from bs4 import BeautifulSoup
from .base import BaseFetcher, RawArticle
from ..config import RSS_FEEDS, settings


def _strip_html(html: str) -> str:
    return BeautifulSoup(html, "lxml").get_text(separator=" ", strip=True)


def _parse_date(entry) -> datetime | None:
    for attr in ("published_parsed", "updated_parsed"):
        val = getattr(entry, attr, None)
        if val:
            try:
                import time
                return datetime(*val[:6])
            except Exception:
                pass
    for attr in ("published", "updated"):
        val = getattr(entry, attr, None)
        if val:
            try:
                return dateparser.parse(val)
            except Exception:
                pass
    return None


def _extract_content(entry) -> str:
    for attr in ("content", "summary_detail"):
        val = getattr(entry, attr, None)
        if val:
            raw = val[0].value if isinstance(val, list) else val.value
            return _strip_html(raw)[: settings.content_max_chars]
    summary = getattr(entry, "summary", "") or ""
    return _strip_html(summary)[: settings.content_max_chars]


class RSSFetcher(BaseFetcher):
    def __init__(self, feeds: list[dict] | None = None):
        self.feeds = feeds or RSS_FEEDS

    def fetch(self) -> list[RawArticle]:
        articles: list[RawArticle] = []
        for feed_cfg in self.feeds:
            try:
                feed = feedparser.parse(feed_cfg["url"])
                for entry in feed.entries[: settings.max_articles_per_fetch]:
                    url = getattr(entry, "link", None)
                    title = getattr(entry, "title", "").strip()
                    if not url or not title:
                        continue
                    articles.append(
                        RawArticle(
                            url=url,
                            title=title,
                            source_name=feed_cfg["name"],
                            source_type="rss",
                            content=_extract_content(entry),
                            published_at=_parse_date(entry),
                        )
                    )
            except Exception as exc:
                print(f"[RSS] Error fetching {feed_cfg['name']}: {exc}")
        return articles
