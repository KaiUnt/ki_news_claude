#!/usr/bin/env python3
"""
Einmalige Migration: Clustert alle 749 bestehenden Artikel in Stories.

Strategie:
- Sortiere alle Artikel nach published_at
- Verarbeite in Batches von je 80 Artikeln (chronologisch)
- Jeder Batch sieht die bereits erzeugten Stories als "offene Stories"
- ArXiv-Paper werden normalerweise als Solo-Stories behandelt (Claude entscheidet)

Flags:
  --no-summarize   Nur clustern, keine Story-Summaries generieren
  --dry-run        Zeigt was geclustert würde, ändert nichts in der DB
"""
import sys
import os
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, MofNCompleteColumn
from sqlmodel import Session, select

from backend.db import create_db_and_tables, engine, get_unclustered_articles, Article, Story
from backend.clusterer import cluster_articles, BATCH_SIZE
from backend.summarizer import Summarizer

console = Console()


def main(summarize: bool = True, dry_run: bool = False) -> None:
    console.rule("[bold magenta]Migrations-Clustering[/bold magenta]")
    create_db_and_tables()

    with Session(engine) as session:
        unclustered = get_unclustered_articles(session)

    if not unclustered:
        console.print("[green]Alle Artikel sind bereits geclustert.[/green]")
        return

    # Sort chronologically so stories are built up in temporal order
    unclustered.sort(key=lambda a: a.published_at or a.fetched_at)

    console.print(f"Zu clusternde Artikel: [bold]{len(unclustered)}[/bold]")
    console.print(f"Batch-Größe: {BATCH_SIZE} | Batches: {-(-len(unclustered) // BATCH_SIZE)}")

    if dry_run:
        console.print("[yellow]DRY RUN — keine DB-Änderungen[/yellow]")
        console.print("Beispiel-Artikel (erste 10):")
        for a in unclustered[:10]:
            console.print(f"  [{a.source_name}] {a.title[:70]}")
        return

    # Cluster in batches
    total_assignments: dict[int, int] = {}
    batches = [unclustered[i: i + BATCH_SIZE] for i in range(0, len(unclustered), BATCH_SIZE)]

    with Progress(
        SpinnerColumn(),
        TextColumn("{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Clustering...", total=len(batches))
        for idx, batch in enumerate(batches):
            assignments = cluster_articles(batch)
            total_assignments.update(assignments)

            # Write assignments immediately so next batch sees new stories
            with Session(engine) as session:
                for article_id, story_id in assignments.items():
                    art = session.get(Article, article_id)
                    if art:
                        art.story_id = story_id
                        session.add(art)
                session.commit()

            progress.advance(task)
            progress.update(task, description=f"[green]Batch {idx+1}/{len(batches)} geclustert[/green]")

    # Summarize all new stories
    summarized = 0
    if summarize:
        with Session(engine) as session:
            pending_count = len(session.exec(select(Story).where(Story.is_processed == False)).all())

        console.print(f"\n[cyan]Story-Summaries generieren: {pending_count} Stories...[/cyan]")
        summarizer = Summarizer()
        with Progress(SpinnerColumn(), TextColumn("{task.description}"),
                      BarColumn(), MofNCompleteColumn(), console=console) as progress:
            task = progress.add_task("Summaries...", total=pending_count)
            summarized = summarizer.summarize_pending_stories()
            progress.update(task, completed=summarized)

    # Report
    with Session(engine) as session:
        total_stories = len(session.exec(select(Story)).all())
        remaining_unclustered = len(get_unclustered_articles(session))

    table = Table(title="Migrations-Ergebnis", show_header=True)
    table.add_column("Metrik", style="cyan")
    table.add_column("Wert", justify="right", style="green")
    table.add_row("Artikel geclustert", str(len(total_assignments)))
    table.add_row("Stories erstellt/aktualisiert", str(total_stories))
    table.add_row("Stories summarisiert", str(summarized) if summarize else "–")
    table.add_row("Noch unklustered", str(remaining_unclustered))
    console.print(table)
    console.rule("[bold green]Migration abgeschlossen[/bold green]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Retroactive clustering migration")
    parser.add_argument("--no-summarize", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    main(summarize=not args.no_summarize, dry_run=args.dry_run)
