"""
Post-clustering story deduplication.

After clustering, Claude may create separate stories for the same real-world
event (e.g. four RTX-Spark articles with different title angles → four cards).
This module asks Claude to identify semantic duplicates among recently-created
stories and merges them: articles are reassigned, the weaker stories are
deleted, and the survivor is flagged for re-summarization.

Toggle via STORY_MERGE_ENABLED env var (default: true).
Window via STORY_MERGE_HOURS env var (default: 24).
"""
import json
import logging
from datetime import datetime, timedelta

import anthropic
from sqlmodel import Session, select, func

from .claude_retry import call_with_retry
from .config import settings
from .db import Article, FavoriteStory, Story, SystemSetting, engine

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """Du bist ein News-Deduplication-Experte für KI-Nachrichten.

Aufgabe: Identifiziere unter den gegebenen Stories Gruppen, die dasselbe reale Ereignis beschreiben.

Zusammenführen wenn:
- Gleicher Produktname/Release, auch bei verschiedenen Titeln oder Blickwinkeln
  (Markt, Technik, Wettbewerb, Features → alles ein Event)
- Gleiche Unternehmensankündigung, mehrfach berichtet
- Gleicher Launch-Event aus verschiedenen Quellen

NICHT zusammenführen wenn:
- Verschiedene Versionsnummern (GPT-4.5 ≠ GPT-5, Claude 4.6 ≠ Claude 4.7)
- Verschiedene Produkte desselben Herstellers (RTX Spark ≠ DGX Spark)
- Nur thematisch verwandt, aber verschiedene Ereignisse

Antworte NUR als valides JSON, kein Text davor/danach:
{"groups": [[story_id, story_id, ...], ...]}

Nur Gruppen mit ≥2 Stories. Stories die zu keiner Gruppe gehören: weglassen."""


def _is_enabled() -> bool:
    """Read story_merge_enabled from DB (overrides env default)."""
    with Session(engine) as session:
        row = session.get(SystemSetting, "story_merge_enabled")
    if row:
        return row.value == "true"
    return settings.story_merge_enabled


def merge_recent_stories() -> int:
    """
    Find and merge semantically duplicate stories created in the last N hours.
    Returns the number of stories eliminated by merging.
    """
    if not _is_enabled():
        return 0

    hours = settings.story_merge_hours
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    with Session(engine) as session:
        recent = list(session.exec(
            select(Story).where(Story.first_seen >= cutoff)
        ).all())

    if len(recent) < 2:
        return 0

    groups = _ask_claude(recent)
    if not groups:
        return 0

    with Session(engine) as session:
        eliminated = _apply_merges(session, groups)

    if eliminated:
        logger.info("[StoryMerger] Merged %d duplicate stories into survivors", eliminated)
    return eliminated


def _ask_claude(stories: list[Story]) -> list[list[int]]:
    stories_block = "\n".join(
        f"{s.id} | {s.title_de}"
        for s in stories
    )
    user_msg = f"STORIES (letzte {settings.story_merge_hours}h):\nID | Titel\n{stories_block}"

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = call_with_retry(lambda: client.messages.create(
            model=settings.model_id,
            max_tokens=1024,
            system=[{
                "type": "text",
                "text": _SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": user_msg}],
        ))
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)
        groups: list[list[int]] = data.get("groups", [])
    except Exception as exc:
        logger.error("[StoryMerger] Claude call failed: %s", exc)
        return []

    # Validate: only keep groups whose IDs actually exist in our input set
    valid_ids = {s.id for s in stories}
    seen: set[int] = set()
    clean: list[list[int]] = []
    for group in groups:
        filtered = [sid for sid in group if sid in valid_ids and sid not in seen]
        if len(filtered) >= 2:
            seen.update(filtered)
            clean.append(filtered)

    return clean


def _apply_merges(session: Session, groups: list[list[int]]) -> int:
    eliminated = 0
    for group in groups:
        # Oldest story (lowest ID) survives; others are merged into it
        survivor_id = min(group)
        to_merge = [sid for sid in group if sid != survivor_id]

        # Reassign articles
        articles = list(session.exec(
            select(Article).where(Article.story_id.in_(to_merge))
        ).all())
        for article in articles:
            article.story_id = survivor_id
            session.add(article)

        # Move favorites so they don't become orphaned
        favorites = list(session.exec(
            select(FavoriteStory).where(FavoriteStory.story_id.in_(to_merge))
        ).all())
        for fav in favorites:
            fav.story_id = survivor_id
            session.add(fav)

        session.flush()

        # Recompute source_count from actual articles
        actual_count = session.exec(
            select(func.count(Article.id)).where(Article.story_id == survivor_id)
        ).one()
        survivor = session.get(Story, survivor_id)
        if survivor:
            survivor.source_count = actual_count
            survivor.last_updated = datetime.utcnow()
            survivor.is_processed = False  # trigger re-summarization
            session.add(survivor)

        # Delete the now-empty loser stories
        for sid in to_merge:
            story = session.get(Story, sid)
            if story:
                logger.info(
                    "[StoryMerger] Merging story %d (%r) → survivor %d",
                    sid, story.title_de, survivor_id,
                )
                session.delete(story)

        session.commit()
        eliminated += len(to_merge)

    return eliminated
