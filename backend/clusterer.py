"""
Claude-based story clustering.

Sends article titles + open story titles to Claude, which assigns
each article to an existing story or creates a new one.
Batches up to BATCH_SIZE articles per call for cost efficiency.
"""
import logging
import anthropic
from datetime import datetime, timedelta
from sqlmodel import Session, select

logger = logging.getLogger(__name__)

from .config import settings
from .db import Article, Story, engine, get_open_stories, get_prompt
from .source_catalog import get_source_metadata, story_signals_for_source_names
from .claude_retry import call_with_retry

BATCH_SIZE = 80  # articles per Claude call
STALE_ARTICLE_DAYS = 7  # articles older than this don't refresh story.last_updated

_SYSTEM_PROMPT = """Du bist ein News-Clustering-Experte für KI-Nachrichten.

Aufgabe: Ordne jeden neuen Artikel einer bestehenden Story zu, oder eröffne eine neue Story.

Regeln:
- Artikel über dasselbe Ereignis/Release/Thema → gleiche Story, auch wenn Titel oder Blickwinkel verschieden.
  Beispiel: "RTX Spark: Laptop-CPU vorgestellt", "Nvidia greift Intel mit ARM-Chip an", "RTX Spark gegen AMD"
  → alle zur selben Story, weil es dasselbe Produkt-Launch ist.
- VERSIONSNUMMERN sind IMMER eigene Stories: GPT-5.4 ≠ GPT-5.5, Claude 4.6 ≠ Claude 4.7, Gemini 2.0 ≠ Gemini 2.5.
  Vergleiche die Versionsnummer im Artikel-Titel mit der in der offenen Story. Bei abweichender Version: NEUE Story.
- Verschiedene Releases desselben Herstellers (z.B. "Claude 4.7 Release" vs "Claude Security Beta") sind eigene Stories.
- DATUMSCHECK: Wenn ein Artikel ein Datum (published_at) Wochen/Monate vor dem first_seen einer offenen Story hat, ist es vermutlich ein älterer Backfill und gehört NICHT zur aktuellen Story — leg eine neue an.
- Jedes wissenschaftliche Paper (ArXiv, HuggingFace Daily Papers) ist normalerweise eine eigene Story, außer ein News-Artikel berichtet direkt darüber.
- Offene Stories mit dem Präfix [PAPER] sind reine Paper-Stories. Hänge NIEMALS einen Mainstream-News-Artikel an eine [PAPER]-Story — die bleibt eigenständig. (Ein Paper darf zu einer bestehenden News-Story stoßen, aber nicht umgekehrt.)
- Story-Titel: kurz, auf Deutsch, max 7 Wörter (z.B. "GPT-5.5 Veröffentlichung", "Gemini 2.5 Flash Release"). Versionsnummern beibehalten.
- story_id = null bedeutet: neue Story anlegen mit new_story_title.

Antworte NUR als valides JSON-Array, kein Text davor/danach:
[{"article_id": <int>, "story_id": <int_or_null>, "new_story_title": <string_or_null>}, ...]

Jeder Artikel muss im Array vorkommen."""


# Forced tool use replaces hand-serialized JSON output — a quote in a German
# new_story_title can no longer break parsing (the old JSONDecodeError class).
# story_id null/absent = neue Story; the existing cluster_articles logic reads
# the fields via .get() and treats falsy story_id as "create new".
_CLUSTER_TOOL = {
    "name": "assign_articles",
    "description": "Ordne jeden Artikel einer bestehenden Story zu oder eröffne eine neue Story.",
    "input_schema": {
        "type": "object",
        "properties": {
            "assignments": {
                "type": "array",
                "description": "Genau ein Eintrag pro Artikel.",
                "items": {
                    "type": "object",
                    "properties": {
                        "article_id": {"type": "integer"},
                        "story_id": {"type": ["integer", "null"], "description": "ID einer bestehenden Story, oder null für neue Story."},
                        "new_story_title": {"type": ["string", "null"], "description": "Kurzer dt. Titel der neuen Story (nur wenn story_id null)."},
                    },
                    "required": ["article_id"],
                },
            },
        },
        "required": ["assignments"],
    },
}


