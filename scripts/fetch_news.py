#!/usr/bin/env python3
"""Daily news fetch script — run via cron or macOS LaunchAgent.

Pipeline:
  1. Fetch raw articles from all sources
  2. Deduplicate gegen bestehende DB (URL + Hash)
  3. Neue Artikel speichern (story_id=null)
  4. Claude clustert alle unklustierten Artikel → Story-Zuordnung
  5. Claude generiert Summaries für alle neuen/unverarbeiteten Stories
  6. Claude generiert den Tages-Digest (Top-Stories + Meta-Summary)
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, MofNCompleteColumn
from sqlmodel import Session

from backend.db import (
    create_db_and_tables, engine,
    get_existing_urls, get_existing_hashes,
    get_unclustered_articles, Article,
)
from backend.fetcher import RSSFetcher, HackerNewsFetcher, RawArticle
from backend.deduplicator import deduplicate, content_hash
from backend.clusterer import cluster_articles
from backend.summarizer import Summarizer
from backend import digest_generator

console = Console()


def _save_articles(new_articles: list[RawArticle]) -> int:
    saved = 0
    for raw_art in new_articles:
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
    return saved


def main(cluster: bool = True, summarize: bool = True, digest: bool = True) -> None:
    console.rule("[bold cyan]KI-News Fetch[/bold cyan]")
    create_db_and_tables()

    # ── Phase 1: Fetch ────────────────────────────────────────────────────────
    fetchers = [RSSFetcher(), HackerNewsFetcher()]
    raw: list[RawArticle] = []
    with Progress(SpinnerColumn(), TextColumn("{task.description}"), console=console) as progress:
        for fetcher in fetchers:
            name = type(fetcher).__name__
            task = progress.add_task(f"Fetching {name}...", total=None)
            articles = fetcher.fetch()
            raw.extend(articles)
            progress.update(task, description=f"[green]{name}: {len(articles)} Artikel[/green]")

    console.print(f"\n[bold]Gefetcht:[/bold] {len(raw)} Artikel")

    # ── Phase 2: Deduplicate ──────────────────────────────────────────────────
    with Session(engine) as session:
        existing_urls = get_existing_urls(session)
        existing_hashes = get_existing_hashes(session)

    new_articles = deduplicate(raw, existing_urls, existing_hashes)
    console.print(f"[bold]Neu (nach Dedup):[/bold] {len(new_articles)} Artikel")

    # ── Phase 3: Speichern ────────────────────────────────────────────────────
    saved = _save_articles(new_articles)

    # ── Phase 4: Clustering ───────────────────────────────────────────────────
    clustered = 0
    if cluster:
        with Session(engine) as session:
            unclustered = get_unclustered_articles(session)

        if unclustered:
            console.print(f"\n[cyan]Unklustered: {len(unclustered)} Artikel → Claude clustert...[/cyan]")
            with Progress(SpinnerColumn(), TextColumn("{task.description}"), console=console) as progress:
                task = progress.add_task("Clustering...", total=None)
                assignments = cluster_articles(unclustered)
                clustered = len(assignments)
                progress.update(task, description=f"[green]{clustered} Artikel geclustert[/green]")

            # Write story_id assignments back to articles
            with Session(engine) as session:
                for article_id, story_id in assignments.items():
                    article = session.get(Article, article_id)
                    if article:
                        article.story_id = story_id
                        session.add(article)
                session.commit()
        else:
            console.print("[yellow]Keine unklusterten Artikel.[/yellow]")
    else:
        console.print("[yellow]Clustering übersprungen.[/yellow]")

    # ── Phase 5: Story-Summaries ──────────────────────────────────────────────
    summarized = 0
    if summarize and cluster:
        console.print(f"\n[cyan]Story-Summaries via Claude API...[/cyan]")
        summarizer = Summarizer()
        with Progress(SpinnerColumn(), TextColumn("{task.description}"),
                      BarColumn(), MofNCompleteColumn(), console=console) as progress:
            # Count pending stories first
            from sqlmodel import select as sqlselect
            from backend.db import Story
            with Session(engine) as session:
                pending_count = len(session.exec(sqlselect(Story).where(Story.is_processed == False)).all())

            if pending_count > 0:
                task = progress.add_task("Summaries...", total=pending_count)
                summarized = summarizer.summarize_pending_stories()
                progress.update(task, completed=summarized,
                                description=f"[green]{summarized} Stories summarisiert[/green]")
    elif not summarize:
        console.print("[yellow]Zusammenfassung übersprungen (--no-summarize).[/yellow]")

    # ── Phase 6: Tages-Digest ─────────────────────────────────────────────────
    digest_status = "–"
    if digest and cluster and summarize:
        console.print(f"\n[cyan]Tages-Digest via Claude API...[/cyan]")
        with Progress(SpinnerColumn(), TextColumn("{task.description}"), console=console) as progress:
            task = progress.add_task("Digest...", total=None)
            try:
                generated = digest_generator.generate()
                if generated is None:
                    digest_status = "übersprungen (kein Material)"
                    progress.update(task, description="[yellow]Keine Stories im Fenster[/yellow]")
                else:
                    digest_status = f"id={generated.id} ({len(generated.top_stories)} Top-Stories)"
                    progress.update(task, description=f"[green]Digest {digest_status}[/green]")
            except Exception as exc:
                digest_status = f"Fehler: {exc}"
                progress.update(task, description=f"[red]Digest fehlgeschlagen: {exc}[/red]")
    elif not digest:
        console.print("[yellow]Digest übersprungen (--no-digest).[/yellow]")

    # ── Report ────────────────────────────────────────────────────────────────
    table = Table(title="Ergebnis", show_header=True)
    table.add_column("Metrik", style="cyan")
    table.add_column("Wert", justify="right", style="green")
    table.add_row("Gefetcht", str(len(raw)))
    table.add_row("Neu gespeichert", str(saved))
    table.add_row("Geclustert", str(clustered) if cluster else "–")
    table.add_row("Stories summarisiert", str(summarized) if summarize else "–")
    table.add_row("Digest", digest_status if digest else "–")
    console.print(table)
    console.rule("[bold green]Fertig[/bold green]")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="KI-News Fetch Script")
    parser.add_argument("--no-cluster", action="store_true", help="Skip Claude clustering")
    parser.add_argument("--no-summarize", action="store_true", help="Skip Claude summarization")
    parser.add_argument("--no-digest", action="store_true", help="Skip daily digest generation")
    args = parser.parse_args()
    main(
        cluster=not args.no_cluster,
        summarize=not args.no_summarize,
        digest=not args.no_digest,
    )
