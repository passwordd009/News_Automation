# Project Hestia — Weekly Wrap-Up

An editorial content management system for Project Hestia's weekly Instagram
"Weekly Wrap-Up," which helps New Yorkers learn about useful, informative and
community-focused developments from the previous week.

A Python worker collects NYC news, screens it with a local LLM, and files it
for review. A Next.js dashboard is where people approve, decline and organise
stories by editorial week.

**The AI recommends. People decide. Nothing is ever posted automatically.**

---

## How the pieces fit

```
  RSS / Gmail / news API
            │
            ▼
   worker/  (Python)
   collect → normalize → deduplicate → AI review
            │
            ▼
     Supabase (Postgres + Auth + RLS)
            │
            ▼
   web/  (Next.js dashboard)
   Review → Approve / Decline → Weekly archive
```

| Directory | What it is |
|---|---|
| `worker/` | Python ingestion and AI screening |
| `web/` | Next.js editorial dashboard |
| `supabase/` | Migrations, RLS policies, and their tests — the schema is the contract between the two |
| `docs/` | The CMS spec and the migration plan |
| `worker/legacy/` | The retired Google Docs workflow, kept for reference |

## The editorial week

Weeks run **Monday to Sunday**. Stories are ready by Sunday night and posted
Monday morning, so a period stays *active* until **Monday at 12:00** — the week
being posted is still the current one while it goes out.

At noon the week rotates: it closes, the next opens, and any article still
awaiting a decision moves forward with it. A decision is permanent; indecision
rolls over.

---

## Setup