def _fmt_date(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%d") if dt else "?"


def _call_claude(
    articles: list[Article],
    open_stories: list[Story],
    paper_only_ids: set[int],
) -> list[dict]:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    with Session(engine) as s:
        system_prompt = get_prompt(s, "clusterer", _SYSTEM_PROMPT)

    stories_block = "KEINE OFFENEN STORIES"
    if open_stories:
        stories_block = "\n".join(
            f"{s.id} | {_fmt_date(s.first_seen)} | "
            f"{'[PAPER] ' if s.id in paper_only_ids else ''}{s.title_de} "
            f"({s.source_count} Quellen)"
            for s in open_stories
        )

    def _fmt_article(a: Article) -> str:
        snippet = ""
        if a.raw_content:
            snippet = " | " + a.raw_content[:120].replace("\n", " ")
        return f"{a.id} | {_fmt_date(a.published_at)} | {a.title[:100]} | {a.source_name}{snippet}"

    articles_block = "\n".join(_fmt_article(a) for a in articles)

    user_msg = (
        f"OFFENE STORIES (letzte 3 Tage):\nID | first_seen | Titel\n{stories_block}\n\n"
        f"NEUE ARTIKEL:\nID | published_at | Titel | Quelle | Snippet\n{articles_block}"
    )

    response = call_with_retry(lambda: client.messages.create(
        model=settings.model_id,
        max_tokens=4096,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[_CLUSTER_TOOL],
        tool_choice={"type": "tool", "name": _CLUSTER_TOOL["name"]},
        messages=[{"role": "user", "content": user_msg}],
    ))

    for block in response.content:
        if block.type == "tool_use" and isinstance(block.input, dict):
            assignments = block.input.get("assignments")
            if isinstance(assignments, list):
                return assignments
    # No usable tool_use block (e.g. max_tokens truncation) — let _call_claude_safe
    # fall back to solo stories rather than silently dropping the whole batch.
    raise ValueError(f"clusterer: no tool_use assignments (stop_reason={response.stop_reason})")


def cluster_articles(articles: list[Article], story_days: int = 3) -> dict[int, int]:
    """
    Assigns each article to a story_id. Creates new Story records as needed.
    Returns {article_id: story_id}.

    story_days: how far back to look for open stories. Use a larger value for
    newsletter articles so weekly newsletters can connect to RSS stories that
    were published up to story_days ago.
    """
    if not articles:
        return {}

    result: dict[int, int] = {}

    stale_cutoff = datetime.utcnow() - timedelta(days=STALE_ARTICLE_DAYS)

    for i in range(0, len(articles), BATCH_SIZE):
        batch = articles[i: i + BATCH_SIZE]
        batch_by_id = {a.id: a for a in batch}

        with Session(engine) as session:
            open_stories = get_open_stories(session, days=story_days)
            paper_only_ids = _paper_only_story_ids(
                session, [s.id for s in open_stories if s.id is not None]
            )

        # Paper-only stories are created deterministically (paper_router) and never
        # need clustering — drop them from the prompt entirely. They were ~75% of
        # the open-stories block; sending them re-bloated every batch's input for
        # nothing. With no papers in the prompt the [PAPER] marker and the reroute
        # guard below naturally no-op, but stay as defense-in-depth.
        open_stories = [s for s in open_stories if s.id not in paper_only_ids]

        assignments = _call_claude_safe(batch, open_stories, paper_only_ids)

        with Session(engine) as session:
            # Guard: Claude must never attach a mainstream-news article to a
            # paper-only story (e.g. 5 "Meta AI pendant" articles got merged into
            # a single-source arXiv paper, inflating its source_count and floating
            # it to digest rank 1). Articles Claude lumped into the same wrong
            # paper-story are rerouted together into one fresh story.
            reroute_target = _reroute_paper_mismatches(
                session, assignments, batch_by_id, paper_only_ids
            )

            for assignment in assignments:
                article_id = assignment.get("article_id")
                story_id = assignment.get("story_id")
                new_title = assignment.get("new_story_title")

                if not article_id:
                    continue

                if article_id in reroute_target:
                    story_id = reroute_target[article_id]
                    new_title = None

                if story_id:
                    # Update existing story's source_count; refresh last_updated
                    # only if the incoming article is itself fresh (avoids a years-old
                    # backfill article from re-floating an old story into the digest).
                    story = session.get(Story, story_id)
                    if story:
                        article = batch_by_id.get(article_id)
                        article_pub = article.published_at if article else None
                        if article_pub is None or article_pub >= stale_cutoff:
                            story.last_updated = datetime.utcnow()
                        story.source_count += 1
                        session.add(story)
                        session.commit()
                        result[article_id] = story_id
                    else:
                        # Story was deleted/invalid — create new
                        story_id = _create_story(session, new_title or "Sonstiges")
                        result[article_id] = story_id
                elif new_title:
                    sid = _create_story(session, new_title)
                    result[article_id] = sid
                else:
                    # Fallback: create solo story with article title
                    article = session.get(Article, article_id)
                    title = article.title[:60] if article else "Unbekannt"
                    sid = _create_story(session, title)
                    result[article_id] = sid

    return result


def _create_story(session: Session, title_de: str, source_count: int = 1) -> int:
    story = Story(
        title_de=title_de,
        first_seen=datetime.utcnow(),
        last_updated=datetime.utcnow(),
        source_count=source_count,
        is_processed=False,
    )
    session.add(story)
    session.commit()
    session.refresh(story)
    return story.id


def _paper_only_story_ids(session: Session, story_ids: list[int]) -> set[int]:
    """Return the subset of story_ids whose sources are *all* paper-feeds."""
    if not story_ids:
        return set()
    rows = session.exec(
        select(Article.story_id, Article.source_name).where(
            Article.story_id.in_(story_ids)
        )
    ).all()
    names_by_story: dict[int, list[str]] = {}
    for story_id, source_name in rows:
        if story_id is not None:
            names_by_story.setdefault(story_id, []).append(source_name)
    return {
        sid
        for sid, names in names_by_story.items()
        if story_signals_for_source_names(names)["story_kind"] == "paper"
    }


def _compute_reroute(
    assignments: list[dict],
    batch_by_id: dict[int, Article],
    paper_only_ids: set[int],
) -> dict[int, list[int]]:
    """Group article_ids that Claude wrongly attached to a paper-only story.

    Pure (no DB) so it can be unit-tested. Returns {bad_story_id: [article_id, ...]}
    for non-paper articles assigned to a paper-only story.
    """
    reroute: dict[int, list[int]] = {}
    for assignment in assignments:
        story_id = assignment.get("story_id")
        article_id = assignment.get("article_id")
        if story_id not in paper_only_ids:
            continue
        article = batch_by_id.get(article_id)
        if article is None:
            continue
        if get_source_metadata(article.source_name)["story_kind"] != "paper":
            reroute.setdefault(story_id, []).append(article_id)
    return reroute


def _reroute_paper_mismatches(
    session: Session,
    assignments: list[dict],
    batch_by_id: dict[int, Article],
    paper_only_ids: set[int],
) -> dict[int, int]:
    """Create one fresh story per wrongly-targeted paper-story and return
    {article_id: new_story_id} for the rerouted articles.

    New stories start at source_count=0 — the main loop increments per article.
    """
    reroute = _compute_reroute(assignments, batch_by_id, paper_only_ids)
    reroute_target: dict[int, int] = {}
    for bad_story_id, article_ids in reroute.items():
        title = batch_by_id[article_ids[0]].title[:60]
        new_sid = _create_story(session, title, source_count=0)
        for article_id in article_ids:
            reroute_target[article_id] = new_sid
        logger.warning(
            "[Clusterer] Reroute: %d non-paper article(s) Claude assigned to "
            "paper-only story %d → new story %d (%r)",
            len(article_ids), bad_story_id, new_sid, title,
        )
    return reroute_target


def _call_claude_safe(
    articles: list[Article], open_stories: list[Story], paper_only_ids: set[int]
) -> list[dict]:
    try:
        return _call_claude(articles, open_stories, paper_only_ids)
    except Exception as exc:
        logger.error("[Clusterer] Error: %s — falling back to solo stories", exc)
        # Fallback: each article gets its own story
        return [
            {"article_id": a.id, "story_id": None, "new_story_title": a.title[:60]}
            for a in articles
        ]
