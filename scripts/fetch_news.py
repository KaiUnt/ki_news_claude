#!/usr/bin/env python3
"""Daily news fetch script — run via systemd timer (oder macOS LaunchAgent).

Dünner Wrapper um `backend.pipeline.run_pipeline` — die einzige Pipeline-Wahrheit,
geteilt mit `POST /api/fetch` (app.py). Dieses Script rendert nur die
Rich-Console-Ausgabe für den Daily-Lauf; die gesamte Logik (Fetch → Dedup →
Speichern → Cluster → Merge → Summarize → Digest, inkl. DB-Quellen, Newsletter
und per-Kategorie-Digests) lebt in backend/pipeline.py.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rich.console import Console
from rich.table import Table

from backend.db import create_db_and_tables
from backend import pipeline

console = Console()


def main(cluster: bool = True, summarize: bool = True, digest: bool = True) -> None:
    console.rule("[bold cyan]KI-News Fetch[/bold cyan]")
    create_db_and_tables()

    result = pipeline.run_pipeline(
        cluster=cluster,
        summarize=summarize,
        digest=digest,
        on_event=lambda msg: console.print(f"[dim]·[/dim] {msg}"),
    )

    # ── Report ────────────────────────────────────────────────────────────────
    if not digest:
        digest_cell = "–"
        cat_cell = "–"
    else:
        digest_cell = f"id={result['digest_id']}" if result["digest_id"] is not None else "übersprungen"
        cat_ids = result["category_digest_ids"]
        cat_cell = ", ".join(f"id={i}" for i in cat_ids) if cat_ids else "keine erzeugt"

    table = Table(title="Ergebnis", show_header=True)
    table.add_column("Metrik", style="cyan")
    table.add_column("Wert", justify="right", style="green")
    table.add_row("Gefetcht", str(result["fetched"]))
    table.add_row("Neu gespeichert", str(result["new_saved"]))
    table.add_row("Geclustert", str(result["clustered"]) if cluster else "–")
    table.add_row("Duplikate gemergt", str(result["stories_merged"]) if cluster else "–")
    table.add_row("Stories summarisiert", str(result["stories_summarized"]) if summarize else "–")
    table.add_row("Digest", digest_cell)
    table.add_row("Kategorie-Digests", cat_cell)
    console.print(table)
    console.rule("[bold green]Fertig[/bold green]")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="KI-News Fetch Script")
    parser.add_argument("--no-cluster", action="store_true", help="Skip clustering")
    parser.add_argument("--no-summarize", action="store_true", help="Skip Claude summaries")
    parser.add_argument("--no-digest", action="store_true", help="Skip daily digest generation")
    args = parser.parse_args()
    main(
        cluster=not args.no_cluster,
        summarize=not args.no_summarize,
        digest=not args.no_digest,
    )
