import hashlib
import re
from difflib import SequenceMatcher
from .fetcher.base import RawArticle
from .config import settings


def _normalize_title(title: str) -> str:
    return re.sub(r"\s+", " ", title.lower().strip())


def _title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _normalize_title(a), _normalize_title(b)).ratio()


def content_hash(article: RawArticle) -> str:
    key = _normalize_title(article.title)
    return hashlib.sha256(key.encode()).hexdigest()


def deduplicate(
    articles: list[RawArticle],
    existing_urls: set[str],
    existing_hashes: set[str],
) -> list[RawArticle]:
    result: list[RawArticle] = []
    seen_urls = set(existing_urls)
    seen_hashes = set(existing_hashes)
    seen_titles: list[str] = []

    for article in articles:
        if article.url in seen_urls:
            continue

        h = content_hash(article)
        if h in seen_hashes:
            continue

        # fuzzy title check against already-accepted batch items
        is_near_dup = any(
            _title_similarity(article.title, t) >= settings.dedup_title_threshold
            for t in seen_titles
        )
        if is_near_dup:
            continue

        seen_urls.add(article.url)
        seen_hashes.add(h)
        seen_titles.append(article.title)
        result.append(article)

    return result
