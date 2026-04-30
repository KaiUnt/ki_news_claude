"""
Claude-based story clustering.

Sends article titles + open story titles to Claude, which assigns
each article to an existing story or creates a new one.
Batches up to BATCH_SIZE articles per call for cost efficiency.
"""
import json
import anthropic
from datetime import datetime
from sqlmodel import Session

from .config import settings
from .db import Article, Story, engine, get_open_stories

BATCH_SIZE = 80  # articles per Claude call

_SYSTEM_PROMPT = """Du bist ein News-Clustering-Experte für KI-Nachrichten.

Aufgabe: Ordne jeden neuen Artikel einer bestehenden Story zu, oder eröffne eine neue Story.

Regeln:
- Artikel über dasselbe Ereignis/Release/Thema → gleiche Story
- Jedes ArXiv-Paper ist normalerweise eine eigene Story, außer ein News-Artikel berichtet direkt darüber
- Story-Titel: kurz, auf Deutsch, max 7 Wörter (z.B. "GPT-5 Veröffentlichung", "Gemini 2.0 Flash Release")
- story_id = null bedeutet: neue Story anlegen mit new_story_title

Antworte NUR als valides JSON-Array, kein Text davor/danach:
[{"article_id": <int>, "story_id": <int_or_null>, "new_story_title": <string_or_null>}, ...]

Jeder Artikel muss im Array vorkommen."""


def _call_claude(articles: list[Article], open_stories: list[Story]) -> list[dict]:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    stories_block = "KEINE OFFENEN STORIES"
    if open_stories:
        stories_block = "\n".join(
            f"{s.id} | {s.title_de}" for s in open_stories
        )

    articles_block = "\n".join(
        f"{a.id} | {a.title[:100]} | {a.source_name}"
        for a in articles
    )

    user_msg = (
        f"OFFENE STORIES (letzte 3 Tage):\nID | Titel\n{stories_block}\n\n"
        f"NEUE ARTIKEL:\nID | Titel | Quelle\n{articles_block}"
    )

    response = client.messages.create(
        model=settings.model_id,
        max_tokens=4096,
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
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    return json.loads(raw)


def cluster_articles(articles: list[Article]) -> dict[int, int]:
    """
    Assigns each article to a story_id. Creates new Story records as needed.
    Returns {article_id: story_id}.
    """
    if not articles:
        return {}

    result: dict[int, int] = {}

    for i in range(0, len(articles), BATCH_SIZE):
        batch = articles[i: i + BATCH_SIZE]

        with Session(engine) as session:
            open_stories = get_open_stories(session, days=3)

        assignments = _call_claude_safe(batch, open_stories)

        with Session(engine) as session:
            for assignment in assignments:
                article_id = assignment.get("article_id")
                story_id = assignment.get("story_id")
                new_title = assignment.get("new_story_title")

                if not article_id:
                    continue

                if story_id:
                    # Update existing story's last_updated + source_count
                    story = session.get(Story, story_id)
                    if story:
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


def _create_story(session: Session, title_de: str) -> int:
    story = Story(
        title_de=title_de,
        first_seen=datetime.utcnow(),
        last_updated=datetime.utcnow(),
        source_count=1,
        is_processed=False,
    )
    session.add(story)
    session.commit()
    session.refresh(story)
    return story.id


def _call_claude_safe(articles: list[Article], open_stories: list[Story]) -> list[dict]:
    try:
        return _call_claude(articles, open_stories)
    except (json.JSONDecodeError, Exception) as exc:
        print(f"[Clusterer] Error: {exc} — falling back to solo stories")
        # Fallback: each article gets its own story
        return [
            {"article_id": a.id, "story_id": None, "new_story_title": a.title[:60]}
            for a in articles
        ]
