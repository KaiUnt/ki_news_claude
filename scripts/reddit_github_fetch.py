#!/usr/bin/env python3
"""Fetches Reddit posts and pushes them to the KI-News server via import API.

Designed for GitHub Actions — GitHub IPs bypass Reddit's datacenter block.
Requires env vars: BACKEND_URL, REDDIT_IMPORT_SECRET
"""
import os
import sys
import time
from datetime import datetime, timezone

import requests

SUBREDDITS = ["anthropic", "openai", "CopilotStudio", "AIAgentsinAction", "singularity"]
SORTS = [("hot", {}), ("top", {"t": "day"})]
LIMIT = 25
HEADERS = {"User-Agent": "ki-news/1.0"}
DELAY = 1.2


def compute_sentiment(upvote_ratio: float, score: int) -> str:
    if upvote_ratio >= 0.90: return "sehr positiv"
    if upvote_ratio >= 0.75: return "positiv"
    if upvote_ratio >= 0.60: return "gemischt"
    return "kontrovers"


def fetch_subreddit(sub: str, sort: str, params: dict) -> list[dict]:
    url = f"https://www.reddit.com/r/{sub}/{sort}.json"
    try:
        r = requests.get(url, params={"limit": LIMIT, **params}, headers=HEADERS, timeout=10)
        if r.status_code in (403, 404):
            print(f"  r/{sub}/{sort}: HTTP {r.status_code}", flush=True)
            return []
        r.raise_for_status()
        return [c["data"] for c in r.json()["data"]["children"]]
    except Exception as e:
        print(f"  Error r/{sub}/{sort}: {e}", flush=True)
        return []


def to_post(p: dict) -> dict | None:
    if not p.get("id"):
        return None
    is_self = p.get("is_self", False)
    score = p.get("score", 0)
    ratio = p.get("upvote_ratio", 0.5)
    return {
        "reddit_id": p["id"],
        "subreddit": p.get("subreddit", ""),
        "title": p.get("title", ""),
        "permalink": "https://www.reddit.com" + p.get("permalink", ""),
        "external_url": "" if is_self else p.get("url", ""),
        "is_self": is_self,
        "score": score,
        "upvote_ratio": ratio,
        "num_comments": p.get("num_comments", 0),
        "flair": p.get("link_flair_text") or None,
        "sentiment": compute_sentiment(ratio, score),
        "created_utc": datetime.fromtimestamp(
            p.get("created_utc", 0), tz=timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%S"),
    }


def main() -> None:
    backend_url = os.environ.get("BACKEND_URL", "").rstrip("/")
    import_secret = os.environ.get("REDDIT_IMPORT_SECRET", "")
    basic_user = os.environ.get("KINEWS_BASIC_USER", "")
    basic_pass = os.environ.get("KINEWS_BASIC_PASS", "")

    if not backend_url or not import_secret:
        print("ERROR: BACKEND_URL und REDDIT_IMPORT_SECRET müssen gesetzt sein.", flush=True)
        sys.exit(1)

    basic_auth = (basic_user, basic_pass) if basic_user and basic_pass else None

    posts = []
    for sub in SUBREDDITS:
        for sort, params in SORTS:
            print(f"Fetching r/{sub}/{sort}…", flush=True)
            raw = fetch_subreddit(sub, sort, params)
            for item in raw:
                post = to_post(item)
                if post:
                    posts.append(post)
            time.sleep(DELAY)

    print(f"\nGefetcht: {len(posts)} Posts", flush=True)

    r = requests.post(
        f"{backend_url}/api/reddit/import",
        json={"posts": posts},
        headers={"Authorization": f"Bearer {import_secret}"},
        auth=basic_auth,
        timeout=30,
    )
    r.raise_for_status()
    result = r.json()
    print(f"Server: {result['new_saved']} neu gespeichert ({result['fetched']} gesamt)", flush=True)


if __name__ == "__main__":
    main()
