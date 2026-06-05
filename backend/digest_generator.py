"""
Claude-based daily digest generation.

Once per day (or on manual regenerate), picks 5–7 most relevant stories from
the recent window, scores them against the user's priority_prompt, and writes
a 2–3 paragraph German meta-summary. Persisted as a DailyDigest row.
"""
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)
from sqlmodel import Session, select, func, or_

from .config import settings, split_tags
from .db import Article, Story, DailyDigest, UserProfile, Category, ManagedSource, engine, get_prompt
from .source_catalog import PAPER_SOURCES, story_signals_for_source_names
from .claude_retry import call_with_retry


_SYSTEM_PROMPT = """Du bist der News-Editor für ein persönliches KI-News-Dashboard.

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
}"""


# Forced tool use replaces hand-serialized JSON output. meta_summary_de is long
# German prose (the highest unescaped-quote risk of all three pipelines) — having
# the SDK return a parsed dict eliminates that JSONDecodeError class entirely.
_DIGEST_TOOL = {
    "name": "publish_digest",
    "description": "Gib die Tageszusammenfassung und die kuratierten Top-Stories zurück.",
    "input_schema": {
        "type": "object",
        "properties": {
            "meta_summary_de": {"type": "string", "description": "2–3 Absätze auf Deutsch, was heute in der KI-Welt passiert ist."},
            "top_stories": {
                "type": "array",
                "description": "5–7 Stories, rank 1 = wichtigste.",
                "items": {
                    "type": "object",
                    "properties": {
                        "story_id": {"type": "integer"},
                        "rank": {"type": "integer"},
                        "why": {"type": "string", "description": "1 Satz, warum diese Story wichtig ist."},
                    },
                    "required": ["story_id", "rank", "why"],
                },
            },
        },
        "required": ["meta_summary_de", "top_stories"],
    },
}


