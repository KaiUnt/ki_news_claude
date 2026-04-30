# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## kinews — KI-News Dashboard

Modulares Dashboard zur täglichen Aggregation von KI-News mit deutschen Zusammenfassungen via Claude API. Backend (FastAPI + SQLModel + SQLite) liefert geclusterte Stories an ein React/Vite/Tailwind-Frontend.

## Projektstruktur

```
ki_news_claude/
├── backend/
│   ├── app.py            FastAPI REST API (Port 8000), CORS für Frontend (5173/3000)
│   ├── config.py         RSS_FEEDS, AVAILABLE_TAGS, Settings — hier neue Quellen/Tags eintragen
│   ├── db.py             SQLModel: Story + Article, schemamigration via PRAGMA
│   ├── deduplicator.py   URL-basiert + SHA256-Title-Hash + Fuzzy-Title (SequenceMatcher)
│   ├── clusterer.py      Claude-basiertes Story-Clustering (BATCH_SIZE=80)
│   ├── summarizer.py     Claude API auf Story-Ebene, Prompt Caching aktiviert
│   └── fetcher/
│       ├── base.py       RawArticle-Dataclass, BaseFetcher ABC
│       ├── rss.py        feedparser-basiert, konfigurierbar über RSS_FEEDS
│       └── hackernews.py Algolia API, query "AI LLM", letzte 24h
├── frontend/             React 19 + Vite 8 + Tailwind 4 + TypeScript 6
│   └── src/{App.tsx, api.ts, types.ts, components/, hooks/}
├── scripts/
│   ├── fetch_news.py             Standalone-CLI für cron/LaunchAgent
│   ├── migrate_cluster.py        Einmalige Retro-Clustering-Migration
│   └── at.worlddirect.kinews.fetch.plist  macOS LaunchAgent tägl. 07:00
├── data/                 SQLite-DB liegt hier (kinews.db) — wird automatisch angelegt
├── .venv/                Python virtualenv (von start.sh erstellt)
├── start.sh              Backend starten (legt .venv an, pip install, uvicorn --reload)
└── requirements.txt
```

## Setup & häufige Befehle

```bash
# Erststart (anlegen .env, .venv, Abhängigkeiten, Backend starten)
cp .env.example .env          # ANTHROPIC_API_KEY eintragen
./start.sh                    # → http://localhost:8000 (API Docs: /docs)

# Backend manuell (innerhalb .venv)
.venv/bin/uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload

# Manueller Fetch / Pipeline-Trigger
curl -X POST http://localhost:8000/api/fetch                  # via API
python scripts/fetch_news.py                                  # via CLI
python scripts/fetch_news.py --no-summarize                   # ohne Claude-Summaries (kein API-Key nötig)
python scripts/fetch_news.py --no-cluster                     # ohne Claude-Clustering

# Migration (einmalig für Bestandsdaten)
python scripts/migrate_cluster.py --dry-run                   # Vorschau
python scripts/migrate_cluster.py --no-summarize              # nur clustern
python scripts/migrate_cluster.py                             # clustern + summarisieren

# Frontend (in frontend/)
npm install
npm run dev                   # Vite-Dev mit Proxy /api → localhost:8000
npm run build                 # tsc -b && vite build
npm run lint                  # eslint
```

Es gibt **keine Test-Suite** im Repo — verifiziere Änderungen über `python scripts/fetch_news.py --no-summarize` (Pipeline läuft trocken durch) oder `curl http://localhost:8000/api/stats`.

## Datenmodell: Story + Article

```
Story (geclustertes Thema)        Article (Quelle)
──────────────────────────        ────────────────────────
id                                id
title_de                          story_id  → Story.id  (NULL = noch nicht geclustert)
summary_de                        url       (unique)
tags_json                         title
first_seen                        source_name, source_type ("rss"|"hackernews")
last_updated                      published_at, fetched_at
source_count                      raw_content (max 500 Zeichen gespeichert)
is_processed (=summary_de exists) content_hash (SHA256 des normalisierten Titels)
```

