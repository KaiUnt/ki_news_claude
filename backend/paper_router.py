"""
Deterministic paper handling — bypasses the Claude clusterer and summarizer.

Papers (arXiv-style feeds) are ~2/3 of daily article volume but never enter the
digest (digest_generator filters them out) — they only populate the dashboard
Paper-Stream lane. Routing them through Claude clustering (each paper becomes its
own story anyway) and Claude summarization (one call per story) was the majority
of total API spend for zero digest value.

Instead each paper article becomes its own solo Story whose "summary" is the raw
abstract excerpt (already capped at 500 chars at fetch time; English as-is) and
it's marked is_processed=True so the summarizer leaves it alone. Curated papers
(HuggingFace Daily Papers) get a flag:kuratiert tag to set them apart from the
raw arXiv firehose. Cross-feed duplicates of the same paper are already removed
in the dedup phase (URL + title hash), so one story per article is correct.
"""
from datetime import datetime

from sqlmodel import Session

from .db import Article, Story, engine
from .source_catalog import get_source_metadata, CURATED_PAPER_SOURCES

CURATED_FLAG = "flag:kuratiert"


def is_paper_article(article: Article) -> bool:
    """True if the article comes from a paper feed (arXiv / HuggingFace papers)."""
    return get_source_metadata(article.source_name)["story_kind"] == "paper"


def route_papers(paper_articles: list[Article]) -> int:
    """Create one pre-summarized solo Story per paper article.

    Returns the number of paper stories created. Each article's story_id is set,
    summary_de is the raw abstract excerpt, and is_processed=True so the
    summarizer skips it. Commits per article so one failure can't drop the batch.
    """
    created = 0
    for art in paper_articles:
        tags = [CURATED_FLAG] if art.source_name in CURATED_PAPER_SOURCES else []
        with Session(engine) as session:
            try:
                story = Story(
                    title_de=art.title,
                    summary_de=art.raw_content or "(kein Abstract)",
                    first_seen=datetime.utcnow(),
                    last_updated=datetime.utcnow(),
                    source_count=1,
                    is_processed=True,
                )
                story.tags = tags
                session.add(story)
                session.commit()
                session.refresh(story)

                db_art = session.get(Article, art.id)
                if db_art is not None:
                    db_art.story_id = story.id
                    session.add(db_art)
                    session.commit()
                created += 1
            except Exception:
                session.rollback()
    return created
