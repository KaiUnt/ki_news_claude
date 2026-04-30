import os
from dotenv import load_dotenv

load_dotenv()

AVAILABLE_TAGS = [
    "Neue Modelle",
    "Tools & Produkte",
    "Technik & Infrastruktur",
    "Forschung / Paper",
    "Kosten & Business",
    "Open Source",
    "Sonstiges",
]

RSS_FEEDS = [
    # ── KI-Labs & Unternehmen ──────────────────────────────────────────────────
    {
        "name": "OpenAI Blog",
        "url": "https://openai.com/blog/rss.xml",
        "tag_hint": "Neue Modelle",
    },
    {
        "name": "Google DeepMind",
        "url": "https://deepmind.google/blog/rss.xml",
        "tag_hint": "Forschung / Paper",
    },
    {
        "name": "Google AI Blog",
        "url": "https://blog.google/technology/ai/rss/",
        "tag_hint": "Neue Modelle",
    },
    {
        "name": "Google Gemini Blog",
        "url": "https://blog.google/products/gemini/rss/",
        "tag_hint": "Neue Modelle",
    },
    {
        "name": "Google Research",
        "url": "https://research.google/blog/rss/",
        "tag_hint": "Forschung / Paper",
    },
    {
        "name": "NVIDIA AI Blog",
        "url": "https://blogs.nvidia.com/feed/",
        "tag_hint": "Technik & Infrastruktur",
    },
    {
        "name": "Microsoft Research",
        "url": "https://www.microsoft.com/en-us/research/blog/feed/",
        "tag_hint": "Forschung / Paper",
    },
    # ── Community & Open Source ────────────────────────────────────────────────
    {
        "name": "HuggingFace Blog",
        "url": "https://huggingface.co/blog/feed.xml",
        "tag_hint": "Tools & Produkte",
    },
    {
        "name": "ArXiv cs.AI",
        "url": "https://arxiv.org/rss/cs.AI",
        "tag_hint": "Forschung / Paper",
    },
    {
        "name": "ArXiv cs.LG",
        "url": "https://arxiv.org/rss/cs.LG",
        "tag_hint": "Forschung / Paper",
    },
    # ── Technologie-Medien ─────────────────────────────────────────────────────
    {
        "name": "TechCrunch AI",
        "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
        "tag_hint": "Neue Modelle",
    },
    {
        "name": "The Verge",
        "url": "https://www.theverge.com/rss/index.xml",
        "tag_hint": "Neue Modelle",
    },
    {
        "name": "VentureBeat AI",
        "url": "https://venturebeat.com/category/ai/feed/",
        "tag_hint": "Kosten & Business",
    },
    {
        "name": "MIT Technology Review AI",
        "url": "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
        "tag_hint": "Forschung / Paper",
    },
    {
        "name": "Wired AI",
        "url": "https://www.wired.com/feed/tag/ai/latest/rss",
        "tag_hint": "Technik & Infrastruktur",
    },
    {
        "name": "Ars Technica",
        "url": "https://feeds.arstechnica.com/arstechnica/index",
        "tag_hint": "Technik & Infrastruktur",
    },
    {
        "name": "AWS ML Blog",
        "url": "https://aws.amazon.com/blogs/machine-learning/feed/",
        "tag_hint": "Technik & Infrastruktur",
    },
]


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/kinews.db")
    model_id: str = "claude-haiku-4-5-20251001"
    max_articles_per_fetch: int = int(os.getenv("MAX_ARTICLES_PER_FETCH", "100"))
    dedup_title_threshold: float = float(os.getenv("DEDUP_TITLE_THRESHOLD", "0.85"))
    content_max_chars: int = 3000


settings = Settings()
