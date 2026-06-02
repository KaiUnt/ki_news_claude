import json
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field, create_engine, Session, select, text, func
from .config import settings


# ── New models (defined before ManagedSource/Story so FK references resolve) ──

class Category(SQLModel, table=True):
    """A news category grouping sources and stories (e.g. 'KI', 'IT-Security')."""
    __tablename__ = "category"
    id: Optional[int] = Field(default=None, primary_key=True)
    slug: str = Field(unique=True, index=True)
    name: str
    icon: Optional[str] = Field(default=None)
    color: Optional[str] = Field(default=None)
    sort_order: int = Field(default=0)
    is_premium: bool = Field(default=False)
    active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    digest_prompt: Optional[str] = Field(default=None)  # NULL = uses global digest_curation prompt


class PromptSetting(SQLModel, table=True):
    """Editable AI prompt stored in DB. Falls back to hardcoded default if missing."""
    __tablename__ = "promptsetting"
    key: str = Field(primary_key=True)
    name: str
    description: str = Field(default="")
    value: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class UserCategoryPreference(SQLModel, table=True):
    """Per-user category visibility/ordering — multi-user readiness. Empty for single-user."""
    __tablename__ = "usercategorypreference"
    __table_args__ = (
        UniqueConstraint("user_profile_id", "category_id", name="uq_user_category"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    user_profile_id: int = Field(foreign_key="userprofile.id", index=True)
    category_id: int = Field(foreign_key="category.id", index=True)
    active: bool = Field(default=True)
    sort_order: Optional[int] = Field(default=None)


# ── Core models ───────────────────────────────────────────────────────────────

class Story(SQLModel, table=True):
    """A deduplicated news event, potentially reported by multiple sources."""
    id: Optional[int] = Field(default=None, primary_key=True)
    title_de: str
    summary_de: Optional[str] = None
    tags_json: Optional[str] = None
    first_seen: datetime = Field(default_factory=datetime.utcnow)
    last_updated: datetime = Field(default_factory=datetime.utcnow)
    source_count: int = Field(default=0)
    is_processed: bool = Field(default=False)  # True once summary_de is generated
    first_digest_id: Optional[int] = Field(default=None, foreign_key="dailydigest.id", index=True)
    category_id: Optional[int] = Field(default=None, foreign_key="category.id")

    @property
    def tags(self) -> list[str]:
        if self.tags_json:
            return json.loads(self.tags_json)
        return []

    @tags.setter
    def tags(self, value: list[str]) -> None:
        self.tags_json = json.dumps(value, ensure_ascii=False)


class Article(SQLModel, table=True):
    """A single article from one source — belongs to a Story."""
    id: Optional[int] = Field(default=None, primary_key=True)
    url: str = Field(unique=True, index=True)
    title: str
    source_name: str
    source_type: str  # "rss", "hackernews"
    published_at: Optional[datetime] = None
    fetched_at: datetime = Field(default_factory=datetime.utcnow)
    raw_content: Optional[str] = None
    content_hash: Optional[str] = None
    story_id: Optional[int] = Field(default=None, foreign_key="story.id", index=True)


class UserProfile(SQLModel, table=True):
    """User profile. Single-row for now (id=1); schema is multi-user-ready."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(default="Kai")
    priority_prompt: str = Field(default="")
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class DailyDigest(SQLModel, table=True):
    """A daily curated digest: meta-summary + Claude-picked top stories."""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_profile_id: int = Field(foreign_key="userprofile.id", index=True)
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    window_start: datetime
    window_end: datetime
    meta_summary_de: str
    top_story_ids_json: str  # JSON: [{"story_id": int, "rank": int, "why": str}, ...]
    model_id: str
    raw_response: Optional[str] = None
    category_id: Optional[int] = Field(default=None, foreign_key="category.id", index=True)
    # NULL = global digest; non-NULL = per-category digest

    @property
    def top_stories(self) -> list[dict]:
        if self.top_story_ids_json:
            return json.loads(self.top_story_ids_json)
        return []

    @top_stories.setter
    def top_stories(self, value: list[dict]) -> None:
        self.top_story_ids_json = json.dumps(value, ensure_ascii=False)


class FavoriteStory(SQLModel, table=True):
    """A story saved by a user for later reading."""
    __table_args__ = (
        UniqueConstraint("user_profile_id", "story_id", name="uq_favorite_story_user_story"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_profile_id: int = Field(foreign_key="userprofile.id", index=True)
    story_id: int = Field(foreign_key="story.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class ManagedSource(SQLModel, table=True):
    """All news sources — both built-in (seeded from config.py) and user-added."""
    __tablename__ = "managedsource"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    source_type: str        # "rss", "newsletter", "hackernews"
    url: str = Field(default="")  # RSS: feed URL; newsletter: from_email; hackernews: ""
    active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # New fields (added via _migrate_schema for existing DBs)
    category_id: Optional[int] = Field(default=None, foreign_key="category.id")
    is_builtin: bool = Field(default=False)  # True = seeded from config.py, not deletable
    story_kind: str = Field(default="general")  # "general" or "paper"


class RedditPost(SQLModel, table=True):
    """A single post fetched from a subreddit via public .json endpoint."""
    id: Optional[int] = Field(default=None, primary_key=True)
    reddit_id: str = Field(unique=True, index=True)   # Reddit's own post ID, e.g. "abc123"
    subreddit: str = Field(index=True)
    title: str
    permalink: str                                     # https://reddit.com/r/.../comments/...
    external_url: str = Field(default="")             # linked article URL; empty for self-posts
    is_self: bool = Field(default=False)
    score: int = Field(default=0)
    upvote_ratio: float = Field(default=0.0)
    num_comments: int = Field(default=0)
    flair: Optional[str] = None
    sentiment: str = Field(default="neutral")         # sehr positiv | positiv | gemischt | kontrovers
    created_utc: datetime
    fetched_at: datetime = Field(default_factory=datetime.utcnow)


class SystemSetting(SQLModel, table=True):
    """Persistent key-value store for runtime-configurable settings."""
    key: str = Field(primary_key=True)
    value: str


def _db_path() -> str:
    url = settings.database_url
    if url.startswith("sqlite:///"):
        path = url[len("sqlite:///"):]
        import os
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    return url


engine = create_engine(_db_path(), echo=False)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    _migrate_schema()
    _ensure_default_profile()
    with Session(engine) as session:
        _seed_initial_data(session)


def _migrate_schema() -> None:
    """Add new columns to existing tables without dropping data."""
    with engine.connect() as conn:
        article_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(article)"))}
        if "story_id" not in article_cols:
            conn.execute(text("ALTER TABLE article ADD COLUMN story_id INTEGER REFERENCES story(id)"))
            conn.commit()

        story_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(story)"))}
        if "first_digest_id" not in story_cols:
            conn.execute(text("ALTER TABLE story ADD COLUMN first_digest_id INTEGER REFERENCES dailydigest(id)"))
            conn.commit()
        if "category_id" not in story_cols:
            conn.execute(text("ALTER TABLE story ADD COLUMN category_id INTEGER REFERENCES category(id)"))
            conn.commit()

        ms_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(managedsource)"))}
        if "category_id" not in ms_cols:
            conn.execute(text("ALTER TABLE managedsource ADD COLUMN category_id INTEGER REFERENCES category(id)"))
            conn.commit()
        if "is_builtin" not in ms_cols:
            conn.execute(text("ALTER TABLE managedsource ADD COLUMN is_builtin INTEGER DEFAULT 0"))
            conn.commit()
        if "story_kind" not in ms_cols:
            conn.execute(text("ALTER TABLE managedsource ADD COLUMN story_kind TEXT DEFAULT 'general'"))
            conn.commit()

        cat_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(category)"))}
        if "digest_prompt" not in cat_cols:
            conn.execute(text("ALTER TABLE category ADD COLUMN digest_prompt TEXT"))
            conn.commit()

        dd_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(dailydigest)"))}
        if "category_id" not in dd_cols:
            conn.execute(text("ALTER TABLE dailydigest ADD COLUMN category_id INTEGER REFERENCES category(id)"))
            conn.commit()


def _ensure_default_profile() -> None:
    """Insert the single-row default profile (id=1) if it doesn't exist yet."""
    with Session(engine) as session:
        if session.get(UserProfile, 1) is None:
            session.add(UserProfile(id=1, name="Kai", priority_prompt=""))
            session.commit()


# Names of RSS feeds whose stories are research papers — determines story_kind at seed time.
_PAPER_SOURCE_NAMES: frozenset[str] = frozenset({
    "ArXiv cs.AI", "ArXiv cs.LG", "ArXiv cs.CL", "HuggingFace Daily Papers",
})

_DEFAULT_PROMPTS: list[dict] = [
    {
        "key": "summarizer_general",
        "name": "Summarizer — Allgemeine News",
        "description": "Zusammenfassung und Klassifikation (Typ, Domain, Flags) für News-Stories",
        "value": """Du bist ein präziser KI-News-Analyst. Fasse News-Stories auf Deutsch zusammen und kategorisiere sie auf drei Achsen.

TYP (genau 1):
  - "release": Neues Modell- oder Produkt-Release von einem KI-Lab (z.B. GPT-5, Claude 4.7, Gemini 2.5)
  - "forschung": Forschungs-News, Paper-Berichterstattung, Lab-Erkenntnisse, Benchmarks
  - "tool": Tools, Produkte, Apps rund um KI (Cursor, Vercel AI SDK, Notion AI)
  - "infrastruktur": Chips, Compute, Hosting, Cloud-AI-Infrastruktur (NVIDIA, AWS Bedrock)
  - "business": Markt, Funding, M&A, Pricing, Konkurrenz, Geschäftszahlen
  - "policy": Regulierung, Recht, AI-Safety-Debatte, Ethik
  - "demo": Capability-Demo, Experiment, "KI macht jetzt X"-Stories, Multi-Agent-Showcases, Welten in denen KI-Modelle eine Society bauen

DOMAIN (1–2):
  - "llm-core": Sprachmodelle, allgemeines LLM-Fundament
  - "coding": Programmier-AI, Code-Assistenten, Software-Engineering mit KI
  - "agenten": Agents, Multi-Agent-Systeme, Tool-Use, autonome Pipelines
  - "bild-video": Bild- und Video-Generation, generative Vision
  - "audio": Sprache, TTS, Musik
  - "robotik": Embodied AI, Robotik
  - "vertikal": Branchen-spezifisch (Health, Legal, Finance, Edu)
  - "sonstige": nichts davon

FLAGS (0 oder mehr):
  - "open-source": Modell, Code oder Tool ist open-source
  - "frontier": SOTA/Frontier-Modell oder -Capability
  - "big-lab": Story dreht sich um OpenAI, Anthropic, Google, Meta oder Microsoft

Antworte ausschließlich als gültiges JSON (kein Markdown):
{
  "summary_de": "<2–3 prägnante Sätze auf Deutsch>",
  "type": "<einer der TYP-Werte>",
  "domains": ["<DOMAIN1>", ...],
  "flags": ["<FLAG1>", ...]
}

Regeln:
- summary_de: Sachlich, max 3 Sätze, kein Marketing-Sprech.
- type: Wenn unsicher, wähle den dominantesten Aspekt der Story.
- domains: Wenn keine klare Domain passt, ["sonstige"].
- flags: Nur setzen wenn klar zutreffend. Leeres Array ist OK.""",
    },
    {
        "key": "summarizer_paper",
        "name": "Summarizer — Research Papers",
        "description": "Zusammenfassung für ArXiv- und HuggingFace-Papers (kein Tagging)",
        "value": """Du fasst wissenschaftliche Papers (ArXiv, HuggingFace Daily Papers) für ein KI-News-Dashboard auf Deutsch zusammen.

Antworte ausschließlich als gültiges JSON (kein Markdown):
{
  "summary_de": "<2–3 prägnante Sätze: Was wurde untersucht, was ist das Ergebnis?>"
}

Regeln:
- Sachlich, max 3 Sätze.
- Direkt einsteigen, kein "Diese Arbeit untersucht..."-Geschwafel.""",
    },
    {
        "key": "clusterer",
        "name": "Clusterer — Story-Zuordnung",
        "description": "Ordnet neue Artikel bestehenden Stories zu oder erstellt neue Stories",
        "value": """Du bist ein News-Clustering-Experte für KI-Nachrichten.

Aufgabe: Ordne jeden neuen Artikel einer bestehenden Story zu, oder eröffne eine neue Story.

Regeln:
- Artikel über dasselbe Ereignis/Release/Thema → gleiche Story, auch wenn Titel oder Blickwinkel verschieden.
  Beispiel: "RTX Spark: Laptop-CPU vorgestellt", "Nvidia greift Intel mit ARM-Chip an", "RTX Spark gegen AMD"
  → alle zur selben Story, weil es dasselbe Produkt-Launch ist.
- VERSIONSNUMMERN sind IMMER eigene Stories: GPT-5.4 ≠ GPT-5.5, Claude 4.6 ≠ Claude 4.7, Gemini 2.0 ≠ Gemini 2.5.
  Vergleiche die Versionsnummer im Artikel-Titel mit der in der offenen Story. Bei abweichender Version: NEUE Story.
- Verschiedene Releases desselben Herstellers (z.B. "Claude 4.7 Release" vs "Claude Security Beta") sind eigene Stories.
- DATUMSCHECK: Wenn ein Artikel ein Datum (published_at) Wochen/Monate vor dem first_seen einer offenen Story hat, ist es vermutlich ein älterer Backfill und gehört NICHT zur aktuellen Story — leg eine neue an.
- Jedes wissenschaftliche Paper (ArXiv, HuggingFace Daily Papers) ist normalerweise eine eigene Story, außer ein News-Artikel berichtet direkt darüber.
- Offene Stories mit dem Präfix [PAPER] sind reine Paper-Stories. Hänge NIEMALS einen Mainstream-News-Artikel an eine [PAPER]-Story — die bleibt eigenständig. (Ein Paper darf zu einer bestehenden News-Story stoßen, aber nicht umgekehrt.)
- Story-Titel: kurz, auf Deutsch, max 7 Wörter (z.B. "GPT-5.5 Veröffentlichung", "Gemini 2.5 Flash Release"). Versionsnummern beibehalten.
- story_id = null bedeutet: neue Story anlegen mit new_story_title.

Antworte NUR als valides JSON-Array, kein Text davor/danach:
[{"article_id": <int>, "story_id": <int_or_null>, "new_story_title": <string_or_null>}, ...]

Jeder Artikel muss im Array vorkommen.""",
    },
    {
        "key": "digest_curation",
        "name": "Digest — Tages-Kuratierung",
        "description": "Wählt die 5–7 wichtigsten Stories des Tages und schreibt die Tageszusammenfassung",
        "value": """Du bist der News-Editor für ein persönliches KI-News-Dashboard.

Aufgabe: Wähle aus den heutigen Stories die wichtigsten 5–7 aus und schreibe eine kurze Tageszusammenfassung auf Deutsch.

Stories sind bereits klassifiziert (du hast die Klassifikation selbst im vorherigen Schritt erzeugt):
- types: einer von release, forschung, tool, infrastruktur, business, policy, demo
- domains: llm-core, coding, agenten, bild-video, audio, robotik, vertikal, sonstige
- flags: open-source, frontier, big-lab

Regeln:
- Berücksichtige die User-Prioritäten (falls angegeben). Wenn keine User-Prioritäten gegeben sind, sortiere nach allgemeiner Wichtigkeit: Recency (latest_published_at = neuer ist besser), Source-Count (mehrere Quellen = wichtig), Themenvielfalt (verschiedene types/domains in den Top-Stories vertreten).
- WICHTIG: Stories mit altem latest_published_at (Wochen/Monate zurück) NICHT in den Top auswählen, auch wenn sie technisch im Window liegen — bevorzuge die jüngsten Releases.
- meta_summary_de: 2–3 Absätze, was heute in der KI-Welt passiert ist. Sachlich, kein Marketing-Sprech, kein "Heute ist..."-Geschwafel. Direkt einsteigen.
- top_stories: 5–7 Stories. Mehr wenn der Tag viel Substanz hat, weniger wenn dünn. rank: 1 = wichtigste.
- "why": 1 Satz, warum diese Story wichtig ist (besonders im Licht der User-Prioritäten).

Antworte ausschließlich als gültiges JSON, kein Markdown:
{
  "meta_summary_de": "...",
  "top_stories": [
    {"story_id": <int>, "rank": <int>, "why": "..."}
  ]
}""",
    },
]


def _seed_initial_data(session: Session) -> None:
    """Idempotent: create default KI category, migrate config.py sources, seed prompts."""
    from .config import RSS_FEEDS, NEWSLETTER_SOURCES

    # 1. KI category
    ki = session.exec(select(Category).where(Category.slug == "ki")).first()
    if ki is None:
        ki = Category(
            slug="ki",
            name="Künstliche Intelligenz",
            icon="🤖",
            color="#4F46E5",
            sort_order=0,
        )
        session.add(ki)
        session.flush()

    # 2. Built-in sources from config.py
    existing_names: set[str] = set(session.exec(select(ManagedSource.name)).all())

    for feed in RSS_FEEDS:
        if feed["name"] not in existing_names:
            kind = "paper" if feed["name"] in _PAPER_SOURCE_NAMES else "general"
            session.add(ManagedSource(
                name=feed["name"],
                source_type="rss",
                url=feed["url"],
                active=True,
                is_builtin=True,
                story_kind=kind,
                category_id=ki.id,
            ))

    if "Hacker News" not in existing_names:
        session.add(ManagedSource(
            name="Hacker News",
            source_type="hackernews",
            url="",
            active=True,
            is_builtin=True,
            story_kind="general",
            category_id=ki.id,
        ))

    for nl in NEWSLETTER_SOURCES:
        if nl["name"] not in existing_names:
            session.add(ManagedSource(
                name=nl["name"],
                source_type="newsletter",
                url=nl["from_email"],
                active=True,
                is_builtin=True,
                story_kind="general",
                category_id=ki.id,
            ))

    # 3. Prompt defaults
    for prompt_def in _DEFAULT_PROMPTS:
        if session.get(PromptSetting, prompt_def["key"]) is None:
            session.add(PromptSetting(**prompt_def))

    session.commit()


def get_session() -> Session:
    return Session(engine)


def get_existing_urls(session: Session) -> set[str]:
    return set(session.exec(select(Article.url)).all())


def get_existing_hashes(session: Session) -> set[str]:
    results = session.exec(
        select(Article.content_hash).where(Article.content_hash.is_not(None))
    ).all()
    return set(results)


def get_unclustered_articles(session: Session) -> list[Article]:
    """Articles not yet assigned to a Story."""
    return list(session.exec(select(Article).where(Article.story_id == None)).all())


def get_open_stories(session: Session, days: int = 3) -> list[Story]:
    """Stories whose newest article (by published_at, fetched_at fallback) is within the cutoff.

    Old logic used Story.first_seen, which kept stories open for 3 days regardless of whether
    a backfill mirror dropped a years-old article into them. Now we look at the article timeline
    directly: if at least one assigned article is recent, the story is still a clustering candidate.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    recent_story_ids = list(session.exec(
        select(Article.story_id)
        .where(Article.story_id.is_not(None))
        .where(func.coalesce(Article.published_at, Article.fetched_at) >= cutoff)
        .distinct()
    ).all())
    if not recent_story_ids:
        return []
    return list(session.exec(select(Story).where(Story.id.in_(recent_story_ids))).all())


def get_pending_stories(session: Session) -> list[Story]:
    """Stories that need a summary generated."""
    return list(session.exec(select(Story).where(Story.is_processed == False)).all())


def get_prompt(session: Session, key: str, default: str) -> str:
    """Return the DB-stored prompt value, or fall back to the hardcoded default."""
    row = session.get(PromptSetting, key)
    return row.value if row else default