Needs **Python 3.12+** (3.11 works), **Node 20+**, a **Supabase project**, and
**[Ollama](https://ollama.com)** for the AI screening.

### 1. Database

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Then create your account through the app (step 4 below) and promote it once:

Edit the `ADMIN EMAIL` line inside it, then run the whole file — either paste
it into the **Supabase SQL editor**, or:

```bash
psql "$SUPABASE_DB_URL" -f supabase/seed_admin.sql
```

It is plain SQL with no psql backslash commands, so both work. Running it twice
is harmless.

This is deliberately manual. "Whoever signs up first becomes admin" is a race,
and a hardcoded email in version control is worse.

### 2. The worker

```bash
python -m venv .venv
source .venv/bin/activate                    # Windows: .venv\Scripts\activate
pip install -r worker/requirements.txt

cp worker/.env.example worker/.env           # then fill it in
```

Fill in `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from **Project Settings →
API**. (Older projects call it `service_role`; either variable name works.)

These are **different from the two the dashboard uses.** The dashboard gets the
publishable key; the worker needs the secret one. A repository-root `.env` also
works if you would rather keep one file, and a real environment variable beats
both — which is how the scheduled job runs with no file at all.

> The secret key **bypasses Row Level Security entirely**. It belongs in
> `worker/.env` and nowhere else — never in `web/`, never committed.

### 3. The model

```bash
ollama serve
ollama pull llama3.1
```

Any Ollama model works; set `OLLAMA_MODEL`. The provider sits behind an
interface, so Claude, OpenAI or Gemini can replace it by registering a client
in `worker/app/llm/client.py` — nothing else changes.

### 4. The dashboard

```bash
cd web
npm install
cp .env.example .env.local                   # then fill it in
npm run dev
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` come from
the same API settings page. (Older projects call that key `anon`; either
variable name works.) These are public by design — the publishable key can only
do what RLS permits the signed-in user to do.

Save the Hestia mark as `web/public/hestia-logo.png` — a square PNG with a
transparent background. Until it is there the app falls back to a plain drawn
ring rather than a broken image.

Open http://localhost:3000, create your account, then run `seed_admin.sql`.

### Collecting from the dashboard

**Collect new articles** appears on the dashboard and on `/review` for anyone
who can review. It runs the same worker as the command line, so no terminal is
needed day to day — no configuration either, as long as the worker sits beside
the dashboard, which it does in this repository.

Set `ENABLE_LOCAL_INGEST=false` to hide it where the dashboard is hosted away
from the worker and the button could only ever fail. Ollama still has to be
running: the button reports exactly what is missing when it is not.

---

## Running it

### Check everything is connected

```bash
python worker/scripts/ingest.py --check
```

Reports on Supabase and the model separately, and says what to fix.

### Collect and screen articles

```bash
python worker/scripts/ingest.py                 # the daily run (or use the button)
python worker/scripts/ingest.py --limit 5       # try a few first
python worker/scripts/ingest.py --dry-run       # screen, write nothing
python worker/scripts/ingest.py --no-review     # collect without AI screening
```

Everything lands as `pending`. The worker cannot approve — that invariant is
enforced in code, and RLS enforces it for everyone else.

**The model is optional.** By default the worker screens articles when Ollama
is reachable and collects without it when it is not, so the button always
produces articles. Unscored ones say so in the queue rather than pretending to
a score. The scheduled job uses `--review require` instead: it stops rather
than filing a whole day unscored, which would bury the queue.

### Review, then hand over

Open `/review` in the dashboard. Reconsiderations come first, then the AI's
recommendations, then by score. Low scorers sink to the bottom rather than
being hidden: the decision is yours to make, not the model's.

Approved stories appear on `/approved` — one vertical feed for the week, which
is what content creators work from. The week stays there until Monday noon, so
it is still the current week while the post goes out.

### Rotate the week

```bash
python worker/scripts/rotate_week.py --status   # report, change nothing
python worker/scripts/rotate_week.py            # rotate if due
```

Safe to run any time — it does nothing unless rotation is actually due, so a
retry or misfire cannot cut a week short.

### On a schedule

```cron
# Collect and screen every morning
0 6 * * *  cd /path/to/repo && .venv/bin/python worker/scripts/ingest.py

# Close the week Monday at noon, after the post goes out
0 12 * * 1 cd /path/to/repo && .venv/bin/python worker/scripts/rotate_week.py
```

---

## Roles

| | Admin | Approver | Content Creator |
|---|:---:|:---:|:---:|
| See the pending queue | ✅ | ✅ | — |
| Approve / decline | ✅ | ✅ | — |
| Edit editorial fields | ✅ | ✅ | — |
| View approved, declined, archive | ✅ | ✅ | ✅ |
| Request reconsideration | ✅ | — | ✅ |
| Resolve reconsideration | ✅ | ✅ | — |
| Manage roles and weeks | ✅ | — | — |

Everyone starts as a Content Creator. An admin promotes them.

The interface offers light, dark and auto. Auto follows the system setting;
an explicit choice is remembered per browser and syncs across open tabs.

Authorization exists at three layers, and only one of them is security:
navigation hides what you cannot use, the server refuses the route, and
**Supabase RLS refuses the data**. The first two are convenience. The third is
the boundary — hiding a button is not access control.

---

## Testing

```bash
# Worker — no network, no Ollama needed
cd worker && pytest tests/ -q

# RLS policies, against a throwaway local Postgres
./supabase/tests/run_local_rls_tests.sh

# Dashboard
cd web && npm run typecheck && npm test && npm run build
```

The RLS suite is the one worth understanding. It starts a real PostgreSQL
cluster, shims what Supabase normally provides, applies the actual migration
files, and then acts as each role with a real `auth.uid()` — proving, for
example, that a Content Creator's approval updates **zero rows**. Policies are
tested, not eyeballed.

---

## Troubleshooting

**`ingest.py` aborts saying the model is unreachable.** Deliberate. If the
model is down, filing a whole run of unscored articles would bury the review
queue, so the run stops instead. Start Ollama and retry.

**The review queue is empty.** Either nothing has been collected yet, or
everything was a duplicate. `ingest.py` prints both counts.

**An article was collected but does not appear.** Check its status — an
article already approved or declined leaves the queue. Duplicates are never
inserted twice: `normalized_url` is unique, and near-identical headlines are
caught by a title fingerprint.

**`User X exists but has no profile row` when running `seed_admin.sql`.** The
signup trigger has not reached your project yet. Apply the migrations — in
particular `20260914000001_attach_signup_trigger.sql`, which attaches it and
backfills anyone who registered first — then re-run the seed. Every migration
is safe to run more than once, so pasting one into the SQL editor is fine if
the CLI is not set up.

**Signed in, then immediately bounced out (repeated 307s).** Your account has
no `profiles` row, so it has no role. The app now shows an explanation instead
of redirecting, but if you are on an older checkout you will see a loop between
`/login` and `/dashboard`. Fix it with `supabase db push` — the migration
attaches the signup trigger and backfills anyone who registered before it
existed. Then sign out and back in.

**`syntax error at or near` when pasting SQL into the Supabase editor.** The
web editor does not understand psql backslash commands (`\set`, `\echo`).
`seed_admin.sql` and `fix_week_boundary.sql` are plain SQL and paste fine; the
files under `supabase/tests/` are psql-only by design and are meant for the
local harness, not your project.

**"Supabase is not configured" on startup.** Supabase renamed its API keys:
`anon` is now `publishable`, and `service_role` is now `secret`. Both names are
accepted, but `NEXT_PUBLIC_` variables are read **at build time** — restart the
dev server after editing `.env.local`.

**The dashboard shows nothing where you expect rows.** That is usually RLS
doing its job. A Content Creator cannot see pending articles at all, so the
review queue is legitimately empty for them.

---

## Status

| Step | | |
|---|---|:---:|
| 1 | Monorepo layout | ✅ |
| 2 | Supabase schema + RLS | ✅ |
| 3 | LLM reviewer | ✅ |
| 4 | Worker writes to Supabase | ✅ |
| 5 | Dashboard auth and role guards | ✅ |
| 6 | `/review` queue | ✅ |
| 7 | `/approved` weekly feed | ✅ |
| 8 | `/archive` | ⬜ |
| 9 | `/declined` + reconsideration | ⬜ |
| 10 | Cleanup job for expired declined content | ⬜ |

See `docs/MIGRATION_PLAN.md` for the detail, and
`docs/HESTIA_NEWS_CMS_SPEC.md` for the product spec.
