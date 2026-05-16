"""
Source-based metadata for stories.

After the tag-schema rewrite the only source-level signal that still drives
behavior is `story_kind`: ArXiv-style paper feeds get `paper`, everything else
gets `general`. The paper flag gates two things:
  - Summarizer skips content-tagging (papers stay with tags=[]).
  - Dashboard renders a dedicated Paper-Stream lane.

All other source attributes (section, category, ingestion_mode, feed_scope,
is_primary_source) were either pure decoration or duplicated what the new
content tags already express, and have been removed.
"""
from typing import Literal, TypedDict

from .config import RSS_FEEDS

StoryKind = Literal["general", "paper"]


class SourceMetadata(TypedDict):
    name: str
    url: str
    type: str
    story_kind: StoryKind


# Feed names whose stories should be treated as papers (skip content-tagging,
# routed to the Paper-Stream lane). Any feed delivering raw arXiv-style
# abstracts belongs here.
_PAPER_SOURCES = {
    "ArXiv cs.AI",
    "ArXiv cs.LG",
    "ArXiv cs.CL",
    "HuggingFace Daily Papers",
}


def _build_catalog() -> dict[str, SourceMetadata]:
    catalog: dict[str, SourceMetadata] = {}
    for feed in RSS_FEEDS:
        catalog[feed["name"]] = {
            "name": feed["name"],
            "url": feed["url"],
            "type": "rss",
            "story_kind": "paper" if feed["name"] in _PAPER_SOURCES else "general",
        }
    catalog["Hacker News"] = {
        "name": "Hacker News",
        "url": "https://news.ycombinator.com",
        "type": "hackernews",
        "story_kind": "general",
    }
    return catalog


SOURCE_CATALOG = _build_catalog()


def get_source_metadata(source_name: str) -> SourceMetadata:
    meta = SOURCE_CATALOG.get(source_name)
    if meta is not None:
        return meta
    return {
        "name": source_name,
        "url": "",
        "type": "unknown",
        "story_kind": "general",
    }


def list_source_configs() -> list[SourceMetadata]:
    return sorted(SOURCE_CATALOG.values(), key=lambda item: item["name"].lower())


def story_signals_for_source_names(source_names: list[str]) -> dict:
    """Aggregate per-source signals into story-level signals.

    A story is a `paper` only if *all* its sources are paper-feeds — a mixed
    cluster (e.g. an arXiv paper + a TechCrunch article reporting on it) is
    treated as a general story so it gets the full content-tag treatment.
    """
    if not source_names:
        return {"story_kind": "general"}
    metas = [get_source_metadata(name) for name in source_names]
    all_papers = all(meta["story_kind"] == "paper" for meta in metas)
    return {"story_kind": "paper" if all_papers else "general"}
