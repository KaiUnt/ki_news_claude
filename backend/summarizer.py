"""
Claude-based summarization — operates on Stories, not individual articles.

For each Story, we send the best article's content + all source titles to Claude
to generate a German summary. For non-paper stories Claude also classifies the
story on three axes (type / domains / flags); paper stories skip the tag step.
is_processed=True afterwards.
"""
import json
import anthropic
from sqlmodel import Session, select

from .config import settings, STORY_TYPES, STORY_DOMAINS, STORY_FLAGS
from .db import Article, Story, engine
from .source_catalog import story_signals_for_source_names


def _build_general_prompt() -> str:
    return f"""Du bist ein präziser KI-News-Analyst. Fasse News-Stories auf Deutsch zusammen und kategorisiere sie auf drei Achsen.

TYP (genau 1):
  - "release": Neues Modell- oder Produkt-Release von einem KI-Lab (z.B. GPT-5, Claude 4.7, Gemini 2.5)
  - "forschung": Forschungs-News, Paper-Berichterstattung, Lab-Erkenntnisse, Benchmarks
  - "tool": Tools, Produkte, Apps rund um KI (Cursor, Vercel AI SDK, Notion AI)
  - "infrastruktur": Chips, Compute, Hosting, Cloud-AI-Infrastruktur (NVIDIA, AWS Bedrock)
  - "business": Markt, Funding, M&A, Pricing, Konkurrenz, Geschäftszahlen
  - "policy": Regulierung, Recht, AI-Safety-Debatte, Ethik
  - "demo": Capability-Demo, Experiment, "KI macht jetzt X"-Stories, Multi-Agent-Showcases, Welten in denen KI-Modelle eine Society bauen

DOMAIN (1–2):
  - "llm-core": Sprachmodelle, allgemeines LLM-Fundament
  - "coding": Programmier-AI, Code-Assistenten, Software-Engineering mit KI
  - "agenten": Agents, Multi-Agent-Systeme, Tool-Use, autonome Pipelines
  - "bild-video": Bild- und Video-Generation, generative Vision
  - "audio": Sprache, TTS, Musik
  - "robotik": Embodied AI, Robotik
  - "vertikal": Branchen-spezifisch (Health, Legal, Finance, Edu)
  - "sonstige": nichts davon

FLAGS (0 oder mehr):
  - "open-source": Modell, Code oder Tool ist open-source
  - "frontier": SOTA/Frontier-Modell oder -Capability
  - "big-lab": Story dreht sich um OpenAI, Anthropic, Google, Meta oder Microsoft

Antworte ausschließlich als gültiges JSON (kein Markdown):
{{
  "summary_de": "<2–3 prägnante Sätze auf Deutsch>",
  "type": "<einer der TYP-Werte>",
  "domains": ["<DOMAIN1>", ...],
  "flags": ["<FLAG1>", ...]
}}

Regeln:
- summary_de: Sachlich, max 3 Sätze, kein Marketing-Sprech.
- type: Wenn unsicher, wähle den dominantesten Aspekt der Story.
- domains: Wenn keine klare Domain passt, ["sonstige"].
- flags: Nur setzen wenn klar zutreffend. Leeres Array ist OK.
- Falls die Story keinen KI-Bezug hat: type="demo", domains=["sonstige"], flags=[]."""


_GENERAL_SYSTEM_PROMPT = _build_general_prompt()

_PAPER_SYSTEM_PROMPT = """Du fasst ArXiv-Papers für ein KI-News-Dashboard auf Deutsch zusammen.

Antworte ausschließlich als gültiges JSON (kein Markdown):
{
  "summary_de": "<2–3 prägnante Sätze: Was wurde untersucht, was ist das Ergebnis?>"
}

Regeln:
- Sachlich, max 3 Sätze.
- Direkt einsteigen, kein "Diese Arbeit untersucht..."-Geschwafel."""


def _build_tags(result: dict) -> list[str]:
    """Convert Claude's structured classification into prefixed tag strings."""
    tags: list[str] = []
    t = result.get("type")
    if isinstance(t, str) and t in STORY_TYPES:
        tags.append(f"type:{t}")
    for d in result.get("domains", []) or []:
        if isinstance(d, str) and d in STORY_DOMAINS:
            tag = f"domain:{d}"
            if tag not in tags:
                tags.append(tag)
    for f in result.get("flags", []) or []:
        if isinstance(f, str) and f in STORY_FLAGS:
            tag = f"flag:{f}"
            if tag not in tags:
                tags.append(tag)
    return tags


class Summarizer:
    def __init__(self):
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    def summarize_pending_stories(self) -> int:
        """Summarize all Stories that don't have a summary yet. Returns count."""
        with Session(engine) as session:
            pending = session.exec(
                select(Story).where(Story.is_processed == False)
            ).all()

        processed = 0
        for story in pending:
            with Session(engine) as session:
                articles = list(session.exec(
                    select(Article).where(Article.story_id == story.id)
                ).all())
            if not articles:
                continue

            best = max(articles, key=lambda a: len(a.raw_content or ""))
            signals = story_signals_for_source_names([a.source_name for a in articles])
            is_paper = signals["story_kind"] == "paper"

            if is_paper:
                result = self._call_paper(story, best)
                new_tags: list[str] = []
            else:
                result = self._call_general(story, best)
                new_tags = _build_tags(result)

            if result.get("summary_de") is None:
                continue

            with Session(engine) as session:
                s = session.get(Story, story.id)
                if s:
                    s.summary_de = result["summary_de"]
                    s.tags = new_tags
                    s.is_processed = True
                    session.add(s)
                    session.commit()
                    processed += 1
        return processed

    def _call_general(self, story: Story, best_article: Article) -> dict:
        user_content = (
            f"Story-Titel: {story.title_de}\n"
            f"Primärquelle: {best_article.source_name}\n"
            f"Artikel-Titel: {best_article.title}\n"
            f"Inhalt: {best_article.raw_content or '(kein Inhalt)'}"
        )
        return self._call(user_content, _GENERAL_SYSTEM_PROMPT, max_tokens=512)

    def _call_paper(self, story: Story, best_article: Article) -> dict:
        user_content = (
            f"Paper-Titel: {best_article.title}\n"
            f"Quelle: {best_article.source_name}\n"
            f"Abstract / Inhalt: {best_article.raw_content or '(kein Inhalt)'}"
        )
        return self._call(user_content, _PAPER_SYSTEM_PROMPT, max_tokens=256)

    def _call(self, user_content: str, system_prompt: str, max_tokens: int) -> dict:
        """Call Claude and return parsed JSON. On *any* failure, return
        summary_de=None so the caller leaves the story unprocessed and a future
        run retries it. We never persist a truncated user_content as if it were
        a valid summary — that would mark the story is_processed=True with junk.
        """
        try:
            response = self._client.messages.create(
                model=settings.model_id,
                max_tokens=max_tokens,
                system=[
                    {
                        "type": "text",
                        "text": system_prompt,
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
        except json.JSONDecodeError as exc:
            print(f"[Summarizer] JSON decode failed: {exc} — story stays unprocessed for retry")
            return {"summary_de": None}
        except Exception as exc:
            print(f"[Summarizer] Error: {exc}")
            return {"summary_de": None}
