import json
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field, create_engine, Session, select, text, func
from .config import settings


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


def _ensure_default_profile() -> None:
    """Insert the single-row default profile (id=1) if it doesn't exist yet."""
    with Session(engine) as session:
        if session.get(UserProfile, 1) is None:
            session.add(UserProfile(id=1, name="Kai", priority_prompt=""))
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
