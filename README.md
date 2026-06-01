# KI-News Dashboard

Persönliches Dashboard für tägliche KI-News aus RSS-Feeds, Hacker News und Reddit — dedupliziert, geclustert, auf Deutsch zusammengefasst (via Claude API), kuratiert nach eigener Prioritäts-Vorgabe.

## Features

- **Quellen:** 30 RSS-Feeds (OpenAI, Anthropic, DeepMind, Google AI/Gemini/Research, NVIDIA, Microsoft Research/AI, AWS ML, HuggingFace, ArXiv cs.AI/cs.LG/cs.CL, TechCrunch AI, VentureBeat AI, MIT Tech Review, Wired AI, The Decoder, Heise KI, Golem KI, t3n KI, EU AI Act, Simon Willison, Interconnects, Latent Space, Ahead of AI) + Hacker News + Reddit
- **Pipeline:** Fetch → Dedup → Clustering (Claude) → Summary (Claude) → Tages-Digest (Claude)
- **Story-Clustering:** mehrere Artikel über dasselbe Ereignis werden zu einer Story zusammengefasst
- **Tages-Digest:** Claude wählt 5–7 Top-Stories und schreibt eine 2–3-Absätze-Tageszusammenfassung — abgestimmt auf einen frei editierbaren Prioritäts-Prompt
- **Reddit-Bereich:** Posts aus 5 KI-Subreddits, getrennt vom Digest, mit Sentiment-Berechnung via Upvote-Ratio
- **Frontend:** React 19 + Tailwind 4, fünf Views (Dashboard / Alle Stories / Favoriten / Reddit / Settings), Tab-Wahl persistent
- **Kategorisierung (3 Achsen):** Typ (release · forschung · tool · infrastruktur · business · policy · demo), Domain (llm-core · coding · agenten · bild-video · audio · robotik · vertikal · sonstige), Flags (open-source · frontier · big-lab). ArXiv-Papers werden quellen-basiert als `story_kind=paper` separiert und überspringen das Content-Tagging.

## Stack

| Schicht | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, SQLModel, SQLite |
| LLM | `claude-haiku-4-5-20251001` (Clustering, Summaries, Digest) |
| Frontend | React 19, Vite 8, Tailwind 4, TypeScript 6 |
| Scheduler | systemd-Timer (Linux, News-Fetch) · LaunchAgent macOS (News + Reddit) |

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
python scripts/fetch_news.py                 # voller Lauf (Fetch → Cluster → Summary → Digest)
python scripts/fetch_news.py --no-summarize  # ohne Summaries
python scripts/fetch_news.py --no-cluster    # ohne Clustering
python scripts/fetch_news.py --no-digest     # ohne Tages-Digest
python scripts/migrate_cluster.py --dry-run  # Bestandsdaten retro-clustern

