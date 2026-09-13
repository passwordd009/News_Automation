# Migration: Google Docs → Supabase editorial CMS

Audit of the repository as it stands, and the smallest safe path to the
architecture in `HESTIA_NEWS_CMS_SPEC.md`.

Written against commit `e0b7f4c`. Nothing in this plan has been implemented yet.

---

## 1. Repository audit

Answers to the eight questions in §26 of the spec.

### Where is news fetched?

`worker/app/collectors/rss_collector.py` — the only implemented source. Every collector
subclasses `NewsCollector` (`worker/app/collectors/base.py`), whose `safe_fetch()`
guarantees a dead feed degrades a run instead of ending it. Feeds are
configuration, not code: `worker/config/rss_feeds.json`, overridable via `RSS_FEEDS`.

`worker/app/services/daily_pipeline.py` orchestrates fetch → normalize → dedupe →
store. Gmail and the news API join `build_collectors()` when built.

### What is the current article structure?

Pydantic models in `worker/app/schemas.py`:

- **`ArticleCandidate`** — `title, url, source, published_at, snippet, author, collector, discovered_at`. Normalizes its own URL during validation, so no collector can skip it.
- **`ArticleReview`** — the six scores plus `appropriate, topic, borough, summary, why_post, rejection_reason`. Range-checked 0–10. **Not yet produced by anything** — there is no LLM reviewer.

The stored row is `Article` in `worker/app/database/models.py` (SQLAlchemy, SQLite).

### Where is Google Docs generation?

| File | Fate |
|---|---|
| `worker/app/google/docs_writer.py` | Deprecated — OAuth + Docs API calls |
| `worker/app/google/document_builder.py` | Deprecated as output; field mapping is trivial |
| `worker/scripts/generate_weekly_doc.py` | Deprecated as the main command |
| `worker/app/services/weekly_pipeline.py` | **Obsolete by design** — see below |

`weekly_pipeline.select_articles()` algorithmically picks 5–10 articles with
topic diversity. Under the new architecture **humans do that selection** in
`/review`. This code is not "Google Docs code," but the spec supersedes it.

### Is Supabase configured?

No. Zero JS/TS/SQL files, no `SUPABASE_*` variables. The 22 configured env vars
are listed in `.env.example`; none relate to Supabase.

### Is a Next.js frontend present?

No. The repository is Python-only.

### What authentication exists?

**None.** No auth, no users, no roles, no sessions anywhere. Roles, RLS and
login are all greenfield.

### What can be reused?

**Keep as-is** — `worker/app/collectors/`, `worker/app/processing/url_normalizer.py`,
`worker/app/processing/deduplicator.py`, `schemas.py`, `config.py`,
`worker/app/services/daily_pipeline.py`. This is the ingestion core §21 says to preserve.

**Adapt** — `worker/app/database/repository.py` (queries move to a Supabase client),
`worker/app/database/models.py` (becomes the SQL migration).

**Deprecate** — `worker/app/google/`, `worker/scripts/generate_weekly_doc.py`,
`worker/app/services/weekly_pipeline.py`.

---

## 2. Two things the audit surfaced

### `approved` means two different things

The current schema has `Article.approved: bool`, set when the **AI** score
clears the thresholds. The spec's `status = 'approved'` means a **human**
approved it.

Mapping one onto the other would let the AI auto-approve, breaking product rule
14 and §18. The migration must map:

```
current  Article.approved        ->  articles.ai_recommended
current  Article.overall_score   ->  articles.overall_score
                    (new)        ->  articles.status  = 'pending' always
```

The Python worker may never write `status = 'approved'`.

### The LLM reviewer still does not exist

Definition-of-done item 3 assumes AI-reviewed articles. `ArticleReview` is
defined and tested but nothing produces one, so every article currently has
`topic = NULL` and no scores. The reviewer is now on the critical path and is
step 3 below.

---

## 3. Target layout

Monorepo, with the schema as the shared contract:

```
worker/          Python ingestion + AI screening (today's app/, scripts/, config/)
web/             Next.js App Router + TypeScript + Tailwind
supabase/
  migrations/    the single source of truth for the schema
docs/
```

---

## 4. Migration steps

Each step is independently reviewable and leaves the repo working.

| # | Step | Verifiable here? |
|---|---|---|
| 0 | ~~Merge PR #2~~ | ✅ done (`e0b7f4c`) |
| 1 | Restructure to the monorepo layout — pure `git mv`, no logic changes | ✅ tests pass |
| 2 | Supabase schema + RLS migrations | ✅ **local Postgres** |
| 3 | LLM reviewer behind `LLMClient` (the missing Phase 3) | ✅ fake-client tests |
| 4 | Python writes to Supabase; isolate `worker/app/google/` | ⚠️ mocked only |
| 5 | Next.js scaffold, auth, roles, route guards | ✅ typecheck + build |
| 6 | `/review` queue — approve / decline | ✅ build only |
| 7 | `/approved` feed + weekly periods | ✅ build only |
| 8 | `/archive` reusing the approved-feed component | ✅ build only |
| 9 | `/declined` + reconsideration workflow | ✅ build only |
| 10 | Cleanup job for expired declined content | ✅ local Postgres |

### Step 2 detail — schema and RLS

Four tables per §10–12: `profiles`, `weekly_periods`, `articles`,
`approval_requests`. Check constraints on every status column, indexes on
`weekly_period_id, status, created_at, normalized_url`, and `normalized_url`
unique.

RLS policies enforce the §6 matrix. The role lookup goes through one
`security definer` helper rather than repeating a subquery in every policy:

```sql
create function public.current_role_name() returns text
  language sql stable security definer set search_path = public
  as $$ select role from public.profiles where id = auth.uid() $$;
```

**These policies get tested before they ship.** A local Postgres 16 cluster with
a small `auth` shim (`auth.users`, `auth.uid()`, the `authenticated` and
`service_role` roles) runs the real migration files and exercises each policy
per role. Proven working during this audit:

```
approver        approves article  ->  UPDATE 1   (allowed)
content_creator approves article  ->  UPDATE 0   (blocked by RLS)
```

That is the §17 requirement — "hiding a button is not sufficient" — checked
mechanically rather than by inspection.

---

## 5. What I cannot verify here

Honest constraints of the build sandbox:

- **Supabase is unreachable** (proxy returns 403). I cannot apply migrations to
  your project, sign a real user in, or test live RLS. You apply migrations via
  the Supabase CLI; I verify the same SQL locally first.
- **npm is reachable**, so the Next.js app really is installed, typechecked and
  built here — not just written and hoped for.
- **No Ollama**, so the reviewer is tested against a fake `LLMClient`. You run
  it against a real model.
- **No browser session**, so UI verification is typecheck + production build.
  Visual and interaction review is yours.

## 6. What I need from you

1. `SUPABASE_URL`, anon key, and service-role key — **put these in `worker/.env` and `web/.env.local` yourself, do not paste them into chat.** The service-role key bypasses RLS entirely.
2. Your Supabase project ref, for `supabase link`.
3. How the first admin gets assigned — a seeded SQL insert against your own user id is the safest, and avoids any "first signup becomes admin" race.

## 7. Open questions

- **Weekly period boundaries.** Sunday–Saturday, per the spec's `September 7 - September 13, 2026` example? And who closes a period — a cron job, or an admin button?
- **Articles already in SQLite.** Backfill them into Supabase as `pending`, or start clean? Clean is simpler and loses nothing real, since the current rows are unreviewed test data.
- **`delete_after` default.** §9 wants it configurable; I propose period end + 14 days, settable via env.
