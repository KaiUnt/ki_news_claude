"""Reddit fetcher — uses public .json endpoints, no API key required."""
import time
import logging
from datetime import datetime, timezone

import requests

from ..db import RedditPost

logger = logging.getLogger(__name__)

SUBREDDITS = ["anthropic", "openai", "CopilotStudio", "AIAgentsinAction", "singularity"]
SORTS = [("hot", {}), ("top", {"t": "day"})]
LIMIT = 25
HEADERS = {"User-Agent": "ki-news/1.0"}
DELAY = 1.2  # seconds between requests


def compute_sentiment(upvote_ratio: float, score: int) -> str:
    if upvote_ratio >= 0.90:
        return "sehr positiv"
    if upvote_ratio >= 0.75:
        return "positiv"
    if upvote_ratio >= 0.60:
        return "gemischt"
    return "kontrovers"


class RedditFetcher:
    def fetch(self) -> list[RedditPost]:
        results: list[RedditPost] = []
        for sub in SUBREDDITS:
            for sort, params in SORTS:
                raw = self._fetch_one(sub, sort, params)
                for item in raw:
                    post = self._to_post(item)
                    if post is not None:
                        results.append(post)
                time.sleep(DELAY)
        return results

    def _fetch_one(self, sub: str, sort: str, params: dict) -> list[dict]:
        url = f"https://www.reddit.com/r/{sub}/{sort}.json"
        try:
            r = requests.get(
                url,
                params={"limit": LIMIT, **params},
                headers=HEADERS,
                timeout=10,
            )
            if r.status_code in (403, 404):
                logger.warning("r/%s %s: HTTP %s", sub, sort, r.status_code)
                return []
            r.raise_for_status()
            return [c["data"] for c in r.json()["data"]["children"]]
        except Exception:
            logger.exception("Reddit fetch failed: r/%s/%s", sub, sort)
            return []

    def _to_post(self, p: dict) -> RedditPost | None:
        try:
            reddit_id = p.get("id", "")
            if not reddit_id:
                return None
            is_self = p.get("is_self", False)
            external_url = "" if is_self else p.get("url", "")
            score = p.get("score", 0)
            upvote_ratio = p.get("upvote_ratio", 0.5)
            return RedditPost(
                reddit_id=reddit_id,
                subreddit=p.get("subreddit", ""),
                title=p.get("title", ""),
                permalink="https://www.reddit.com" + p.get("permalink", ""),
                external_url=external_url,
                is_self=is_self,
                score=score,
                upvote_ratio=upvote_ratio,
                num_comments=p.get("num_comments", 0),
                flair=p.get("link_flair_text") or None,
                sentiment=compute_sentiment(upvote_ratio, score),
                created_utc=datetime.fromtimestamp(p.get("created_utc", 0), tz=timezone.utc).replace(tzinfo=None),
            )
        except Exception:
            logger.exception("Could not parse Reddit post: %s", p.get("id"))
            return None
