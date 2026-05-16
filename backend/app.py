from datetime import datetime, date, time, timedelta, timezone
from typing import Optional
from dateutil import tz
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import select, Session
from .db import (
    Article, Story, UserProfile, DailyDigest, FavoriteStory, create_db_and_tables, engine,
    get_existing_urls, get_existing_hashes,
    get_unclustered_articles,
)
from .fetcher import RSSFetcher, HackerNewsFetcher, RawArticle
from .deduplicator import deduplicate, content_hash
from .clusterer import cluster_articles
from .summarizer import Summarizer
from . import digest_generator
from .config import STORY_TYPES, STORY_DOMAINS, STORY_FLAGS, normalize_tags
from .source_catalog import list_source_configs, story_signals_for_source_names

app = FastAPI(title="KI-News Dashboard API", version="2.0.0")

DEFAULT_PROFILE_ID = 1
LOCAL_TZ = tz.gettz("Europe/Vienna") or timezone(timedelta(hours=1), "Europe/Vienna")

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
    include_sources: bool = False,
    primary_title: str | None = None,
    is_favorite: bool = False,
) -> dict:
    if primary_title is None and sources:
        primary_title = max(sources, key=lambda a: len(a.raw_content or "")).title
    signals = _story_signals(sources or [])
    d = {
        "id": s.id,
        "title_de": s.title_de,
        "primary_title": primary_title,
        "summary_de": s.summary_de,
        "tags": normalize_tags(s.tags),
        "source_count": s.source_count,
        "first_seen": s.first_seen.isoformat() if s.first_seen else None,
        "last_updated": s.last_updated.isoformat() if s.last_updated else None,
        "is_processed": s.is_processed,
        "is_favorite": is_favorite,
        **signals,
    }
    if include_sources and sources is not None:
        d["sources"] = [_source_to_dict(a) for a in sources]
    return d


def _favorite_story_ids(session: Session, story_ids: list[int], user_profile_id: int = DEFAULT_PROFILE_ID) -> set[int]:
    if not story_ids:
        return set()
    return set(session.exec(
        select(FavoriteStory.story_id)
        .where(FavoriteStory.user_profile_id == user_profile_id)
        .where(FavoriteStory.story_id.in_(story_ids))
    ).all())


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


def _batch_story_articles(session: Session, story_ids: list[int]) -> dict[int, list[Article]]:
    if not story_ids:
        return {}
    rows = session.exec(
        select(Article).where(Article.story_id.in_(story_ids))
    ).all()
    grouped: dict[int, list[Article]] = {}
    for article in rows:
        if article.story_id is None:
            continue
        grouped.setdefault(article.story_id, []).append(article)
    return grouped


def _story_signals(sources: list[Article]) -> dict:
    return story_signals_for_source_names([article.source_name for article in sources])


def _utc_naive_to_local(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
    return dt.astimezone(LOCAL_TZ)


def _week_bounds_local(dt: datetime) -> tuple[datetime, datetime]:
    local = _utc_naive_to_local(dt)
    week_start_date = local.date() - timedelta(days=local.weekday())
    week_start = datetime.combine(week_start_date, time.min, tzinfo=LOCAL_TZ)
    week_end = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)
    return week_start, week_end


def _week_label(week_start: datetime, week_end: datetime) -> str:
    calendar_week = week_start.isocalendar().week
    return (
        f"KW {calendar_week}: "
        f"{week_start.strftime('%d.%m.')} bis {week_end.strftime('%d.%m.%Y')}"
    )


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
    exclude_tags: Optional[str] = Query(None, description="Comma-separated tags to exclude"),
    sources: Optional[str] = Query(None, description="Filter by source_name (any article in story)"),
    story_kind: Optional[str] = Query(None, pattern="^(general|paper)$"),
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
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        # AND across axes, OR within: a story must hit at least one selected
        # tag in *every* axis the user filtered on. E.g. picking type:release +
        # type:forschung + domain:coding requires (release OR forschung) AND coding.
        tags_by_axis: dict[str, list[str]] = {}
        for t in tag_list:
            axis = t.split(":", 1)[0] if ":" in t else "_legacy"
            tags_by_axis.setdefault(axis, []).append(t)

        def _matches_all_axes(story_tags: list[str]) -> bool:
            normalized = normalize_tags(story_tags)
            return all(
                any(t in normalized for t in axis_tags)
                for axis_tags in tags_by_axis.values()
            )

        stories = [s for s in stories if _matches_all_axes(s.tags)]

    if exclude_tags:
        excluded = {t.strip() for t in exclude_tags.split(",") if t.strip()}
        stories = [s for s in stories if not (excluded & set(normalize_tags(s.tags)))]

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

    if story_kind:
        story_ids = [s.id for s in stories if s.id is not None]
        with Session(engine) as session:
            source_map = _batch_story_articles(session, story_ids) if story_ids else {}
        filtered = []
        for story in stories:
            story_sources = source_map.get(story.id, [])
            signals = _story_signals(story_sources)
            if signals["story_kind"] != story_kind:
                continue
            filtered.append(story)
        stories = filtered

    reverse = sort == "date_desc"
    stories.sort(
        key=lambda s: s.last_updated or s.first_seen or datetime.min,
        reverse=reverse,
    )

    total = len(stories)
    page = stories[offset: offset + limit]

    page_ids = [s.id for s in page if s.id is not None]
    with Session(engine) as session:
        primaries = _batch_primary_titles(session, page_ids)
        favorite_ids = _favorite_story_ids(session, page_ids)
        page_source_map = _batch_story_articles(session, page_ids)

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            _story_to_dict(
                s,
                sources=page_source_map.get(s.id, []),
                primary_title=primaries.get(s.id),
                is_favorite=s.id in favorite_ids,
            )
            for s in page
        ],
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
        is_favorite = story_id in _favorite_story_ids(session, [story_id])
    return _story_to_dict(
        story,
        sources=list(sources_sorted),
        include_sources=True,
        is_favorite=is_favorite,
    )