- **Story** = dedupliziertes Thema/Ereignis; trägt die deutsche Zusammenfassung + Tags
- **Article** = einzelne Quelle, gehört zu einer Story (1:n)
- Frontend zeigt Stories; Quellen-URLs klappbar pro Story
- Tags werden auf der `Story` als JSON-String in `tags_json` gespeichert, Zugriff via `Story.tags`-Property
- Schemamigration in `db._migrate_schema()` — fügt `story_id` per `ALTER TABLE` hinzu, ohne Daten zu verlieren

## Fetch-Pipeline (3 Phasen, idempotent)

1. **Fetch + Dedup** — RSS + Hacker News laden, gegen `existing_urls` und `existing_hashes` filtern, neue Artikel mit `story_id=NULL` speichern
2. **Clustering** — `clusterer.cluster_articles()` schickt unklustierte Artikel + offene Stories (`get_open_stories(days=3)`) batchweise (80 Artikel) an Claude. Claude weist jedem Artikel eine bestehende `story_id` zu **oder** legt eine neue Story mit `new_story_title` an
3. **Summarize** — `summarizer.summarize_pending_stories()` wählt für jede Story mit `is_processed=False` den Artikel mit dem längsten `raw_content` und generiert `summary_de` + `tags`

Pipeline-Invariante: kein Artikel und keine Story wird je doppelt von Claude verarbeitet:
- `Article.story_id IS NOT NULL` → bereits geclustert
- `Story.is_processed = True` → bereits summarisiert

`migrate_cluster.py` sortiert Bestandsartikel chronologisch und ruft die Phasen 2+3 auf, sodass spätere Batches die schon erzeugten Stories als "offen" sehen.

## Story-Zeitfenster

`get_open_stories(days=3)` — Stories der letzten 3 Tage bleiben als Cluster-Kandidaten offen. Nach 3 Tagen wird ein neuer Artikel zum gleichen Thema zwangsläufig als neue Story angelegt.

## Wichtige Konventionen

- **Modell:** `claude-haiku-4-5-20251001` (Settings.model_id) für Kosteneffizienz
- **Prompt Caching:** System-Prompt in `clusterer._call_claude` und `summarizer._call` trägt `cache_control: {"type": "ephemeral"}` — beim Bearbeiten dieser Prompts beachten, dass Cache-Hits beim Neufassen des System-Prompts brechen
- **Claude-Antwort-Parsing:** Beide Module strippen ` ```json ` Codeblock-Wrapper bevor `json.loads` läuft — ein Fallback fängt JSONDecodeError ab und legt jede Story solo an
- **Dedup-Reihenfolge:** URL-Match → Hash-Match → Fuzzy-Title (Schwelle `DEDUP_TITLE_THRESHOLD`, Default 0.85) — die Fuzzy-Prüfung läuft nur gegen den **aktuellen Batch**, nicht gegen die DB
- **Sessions:** Kurze, isolierte `with Session(engine) as session:`-Blöcke pro DB-Operation; Commits werden bewusst pro Eintrag gemacht, damit ein Fehler nicht den ganzen Batch kippt
- **Zeitzone:** Alle Zeitstempel sind `datetime.utcnow()`-naive UTC

## API Übersicht

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET | `/api/stories` | Stories mit Filtern: `tags`, `sources`, `date_from`, `date_to`, `search`, `sort` (date_desc\|date_asc), `processed_only`, `limit`, `offset` |
| GET | `/api/stories/{id}` | Einzelne Story inkl. zugeordneter Articles |
| POST | `/api/fetch` | Manueller Fetch + optional `cluster` + `summarize` |
| GET | `/api/tags` | `AVAILABLE_TAGS` |
| GET | `/api/sources` | `RSS_FEEDS` + Hacker News |
| GET | `/api/stats` | Zähler über Articles/Stories/unclustered |

## Neue Quelle hinzufügen

1. RSS: `backend/config.py` → Eintrag in `RSS_FEEDS` ergänzen (`name`, `url`, `tag_hint`)
2. Andere API: neue Klasse in `backend/fetcher/` anlegen (erbt von `BaseFetcher`, gibt `list[RawArticle]` zurück), in `backend/fetcher/__init__.py` exportieren und in der `fetchers`-Liste in `app.py` und `scripts/fetch_news.py` ergänzen

## Neue Tag-Kategorie

`backend/config.py` → `AVAILABLE_TAGS` erweitern. Der Summarizer-System-Prompt rendert die Liste via f-String, Claude bekommt die neue Kategorie also automatisch.
