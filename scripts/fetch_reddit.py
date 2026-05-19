#!/usr/bin/env python3
"""Reddit fetch script — fetches posts from KI subreddits and stores them in the DB."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select

from backend.db import create_db_and_tables, engine, RedditPost
from backend.fetcher.reddit import RedditFetcher

from rich.console import Console
from rich.table import Table

console = Console()


def main() -> None:
    console.rule("[bold cyan]Reddit Fetch[/bold cyan]")
    create_db_and_tables()

    fetcher = RedditFetcher()
    console.print("Fetching Reddit posts…")
    posts = fetcher.fetch()
    console.print(f"Gefetcht: [bold]{len(posts)}[/bold] Posts")

    new_saved = 0
    with Session(engine) as session:
        existing = set(session.exec(select(RedditPost.reddit_id)).all())
        for post in posts:
            if post.reddit_id not in existing:
                session.add(post)
                existing.add(post.reddit_id)
                new_saved += 1
        session.commit()

    table = Table(title="Ergebnis", show_header=True)
    table.add_column("Metrik", style="cyan")
    table.add_column("Wert", justify="right", style="green")
    table.add_row("Gefetcht", str(len(posts)))
    table.add_row("Neu gespeichert", str(new_saved))
    table.add_row("Duplikate übersprungen", str(len(posts) - new_saved))
    console.print(table)
    console.rule("[bold green]Fertig[/bold green]")


if __name__ == "__main__":
    main()
