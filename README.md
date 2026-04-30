# KI-News Dashboard

Tägliche KI-News aus RSS-Feeds und Hacker News — dedupliziert, auf Deutsch zusammengefasst (via Claude API), filterbar nach Themen.

## Features

- **Quellen:** 11 RSS-Feeds (HuggingFace, ArXiv, TechCrunch AI, The Verge, Anthropic Blog, …) + Hacker News
- **Deduplizierung:** URL-basiert + Fuzzy-Titel-Matching
- **Zusammenfassungen:** Claude API, automatisch auf Deutsch
- **Tags:** Neue Modelle · Tools & Produkte · Technik & Infrastruktur · Forschung/Paper · Kosten & Business · Open Source
- **API:** REST-Endpunkte mit Filter, Suche, Sortierung
- **Scheduler:** macOS LaunchAgent, täglich 07:00 Uhr

## Schnellstart

```bash
# 1. API-Key setzen
cp .env.example .env
nano .env   # ANTHROPIC_API_KEY=sk-ant-...

# 2. Backend starten
./start.sh
# → http://localhost:8000/docs

# 3. Ersten Fetch manuell starten
curl -X POST http://localhost:8000/api/fetch

# Oder ohne Zusammenfassung (kein API-Key nötig):
python scripts/fetch_news.py --no-summarize
```

## LaunchAgent einrichten (tägl. 07:00)

```bash
cp scripts/at.worlddirect.kinews.fetch.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/at.worlddirect.kinews.fetch.plist

# Sofort testen:
launchctl start at.worlddirect.kinews.fetch

# Logs:
tail -f ~/Library/Logs/kinews_fetch.log
```

## API Übersicht

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET | `/api/stories` | Stories mit Filtern: `tags`, `sources`, `date_from`, `date_to`, `search`, `sort`, `processed_only`, `limit`, `offset` |
| GET | `/api/stories/{id}` | Einzelne Story inkl. zugeordneter Quellen |
| POST | `/api/fetch` | Manueller Fetch + Cluster + Summarize |
| GET | `/api/tags` | Verfügbare Tags |
| GET | `/api/sources` | Konfigurierte Quellen |
| GET | `/api/stats` | Statistiken (Stories, Artikel, Quellen) |

## Neue Quelle hinzufügen

```python
# backend/config.py
RSS_FEEDS.append({
    "name": "Mein Blog",
    "url": "https://example.com/feed.xml",
    "tag_hint": "Tools & Produkte",
})
```

## Projektstruktur

```
backend/          Python + FastAPI
  fetcher/        Modulare Fetcher (rss, hackernews, reddit kommt)
  summarizer.py   Claude API Integration
  deduplicator.py Deduplizierungs-Logik
scripts/          Cron-Script + LaunchAgent-Plist
data/             SQLite-Datenbank
```

## Roadmap

- [ ] Phase 2: React-Frontend mit Filterpanel und collapsible Cards
- [ ] Reddit-Fetcher
- [ ] Weitere Themen: IT-Security, Marketing-News, Company-Radar
