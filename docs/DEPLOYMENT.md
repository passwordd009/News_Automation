# Deployment plan

Everything built so far assumes one machine: the dashboard, the Python worker
and Ollama all sit together on your laptop. Deploying splits them apart, and
three things stop working the moment it does.

This is the plan for each. Nothing here is implemented yet.

---

## What breaks, and why

### 1. Ollama — the hard blocker

`OLLAMA_URL=http://localhost:11434` means nothing on a server. There is no
model there, and a hosted worker cannot reach the one on your laptop.

Without a model there is no screening: no scores, no topic, no description, no
`why_post`. Every article would land in the queue unscored and your reviewers
would do all the work by hand — which is the thing this system exists to avoid.

**This has to be solved before anything else is worth deploying.**

The groundwork is already there. `LLMClient` (`worker/app/llm/client.py`) is an
interface with one implementation; a hosted provider is a new class plus a line
in `_PROVIDERS`, and `LLM_PROVIDER` switches between them. No other module
changes — the reviewer, the pipeline and the prompts all stay as they are.

Two ways out:

| | What it means | Trade-off |
|---|---|---|
| **Hosted API** | Claude, OpenAI or Gemini behind the same interface | Costs money per article; reliable, no infrastructure |
| **Self-hosted Ollama** | Run it on a VM the worker can reach | No per-article cost; you maintain a box, and CPU-only inference is slow |

At roughly 50 articles a day the token volume is small — each review is one
article's text in, a short JSON object out. A hosted small/fast model is likely
cheaper than a VM, but check current pricing rather than trusting an estimate
here.

### 2. Nothing runs the worker

Today you run `ingest.py` yourself, or press the button. In production
something has to do it daily, and rotate the week on Monday at noon.

### 3. The button shells out to a local process

`/api/ingest/run` runs `python worker/scripts/ingest.py` as a subprocess. On
Vercel there is no Python and no worker directory, so the button cannot work as
written. It hides itself (`workerAvailable()` returns false when the script is
missing), so the deployed app degrades quietly rather than showing a broken
control — but you would lose the button.

---

## The proposed shape

```
        Vercel                 GitHub Actions              Supabase
   ┌──────────────┐          ┌────────────────┐         ┌──────────┐
   │  Next.js     │          │ daily  06:00   │         │ Postgres │
   │  dashboard   │          │ rotate Mon 12  │────────▶│ Auth     │
   │              │          │ on demand      │         │ RLS      │
   │  publishable │─────────▶│                │         └──────────┘
   │  key + RLS   │ dispatch │ secret key     │              ▲
   └──────────────┘          │ LLM API key    │              │
          │                  └────────────────┘              │
          └──────────────────── reads/writes ────────────────┘
```

**Dashboard → Vercel.** It is a Next.js app that talks to Supabase with the
publishable key; RLS decides what each person can see. Nothing else needed.

**Worker → GitHub Actions.** Free, already in your spec (§9), and the secrets
live in GitHub rather than on a machine someone has to maintain. Two scheduled
workflows plus one that can be triggered on demand.

**Button → `workflow_dispatch`.** Instead of spawning a process, the route asks
GitHub to start the workflow. The click still collects news; it just happens a
few seconds later and on someone else's computer. The button reports that a run
started and links to it.

An always-on host (Railway, Fly, Render) is the alternative: the worker becomes
a small HTTP service, the button calls it, and results come back immediately.
Better feedback, but a service to keep alive and pay for.

---

## Steps

| # | Step | Depends on |
|---|---|---|
| 1 | Add a hosted LLM client behind `LLMClient`, selected by `LLM_PROVIDER` | choosing a provider |
| 2 | GitHub Actions: daily ingest, Monday-noon rotation | step 1 |
| 3 | `workflow_dispatch` so the button triggers the remote run | step 2 |
| 4 | Deploy the dashboard to Vercel | — |
| 5 | Harden: rotate keys, confirm RLS in production, Supabase auth settings | — |

Steps 4 and 5 are independent of the rest and can go first.

### Step 5 in detail — before real data

- **Rotate the Supabase keys.** They have been in local files and terminal
  output during setup; a deployed system should not run on them.
- **Confirm RLS is on in production.** The local suite proves the policies, but
  verify against the real project: sign in as a Content Creator and check the
  pending queue is empty for them.
- **Supabase Auth.** Turn on email confirmation, set the Site URL and redirect
  URLs to the deployed domain, and decide whether signup stays open — anyone
  who signs up becomes a Content Creator and can read approved and declined
  articles.
- **Never expose the secret key.** It belongs in GitHub Actions secrets and, if
  the button dispatches, nowhere else. Only `NEXT_PUBLIC_SUPABASE_URL` and the
  publishable key belong in Vercel.

---

## What this does not change

The editorial rules are enforced in the database, so they survive the move
unchanged: the worker still cannot approve, Content Creators still cannot
decide, decisions are still stamped from `auth.uid()`, and the week still
rotates Monday at noon. Deployment moves where code runs, not who is allowed to
do what.
