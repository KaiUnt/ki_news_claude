"""
KI-gesteuerter Teams-Post-Generator.

Nimmt eine Liste von Story-IDs, analysiert die Inhalte mit Claude
und clustert sie zu einem strukturierten Bericht mit Themenabschnitten.
"""
import logging
from typing import Optional

import anthropic

from .config import settings
from .claude_retry import call_with_retry
from .db import Story, engine
from sqlmodel import Session, select

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """Du bist Redakteur eines internen KI-News-Newsletters für ein Tech-Unternehmen.

Aufgabe: Analysiere die gegebenen KI-News-Stories und strukturiere sie zu einem lesbaren Teams-Post.

Regeln:
- Erkenne SELBSTSTÄNDIG thematische Zusammenhänge — ignoriere die vorhandenen Tags vollständig
- Bilde 2–5 sinnvolle Themencluster (nie mehr als 5, nie weniger als 2, außer es gibt sehr wenige Stories)
- Pro Cluster: einen prägnanten deutschen Titel + 1–2 Sätze Einleitung, die den Kontext und die Relevanz erklärt
- Sortiere die Stories innerhalb jedes Clusters nach Wichtigkeit (relevanteste zuerst)
- Jede Story kommt in genau einen Cluster — keine Story weglassen, keine doppelt
- Schreibe auf Deutsch, sachlich und klar — kein Marketing-Sprech
- Cluster-Titel: kurz, informativ (z.B. "Neue Sprachmodelle & Releases", "KI in der Praxis", "Regulierung & Policy")
- Einleitungen: direkt einsteigen, Kontext geben, roter Faden zwischen den Stories des Clusters aufzeigen"""


_POST_TOOL = {
    "name": "publish_post",
    "description": "Strukturierter Teams-Post mit thematisch geclusterten KI-News.",
    "input_schema": {
        "type": "object",
        "properties": {
            "clusters": {
                "type": "array",
                "description": "Themencluster des Posts. 2–5 Cluster, jede Story in genau einem Cluster.",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Kurzer, prägnanter Titel des Themenclusters auf Deutsch.",
                        },
                        "intro": {
                            "type": "string",
                            "description": "1–2 Sätze Einleitung, die den Kontext und die Relevanz des Clusters erklärt.",
                        },
                        "story_ids": {
                            "type": "array",
                            "description": "IDs der Stories in diesem Cluster, sortiert nach Relevanz (wichtigste zuerst).",
                            "items": {"type": "integer"},
                        },
                    },
                    "required": ["title", "intro", "story_ids"],
                },
            },
        },
        "required": ["clusters"],
    },
}


def generate_post(story_ids: list[int]) -> dict:
    """Generiert einen strukturierten Teams-Post aus den gegebenen Story-IDs.

    Returns:
        {"clusters": [{"title": str, "intro": str, "story_ids": [int]}]}
    """
    with Session(engine) as session:
        stories = session.exec(
            select(Story).where(Story.id.in_(story_ids))  # type: ignore[attr-defined]
        ).all()

    if not stories:
        raise ValueError("Keine Stories gefunden für die gegebenen IDs.")

    # Build story list for the prompt
    story_lines: list[str] = []
    for s in stories:
        title = s.primary_title or s.title_de or "(kein Titel)"
        summary = s.summary_de or "(keine Zusammenfassung)"
        story_lines.append(f"ID {s.id}: {title}\nZusammenfassung: {summary}")

    stories_text = "\n\n".join(story_lines)
    user_message = f"Hier sind {len(stories)} KI-News-Stories:\n\n{stories_text}\n\nBitte analysiere und clustere diese Stories thematisch."

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    def _call():
        return client.messages.create(
            model=settings.model_id,
            max_tokens=2048,
            system=_SYSTEM_PROMPT,
            tools=[_POST_TOOL],
            tool_choice={"type": "tool", "name": "publish_post"},
            messages=[{"role": "user", "content": user_message}],
        )

    response = call_with_retry(_call)

    # Extract tool result
    for block in response.content:
        if block.type == "tool_use" and block.name == "publish_post":
            result = block.input
            # Validate that all story_ids are present in exactly one cluster
            clustered_ids: set[int] = set()
            for cluster in result.get("clusters", []):
                for sid in cluster.get("story_ids", []):
                    clustered_ids.add(sid)

            # Add any missed stories to a catch-all cluster
            missed = [sid for sid in story_ids if sid not in clustered_ids]
            if missed:
                logger.warning("[post_generator] %d Stories nicht geclustert, füge Sammelcluster hinzu", len(missed))
                result["clusters"].append({
                    "title": "Weitere Meldungen",
                    "intro": "Weitere relevante Meldungen aus der KI-Welt.",
                    "story_ids": missed,
                })

            return result

    raise RuntimeError("Claude hat kein gültiges Tool-Ergebnis zurückgegeben.")