python scripts/reddit_github_fetch.py        # Reddit fetchen + zu Server pushen (Mac → Server)
python scripts/reddit_test.py                # Reddit-Endpunkte testen (kein DB-Schreibzugriff)
```

## Scheduler

**Linux (systemd, News-Fetch):** units in `scripts/server/` — einmalig nach `/etc/systemd/system/` kopieren, `systemctl enable --now kinews-fetch.timer`. Default ist täglich 07:30 lokale Zeit.

**macOS (LaunchAgent, News-Fetch):**
```bash
cp scripts/at.worlddirect.kinews.fetch.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/at.worlddirect.kinews.fetch.plist
```
Default 07:00. Falls Mac beim Trigger-Zeitpunkt aus ist, läuft der Job beim nächsten Aufwachen.

**macOS (LaunchAgent, Reddit-Fetch):**
```bash
cp scripts/at.worlddirect.kinews.reddit.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/at.worlddirect.kinews.reddit.plist
```
Default 07:45 (nach dem News-Fetch). Fetcht Reddit von der Mac-Heim-IP (Datacenter-IPs werden von Reddit geblockt) und pusht via `POST /api/reddit/import` zum Server.

Benötigte `.env`-Einträge für den Reddit-LaunchAgent:
```
BACKEND_URL=https://kinews.kais.world
REDDIT_IMPORT_SECRET=<secret>
KINEWS_BASIC_USER=<nginx-user>
KINEWS_BASIC_PASS=<nginx-pass>
```

## API

### News

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

### Reddit

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET | `/api/reddit/posts` | Posts mit Filtern: `subreddit`, `sort` (score/date/ratio/comments), `limit`, `offset` |
| GET | `/api/reddit/stats` | Statistik pro Subreddit: count, avg_score, avg_ratio |
| POST | `/api/reddit/import` | Bulk-Import von Posts (Bearer via `X-Import-Secret`-Header) |

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

RedditPost (getrennt vom News-Pipeline)
───────────────────────────────────────
id, reddit_id (unique), subreddit, title
permalink, external_url, is_self
score, upvote_ratio, num_comments, flair
sentiment  (sehr positiv / positiv / gemischt / kontrovers)
created_utc, fetched_at
```

## Reddit — Architektur-Entscheidungen

- **Getrennt vom News-Digest:** eigene Tabelle, kein Clustering/Summarizing via Claude
- **Kein API-Key nötig:** öffentliche `.json`-Endpunkte von Reddit (ohne Auth)
- **Fetch vom Mac:** Reddit blockiert Datacenter-IPs (Server + GitHub Actions). Mac läuft über Heim-IP
- **Sentiment via Signals:** Upvote-Ratio ≥ 0.90 → sehr positiv, ≥ 0.75 → positiv, ≥ 0.60 → gemischt, < 0.60 → kontrovers
- **Subreddits:** anthropic, openai, CopilotStudio, AIAgentsinAction, singularity

## Neue Quelle hinzufügen

```python
# backend/config.py
RSS_FEEDS.append({
    "name": "Mein Blog",
    "url": "https://example.com/feed.xml",
})
# Für reine Paper-Feeds (arXiv-Style) zusätzlich den Namen in
# backend/source_catalog.py:_PAPER_SOURCES eintragen — dann landen die Stories
# im Paper-Stream und überspringen das Content-Tagging.
```

## Projektstruktur

```
backend/
  app.py              FastAPI REST API (News + Reddit)
  config.py           Settings, RSS_FEEDS, STORY_TYPES/DOMAINS/FLAGS
  db.py               SQLModel-Schema (Story, Article, RedditPost, …)
  fetcher/            RSS + Hacker News + Reddit
  deduplicator.py     URL + Hash + Fuzzy-Title
  clusterer.py        Claude-basiertes Story-Clustering
  summarizer.py       Claude-basierte Story-Summaries
  digest_generator.py Claude-basierter Tages-Digest
frontend/src/
  App.tsx             View-Routing (Dashboard / Alle / Favoriten / Reddit / Settings)
  hooks/              useStories, useDigest, usePersistedView, …
  components/         Dashboard, TopStoryCard, StoryCard, FilterBar, Reddit, …
scripts/
  fetch_news.py                     News-Pipeline-CLI
  fetch_reddit.py                   Reddit-Fetch lokal (in lokale DB)
  reddit_github_fetch.py            Reddit-Fetch + Push zu Server (LaunchAgent)
  reddit_test.py                    Reddit-Endpunkte testen
  migrate_cluster.py                Retro-Clustering für Bestandsdaten
  at.worlddirect.kinews.fetch.plist macOS LaunchAgent News-Fetch (07:00)
  at.worlddirect.kinews.reddit.plist macOS LaunchAgent Reddit-Fetch (07:45)
  server/                           systemd-Units + nginx-Config
data/                 SQLite-DB (gitignored)
```

## Lizenz

MIT. Persönliches Projekt — Issues und PRs willkommen, aber keine SLA.
