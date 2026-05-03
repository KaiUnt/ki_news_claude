"""
Claude-based daily digest generation.

Once per day (or on manual regenerate), picks 5–7 most relevant stories from
the recent window, scores them against the user's priority_prompt, and writes
a 2–3 paragraph German meta-summary. Persisted as a DailyDigest row.
"""
import json
from datetime import datetime, timedelta
from typing import Optional

import anthropic
from sqlmodel import Session, select, func, or_

from .config import settings
from .db import Article, Story, DailyDigest, UserProfile, engine


_SYSTEM_PROMPT = """Du bist der News-Editor für ein persönliches KI-News-Dashboard.

Aufgabe: Wähle aus den heutigen Stories die wichtigsten 5–7 aus und schreibe eine kurze Tageszusammenfassung auf Deutsch.

Regeln:
- Berücksichtige die User-Prioritäten (falls angegeben). Wenn keine User-Prioritäten gegeben sind, sortiere nach allgemeiner Wichtigkeit: Recency (latest_published_at = neuer ist besser), Source-Count (mehrere Quellen = wichtig), Tag-Diversität.
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
}"""


def generate(reuse_last_window: bool = False) -> Optional[DailyDigest]:
    """Generate a new DailyDigest. Persists and returns it.

    reuse_last_window=False: window starts at MAX(DailyDigest.generated_at), or
                              now-24h if no digest exists yet. This is the
                              daily-pipeline mode (only "new since last digest").
    reuse_last_window=True:  window starts at last digest's window_start, so the
                              same story pool is re-curated. Used by the manual
                              regenerate endpoint after a priority_prompt edit.

    Returns None if the resulting window has no processed stories.
    """
    with Session(engine) as session:
        profile = session.get(UserProfile, 1)
        if profile is None:
            raise RuntimeError("Default profile (id=1) not initialized")

        window_start = _compute_window_start(session, reuse_last_window)
        window_end = datetime.utcnow()

        # Stories qualify for this digest only if they have at least one article
        # with a recent publication date — prevents backfill mirrors from
        # re-floating years-old reports into today's window.
        recent_story_ids = list(session.exec(
            select(Article.story_id)
            .where(Article.story_id.is_not(None))
            .where(func.coalesce(Article.published_at, Article.fetched_at) >= window_start)
            .distinct()
        ).all())

        latest_pub_by_story = dict(session.exec(
            select(
                Article.story_id,
                func.max(func.coalesce(Article.published_at, Article.fetched_at)),
            )
            .where(Article.story_id.is_not(None))
            .group_by(Article.story_id)
        ).all())

        if not recent_story_ids:
            return None

        story_query = (
            select(Story)
            .where(Story.id.in_(recent_story_ids))
            .where(Story.is_processed == True)
            # Exclude historic catch-all stories (often 20+ unrelated articles
            # piled into a single "Sonstiges" bucket by older cluster runs).
            .where(func.lower(Story.title_de) != "sonstiges")
        )

        # Each story may appear in at most one digest. On regenerate, also include
        # the exact stories that were in the last digest (regardless of when their
        # first_digest_id was set), so the same pool gets re-curated.
        if reuse_last_window:
            last_digest = session.exec(
                select(DailyDigest).order_by(DailyDigest.generated_at.desc()).limit(1)
            ).first()
            last_top_ids = {
                t.get("story_id")
                for t in (last_digest.top_stories if last_digest else [])
                if isinstance(t.get("story_id"), int)
            }
            story_query = story_query.where(
                or_(Story.first_digest_id.is_(None), Story.id.in_(last_top_ids))
            ) if last_top_ids else story_query.where(Story.first_digest_id.is_(None))
        else:
            story_query = story_query.where(Story.first_digest_id.is_(None))

        stories = list(session.exec(story_query).all())

        priority_prompt = profile.priority_prompt or ""
        profile_id = profile.id

    if not stories:
        return None

    stories_payload = [
        {
            "id": s.id,
            "title_de": s.title_de,
            "summary_de": s.summary_de,
            "tags": s.tags,
            "source_count": s.source_count,
            "latest_published_at": (
                latest_pub_by_story.get(s.id).isoformat()
                if latest_pub_by_story.get(s.id) else None
            ),
        }
        for s in stories
    ]

    user_msg = (
        f"USER-PRIORITÄTEN:\n"
        f"{priority_prompt or '(keine angegeben — sortiere nach allgemeiner Wichtigkeit)'}\n\n"
        f"STORIES (Fenster {window_start.isoformat()} bis {window_end.isoformat()}):\n"
        f"{json.dumps(stories_payload, ensure_ascii=False, indent=2)}"
    )

    result, raw_response = _call_safe(user_msg, stories)

    digest = DailyDigest(
        user_profile_id=profile_id,
        generated_at=window_end,
        window_start=window_start,
        window_end=window_end,
        meta_summary_de=result["meta_summary_de"],
        model_id=settings.model_id,
        raw_response=raw_response,
    )
    digest.top_stories = result["top_stories"]

    # expire_on_commit=False keeps `digest` attributes loaded after the second
    # commit below — otherwise marking stories with first_digest_id triggers an
    # implicit expire on `digest` and the caller hits DetachedInstanceError.
    with Session(engine, expire_on_commit=False) as session:
        session.add(digest)
        session.commit()
        session.refresh(digest)

        # Mark each top story with its first digest appearance (Fix 4: one-shot)
        for entry in result["top_stories"]:
            sid = entry.get("story_id")
            if not isinstance(sid, int):
                continue
            story = session.get(Story, sid)
            if story and story.first_digest_id is None:
                story.first_digest_id = digest.id
                session.add(story)
        session.commit()

    return digest


def _compute_window_start(session: Session, reuse_last_window: bool) -> datetime:
    if reuse_last_window:
        last = session.exec(
            select(DailyDigest).order_by(DailyDigest.generated_at.desc()).limit(1)
        ).first()
        if last:
            return last.window_start
    else:
        last_at = session.exec(select(func.max(DailyDigest.generated_at))).first()
        if last_at:
            return last_at
    return datetime.utcnow() - timedelta(hours=24)


def _call_safe(user_msg: str, stories: list[Story]) -> tuple[dict, Optional[str]]:
    """Call Claude. On any error, fall back to a top-by-source_count digest.
    Returns (parsed_result, raw_response_or_None)."""
    raw_for_debug: Optional[str] = None
    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model=settings.model_id,
            max_tokens=2048,
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = response.content[0].text.strip()
        raw_for_debug = raw
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw), raw_for_debug
    except Exception as exc:
        print(f"[DigestGenerator] Error: {exc} — falling back to source_count ranking")
        top = sorted(stories, key=lambda s: s.source_count, reverse=True)[:5]
        return (
            {
                "meta_summary_de": "",
                "top_stories": [
                    {"story_id": s.id, "rank": i + 1, "why": "Fallback: höchste Quellen-Anzahl"}
                    for i, s in enumerate(top)
                ],
            },
            raw_for_debug,
        )