def generate(
    reuse_last_window: bool = False,
    category_id: Optional[int] = None,
) -> Optional[DailyDigest]:
    """Generate a DailyDigest — global (category_id=None) or per-category.

    reuse_last_window=False: window starts at last digest's generated_at for
                              this digest type (global or same category).
    reuse_last_window=True:  re-curates the same story pool as the last digest
                              of this type. Used on manual regenerate.

    Returns None if no processed stories in the window.
    """
    with Session(engine) as session:
        profile = session.get(UserProfile, 1)
        if profile is None:
            raise RuntimeError("Default profile (id=1) not initialized")

        window_start = _compute_window_start(session, reuse_last_window, category_id)
        window_end = datetime.utcnow()

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

        non_paper_story_ids = (
            select(Article.story_id)
            .where(Article.story_id.is_not(None))
            .where(~Article.source_name.in_(list(PAPER_SOURCES)))
            .distinct()
        )

        non_newsletter_story_ids = list(session.exec(
            select(Article.story_id)
            .where(Article.story_id.is_not(None))
            .where(Article.source_type != "newsletter")
            .distinct()
        ).all())

        story_query = (
            select(Story)
            .where(Story.id.in_(recent_story_ids))
            .where(Story.id.in_(non_newsletter_story_ids))
            .where(Story.is_processed == True)
            .where(Story.id.in_(non_paper_story_ids))
            .where(func.lower(Story.title_de) != "sonstiges")
        )

        # Per-category: restrict to stories from sources belonging to this category
        if category_id is not None:
            cat_source_names = list(session.exec(
                select(ManagedSource.name).where(ManagedSource.category_id == category_id)
            ).all())
            if not cat_source_names:
                return None
            cat_story_subq = (
                select(Article.story_id)
                .where(Article.story_id.is_not(None))
                .where(Article.source_name.in_(cat_source_names))
                .distinct()
            )
            story_query = story_query.where(Story.id.in_(cat_story_subq))
            # Category digests don't use first_digest_id guard — same story can
            # appear in both global and category digest.
        else:
            # Global digest: only stories not yet in any digest
            if reuse_last_window:
                last_digest = session.exec(
                    select(DailyDigest)
                    .where(DailyDigest.category_id.is_(None))
                    .order_by(DailyDigest.generated_at.desc())
                    .limit(1)
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
        story_ids = [story.id for story in stories if story.id is not None]
        source_names_by_story: dict[int, list[str]] = {}
        if story_ids:
            article_rows = session.exec(
                select(Article.story_id, Article.source_name)
                .where(Article.story_id.in_(story_ids))
            ).all()
            for story_id, source_name in article_rows:
                if story_id is None:
                    continue
                source_names_by_story.setdefault(story_id, []).append(source_name)

        # Prompt: category-specific if set, else global digest_curation
        if category_id is not None:
            category = session.get(Category, category_id)
            system_prompt = (
                category.digest_prompt
                if category and category.digest_prompt
                else get_prompt(session, "digest_curation", _SYSTEM_PROMPT)
            )
        else:
            system_prompt = get_prompt(session, "digest_curation", _SYSTEM_PROMPT)

        priority_prompt = profile.priority_prompt or ""
        profile_id = profile.id

    if not stories:
        return None

    stories_payload = [
        {
            "id": s.id,
            "title_de": s.title_de,
            "summary_de": s.summary_de,
            **split_tags(s.tags),
            "source_count": s.source_count,
            "latest_published_at": (
                latest_pub_by_story.get(s.id).isoformat()
                if latest_pub_by_story.get(s.id) else None
            ),
            **story_signals_for_source_names(source_names_by_story.get(s.id, [])),
        }
        for s in stories
    ]

    user_msg = (
        f"USER-PRIORITÄTEN:\n"
        f"{priority_prompt or '(keine angegeben — sortiere nach allgemeiner Wichtigkeit)'}\n\n"
        f"STORIES (Fenster {window_start.isoformat()} bis {window_end.isoformat()}):\n"
        f"{json.dumps(stories_payload, ensure_ascii=False, indent=2)}"
    )

    call_result = _call_safe(user_msg, system_prompt)
    if call_result is None:
        return None
    result, raw_response = call_result

    digest = DailyDigest(
        user_profile_id=profile_id,
        generated_at=window_end,
        window_start=window_start,
        window_end=window_end,
        meta_summary_de=result["meta_summary_de"],
        model_id=settings.model_id,
        raw_response=raw_response,
        category_id=category_id,
    )
    digest.top_stories = result["top_stories"]

    with Session(engine, expire_on_commit=False) as session:
        session.add(digest)
        session.commit()
        session.refresh(digest)

        # Only global digests mark first_digest_id on stories
        if category_id is None:
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


def _compute_window_start(
    session: Session,
    reuse_last_window: bool,
    category_id: Optional[int] = None,
) -> datetime:
    q = select(DailyDigest)
    if category_id is None:
        q = q.where(DailyDigest.category_id.is_(None))
    else:
        q = q.where(DailyDigest.category_id == category_id)

    if reuse_last_window:
        last = session.exec(q.order_by(DailyDigest.generated_at.desc()).limit(1)).first()
        if last:
            return last.window_start
    else:
        max_q = select(func.max(DailyDigest.generated_at))
        if category_id is None:
            max_q = max_q.where(DailyDigest.category_id.is_(None))
        else:
            max_q = max_q.where(DailyDigest.category_id == category_id)
        last_at = session.exec(max_q).first()
        if last_at:
            return last_at
    return datetime.utcnow() - timedelta(hours=24)


def _call_safe(user_msg: str, system_prompt: str = _SYSTEM_PROMPT) -> Optional[tuple[dict, Optional[str]]]:
    """Call Claude. On any error, return None so the caller skips persistence.

    Persisting an empty fallback digest would mark its top stories with
    first_digest_id and exclude them from the next regular run — losing the
    most important stories of the day on a Claude outage.
    """
    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = call_with_retry(lambda: client.messages.create(
            model=settings.model_id,
            max_tokens=2048,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=[_DIGEST_TOOL],
            tool_choice={"type": "tool", "name": _DIGEST_TOOL["name"]},
            messages=[{"role": "user", "content": user_msg}],
        ))
        for block in response.content:
            if block.type == "tool_use" and isinstance(block.input, dict):
                result = block.input
                if result.get("meta_summary_de") and isinstance(result.get("top_stories"), list):
                    return result, json.dumps(result, ensure_ascii=False)
        logger.error(
            "[DigestGenerator] No usable tool_use block (stop_reason=%s) — skipping persistence",
            response.stop_reason,
        )
        return None
    except Exception as exc:
        logger.error("[DigestGenerator] Error: %s — skipping digest persistence", exc)
        return None
