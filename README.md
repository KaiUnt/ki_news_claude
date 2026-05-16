# KI-News Dashboard

Persönliches Dashboard für tägliche KI-News aus RSS-Feeds und Hacker News — dedupliziert, geclustert, auf Deutsch zusammengefasst (via Claude API), kuratiert nach eigener Prioritäts-Vorgabe.

## Features

- **Quellen:** 23 RSS-Feeds (OpenAI, Anthropic, DeepMind, Google AI, NVIDIA, Microsoft Research/AI, HuggingFace, ArXiv cs.AI/cs.LG/cs.CL, TechCrunch AI, The Decoder, Heise KI, EU AI Act, …) + Hacker News
- **Pipeline:** Fetch → Dedup → Clustering (Claude) → Summary (Claude) → Tages-Digest (Claude)
- **Story-Clustering:** mehrere Artikel über dasselbe Ereignis werden zu einer Story zusammengefasst
- **Tages-Digest:** Claude wählt 5–7 Top-Stories und schreibt eine 2–3-Absätze-Tageszusammenfassung — abgestimmt auf einen frei editierbaren Prioritäts-Prompt
- **Frontend:** React 19 + Tailwind 4, drei Views (Dashboard / Alle Stories / Settings), Tab-Wahl persistent
- **Kategorisierung (3 Achsen):** Typ (release · forschung · tool · infrastruktur · business · policy · demo), Domain (llm-core · coding · agenten · bild-video · audio · robotik · vertikal · sonstige), Flags (open-source · frontier · big-lab). ArXiv-Papers werden quellen-basiert als `story_kind=paper` separiert und überspringen das Content-Tagging.

## Stack

| Schicht | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, SQLModel, SQLite |
| LLM | `claude-haiku-4-5-20251001` (Clustering, Summaries, Digest) |
| Frontend | React 19, Vite 8, Tailwind 4, TypeScript 6 |
| Scheduler | systemd-Timer (Linux) bzw. LaunchAgent (macOS) |

## Schnellstart

```bash
# 1. API-Key setzen
cp .env.example .env
# ANTHROPIC_API_KEY in .env eintragen

# 2. Backend starten (legt .venv an, installiert Deps, startet uvicorn)
./start.sh
# → http://localhost:8000/docs

# 3. Frontend (separates Terminal)
cd frontend
npm install
npm run dev
# → http://localhost:5173 (Vite-Proxy /api → :8000)

# 4. Ersten Fetch starten
curl -X POST http://localhost:8000/api/fetch
# Oder ohne Claude (Pipeline trocken):
python scripts/fetch_news.py --no-summarize --no-digest
```

## CLI

```bash
python scripts/fetch_news.py                 # voller Lauf
python scripts/fetch_news.py --no-summarize  # ohne Summaries
python scripts/fetch_news.py --no-cluster    # ohne Clustering
python scripts/fetch_news.py --no-digest     # ohne Tages-Digest
python scripts/migrate_cluster.py --dry-run  # Bestandsdaten retro-clustern
```

## Scheduler

**Linux (systemd):** units in `scripts/server/` — einmalig nach `/etc/systemd/system/` kopieren, `systemctl enable --now kinews-fetch.timer`. Default ist täglich 07:30 lokale Zeit.

**macOS (LaunchAgent):** `cp scripts/at.worlddirect.kinews.fetch.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/at.worlddirect.kinews.fetch.plist`. Default 07:00.

## API

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET | `/api/stories` | Stories mit Filtern: `tags`, `sources`, `date_from`, `date_to`, `search`, `sort`, `processed_only`, `limit`, `offset` |
| GET | `/api/stories/{id}` | Einzelne Story inkl. Quellen |
| POST | `/api/fetch` | Pipeline triggern: `?cluster=true&summarize=true&digest=true` |
| GET | `/api/tags` | Tag-Schema: `{ types, domains, flags }` |
| GET | `/api/sources` | Konfigurierte Quellen |
| GET | `/api/stats` | Zähler: Articles, Stories, processed, unclustered |
| GET | `/api/profile` | User-Profil (Single-Row, multi-user-ready) |
| PUT | `/api/profile` | `name` und/oder `priority_prompt` updaten |
| GET | `/api/digest/latest` | Aktuellster Digest mit hydratisierten Top-Stories |
| GET | `/api/digest` | Digest-Verlauf (Liste der Summaries) |
| POST | `/api/digest/regenerate` | Manueller Re-Generate (gleiches Window, neu kuratiert) |

## Datenmodell

```
Story (Cluster)            Article (Quelle)         DailyDigest         UserProfile
──────────────             ───────────────          ──────────          ────────────
id                         id                       id                  id (=1)
title_de                   url (unique)             user_profile_id     name
summary_de                 title                    generated_at        priority_prompt
tags_json                  source_name              window_start..end   updated_at
source_count               story_id → Story.id      meta_summary_de
is_processed                                        top_story_ids_json
```

## Neue Quelle hinzufügen

```python
# backend/config.py
RSS_FEEDS.append({
    "name": "Mein Blog",
    "url": "https://example.com/feed.xml",
})
# Bei Bedarf in backend/source_catalog.py Metadaten ergänzen
# (section, story_kind, category, is_primary_source).
```

## Projektstruktur

```
backend/
  app.py              FastAPI REST API
  config.py           Settings, RSS_FEEDS, STORY_TYPES/DOMAINS/FLAGS, normalize_tags
  db.py               SQLModel-Schema + Migration
  fetcher/            RSS + Hacker News
  deduplicator.py     URL + Hash + Fuzzy-Title
  clusterer.py        Claude-basiertes Story-Clustering
  summarizer.py       Claude-basierte Story-Summaries
  digest_generator.py Claude-basierter Tages-Digest
frontend/src/
  App.tsx             View-Routing (Dashboard / Alle / Settings)
  hooks/              useStories, useDigest, usePersistedView, …
  components/         Dashboard, TopStoryCard, StoryCard, FilterBar, …
scripts/
  fetch_news.py       Pipeline-CLI
  migrate_cluster.py  Retro-Clustering für Bestandsdaten
  server/             systemd-Units + nginx-Config
data/                 SQLite-DB (gitignored)
```

## Lizenz

MIT. Persönliches Projekt — Issues und PRs willkommen, aber keine SLA.
