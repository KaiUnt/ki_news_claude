#!/usr/bin/env python3
"""Reddit scraper test — kein API-Key, kein Account nötig.

Testet öffentliche .json-Endpunkte von Reddit für KI-relevante Subreddits.
Ausgabe: Titel, URL, Score, Kommentare, Alter, Flair.
"""
import time
from datetime import datetime, timezone

import requests
from rich.console import Console
from rich.table import Table
from rich import box

SUBREDDITS = [
    "anthropic",
    "openai",
    "CopilotStudio",
    "AIAgentsinAction",
    "singularity",
]

SORTS = [
    ("hot", {}),
    ("new", {}),
    ("top", {"t": "day"}),
]

LIMIT = 10
HEADERS = {"User-Agent": "ki-news-test/1.0 (by Kai)"}
DELAY = 1.2  # Sekunden zwischen Requests

console = Console()


def fetch_subreddit(sub: str, sort: str, params: dict) -> list[dict]:
    url = f"https://www.reddit.com/r/{sub}/{sort}.json"
    try:
        r = requests.get(
            url,
            params={"limit": LIMIT, **params},
            headers=HEADERS,
            timeout=10,
        )
        if r.status_code == 404:
            return []
        if r.status_code == 403:
            console.print(f"  [yellow]r/{sub} ist privat oder gesperrt (403)[/yellow]")
            return []
        r.raise_for_status()
        children = r.json()["data"]["children"]
        return [c["data"] for c in children]
    except Exception as e:
        console.print(f"  [red]Fehler bei r/{sub}/{sort}: {e}[/red]")
        return []


def age_str(created_utc: float) -> str:
    delta = datetime.now(timezone.utc) - datetime.fromtimestamp(created_utc, tz=timezone.utc)
    h = int(delta.total_seconds() // 3600)
    if h < 1:
        m = int(delta.total_seconds() // 60)
        return f"{m}m"
    if h < 24:
        return f"{h}h"
    return f"{h // 24}d"


def print_results(sub: str, sort: str, posts: list[dict]) -> None:
    label = f"r/{sub}  [{sort.upper()}]"
    if not posts:
        console.print(f"\n[dim]{label} — keine Posts[/dim]")
        return

    table = Table(
        title=label,
        box=box.SIMPLE_HEAD,
        show_lines=False,
        title_style="bold cyan",
    )
    table.add_column("#", style="dim", width=3, justify="right")
    table.add_column("Titel", min_width=40, max_width=70, no_wrap=True)
    table.add_column("Score", justify="right", style="green", width=7)
    table.add_column("Komm.", justify="right", style="blue", width=6)
    table.add_column("Alter", justify="right", style="dim", width=5)
    table.add_column("Flair", style="magenta", width=18, no_wrap=True)

    for i, p in enumerate(posts, 1):
        flair = (p.get("link_flair_text") or "").strip()[:18]
        is_self = p.get("is_self", False)
        title = p["title"]
        url_hint = " [self]" if is_self else ""
        table.add_row(
            str(i),
            title + url_hint,
            str(p.get("score", 0)),
            str(p.get("num_comments", 0)),
            age_str(p.get("created_utc", 0)),
            flair,
        )

    console.print(table)


def main() -> None:
    console.rule("[bold cyan]Reddit Scraper Test[/bold cyan]")
    console.print(f"Subreddits: {', '.join(SUBREDDITS)}")
    console.print(f"Sorts: {', '.join(s for s, _ in SORTS)}")
    console.print(f"Limit: {LIMIT} Posts pro Abfrage\n")

    total_posts = 0
    total_requests = 0
    errors = 0

    for sub in SUBREDDITS:
        console.rule(f"[bold]r/{sub}[/bold]", style="dim")
        for sort, params in SORTS:
            posts = fetch_subreddit(sub, sort, params)
            total_requests += 1
            if posts is not None:
                total_posts += len(posts)
            else:
                errors += 1
            print_results(sub, sort, posts or [])
            time.sleep(DELAY)

    # Zusammenfassung
    console.rule()
    summary = Table(title="Zusammenfassung", box=box.SIMPLE_HEAD)
    summary.add_column("Metrik", style="cyan")
    summary.add_column("Wert", justify="right", style="green")
    summary.add_row("Requests", str(total_requests))
    summary.add_row("Posts gesamt", str(total_posts))
    summary.add_row("Fehler", str(errors))
    console.print(summary)
    console.rule("[bold green]Fertig[/bold green]")


if __name__ == "__main__":
    main()
