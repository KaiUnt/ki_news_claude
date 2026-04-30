# kinews — KI-News Dashboard

Modulares Dashboard zur täglichen Aggregation von KI-News mit deutschen Zusammenfassungen.

## Projektstruktur

```
kinewsclaude/
├── backend/
│   ├── app.py            FastAPI REST API (Port 8000)
│   ├── config.py         RSS-Feeds, Tags, Settings — hier neue Quellen/Tags eintragen
│   ├── db.py             SQLite-Modell via SQLModel (Article)
│   ├── deduplicator.py   URL-basiert + Fuzzy-Titel-Dedup (SequenceMatcher)
│   ├── summarizer.py     Claude API (Haiku), Prompt Caching aktiviert
│   └── fetcher/
│       ├── base.py       RawArticle-Dataclass, BaseFetcher ABC
│       ├── rss.py        feedparser-basiert, konfigurierbar über RSS_FEEDS
│       └── hackernews.py Algolia API, query "AI LLM", letzte 24h
├── scripts/
│   ├── fetch_news.py     Standalone-CLI (cron/LaunchAgent)
│   └── at.worlddirect.kinews.fetch.plist  LaunchAgent tägl. 07:00
├── data/                 SQLite-DB liegt hier (kinews.db)
├── .venv/                Python virtualenv
├── start.sh              Backend starten
└── requirements.txt
```

## Setup

```bash
cp .env.example .env
# ANTHROPIC_API_KEY in .env eintragen

./start.sh   # startet Backend auf http://localhost:8000
```

## Neue Quelle hinzufügen

1. `backend/config.py` → `RSS_FEEDS` Liste erweitern, oder
2. Neue Klasse in `backend/fetcher/` anlegen (erbt von `BaseFetcher`)
3. In `scripts/fetch_news.py` und `backend/app.py` in die `fetchers`-Liste eintragen

## Neue Themen-Kategorie

`backend/config.py` → `AVAILABLE_TAGS` Liste erweitern. Claude bekommt die aktuelle Liste automatisch im System-Prompt.

## Geplante Erweiterungen

- `backend/fetcher/reddit.py` — Reddit via PRAW oder Pushshift
- IT-Security, Marketing, Company-News als eigene Tag-Gruppen
- React-Frontend (Phase 2)

## Wichtige Konventionen

- Tags werden immer als JSON-String in `Article.tags_json` gespeichert, Zugriff via `article.tags` (Property)
- Deduplizierung läuft in-memory vor dem DB-Insert — `content_hash` basiert auf normalisiertem Titel
- Claude-Summarizer nutzt `cache_control: ephemeral` auf dem System-Prompt (Prompt Caching)
- Modell: `claude-haiku-4-5-20251001` für Kosteneffizienz

## Datenmodell: Story + Article

```
Story              Article (Quelle)
─────────────      ────────────────────────
id                 id
title_de           story_id → Story.id
summary_de         url (unique)
tags_json          title
first_seen         source_name
last_updated       source_type
source_count       published_at
is_processed       raw_content
```

- **Story** = dedupliziertes Thema/Ereignis — hat eine deutsche Zusammenfassung + Tags
- **Article** = einzelner Artikel einer Quelle — gehört zu einer Story
- Dashboard zeigt Stories; Quellen-URLs klappbar pro Story

## Fetch-Pipeline (3-Phasen)

1. **Fetch + Dedup** → nur neue URLs/Hashes kommen durch, gespeichert mit `story_id=null`
2. **Clustering** → Claude bekommt alle unklustierten Artikel + offene Stories (3 Tage), weist `story_id` zu
3. **Summarize** → für jede Story mit `is_processed=False` generiert Claude eine Zusammenfassung (Story-Ebene, nicht Artikel-Ebene)

Kein Artikel / keine Story wird je doppelt von Claude verarbeitet:
- `Article.story_id IS NOT NULL` → geclustert, nie wieder angefasst
- `Story.is_processed = True` → summarisiert, nie wieder angefasst

## Story-Zeitfenster

`get_open_stories(days=3)` — Stories der letzten 3 Tage bleiben offen für neue Quellen.
Nach 3 Tagen wird ein neuer Artikel zum gleichen Thema als neue Story angelegt.

## Migration bestehender Artikel

```bash
python scripts/migrate_cluster.py --dry-run   # Vorschau
python scripts/migrate_cluster.py --no-summarize  # nur clustern
python scripts/migrate_cluster.py             # clustern + summarisieren
```
