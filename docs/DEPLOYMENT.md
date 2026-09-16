# Deployment plan

Everything built so far assumes one machine: the dashboard, the Python worker
and Ollama all sit together on your laptop. Deploying splits them apart, and
three things stop working the moment it does.

The plan for each, and what is already done: Ollama now accepts a bearer token
so a networked instance is not left open, and the scheduled workflows exist.
Standing up the VM and moving the button are still ahead.

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

**Decision: the model runs on the GitHub Actions runner.** Ollama is installed
per job, the weights come from cache, and the machine is thrown away when the
run ends.

An always-on VM was the earlier plan and was the wrong shape for this: the
daily run is minutes long, so a machine billed by the hour sits idle roughly
99% of the week. Runner-hosted costs nothing on a public repository, exposes no
port, and needs no token.

See `docs/OLLAMA_VM.md`. Setting the `OLLAMA_URL` secret still switches to a
hosted instance with no code change, and a hosted API is a one-class addition
if the runner turns out too slow.

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

## Securing the Ollama VM

**Your repository is public**, which rules out the neatest arrangement: a
self-hosted Actions runner on the same VM as Ollama, with the model bound to
localhost. On a public repo anyone can open a pull request, and a self-hosted
runner would execute it on your machine.

So GitHub's hosted runners have to reach the VM over the internet — and
**Ollama has no authentication of its own**. An open port 11434 lets anyone who
finds it use your model, pull models onto your disk, and read what you send.
Scanners find these quickly.

Put a proxy in front of it and make the worker prove itself. The worker sends
`Authorization: Bearer $OLLAMA_AUTH_TOKEN` when that variable is set (and
nothing when it is not, so localhost is unaffected).

**`docs/OLLAMA_VM.md` is the runbook, and `scripts/setup_ollama_vm.sh` does it
for you.** The pieces, for reference:

A Caddyfile is about the smallest thing that works:

```caddy
ollama.example.com {
	@unauthorized not header Authorization "Bearer YOUR_LONG_RANDOM_TOKEN"
	respond @unauthorized 401

	reverse_proxy 127.0.0.1:11434
}
```

Then bind Ollama to localhost only, so the proxy is the sole way in:

```bash
# /etc/systemd/system/ollama.service.d/override.conf
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
```

And close the port at the firewall — 80 and 443 for Caddy, nothing else:

```bash
ufw allow 80,443/tcp && ufw deny 11434/tcp && ufw enable
```

Generate the token with `openssl rand -hex 32` and put it in both the Caddyfile
and the `OLLAMA_AUTH_TOKEN` secret. Confirm it works from somewhere else:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ollama.example.com/api/tags              # expect 401
curl -s -H "Authorization: Bearer TOKEN" https://ollama.example.com/api/tags | head -c 80  # expect JSON
```

**Tailscale is the stronger option** if you would rather the VM never appear on
the public internet at all: the runner joins your tailnet with
`tailscale/github-action`, and `OLLAMA_URL` becomes the machine's tailnet
address. More moving parts, no exposed surface.

### Sizing

Screening one article is a small prompt in and a short JSON object out, but on
CPU-only hardware a 8B model still takes tens of seconds. At 50 articles a day
that is a run measured in tens of minutes — fine for a 06:00 cron, slow for a
button press. The ingest workflow allows 45 minutes and sets `LLM_TIMEOUT=300`
for that reason. A smaller model, or a GPU instance, is the lever if runs start
timing out.

## Steps

| # | Step | Depends on |
|---|---|---|
| 1 | ~~Token auth for a networked Ollama~~ | ✅ done |
| 2 | ~~GitHub Actions: daily ingest, Monday-noon rotation~~ | ✅ done |
| 3 | ~~Run the model on the runner — no host to stand up~~ | ✅ done |
| 4 | Add the Supabase secrets, then run each workflow manually once | you |
| 5 | Point the button at `workflow_dispatch` instead of a local process | step 4 |
| 6 | Deploy the dashboard to Vercel | — |
| 7 | Harden: rotate keys, confirm RLS in production, Supabase auth settings | — |

Steps 6 and 7 are independent and can go first.

### Secrets and variables

In **Settings → Secrets and variables → Actions**:

| Secret | |
|---|---|
| `SUPABASE_URL` | your project URL |
| `SUPABASE_SECRET_KEY` | the secret (service-role) key — never in Vercel |
| `OLLAMA_URL` | **only** to use a hosted model instead of the runner |
| `OLLAMA_AUTH_TOKEN` | with `OLLAMA_URL`, if it is behind a proxy |

| Variable | Default if unset |
|---|---|
| `OLLAMA_MODEL` | `llama3.2:3b` |
| `TIMEZONE` | `America/New_York` |

Only the two Supabase secrets are required. Leave the Ollama ones unset and the
model runs on the runner.

Both workflows have `workflow_dispatch`, so run each once by hand from the
Actions tab before trusting the schedule. `ingest.py --check` runs first and
reports Supabase and the model separately.

### About the two cron lines

GitHub cron is UTC and ignores daylight saving, so a single expression drifts
an hour twice a year. Each workflow is scheduled at both offsets and decides
whether to act: ingest checks the local hour, and `rotate_week.py` already
refuses unless it is Monday at or after noon **and** the week has ended.

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
