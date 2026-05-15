from typing import Literal, TypedDict

from .config import RSS_FEEDS

StorySection = Literal["general", "research"]
StoryKind = Literal["general", "research", "paper"]
SourceCategory = Literal["official", "media", "community", "policy", "papers"]
IngestionMode = Literal["rss", "api", "scrape", "hybrid"]
FeedScope = Literal["focused", "broad"]


class SourceMetadata(TypedDict):
    name: str
    url: str
    type: str
    section: StorySection
    story_kind: StoryKind
    category: SourceCategory
    ingestion_mode: IngestionMode
    feed_scope: FeedScope
    is_primary_source: bool


_METADATA_OVERRIDES: dict[str, dict] = {
    "OpenAI Blog": {
        "section": "general",
        "story_kind": "general",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "Anthropic News": {
        "section": "general",
        "story_kind": "general",
        "category": "official",
        "ingestion_mode": "hybrid",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "Google DeepMind": {
        "section": "research",
        "story_kind": "research",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "Google AI Blog": {
        "section": "general",
        "story_kind": "general",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "Google Gemini Blog": {
        "section": "general",
        "story_kind": "general",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "Google Research": {
        "section": "research",
        "story_kind": "research",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "NVIDIA AI Blog": {
        "section": "general",
        "story_kind": "general",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "broad",
        "is_primary_source": True,
    },
    "Microsoft Research": {
        "section": "research",
        "story_kind": "research",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "Microsoft AI Blog": {
        "section": "general",
        "story_kind": "general",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "Microsoft Power Platform Blog": {
        "section": "general",
        "story_kind": "general",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "broad",
        "is_primary_source": True,
    },
    "HuggingFace Blog": {
        "section": "research",
        "story_kind": "research",
        "category": "community",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "ArXiv cs.AI": {
        "section": "research",
        "story_kind": "paper",
        "category": "papers",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "ArXiv cs.LG": {
        "section": "research",
        "story_kind": "paper",
        "category": "papers",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "ArXiv cs.CL": {
        "section": "research",
        "story_kind": "paper",
        "category": "papers",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "TechCrunch AI": {
        "section": "general",
        "story_kind": "general",
        "category": "media",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": False,
    },
    "The Verge": {
        "section": "general",
        "story_kind": "general",
        "category": "media",
        "ingestion_mode": "rss",
        "feed_scope": "broad",
        "is_primary_source": False,
    },
    "VentureBeat AI": {
        "section": "general",
        "story_kind": "general",
        "category": "media",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": False,
    },
    "MIT Technology Review AI": {
        "section": "general",
        "story_kind": "general",
        "category": "media",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": False,
    },
    "Wired AI": {
        "section": "general",
        "story_kind": "general",
        "category": "media",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": False,
    },
    "Ars Technica": {
        "section": "general",
        "story_kind": "general",
        "category": "media",
        "ingestion_mode": "rss",
        "feed_scope": "broad",
        "is_primary_source": False,
    },
    "AWS ML Blog": {
        "section": "research",
        "story_kind": "research",
        "category": "official",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": True,
    },
    "The Decoder": {
        "section": "general",
        "story_kind": "general",
        "category": "media",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": False,
    },
    "Heise KI": {
        "section": "general",
        "story_kind": "general",
        "category": "media",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": False,
    },
    "EU AI Act News": {
        "section": "research",
        "story_kind": "research",
        "category": "policy",
        "ingestion_mode": "rss",
        "feed_scope": "focused",
        "is_primary_source": False,
    },
    "Hacker News": {
        "name": "Hacker News",
        "url": "https://news.ycombinator.com",
        "type": "hackernews",
        "section": "general",
        "story_kind": "general",
        "category": "community",
        "ingestion_mode": "api",
        "feed_scope": "broad",
        "is_primary_source": False,
    },
}

_DEFAULT_METADATA = {
    "section": "general",
    "story_kind": "general",
    "category": "media",
    "ingestion_mode": "rss",
    "feed_scope": "focused",
    "is_primary_source": False,
}


def _build_catalog() -> dict[str, SourceMetadata]:
    catalog: dict[str, SourceMetadata] = {}
    for feed in RSS_FEEDS:
        override = _METADATA_OVERRIDES.get(feed["name"], {})
        catalog[feed["name"]] = {
            "name": feed["name"],
            "url": feed["url"],
            "type": "rss",
            "section": override.get("section", _DEFAULT_METADATA["section"]),
            "story_kind": override.get("story_kind", _DEFAULT_METADATA["story_kind"]),
            "category": override.get("category", _DEFAULT_METADATA["category"]),
            "ingestion_mode": override.get("ingestion_mode", _DEFAULT_METADATA["ingestion_mode"]),
            "feed_scope": override.get("feed_scope", _DEFAULT_METADATA["feed_scope"]),
            "is_primary_source": override.get(
                "is_primary_source",
                _DEFAULT_METADATA["is_primary_source"],
            ),
        }

    hacker_news = _METADATA_OVERRIDES["Hacker News"]
    catalog["Hacker News"] = {
        "name": hacker_news["name"],
        "url": hacker_news["url"],
        "type": hacker_news["type"],
        "section": hacker_news["section"],
        "story_kind": hacker_news["story_kind"],
        "category": hacker_news["category"],
        "ingestion_mode": hacker_news["ingestion_mode"],
        "feed_scope": hacker_news["feed_scope"],
        "is_primary_source": hacker_news["is_primary_source"],
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
        "section": _DEFAULT_METADATA["section"],
        "story_kind": _DEFAULT_METADATA["story_kind"],
        "category": _DEFAULT_METADATA["category"],
        "ingestion_mode": _DEFAULT_METADATA["ingestion_mode"],
        "feed_scope": _DEFAULT_METADATA["feed_scope"],
        "is_primary_source": _DEFAULT_METADATA["is_primary_source"],
    }


def list_source_configs() -> list[SourceMetadata]:
    return sorted(SOURCE_CATALOG.values(), key=lambda item: item["name"].lower())


def story_signals_for_source_names(source_names: list[str]) -> dict:
    if not source_names:
        return {
            "section": "general",
            "story_kind": "general",
            "has_primary_source": False,
            "has_broad_source": False,
            "source_categories": [],
            "source_ingestion_modes": [],
        }

    metas = [get_source_metadata(name) for name in source_names]
    unique_categories = sorted({meta["category"] for meta in metas})
    unique_ingestion_modes = sorted({meta["ingestion_mode"] for meta in metas})
    all_papers = all(meta["story_kind"] == "paper" for meta in metas)
    has_research = any(meta["section"] == "research" for meta in metas)

    story_kind: StoryKind
    if all_papers:
        story_kind = "paper"
    elif has_research:
        story_kind = "research"
    else:
        story_kind = "general"

    section: StorySection = "research" if story_kind in {"research", "paper"} else "general"
    return {
        "section": section,
        "story_kind": story_kind,
        "has_primary_source": any(meta["is_primary_source"] for meta in metas),
        "has_broad_source": any(meta["feed_scope"] == "broad" for meta in metas),
        "source_categories": unique_categories,
        "source_ingestion_modes": unique_ingestion_modes,
    }
