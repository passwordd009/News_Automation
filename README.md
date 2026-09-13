# Project Hestia — Weekly Wrap-Up News Automation

Automates news discovery and curation for Project Hestia's weekly Instagram
"Weekly Wrap-Up," which helps New Yorkers stay informed about events, programs,
developments and useful local news.

The system collects NYC news daily, deduplicates it, has an LLM evaluate each
article against Hestia's editorial goals, and generates a Google Doc of the best
stories each week. **Nothing is ever published automatically** — the weekly doc
is a draft for the Hestia team to review and edit.

## Status

| Phase | Scope | Status |
|-------|---------------------------------------------|--------|
| 1 | Article models, SQLite database, RSS collector | ✅ Done |
| 2 | Deduplication (URL + title; embeddings deferred) | ✅ Done |
| 3 | Ollama LLM reviewer | ⬜ **Next** |
| 4 | Scoring and approval | ⬜ |
| 5 | Terminal report of approved stories | ⬜ |
| 6 | Weekly doc generation (local file + Google Docs) | ✅ Done |
| 7 | Gmail newsletter ingestion | ⬜ |
| 8 | Optional news API collector | ⬜ |
| 9 | Scheduling (cron / GitHub Actions) | ⬜ |
| 10 | Tests, monitoring, documentation | 🟨 40 tests passing |

**Phase 6 landed before Phase 3**, so the document works end to end but each
entry's `Why post` is an explicit placeholder rather than written prose, and
`Topic` reads `Uncategorized`. The LLM reviewer fills both in.

## Quick start

Requires Python 3.12+ (the code also runs on 3.11).

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r worker/requirements.txt
cp .env.example .env               # optional; defaults work out of the box
```

**One command does everything** — collect fresh articles, store them, and build
the document:

```bash
python worker/scripts/generate_weekly_doc.py
```

That writes `output/weekly-wrap-up-YYYY-MM-DD.txt` and prints it. To create a
real Google Doc instead, see [Google Docs output](#google-docs-output) below:

```bash
python worker/scripts/generate_weekly_doc.py --google
```

Use `worker/scripts/collect_articles.py` when you want to collect *without* building a
document — for example from a daily cron job that feeds a weekly one.

Useful flags:

```bash
# Collection
python worker/scripts/collect_articles.py --limit 20                         # cap output
python worker/scripts/collect_articles.py --feed https://gothamist.com/feed  # one feed only
python worker/scripts/collect_articles.py --json                             # machine-readable
python worker/scripts/collect_articles.py --no-save                          # preview, store nothing

# Weekly document (collects first unless told otherwise)
python worker/scripts/generate_weekly_doc.py --no-collect     # use what is already stored
python worker/scripts/generate_weekly_doc.py --dry-run        # print it, change nothing
python worker/scripts/generate_weekly_doc.py --days 14        # widen the window
python worker/scripts/generate_weekly_doc.py --max 8          # cap the article count
python worker/scripts/generate_weekly_doc.py --approved-only  # LLM-approved only (Phase 3+)
python worker/scripts/generate_weekly_doc.py --out draft.txt  # choose the output path
```

`--dry-run` is the safe way to look: a normal run marks the articles it used as
`selected` so they cannot appear in a later Wrap-Up.

Sample document:

```
WEEKLY WRAP-UP

DATE: September 6, 2026 - September 13, 2026


Topic: Small Business

URL:
https://example.com/grants

Description:
The city announced $5 million in grants for businesses affected by construction.

Why post:
[Needs review — the LLM reviewer (Phase 3) has not written this yet.]

--------------------------------------------
```

## Google Docs output

Only needed for `--google`; the local file needs no setup.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable both the **Google Docs API** and the **Google Drive API**.
2. Create an OAuth client ID of type **Desktop app**, download the JSON, and
   save it as `credentials.json` in the project root.
3. Run `python worker/scripts/generate_weekly_doc.py --google`. A browser opens once
   for consent; the resulting `token.json` is reused afterwards.

Both files are gitignored. Set `GOOGLE_DRIVE_FOLDER_ID` to drop the doc into a
specific Drive folder. The doc is fully editable by the Hestia team — and
nothing is ever posted to Instagram automatically.

Run the tests (no network needed — feeds are served from fixtures):

```bash
pytest tests/ -q
```

## Layout

The repository is a monorepo. `supabase/migrations/` is the schema contract
shared by both sides.

```
worker/                       Python ingestion + AI screening
├── app/
│   ├── collectors/           # one module per source, all behind NewsCollector
│   │   ├── base.py           # the NewsCollector interface + safe_fetch guard rail
│   │   └── rss_collector.py
│   ├── processing/
│   │   ├── url_normalizer.py
│   │   └── deduplicator.py   # title fingerprints + similarity (Level 1 & 2)
│   ├── database/
│   │   ├── models.py         # SQLAlchemy Article + ArticleStatus
│   │   ├── database.py       # engine, session_scope(), init_db()
│   │   └── repository.py     # all queries live here
│   ├── google/               # legacy — deprecated by the CMS migration
│   ├── services/
│   │   ├── daily_pipeline.py # fetch from every enabled collector + store
│   │   └── weekly_pipeline.py
│   ├── llm/                  # the reviewer lands here
│   ├── schemas.py            # ArticleCandidate + ArticleReview (Pydantic)
│   └── config.py             # environment-driven settings
├── config/rss_feeds.json     # the feed list — configuration, not code
├── scripts/
└── tests/

web/                          Next.js editorial dashboard (not built yet)
supabase/migrations/          the schema — single source of truth
docs/                         CMS spec + migration plan
```

## Configuration

Everything is environment-driven; see `.env.example` for the full list. The
values you are most likely to touch:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite:///hestia_news.db` | Storage. A relative SQLite path is resolved against the project root, so the commands find the same database whatever directory you run them from. Swap for Postgres later without code changes. |
| `ENABLE_RSS` / `ENABLE_GMAIL` / `ENABLE_NEWS_API` | `true` / `false` / `false` | Turn collectors on and off. |
| `RSS_FEEDS_FILE` | `config/rss_feeds.json` (relative to `worker/`) | Where the feed list lives. |
| `RSS_FEEDS` | — | Comma-separated URLs; overrides the file entirely. |
| `LOOKBACK_DAYS` | `2` | Ignore entries older than this. |
| `MIN_ARTICLE_SCORE` | `7` | Approval threshold (Phase 4). |
| `OLLAMA_MODEL` | `llama3.1` | Local model to review articles (Phase 3). |

### Adding or muting a feed

Edit `worker/config/rss_feeds.json` — no code changes:

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

**The document format has no Google dependency.** `document_builder.py` owns the
layout and renders to text; `docs_writer.py` turns the same structure into
Google Docs API calls. The format is therefore fully testable offline, and the
destination is swappable.

**Missing data is flagged, never invented.** Before the LLM reviewer exists,
`Description` falls back to the article's own summary and `Why post` is an
explicit `[Needs review]` placeholder. The generator never writes a
justification it cannot support.

## Next: Phase 3

The Ollama reviewer, behind an `LLMClient` interface so Claude, OpenAI or
Gemini can replace it later. That fills in `Topic`, `Description` and
`Why post`, enables `--approved-only`, and activates the scoring thresholds
already defined in `schemas.py`.

Known gap for Phase 3: near-duplicate titles are collapsed *within* one
document, but a story very similar to one used in a **previous** week is not
yet caught — only exact article reuse is blocked, via the `selected` status.