@app.get("/api/favorites")
def list_favorites():
    with Session(engine) as session:
        rows = session.exec(
            select(FavoriteStory, Story)
            .where(FavoriteStory.user_profile_id == DEFAULT_PROFILE_ID)
            .where(FavoriteStory.story_id == Story.id)
            .order_by(FavoriteStory.created_at.desc())
        ).all()
        story_ids = [story.id for _, story in rows if story.id is not None]
        primaries = _batch_primary_titles(session, story_ids)
        source_map = _batch_story_articles(session, story_ids)

    by_week: dict[str, dict] = {}
    for favorite, story in rows:
        week_start, week_end = _week_bounds_local(favorite.created_at)
        key = week_start.date().isoformat()
        if key not in by_week:
            by_week[key] = {
                "week_start": week_start.date().isoformat(),
                "week_end": week_end.date().isoformat(),
                "label": _week_label(week_start, week_end),
                "items": [],
            }
        by_week[key]["items"].append({
            "favorite_id": favorite.id,
            "favorited_at": favorite.created_at.isoformat() if favorite.created_at else None,
                "story": _story_to_dict(
                    story,
                    sources=source_map.get(story.id, []),
                    primary_title=primaries.get(story.id),
                    is_favorite=True,
                ),
            })

    weeks = sorted(by_week.values(), key=lambda w: w["week_start"], reverse=True)
    return {"weeks": weeks}


@app.post("/api/favorites/{story_id}")
def add_favorite(story_id: int):
    with Session(engine) as session:
        story = session.get(Story, story_id)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found")

        favorite = session.exec(
            select(FavoriteStory)
            .where(FavoriteStory.user_profile_id == DEFAULT_PROFILE_ID)
            .where(FavoriteStory.story_id == story_id)
        ).first()
        if favorite is None:
            favorite = FavoriteStory(user_profile_id=DEFAULT_PROFILE_ID, story_id=story_id)
            session.add(favorite)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
            else:
                session.refresh(favorite)

        primary = _batch_primary_titles(session, [story_id]).get(story_id)
        source_map = _batch_story_articles(session, [story_id])
        return _story_to_dict(
            story,
            sources=source_map.get(story_id, []),
            primary_title=primary,
            is_favorite=True,
        )


@app.delete("/api/favorites/{story_id}")
def remove_favorite(story_id: int):
    with Session(engine) as session:
        story = session.get(Story, story_id)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found")

        favorite = session.exec(
            select(FavoriteStory)
            .where(FavoriteStory.user_profile_id == DEFAULT_PROFILE_ID)
            .where(FavoriteStory.story_id == story_id)
        ).first()
        if favorite:
            session.delete(favorite)
            session.commit()

    return {"ok": True, "story_id": story_id}


# ── Metadata endpoints ────────────────────────────────────────────────────────

@app.get("/api/tags")
def list_tags():
    return {
        "types": STORY_TYPES,
        "domains": STORY_DOMAINS,
        "flags": STORY_FLAGS,
    }


@app.get("/api/sources")
def list_sources():
    return {"sources": list_source_configs()}


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
        favorite_ids: set[int] = set()
        if story_ids:
            stories = session.exec(select(Story).where(Story.id.in_(story_ids))).all()
            story_by_id = {s.id: s for s in stories}
            primaries = _batch_primary_titles(session, story_ids)
            favorite_ids = _favorite_story_ids(session, story_ids)
            source_map = _batch_story_articles(session, story_ids)
        else:
            source_map = {}

        top_with_data = []
        for entry in digest.top_stories:
            sid = entry.get("story_id")
            story = story_by_id.get(sid)
            if story is None:
                continue
            top_with_data.append({
                "rank": entry.get("rank"),
                "why": entry.get("why"),
                "story": _story_to_dict(
                    story,
                    sources=source_map.get(sid, []),
                    primary_title=primaries.get(sid),
                    is_favorite=sid in favorite_ids,
                ),
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
