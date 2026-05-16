import os
from dotenv import load_dotenv

load_dotenv()

STORY_TYPES = [
    "release",
    "forschung",
    "tool",
    "infrastruktur",
    "business",
    "policy",
    "demo",
]

STORY_DOMAINS = [
    "llm-core",
    "coding",
    "agenten",
    "bild-video",
    "audio",
    "robotik",
    "vertikal",
    "sonstige",
]

STORY_FLAGS = [
    "open-source",
    "frontier",
    "big-lab",
]

# Heuristic mapping for stories tagged before the schema rewrite. Applied at
# read-time in _normalize_tags so old data stays filterable without re-tagging.
# Entries that map to None are silently dropped.
LEGACY_TAG_MAPPING: dict[str, str | None] = {
    "Neue Modelle": "type:release",
    "Tools & Produkte": "type:tool",
    "Technik & Infrastruktur": "type:infrastruktur",
    "Forschung / Paper": "type:forschung",
    "Kosten & Business": "type:business",
    "Open Source": "flag:open-source",
    "Sonstiges": None,
}


def normalize_tags(tags: list[str]) -> list[str]:
    """Translate legacy tag names to the new prefixed schema.

    Already-prefixed tags pass through unchanged. Unknown legacy strings drop out.
    Used at read time so existing stories stay filterable without re-tagging.
    """
    result: list[str] = []
    for t in tags:
        if ":" in t:
            result.append(t)
            continue
        mapped = LEGACY_TAG_MAPPING.get(t)
        if mapped:
            result.append(mapped)
    return result

RSS_FEEDS = [
    # ── KI-Labs & Unternehmen ──────────────────────────────────────────────────
    {
        "name": "OpenAI Blog",
        "url": "https://openai.com/news/rss.xml",
    },
    {
        "name": "Anthropic News",
        # Anthropic hat keinen offiziellen Feed; Olshansk-Mirror wird stuendlich regeneriert.
        "url": "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml",
    },
    {
        "name": "Google DeepMind",
        "url": "https://deepmind.google/blog/rss.xml",
    },
    {
        "name": "Google AI Blog",
        "url": "https://blog.google/technology/ai/rss/",
    },
    {
        "name": "Google Gemini Blog",
        "url": "https://blog.google/products/gemini/rss/",
    },
    {
        "name": "Google Research",
        "url": "https://research.google/blog/rss/",
    },
    {
        "name": "NVIDIA AI Blog",
        "url": "https://blogs.nvidia.com/feed/",
    },
    {
        "name": "Microsoft Research",
        "url": "https://www.microsoft.com/en-us/research/blog/feed/",
    },
    {
        "name": "Microsoft AI Blog",
        "url": "https://blogs.microsoft.com/ai/feed/",
    },
    {
        "name": "Anthropic Research",
        "url": "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_research.xml",
    },
    {
        "name": "Anthropic Engineering",
        "url": "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml",
    },
    # ── Community & Open Source ────────────────────────────────────────────────
    {
        "name": "HuggingFace Blog",
        "url": "https://huggingface.co/blog/feed.xml",
    },
    {
        "name": "HuggingFace Daily Papers",
        "url": "https://papers.takara.ai/api/feed",
    },
    {
        "name": "ArXiv cs.AI",
        "url": "https://export.arxiv.org/rss/cs.AI",
    },
    {
        "name": "ArXiv cs.LG",
        "url": "https://export.arxiv.org/rss/cs.LG",
    },
    {
        "name": "ArXiv cs.CL",
        "url": "https://export.arxiv.org/rss/cs.CL",
    },
    # ── Technologie-Medien ─────────────────────────────────────────────────────
    {
        "name": "TechCrunch AI",
        "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
    },
    {
        "name": "VentureBeat AI",
        "url": "https://venturebeat.com/category/ai/feed/",
    },
    {
        "name": "MIT Technology Review AI",
        "url": "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
    },
    {
        "name": "Wired AI",
        "url": "https://www.wired.com/feed/tag/ai/latest/rss",
    },
    {
        "name": "AWS ML Blog",
        "url": "https://aws.amazon.com/blogs/machine-learning/feed/",
    },
    {
        "name": "The Decoder",
        "url": "https://the-decoder.de/feed/",
    },
    {
        "name": "Heise KI",
        "url": "https://www.heise.de/thema/Kuenstliche-Intelligenz.xml",
    },
    {
        "name": "Golem KI",
        "url": "https://rss.golem.de/rss.php?feed=RSS2.0&ressort=ki",
    },
    {
        "name": "t3n KI",
        "url": "https://t3n.de/tag/kuenstliche-intelligenz/rss.xml",
    },
    # ── Newsletter & Individuelle Stimmen (Substack/Atom) ──────────────────────
    {
        "name": "Simon Willison",
        "url": "https://simonwillison.net/atom/everything/",
    },
    {
        "name": "Interconnects (Nathan Lambert)",
        "url": "https://www.interconnects.ai/feed",
    },
    {
        "name": "Latent Space (Swyx)",
        "url": "https://www.latent.space/feed",
    },
    {
        "name": "Ahead of AI (Raschka)",
        "url": "https://magazine.sebastianraschka.com/feed",
    },
    # ── Regulierung & Policy ───────────────────────────────────────────────────
    {
        "name": "EU AI Act News",
        "url": "https://artificialintelligenceact.eu/feed/",
    },
]


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/kinews.db")
    model_id: str = "claude-haiku-4-5-20251001"
    max_articles_per_fetch: int = int(os.getenv("MAX_ARTICLES_PER_FETCH", "100"))
    dedup_title_threshold: float = float(os.getenv("DEDUP_TITLE_THRESHOLD", "0.85"))
    content_max_chars: int = 3000
    hackernews_max_items: int = int(os.getenv("HN_MAX_ITEMS", "30"))
    hackernews_days_back: int = int(os.getenv("HN_DAYS_BACK", "1"))
    hackernews_fetch_multiplier: int = int(os.getenv("HN_FETCH_MULTIPLIER", "4"))
    hackernews_min_points: int = int(os.getenv("HN_MIN_POINTS", "3"))
    hackernews_min_comments: int = int(os.getenv("HN_MIN_COMMENTS", "1"))


settings = Settings()
