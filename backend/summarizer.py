"""
Claude-based summarization — operates on Stories, not individual articles.

For each Story, we send the best article's content (most text) + all source titles
to generate a German summary + tags once. is_processed=True afterwards.
"""
import json
import anthropic
from sqlmodel import Session, select

from .config import settings, AVAILABLE_TAGS
from .db import Article, Story, engine

_SYSTEM_PROMPT = f"""Du bist ein präziser KI-News-Analyst. Fasse News-Stories auf Deutsch zusammen und vergib Tags.

Verfügbare Tags:
{chr(10).join(f'- "{t}"' for t in AVAILABLE_TAGS)}

Antworte ausschließlich als gültiges JSON (kein Markdown):
{{
  "summary_de": "<2–3 prägnante Sätze auf Deutsch>",
  "tags": ["<Tag1>", "<Tag2>"]
}}

Regeln:
- summary_de: Sachlich, max 3 Sätze, kein Marketing-Sprech.
- tags: 1–3 Tags aus der obigen Liste.
- Falls kein KI-Bezug: tags = ["Sonstiges"]"""


class Summarizer:
    def __init__(self):
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    def summarize_story(self, story: Story, best_article: Article) -> dict:
        """Generate summary + tags for a Story based on its best article."""
        user_content = (
            f"Story-Titel: {story.title_de}\n"
            f"Primärquelle: {best_article.source_name}\n"
            f"Artikel-Titel: {best_article.title}\n"
            f"Inhalt: {best_article.raw_content or '(kein Inhalt)'}"
        )
        return self._call(user_content)

    def summarize_pending_stories(self) -> int:
        """Summarize all Stories that don't have a summary yet. Returns count."""
        with Session(engine) as session:
            pending = session.exec(
                select(Story).where(Story.is_processed == False)
            ).all()

        processed = 0
        for story in pending:
            best = self._best_article_for_story(story.id)
            if best is None:
                continue
            result = self.summarize_story(story, best)
            # On API errors (rate limit, network, etc.) `_call` returns summary_de=None.
            # Leave the story as pending so a future run can retry it.
            if result.get("summary_de") is None:
                continue
            with Session(engine) as session:
                s = session.get(Story, story.id)
                if s:
                    s.summary_de = result["summary_de"]
                    s.tags = result.get("tags", [])
                    s.is_processed = True
                    session.add(s)
                    session.commit()
                    processed += 1
        return processed

    def _best_article_for_story(self, story_id: int) -> Article | None:
        """Return the article with the most raw_content for a given story."""
        with Session(engine) as session:
            articles = session.exec(
                select(Article).where(Article.story_id == story_id)
            ).all()
        if not articles:
            return None
        return max(articles, key=lambda a: len(a.raw_content or ""))

    def _call(self, user_content: str) -> dict:
        try:
            response = self._client.messages.create(
                model=settings.model_id,
                max_tokens=512,
                system=[
                    {
                        "type": "text",
                        "text": _SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_content}],
            )
            raw = response.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"summary_de": user_content[:200], "tags": ["Sonstiges"]}
        except Exception as exc:
            print(f"[Summarizer] Error: {exc}")
            return {"summary_de": None, "tags": ["Sonstiges"]}
