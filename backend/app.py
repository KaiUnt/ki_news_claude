from datetime import datetime, date
from typing import Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import select, Session
from .db import (
    Article, Story, UserProfile, DailyDigest, create_db_and_tables, engine,
    get_existing_urls, get_existing_hashes,
    get_unclustered_articles, get_pending_stories,
)
from .fetcher import RSSFetcher, HackerNewsFetcher, RawArticle
from .deduplicator import deduplicate, content_hash
from .clusterer import cluster_articles
from .summarizer import Summarizer
from . import digest_generator
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

def _story_to_dict(
    s: Story,
    sources: list[Article] | None = None,
    primary_title: str | None = None,
) -> dict:
    if primary_title is None and sources:
        primary_title = max(sources, key=lambda a: len(a.raw_content or "")).title
    d = {
        "id": s.id,
        "title_de": s.title_de,
        "primary_title": primary_title,
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


def _batch_primary_titles(session: Session, story_ids: list[int]) -> dict[int, str]:
    """Return {story_id: title_of_longest_raw_content_article} for the given stories.

    Mirrors Summarizer._best_article_for_story logic so the displayed headline
    matches the article that produced the German summary.
    """
    if not story_ids:
        return {}
    rows = session.exec(
        select(Article.story_id, Article.title, Article.raw_content)
        .where(Article.story_id.in_(story_ids))
    ).all()
    by_story: dict[int, list[tuple[str, int]]] = {}
    for sid, title, raw in rows:
        by_story.setdefault(sid, []).append((title, len(raw or "")))
    return {sid: max(items, key=lambda x: x[1])[0] for sid, items in by_story.items()}


def _source_to_dict(a: Article) -> dict:
    return {
        "id": a.id,
        "url": a.url,
        "title": a.title,
        "source_name": a.source_name,
        "source_type": a.source_type,
        "published_at": a.published_at.isoformat() if a.published_at else None,
    }


def _profile_to_dict(p: UserProfile) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "priority_prompt": p.priority_prompt,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    priority_prompt: Optional[str] = None


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

    with Session(engine) as session:
        primaries = _batch_primary_titles(session, [s.id for s in page])

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [_story_to_dict(s, primary_title=primaries.get(s.id)) for s in page],
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


# ── Profile endpoints ─────────────────────────────────────────────────────────

@app.get("/api/profile")
def get_profile():
    with Session(engine) as session:
        profile = session.get(UserProfile, 1)
        if not profile:
            raise HTTPException(status_code=500, detail="Default profile not initialized")
        return _profile_to_dict(profile)


@app.put("/api/profile")
def update_profile(body: ProfileUpdate):
    with Session(engine) as session:
        profile = session.get(UserProfile, 1)
        if not profile:
            raise HTTPException(status_code=500, detail="Default profile not initialized")
        if body.name is not None:
            profile.name = body.name
        if body.priority_prompt is not None:
            profile.priority_prompt = body.priority_prompt
        profile.updated_at = datetime.utcnow()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        return _profile_to_dict(profile)


# ── Digest endpoints ──────────────────────────────────────────────────────────

def _digest_summary(d: DailyDigest) -> dict:
    return {
        "id": d.id,
        "generated_at": d.generated_at.isoformat() if d.generated_at else None,
        "window_start": d.window_start.isoformat() if d.window_start else None,
        "window_end": d.window_end.isoformat() if d.window_end else None,
        "meta_summary_de": d.meta_summary_de,
        "model_id": d.model_id,
        "top_story_count": len(d.top_stories),
    }


@app.get("/api/digest/latest")
def get_latest_digest():
    with Session(engine) as session:
        digest = session.exec(
            select(DailyDigest).order_by(DailyDigest.generated_at.desc()).limit(1)
        ).first()
        if not digest:
            raise HTTPException(status_code=404, detail="No digest exists yet")

        story_ids = [t.get("story_id") for t in digest.top_stories if t.get("story_id")]
        story_by_id: dict[int, Story] = {}
        primaries: dict[int, str] = {}
        if story_ids:
            stories = session.exec(select(Story).where(Story.id.in_(story_ids))).all()
            story_by_id = {s.id: s for s in stories}
            primaries = _batch_primary_titles(session, story_ids)

        top_with_data = []
        for entry in digest.top_stories:
            sid = entry.get("story_id")
            story = story_by_id.get(sid)
            if story is None:
                continue
            top_with_data.append({
                "rank": entry.get("rank"),
                "why": entry.get("why"),
                "story": _story_to_dict(story, primary_title=primaries.get(sid)),
            })
        top_with_data.sort(key=lambda x: x.get("rank") or 999)

    return {
        **_digest_summary(digest),
        "top_stories": top_with_data,
    }


@app.get("/api/digest")
def list_digests(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    with Session(engine) as session:
        digests = session.exec(
            select(DailyDigest)
            .order_by(DailyDigest.generated_at.desc())
            .offset(offset)
            .limit(limit)
        ).all()
    return {
        "offset": offset,
        "limit": limit,
        "items": [_digest_summary(d) for d in digests],
    }


@app.post("/api/digest/regenerate")
def regenerate_digest():
    digest = digest_generator.generate(reuse_last_window=True)
    if digest is None:
        raise HTTPException(
            status_code=400,
            detail="No processed stories in the digest window — nothing to digest yet.",
        )
    return _digest_summary(digest)


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
    digest: bool = Query(True),
):
    """Fetch → dedup → save → cluster → summarize → digest pipeline."""
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

    # Digest
    digest_id: Optional[int] = None
    if digest and cluster and summarize:
        try:
            generated = digest_generator.generate()
            if generated is not None:
                digest_id = generated.id
        except Exception as exc:
            print(f"[fetch] Digest generation failed: {exc}")

    return {
        "fetched": len(raw),
        "new_saved": saved,
        "clustered": clustered,
        "stories_summarized": summarized,
        "digest_id": digest_id,
    }
