from datetime import datetime, date
from typing import Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select, Session
from .db import (
    Article, Story, create_db_and_tables, engine,
    get_existing_urls, get_existing_hashes,
    get_unclustered_articles, get_pending_stories,
)
from .fetcher import RSSFetcher, HackerNewsFetcher, RawArticle
from .deduplicator import deduplicate, content_hash
from .clusterer import cluster_articles
from .summarizer import Summarizer
from .config import AVAILABLE_TAGS, RSS_FEEDS

app = FastAPI(title="KI-News Dashboard API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    create_db_and_tables()


# ── Serializers ───────────────────────────────────────────────────────────────

def _story_to_dict(s: Story, sources: list[Article] | None = None) -> dict:
    d = {
        "id": s.id,
        "title_de": s.title_de,
        "summary_de": s.summary_de,
        "tags": s.tags,
        "source_count": s.source_count,
        "first_seen": s.first_seen.isoformat() if s.first_seen else None,
        "last_updated": s.last_updated.isoformat() if s.last_updated else None,
        "is_processed": s.is_processed,
    }
    if sources is not None:
        d["sources"] = [_source_to_dict(a) for a in sources]
    return d


def _source_to_dict(a: Article) -> dict:
    return {
        "id": a.id,
        "url": a.url,
        "title": a.title,
        "source_name": a.source_name,
        "source_type": a.source_type,
        "published_at": a.published_at.isoformat() if a.published_at else None,
    }


# ── Story endpoints ───────────────────────────────────────────────────────────

@app.get("/api/stories")
def list_stories(
    tags: Optional[str] = Query(None, description="Comma-separated tag filter"),
    sources: Optional[str] = Query(None, description="Filter by source_name (any article in story)"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("date_desc", pattern="^(date_desc|date_asc)$"),
    processed_only: bool = Query(True, description="Only return stories with a summary"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    with Session(engine) as session:
        stmt = select(Story)
        if processed_only:
            stmt = stmt.where(Story.is_processed == True)
        if date_from:
            stmt = stmt.where(Story.first_seen >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            stmt = stmt.where(Story.first_seen <= datetime.combine(date_to, datetime.max.time()))

        stories = session.exec(stmt).all()

    if tags:
        tag_list = [t.strip() for t in tags.split(",")]
        stories = [s for s in stories if any(t in s.tags for t in tag_list)]

    if search:
        q = search.lower()
        stories = [
            s for s in stories
            if q in (s.title_de or "").lower() or q in (s.summary_de or "").lower()
        ]

    if sources:
        src_list = {s.strip() for s in sources.split(",")}
        filtered = []
        with Session(engine) as session:
            for story in stories:
                story_sources = session.exec(
                    select(Article.source_name).where(Article.story_id == story.id)
                ).all()
                if src_list & set(story_sources):
                    filtered.append(story)
        stories = filtered

    reverse = sort == "date_desc"
    stories.sort(
        key=lambda s: s.last_updated or s.first_seen or datetime.min,
        reverse=reverse,
    )

    total = len(stories)
    page = stories[offset: offset + limit]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [_story_to_dict(s) for s in page],
    }


@app.get("/api/stories/{story_id}")
def get_story(story_id: int):
    with Session(engine) as session:
        story = session.get(Story, story_id)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found")
        sources = session.exec(
            select(Article).where(Article.story_id == story_id)
        ).all()
        sources_sorted = sorted(sources, key=lambda a: a.published_at or datetime.min)
    return _story_to_dict(story, sources=list(sources_sorted))


# ── Metadata endpoints ────────────────────────────────────────────────────────

@app.get("/api/tags")
def list_tags():
    return {"tags": AVAILABLE_TAGS}


@app.get("/api/sources")
def list_sources():
    sources = [{"name": f["name"], "url": f["url"], "type": "rss"} for f in RSS_FEEDS]
    sources.append({"name": "Hacker News", "url": "https://news.ycombinator.com", "type": "hackernews"})
    return {"sources": sources}


@app.get("/api/stats")
def get_stats():
    with Session(engine) as session:
        total_articles = len(session.exec(select(Article)).all())
        total_stories = len(session.exec(select(Story)).all())
        processed_stories = len(session.exec(select(Story).where(Story.is_processed == True)).all())
        unclustered = len(session.exec(select(Article).where(Article.story_id == None)).all())
        source_names = list({
            a.source_name
            for a in session.exec(select(Article)).all()
        })
    return {
        "total_articles": total_articles,
        "total_stories": total_stories,
        "processed_stories": processed_stories,
        "unclustered_articles": unclustered,
        "sources": source_names,
    }


# ── Manual trigger ────────────────────────────────────────────────────────────

@app.post("/api/fetch")
def trigger_fetch(
    cluster: bool = Query(True),
    summarize: bool = Query(True),
):
    """Fetch → dedup → save → cluster → summarize pipeline."""
    # Fetch
    fetchers = [RSSFetcher(), HackerNewsFetcher()]
    raw: list[RawArticle] = []
    for f in fetchers:
        raw.extend(f.fetch())

    with Session(engine) as session:
        existing_urls = get_existing_urls(session)
        existing_hashes = get_existing_hashes(session)

    new_raw = deduplicate(raw, existing_urls, existing_hashes)

    # Save
    saved = 0
    for raw_art in new_raw:
        db_article = Article(
            url=raw_art.url,
            title=raw_art.title,
            source_name=raw_art.source_name,
            source_type=raw_art.source_type,
            published_at=raw_art.published_at,
            raw_content=raw_art.content[:500] if raw_art.content else None,
            content_hash=content_hash(raw_art),
            story_id=None,
        )
        with Session(engine) as session:
            try:
                session.add(db_article)
                session.commit()
                saved += 1
            except Exception:
                session.rollback()

    # Cluster
    clustered = 0
    if cluster:
        with Session(engine) as session:
            unclustered = get_unclustered_articles(session)
        assignments = cluster_articles(unclustered)
        clustered = len(assignments)
        with Session(engine) as session:
            for article_id, story_id in assignments.items():
                article = session.get(Article, article_id)
                if article:
                    article.story_id = story_id
                    session.add(article)
            session.commit()

    # Summarize
    summarized = 0
    if summarize and cluster:
        summarizer = Summarizer()
        summarized = summarizer.summarize_pending_stories()

    return {
        "fetched": len(raw),
        "new_saved": saved,
        "clustered": clustered,
        "stories_summarized": summarized,
    }
