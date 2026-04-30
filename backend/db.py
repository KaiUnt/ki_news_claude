import json
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field, create_engine, Session, select, text
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

    # Legacy fields kept for backwards compat during migration
    summary_de: Optional[str] = None
    tags_json: Optional[str] = None
    is_processed: bool = Field(default=False)

    @property
    def tags(self) -> list[str]:
        if self.tags_json:
            return json.loads(self.tags_json)
        return []

    @tags.setter
    def tags(self, value: list[str]) -> None:
        self.tags_json = json.dumps(value, ensure_ascii=False)


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


def _migrate_schema() -> None:
    """Add new columns to existing tables without dropping data."""
    with engine.connect() as conn:
        existing = {row[1] for row in conn.execute(text("PRAGMA table_info(article)"))}
        if "story_id" not in existing:
            conn.execute(text("ALTER TABLE article ADD COLUMN story_id INTEGER REFERENCES story(id)"))
            conn.commit()


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


def get_pending_articles(session: Session) -> list[Article]:
    """Legacy: articles not yet summarized by Claude (individual mode)."""
    return list(session.exec(select(Article).where(Article.is_processed == False)).all())


def get_open_stories(session: Session, days: int = 3) -> list[Story]:
    """Stories still within the update window."""
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(days=days)
    return list(session.exec(select(Story).where(Story.first_seen >= cutoff)).all())


def get_pending_stories(session: Session) -> list[Story]:
    """Stories that need a summary generated."""
    return list(session.exec(select(Story).where(Story.is_processed == False)).all())
