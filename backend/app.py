import logging
import threading
from datetime import datetime, date, time, timedelta, timezone
from typing import Optional
from dateutil import tz
from fastapi import FastAPI, Query, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import select, Session, func, or_
from .db import (
    Article, Story, UserProfile, DailyDigest, FavoriteStory, RedditPost, ManagedSource,
    SystemSetting, Category, PromptSetting,
    create_db_and_tables, engine,
)
from . import digest_generator, pipeline
from .config import STORY_TYPES, STORY_DOMAINS, STORY_FLAGS, normalize_tags, settings, RSS_FEEDS, NEWSLETTER_SOURCES
from .source_catalog import list_source_configs, story_signals_for_source_names, PAPER_SOURCES

logger = logging.getLogger(__name__)

app = FastAPI(title="KI-News Dashboard API", version="2.0.0")

_fetch_lock = threading.Lock()
_fetch_status: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "result": None,
    "error": None,
}

DEFAULT_PROFILE_ID = 1
LOCAL_TZ = tz.gettz("Europe/Vienna") or timezone(timedelta(hours=1), "Europe/Vienna")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _configure_logging() -> None:
    """Sorgt dafür, dass app/pipeline-Logs (logger.info "[fetch] …") im
    Backend-Journal landen. uvicorn konfiguriert nur seine eigenen Logger und
    lässt unseren `backend`-Logger sonst auf WARNING ohne Handler."""
    backend_logger = logging.getLogger("backend")
    backend_logger.setLevel(logging.INFO)
    if not backend_logger.handlers:
        handler = logging.StreamHandler()  # stderr → journald
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        backend_logger.addHandler(handler)
    backend_logger.propagate = False


@app.on_event("startup")
def on_startup():
    _configure_logging()
    create_db_and_tables()


# ── Serializers ───────────────────────────────────────────────────────────────

