# Project Hestia — Weekly Wrap-Up News Automation

Automates news discovery and curation for Project Hestia's weekly Instagram
"Weekly Wrap-Up," which helps New Yorkers stay informed about events, programs,
developments and useful local news.

The system collects NYC news daily, deduplicates it, has an LLM evaluate each
article against Hestia's editorial goals, and generates a Google Doc of the best
stories each week. **Nothing is ever published automatically** — the weekly doc
is a draft for the Hestia team to review and edit.

## Status — Phase 1 complete

| Phase | Scope | Status |
|-------|---------------------------------------------|--------|
| 1 | Article models, SQLite database, RSS collector | ✅ Done |
| 2 | Deduplication | ⬜ Next |
| 3 | Ollama LLM reviewer | ⬜ |
| 4 | Scoring and approval | ⬜ |
| 5 | Terminal report of approved stories | ⬜ |
| 6 | Google Docs generation | ⬜ |
| 7 | Gmail newsletter ingestion | ⬜ |
| 8 | Optional news API collector | ⬜ |
| 9 | Scheduling (cron / GitHub Actions) | ⬜ |
| 10 | Tests, monitoring, documentation | ⬜ |

## Quick start

Requires Python 3.12+ (the code also runs on 3.11).

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # optional; defaults work out of the box

python scripts/collect_articles.py
```

Useful flags:

```bash
python scripts/collect_articles.py --limit 20                       # cap output
python scripts/collect_articles.py --feed https://gothamist.com/feed  # one feed only
python scripts/collect_articles.py --json                           # machine-readable
python scripts/collect_articles.py --log-level DEBUG                # verbose
```

Sample output:

```
  1. City launches $5M grant program for small businesses
     Gothamist  |  2026-09-12 23:38 UTC
     https://gothamist.com/grants
     The city announced grants for neighborhood businesses affected by construction.

------------------------------------------------------------------------
Collected: 2
    2  Gothamist
------------------------------------------------------------------------
```

Run the tests (no network needed — feeds are served from fixtures):

```bash
pytest tests/ -q
```

## Layout

```
app/
├── collectors/          # one module per source, all behind NewsCollector
│   ├── base.py          # the NewsCollector interface + safe_fetch guard rail
│   └── rss_collector.py # Phase 1 source
├── processing/
│   └── url_normalizer.py
├── database/
│   ├── models.py        # SQLAlchemy Article + ArticleStatus
│   └── database.py      # engine, session_scope(), init_db()
├── llm/                 # Phase 3
├── google/              # Phase 6
├── services/            # daily & weekly pipelines (Phase 4-6)
├── schemas.py           # ArticleCandidate + ArticleReview (Pydantic)
└── config.py            # environment-driven settings
config/rss_feeds.json    # the feed list — configuration, not code
scripts/collect_articles.py
tests/
```

## Configuration

Everything is environment-driven; see `.env.example` for the full list. The
values you are most likely to touch:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite:///hestia_news.db` | Storage. Swap for Postgres later without code changes. |
| `ENABLE_RSS` / `ENABLE_GMAIL` / `ENABLE_NEWS_API` | `true` / `false` / `false` | Turn collectors on and off. |
| `RSS_FEEDS_FILE` | `config/rss_feeds.json` | Where the feed list lives. |
| `RSS_FEEDS` | — | Comma-separated URLs; overrides the file entirely. |
| `LOOKBACK_DAYS` | `2` | Ignore entries older than this. |
| `MIN_ARTICLE_SCORE` | `7` | Approval threshold (Phase 4). |
| `OLLAMA_MODEL` | `llama3.1` | Local model to review articles (Phase 3). |

### Adding or muting a feed

Edit `config/rss_feeds.json` — no code changes:

```json
{ "name": "Chalkbeat New York", "url": "https://www.chalkbeat.org/...", "enabled": true }
```

Set `"enabled": false` to mute a feed without losing the URL.

## Design notes

**Collectors share one interface.** Every source implements
`NewsCollector.fetch_articles() -> list[ArticleCandidate]`, so the pipeline
never knows or cares whether a story came from RSS, a Gmail newsletter or a
news API. `safe_fetch()` wraps each collector so a dead feed, a timeout or a
malformed entry is logged and skipped — one broken source never ends a run.

**URLs are normalized before anything else.** Tracking parameters (`utm_*`,
`fbclid`, `mc_cid`, …), `www.`, default ports, fragments and trailing slashes
are stripped, and query parameters are sorted. This is what makes exact-URL
deduplication work in Phase 2, and it happens inside `ArticleCandidate`
validation so no collector can forget to do it.

**Positive is not the same as appropriate.** `ArticleReview.overall_score`
weights NYC relevance 30%, community value 25%, informative value 20%,
credibility 15%, and positivity and local-event value 5% each. An informative
housing-policy dispute with a positivity score of 4 can still score well above
the approval line — which is the intent. Thresholds are configurable, and
approval also requires a minimum NYC relevance and credibility.

**LLM output is never trusted.** Every response must parse into the
`ArticleReview` Pydantic model, with scores range-checked 0–10, before it can
affect anything. A rejected review without a stated reason gets one filled in
rather than being stored blank.

**Article history is permanent.** Articles move through
`candidate → reviewed → approved/rejected → selected → posted`, and the URL
column is unique, so a story cannot appear in two different Weekly Wrap-Ups.

## Next: Phase 2

Deduplication — exact normalized-URL matching (Level 1) and near-identical
title matching (Level 2), checked against stored history. Embedding similarity
(Level 3) is deliberately deferred.
