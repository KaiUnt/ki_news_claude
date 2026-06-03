"""
Fetch-Pipeline — die einzige Wahrheit.

Orchestriert die 6 Phasen (Fetch → Dedup → Speichern → Cluster → Merge →
Summarize → Digest) und wird von beiden Einstiegspunkten aufgerufen:
- `backend/app.py` (POST /api/fetch, als Background-Task)
- `scripts/fetch_news.py` (Daily-Timer, eigener Prozess)

Quellen kommen aus der DB (`ManagedSource`, seeded aus config.py; user-added
Quellen automatisch dabei). Der optionale `on_event(msg)`-Callback erlaubt es
dem Aufrufer, Fortschritt anzuzeigen (Rich-Console im CLI, Logger in der API),
ohne dass die Pipeline etwas über Darstellung wissen muss.
"""
import logging
from typing import Callable, Optional

from sqlmodel import select, Session

from .db import (
    Article, Category, ManagedSource, engine,
    get_existing_urls, get_existing_hashes, get_unclustered_articles,
)
from .fetcher import RSSFetcher, HackerNewsFetcher, NewsletterFetcher, RawArticle
from .deduplicator import deduplicate, content_hash
from .clusterer import cluster_articles
from .story_merger import merge_recent_stories
from .summarizer import Summarizer
from . import digest_generator

logger = logging.getLogger(__name__)

OnEvent = Optional[Callable[[str], None]]


def _emit(on_event: OnEvent, msg: str) -> None:
    if on_event is not None:
        try:
            on_event(msg)
        except Exception:  # ein kaputter Callback darf die Pipeline nie kippen
            logger.exception("on_event callback raised")


def run_pipeline(
    cluster: bool = True,
    summarize: bool = True,
    digest: bool = True,
    on_event: OnEvent = None,
) -> dict:
    """Fetch → dedup → save → cluster → merge → summarize → digest.

    Gibt ein Ergebnis-Dict mit Zählern und Digest-IDs zurück.
    """
    # ── Phase 1: Fetch ────────────────────────────────────────────────────────
    # Alle Quellen aus der DB (seeded aus config.py; user-added Quellen inklusive).
    with Session(engine) as session:
        active_sources = session.exec(
            select(ManagedSource).where(ManagedSource.active == True)
        ).all()

    rss_feeds = [{"name": s.name, "url": s.url} for s in active_sources if s.source_type == "rss"]
    nl_sources = [{"name": s.name, "from_email": s.url} for s in active_sources if s.source_type == "newsletter"]
    run_hn = any(s.source_type == "hackernews" for s in active_sources)

    fetchers = [
        RSSFetcher(feeds=rss_feeds),
        NewsletterFetcher(sources=nl_sources),
    ]
    if run_hn:
        fetchers.append(HackerNewsFetcher())

    raw: list[RawArticle] = []
    for f in fetchers:
        articles = f.fetch()
        raw.extend(articles)
        _emit(on_event, f"{type(f).__name__}: {len(articles)} Artikel")
    _emit(on_event, f"Gefetcht: {len(raw)} Artikel")

    # ── Phase 2: Dedup ────────────────────────────────────────────────────────
    with Session(engine) as session:
        existing_urls = get_existing_urls(session)
        existing_hashes = get_existing_hashes(session)

    new_raw = deduplicate(raw, existing_urls, existing_hashes)
    _emit(on_event, f"Neu (nach Dedup): {len(new_raw)} Artikel")

    # ── Phase 3: Speichern ────────────────────────────────────────────────────
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

    # ── Phase 4: Clustering ───────────────────────────────────────────────────
    # Newsletter-Artikel nutzen ein breiteres 8-Tage-Fenster, damit wöchentliche
    # Newsletter an RSS-Stories bis zu 8 Tage zurück andocken können. Andere
    # Artikel nutzen das Standard-3-Tage-Fenster.
    clustered = 0
    if cluster:
        with Session(engine) as session:
            unclustered = get_unclustered_articles(session)

        nl_articles = [a for a in unclustered if a.source_type == "newsletter"]
        other_articles = [a for a in unclustered if a.source_type != "newsletter"]

        all_assignments: dict[int, int] = {}
        if nl_articles:
            all_assignments.update(cluster_articles(nl_articles, story_days=8))
        if other_articles:
            all_assignments.update(cluster_articles(other_articles, story_days=3))

        clustered = len(all_assignments)
        with Session(engine) as session:
            for article_id, story_id in all_assignments.items():
                article = session.get(Article, article_id)
                if article:
                    article.story_id = story_id
                    session.add(article)
            session.commit()
        _emit(on_event, f"{clustered} Artikel geclustert")

    # ── Phase 4b: Story-Merge ─────────────────────────────────────────────────
    merged = 0
    if cluster:
        merged = merge_recent_stories()
        if merged:
            _emit(on_event, f"{merged} Duplikate zusammengeführt")

    # ── Phase 5: Summarize ────────────────────────────────────────────────────
    summarized = 0
    if summarize and cluster:
        summarizer = Summarizer()
        summarized = summarizer.summarize_pending_stories()
        _emit(on_event, f"{summarized} Stories summarisiert")

    # ── Phase 6: Digest (global + pro aktiver Kategorie) ──────────────────────
    digest_id: Optional[int] = None
    category_digest_ids: list[int] = []
    if digest and cluster and summarize:
        _emit(on_event, "Tages-Digest via Claude API...")
        try:
            generated = digest_generator.generate()
            if generated is not None:
                digest_id = generated.id
                _emit(on_event, f"Digest id={generated.id} ({len(generated.top_stories)} Top-Stories)")
        except Exception as exc:
            logger.error("[pipeline] Global digest generation failed: %s", exc)
            _emit(on_event, f"Globaler Digest fehlgeschlagen: {exc}")

        with Session(engine) as session:
            active_cats = list(session.exec(
                select(Category).where(Category.active == True)
            ).all())
        for cat in active_cats:
            _emit(on_event, f"Kategorie-Digest '{cat.slug}'...")
            try:
                cat_digest = digest_generator.generate(category_id=cat.id)
                if cat_digest is not None:
                    category_digest_ids.append(cat_digest.id)
            except Exception as exc:
                logger.error("[pipeline] Category digest '%s' failed: %s", cat.slug, exc)
                _emit(on_event, f"Kategorie-Digest '{cat.slug}' fehlgeschlagen: {exc}")

    return {
        "fetched": len(raw),
        "new_saved": saved,
        "clustered": clustered,
        "stories_merged": merged,
        "stories_summarized": summarized,
        "digest_id": digest_id,
        "category_digest_ids": category_digest_ids,
    }