def _story_to_dict(
    s: Story,
    sources: list[Article] | None = None,
    include_sources: bool = False,
    primary_title: str | None = None,
    primary_url: str | None = None,
    is_favorite: bool = False,
) -> dict:
    if (primary_title is None or primary_url is None) and sources:
        best = max(sources, key=lambda a: len(a.raw_content or ""))
        if primary_title is None:
            primary_title = best.title
        if primary_url is None:
            primary_url = best.url
    signals = _story_signals(sources or [])
    d = {
        "id": s.id,
        "title_de": s.title_de,
        "primary_title": primary_title,
        "primary_url": primary_url,
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


def _batch_primary_info(session: Session, story_ids: list[int]) -> dict[int, dict]:
    """Return {story_id: {"title": str, "url": str}} for the best article per story.

    Mirrors Summarizer._best_article_for_story logic so the displayed headline
    matches the article that produced the German summary.
    """
    if not story_ids:
        return {}
    rows = session.exec(
        select(Article.story_id, Article.title, Article.url, Article.raw_content)
        .where(Article.story_id.in_(story_ids))
    ).all()
    by_story: dict[int, list[tuple[str, str, int]]] = {}
    for sid, title, url, raw in rows:
        by_story.setdefault(sid, []).append((title, url, len(raw or "")))
    return {
        sid: {"title": max(items, key=lambda x: x[2])[0], "url": max(items, key=lambda x: x[2])[1]}
        for sid, items in by_story.items()
    }


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


class RedditPostImport(BaseModel):
    reddit_id: str
    subreddit: str
    title: str
    permalink: str
    external_url: str = ""
    is_self: bool = False
    score: int = 0
    upvote_ratio: float = 0.0
    num_comments: int = 0
    flair: Optional[str] = None
    sentiment: str = "neutral"
    created_utc: str


class RedditImportPayload(BaseModel):
    posts: list[RedditPostImport]


# ── Story endpoints ───────────────────────────────────────────────────────────

@app.get("/api/stories")
def list_stories(
    tags: Optional[str] = Query(None, description="Comma-separated tag filter"),
    exclude_tags: Optional[str] = Query(None, description="Comma-separated tags to exclude"),
    sources: Optional[str] = Query(None, description="Filter by source_name (any article in story)"),
    story_kind: Optional[str] = Query(None, pattern="^(general|paper)$"),
    category_slug: Optional[str] = Query(None, description="Filter stories whose sources belong to this category slug"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("date_desc", pattern="^(date_desc|date_asc)$"),
    processed_only: bool = Query(True, description="Only return stories with a summary"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    with Session(engine) as session:
        filters = []

        if processed_only:
            filters.append(Story.is_processed == True)
        if date_from:
            filters.append(Story.first_seen >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            filters.append(Story.first_seen <= datetime.combine(date_to, datetime.max.time()))

        # Tag filter: AND across axes, OR within axis — pushed to SQL via LIKE on tags_json.
        # E.g. type:release,type:forschung,domain:coding →
        #   WHERE (tags_json LIKE '%"type:release"%' OR tags_json LIKE '%"type:forschung"%')
        #     AND (tags_json LIKE '%"domain:coding"%')
        if tags:
            tag_list = [t.strip() for t in tags.split(",") if t.strip()]
            tags_by_axis: dict[str, list[str]] = {}
            for t in tag_list:
                axis = t.split(":", 1)[0] if ":" in t else "_legacy"
                tags_by_axis.setdefault(axis, []).append(t)
            for axis_tags in tags_by_axis.values():
                filters.append(or_(*[Story.tags_json.like(f'%"{t}"%') for t in axis_tags]))

        if exclude_tags:
            for tag in [t.strip() for t in exclude_tags.split(",") if t.strip()]:
                # NULL tags_json means no tags — story passes the exclude filter correctly.
                filters.append(or_(Story.tags_json.is_(None), ~Story.tags_json.like(f'%"{tag}"%')))

        if search:
            q = f"%{search}%"
            filters.append(or_(Story.title_de.ilike(q), Story.summary_de.ilike(q)))

        if sources:
            src_list = [s.strip() for s in sources.split(",") if s.strip()]
            source_subq = (
                select(Article.story_id)
                .where(Article.story_id.is_not(None))
                .where(Article.source_name.in_(src_list))
                .distinct()
            )
            filters.append(Story.id.in_(source_subq))

        if category_slug:
            cat = session.exec(select(Category).where(Category.slug == category_slug)).first()
            if cat:
                cat_source_names = list(session.exec(
                    select(ManagedSource.name).where(ManagedSource.category_id == cat.id)
                ).all())
                if cat_source_names:
                    cat_story_subq = (
                        select(Article.story_id)
                        .where(Article.story_id.is_not(None))
                        .where(Article.source_name.in_(cat_source_names))
                        .distinct()
                    )
                    filters.append(Story.id.in_(cat_story_subq))

        if story_kind:
            # Read paper source names from DB (story_kind="paper") for dynamic config
            paper_sources = list(session.exec(
                select(ManagedSource.name).where(ManagedSource.story_kind == "paper")
            ).all()) or list(PAPER_SOURCES)
            non_paper_subq = (
                select(Article.story_id)
                .where(Article.story_id.is_not(None))
                .where(~Article.source_name.in_(paper_sources))
                .distinct()
            )
            if story_kind == "paper":
                # Paper story: has articles, and none from non-paper sources.
                has_articles_subq = (
                    select(Article.story_id)
                    .where(Article.story_id.is_not(None))
                    .distinct()
                )
                filters.append(Story.id.in_(has_articles_subq))
                filters.append(~Story.id.in_(non_paper_subq))
            else:
                # General story: at least one article from a non-paper source.
                filters.append(Story.id.in_(non_paper_subq))

        # Count matching stories without loading them.
        count_stmt = select(func.count(Story.id))
        for f in filters:
            count_stmt = count_stmt.where(f)
        total = session.exec(count_stmt).one()

        # Fetch the requested page, sorted in DB.
        sort_expr = func.coalesce(Story.last_updated, Story.first_seen)
        order = sort_expr.desc() if sort == "date_desc" else sort_expr.asc()
        data_stmt = select(Story).order_by(order).offset(offset).limit(limit)
        for f in filters:
            data_stmt = data_stmt.where(f)
        page = list(session.exec(data_stmt).all())

        page_ids = [s.id for s in page if s.id is not None]
        primary_info = _batch_primary_info(session, page_ids)
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
                primary_title=primary_info.get(s.id, {}).get("title"),
                primary_url=primary_info.get(s.id, {}).get("url"),
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
        primary_info = _batch_primary_info(session, story_ids)
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
                    primary_title=primary_info.get(story.id, {}).get("title"),
                    primary_url=primary_info.get(story.id, {}).get("url"),
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

        info = _batch_primary_info(session, [story_id]).get(story_id, {})
        source_map = _batch_story_articles(session, [story_id])
        return _story_to_dict(
            story,
            sources=source_map.get(story_id, []),
            primary_title=info.get("title"),
            primary_url=info.get("url"),
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
    with Session(engine) as session:
        sources = session.exec(
            select(ManagedSource).order_by(ManagedSource.name)
        ).all()
    return {"sources": [_managed_source_to_dict(s) for s in sources]}


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
        "category_id": d.category_id,
    }


def _hydrate_digest(session: Session, digest: DailyDigest) -> dict:
    story_ids = [t.get("story_id") for t in digest.top_stories if t.get("story_id")]
    story_by_id: dict[int, Story] = {}
    primaries: dict[int, str] = {}
    favorite_ids: set[int] = set()
    if story_ids:
        stories = session.exec(select(Story).where(Story.id.in_(story_ids))).all()
        story_by_id = {s.id: s for s in stories}
        primary_info = _batch_primary_info(session, story_ids)
        favorite_ids = _favorite_story_ids(session, story_ids)
        source_map = _batch_story_articles(session, story_ids)
    else:
        primary_info = {}
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
                primary_title=primary_info.get(sid, {}).get("title"),
                primary_url=primary_info.get(sid, {}).get("url"),
                is_favorite=sid in favorite_ids,
            ),
        })
    top_with_data.sort(key=lambda x: x.get("rank") or 999)

    return {
        **_digest_summary(digest),
        "top_stories": top_with_data,
    }


@app.get("/api/digest/latest")
def get_latest_digest(category_slug: Optional[str] = Query(None)):
    with Session(engine) as session:
        q = select(DailyDigest).order_by(DailyDigest.generated_at.desc()).limit(1)
        if category_slug:
            cat = session.exec(select(Category).where(Category.slug == category_slug)).first()
            if not cat:
                raise HTTPException(status_code=404, detail=f"Kategorie '{category_slug}' nicht gefunden.")
            q = q.where(DailyDigest.category_id == cat.id)
        else:
            q = q.where(DailyDigest.category_id.is_(None))
        digest = session.exec(q).first()
        if not digest:
            raise HTTPException(status_code=404, detail="No digest exists yet")
        return _hydrate_digest(session, digest)


@app.get("/api/digest/{digest_id}")
def get_digest_by_id(digest_id: int):
    with Session(engine) as session:
        digest = session.get(DailyDigest, digest_id)
        if not digest:
            raise HTTPException(status_code=404, detail="Digest not found")
        return _hydrate_digest(session, digest)


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
def regenerate_digest(category_slug: Optional[str] = Query(None)):
    category_id: Optional[int] = None
    if category_slug:
        with Session(engine) as session:
            cat = session.exec(select(Category).where(Category.slug == category_slug)).first()
            if not cat:
                raise HTTPException(status_code=404, detail=f"Kategorie '{category_slug}' nicht gefunden.")
            category_id = cat.id
    digest = digest_generator.generate(reuse_last_window=True, category_id=category_id)
    if digest is None:
        raise HTTPException(
            status_code=400,
            detail="No processed stories in the digest window — nothing to digest yet.",
        )
    return _digest_summary(digest)


@app.get("/api/stats")
def get_stats():
    with Session(engine) as session:
        total_articles = session.exec(select(func.count(Article.id))).one()
        total_stories = session.exec(select(func.count(Story.id))).one()
        processed_stories = session.exec(
            select(func.count(Story.id)).where(Story.is_processed == True)
        ).one()
        unclustered = session.exec(
            select(func.count(Article.id)).where(Article.story_id == None)
        ).one()
        source_names = list(session.exec(select(Article.source_name).distinct()).all())
    return {
        "total_articles": total_articles,
        "total_stories": total_stories,
        "processed_stories": processed_stories,
        "unclustered_articles": unclustered,
        "sources": source_names,
    }


# ── Manual trigger (Background-Task) ──────────────────────────────────────────

def _run_pipeline_bg(cluster: bool, summarize: bool, digest: bool) -> None:
    """Läuft im Hintergrund-Thread; schreibt Status, gibt am Ende den Lock frei."""
    try:
        result = pipeline.run_pipeline(
            cluster=cluster,
            summarize=summarize,
            digest=digest,
            on_event=lambda msg: logger.info("[fetch] %s", msg),
        )
        _fetch_status["result"] = result
        _fetch_status["error"] = None
    except Exception as exc:
        logger.exception("[fetch] pipeline failed")
        _fetch_status["error"] = str(exc)
    finally:
        _fetch_status["running"] = False
        _fetch_status["finished_at"] = datetime.utcnow().isoformat()
        _fetch_lock.release()


@app.post("/api/fetch")
def trigger_fetch(
    cluster: bool = Query(True),
    summarize: bool = Query(True),
    digest: bool = Query(True),
):
    """Startet die Pipeline im Hintergrund und kehrt sofort zurück.

    Fortschritt/Ergebnis sind über GET /api/fetch/status abrufbar.
    """
    if not _fetch_lock.acquire(blocking=False):
        return {"status": "already_running"}
    _fetch_status.update(
        running=True,
        started_at=datetime.utcnow().isoformat(),
        finished_at=None,
        result=None,
        error=None,
    )
    threading.Thread(
        target=_run_pipeline_bg,
        args=(cluster, summarize, digest),
        daemon=True,
    ).start()
    return {"status": "started"}


@app.get("/api/fetch/status")
def fetch_status():
    """Status des laufenden bzw. letzten Fetch-Laufs (Frontend pollt darauf)."""
    return _fetch_status


# ── Reddit endpoints ──────────────────────────────────────────────────────────

def _reddit_post_to_dict(p: RedditPost) -> dict:
    return {
        "id": p.id,
        "reddit_id": p.reddit_id,
        "subreddit": p.subreddit,
        "title": p.title,
        "permalink": p.permalink,
        "external_url": p.external_url,
        "is_self": p.is_self,
        "score": p.score,
        "upvote_ratio": p.upvote_ratio,
        "num_comments": p.num_comments,
        "flair": p.flair,
        "sentiment": p.sentiment,
        "created_utc": p.created_utc.isoformat() if p.created_utc else None,
        "fetched_at": p.fetched_at.isoformat() if p.fetched_at else None,
    }


@app.get("/api/reddit/posts")
def list_reddit_posts(
    subreddit: Optional[str] = Query(None),
    sort: str = Query("score", pattern="^(score|date|ratio|comments)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    with Session(engine) as session:
        q = select(RedditPost)
        if subreddit:
            q = q.where(RedditPost.subreddit == subreddit)
        if sort == "score":
            q = q.order_by(RedditPost.score.desc())
        elif sort == "ratio":
            q = q.order_by(RedditPost.upvote_ratio.desc())
        elif sort == "comments":
            q = q.order_by(RedditPost.num_comments.desc())
        else:
            q = q.order_by(RedditPost.created_utc.desc())

        total = session.exec(select(func.count()).select_from(q.subquery())).one()
        posts = session.exec(q.offset(offset).limit(limit)).all()
        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "items": [_reddit_post_to_dict(p) for p in posts],
        }


@app.get("/api/reddit/stats")
def reddit_stats():
    with Session(engine) as session:
        rows = session.exec(
            select(
                RedditPost.subreddit,
                func.count(RedditPost.id).label("count"),
                func.avg(RedditPost.score).label("avg_score"),
                func.avg(RedditPost.upvote_ratio).label("avg_ratio"),
            ).group_by(RedditPost.subreddit)
        ).all()
        return [
            {
                "subreddit": r.subreddit,
                "count": r.count,
                "avg_score": round(r.avg_score or 0, 1),
                "avg_ratio": round(r.avg_ratio or 0, 3),
            }
            for r in rows
        ]


@app.post("/api/reddit/import")
def import_reddit_posts(
    payload: RedditImportPayload,
    x_import_secret: Optional[str] = Header(None),
):
    secret = settings.reddit_import_secret
    if not secret or x_import_secret != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")

    new_saved = 0
    with Session(engine) as session:
        existing = set(session.exec(select(RedditPost.reddit_id)).all())
        for p in payload.posts:
            if p.reddit_id not in existing:
                session.add(RedditPost(
                    reddit_id=p.reddit_id,
                    subreddit=p.subreddit,
                    title=p.title,
                    permalink=p.permalink,
                    external_url=p.external_url,
                    is_self=p.is_self,
                    score=p.score,
                    upvote_ratio=p.upvote_ratio,
                    num_comments=p.num_comments,
                    flair=p.flair,
                    sentiment=p.sentiment,
                    created_utc=datetime.fromisoformat(p.created_utc),
                ))
                existing.add(p.reddit_id)
                new_saved += 1
        session.commit()
    return {"fetched": len(payload.posts), "new_saved": new_saved}


# ── Managed Sources (Settings-Form) ──────────────────────────────────────────

class ManagedSourceCreate(BaseModel):
    name: str
    source_type: str            # "rss", "newsletter", "hackernews"
    url: str                    # RSS: feed URL; newsletter: from_email; hackernews: ""
    category_id: Optional[int] = None


class ManagedSourceUpdate(BaseModel):
    active: Optional[bool] = None
    category_id: Optional[int] = None
    name: Optional[str] = None
    url: Optional[str] = None


def _managed_source_to_dict(s: ManagedSource) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "source_type": s.source_type,
        "url": s.url,
        "active": s.active,
        "is_builtin": s.is_builtin,
        "story_kind": s.story_kind,
        "category_id": s.category_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@app.get("/api/admin/sources")
def list_managed_sources():
    with Session(engine) as session:
        sources = session.exec(
            select(ManagedSource).order_by(ManagedSource.name)
        ).all()
    return {"sources": [_managed_source_to_dict(s) for s in sources]}


@app.post("/api/admin/sources", status_code=201)
def create_managed_source(body: ManagedSourceCreate):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Name darf nicht leer sein.")
    if body.source_type not in ("rss", "newsletter"):
        raise HTTPException(status_code=422, detail="source_type muss 'rss' oder 'newsletter' sein.")
    if body.source_type != "hackernews" and not body.url.strip():
        raise HTTPException(status_code=422, detail="URL darf nicht leer sein.")

    source = ManagedSource(
        name=body.name.strip(),
        source_type=body.source_type,
        url=body.url.strip(),
        category_id=body.category_id,
        is_builtin=False,
    )
    with Session(engine) as session:
        session.add(source)
        try:
            session.commit()
            session.refresh(source)
        except Exception:
            session.rollback()
            raise HTTPException(status_code=409, detail=f"Quelle '{body.name}' existiert bereits.")
    return _managed_source_to_dict(source)


@app.patch("/api/admin/sources/{source_id}")
def update_managed_source(source_id: int, body: ManagedSourceUpdate):
    with Session(engine) as session:
        source = session.get(ManagedSource, source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Quelle nicht gefunden.")
        if body.active is not None:
            source.active = body.active
        if body.category_id is not None:
            source.category_id = body.category_id
        # Name and URL only editable for non-builtin sources
        if not source.is_builtin:
            if body.name is not None:
                source.name = body.name.strip()
            if body.url is not None:
                source.url = body.url.strip()
        session.add(source)
        session.commit()
        session.refresh(source)
        return _managed_source_to_dict(source)


@app.delete("/api/admin/sources/{source_id}")
def delete_managed_source(source_id: int):
    with Session(engine) as session:
        source = session.get(ManagedSource, source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Quelle nicht gefunden.")
        if source.is_builtin:
            raise HTTPException(status_code=403, detail="Eingebaute Quellen können nicht gelöscht werden.")
        session.delete(source)
        session.commit()
    return {"ok": True, "id": source_id}


# ── System settings ───────────────────────────────────────────────────────────

def _get_system_setting(key: str, default: str) -> str:
    with Session(engine) as session:
        row = session.get(SystemSetting, key)
        return row.value if row else default


def _set_system_setting(key: str, value: str) -> None:
    with Session(engine) as session:
        row = session.get(SystemSetting, key)
        if row:
            row.value = value
        else:
            row = SystemSetting(key=key, value=value)
        session.add(row)
        session.commit()


class SystemSettingsUpdate(BaseModel):
    story_merge_enabled: Optional[bool] = None


@app.get("/api/admin/settings")
def get_system_settings():
    default_merge = "true" if settings.story_merge_enabled else "false"
    merge_val = _get_system_setting("story_merge_enabled", default_merge)
    return {"story_merge_enabled": merge_val == "true"}


@app.patch("/api/admin/settings")
def update_system_settings(body: SystemSettingsUpdate):
    if body.story_merge_enabled is not None:
        _set_system_setting("story_merge_enabled", "true" if body.story_merge_enabled else "false")
    default_merge = "true" if settings.story_merge_enabled else "false"
    return {"story_merge_enabled": _get_system_setting("story_merge_enabled", default_merge) == "true"}


# ── Categories ────────────────────────────────────────────────────────────────

class CategoryCreate(BaseModel):
    slug: str
    name: str
    icon: Optional[str] = None
    color: Optional[str] = None
    sort_order: int = 0
    is_premium: bool = False


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    is_premium: Optional[bool] = None
    active: Optional[bool] = None
    digest_prompt: Optional[str] = None  # empty string → set to None (use global)


def _category_to_dict(c: Category) -> dict:
    return {
        "id": c.id,
        "slug": c.slug,
        "name": c.name,
        "icon": c.icon,
        "color": c.color,
        "sort_order": c.sort_order,
        "is_premium": c.is_premium,
        "active": c.active,
        "digest_prompt": c.digest_prompt,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@app.get("/api/admin/categories")
def list_categories():
    with Session(engine) as session:
        cats = session.exec(
            select(Category).order_by(Category.sort_order, Category.name)
        ).all()
    return {"categories": [_category_to_dict(c) for c in cats]}


@app.post("/api/admin/categories", status_code=201)
def create_category(body: CategoryCreate):
    if not body.slug.strip() or not body.name.strip():
        raise HTTPException(status_code=422, detail="Slug und Name dürfen nicht leer sein.")
    cat = Category(
        slug=body.slug.strip().lower(),
        name=body.name.strip(),
        icon=body.icon,
        color=body.color,
        sort_order=body.sort_order,
        is_premium=body.is_premium,
    )
    with Session(engine) as session:
        session.add(cat)
        try:
            session.commit()
            session.refresh(cat)
        except Exception:
            session.rollback()
            raise HTTPException(status_code=409, detail=f"Kategorie '{body.slug}' existiert bereits.")
    return _category_to_dict(cat)


@app.patch("/api/admin/categories/{category_id}")
def update_category(category_id: int, body: CategoryUpdate):
    with Session(engine) as session:
        cat = session.get(Category, category_id)
        if not cat:
            raise HTTPException(status_code=404, detail="Kategorie nicht gefunden.")
        if body.name is not None:
            cat.name = body.name.strip()
        if body.icon is not None:
            cat.icon = body.icon
        if body.color is not None:
            cat.color = body.color
        if body.sort_order is not None:
            cat.sort_order = body.sort_order
        if body.is_premium is not None:
            cat.is_premium = body.is_premium
        if body.active is not None:
            cat.active = body.active
        if body.digest_prompt is not None:
            # Empty string → reset to global prompt (store None)
            cat.digest_prompt = body.digest_prompt.strip() or None
        session.add(cat)
        session.commit()
        session.refresh(cat)
        return _category_to_dict(cat)


@app.delete("/api/admin/categories/{category_id}", status_code=204)
def delete_category(category_id: int):
    with Session(engine) as session:
        cat = session.get(Category, category_id)
        if not cat:
            raise HTTPException(status_code=404, detail="Kategorie nicht gefunden.")
        has_sources = session.exec(
            select(ManagedSource).where(ManagedSource.category_id == category_id).limit(1)
        ).first()
        if has_sources:
            raise HTTPException(
                status_code=409,
                detail="Kategorie hat noch zugeordnete Quellen. Bitte zuerst Quellen umziehen.",
            )
        session.delete(cat)
        session.commit()


# ── Prompt Settings ───────────────────────────────────────────────────────────

class PromptUpdate(BaseModel):
    value: str


def _prompt_to_dict(p: PromptSetting) -> dict:
    return {
        "key": p.key,
        "name": p.name,
        "description": p.description,
        "value": p.value,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@app.get("/api/admin/prompts")
def list_prompts():
    with Session(engine) as session:
        prompts = session.exec(select(PromptSetting).order_by(PromptSetting.key)).all()
    return {"prompts": [_prompt_to_dict(p) for p in prompts]}


@app.patch("/api/admin/prompts/{key}")
def update_prompt(key: str, body: PromptUpdate):
    if not body.value.strip():
        raise HTTPException(status_code=422, detail="Prompt darf nicht leer sein.")
    with Session(engine) as session:
        prompt = session.get(PromptSetting, key)
        if not prompt:
            raise HTTPException(status_code=404, detail=f"Prompt '{key}' nicht gefunden.")
        prompt.value = body.value
        prompt.updated_at = datetime.utcnow()
        session.add(prompt)
        session.commit()
        session.refresh(prompt)
        return _prompt_to_dict(prompt)


