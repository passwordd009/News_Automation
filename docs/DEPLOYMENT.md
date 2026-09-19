# Deployment plan

Development assumes one machine: dashboard, Python worker and Ollama together
on your laptop. Deploying splits them apart, and three things stopped working
the moment it did. All three are now solved in code — what remains is
configuration, and **"Deploying, in order" below is the runbook**. The sections
before it explain why the shape is what it is.

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

### 3. ~~The button shells out to a local process~~ — solved

`/api/ingest/run` used to run `python worker/scripts/ingest.py` as a subprocess,
which a deployed dashboard cannot do: no Python, no worker directory, no model.

**It now dispatches the ingest workflow instead** and polls the run to
completion, refreshing the queue when it lands. The subprocess path is gone
rather than kept as a fallback — two ways to collect meant local behaviour that
production could not reproduce, and a screening step that was required in one
and optional in the other.

Consequences worth knowing:

- A click takes **minutes**, not seconds. The UI shows run progress and links
  to the log.
- Collection now always runs with `--review require`, so an unreachable model
  fails the run instead of filing a day unscored.
- The button is hidden unless `GITHUB_DISPATCH_TOKEN` is set. Everything else
  in the dashboard works without it.

---

## The proposed shape

```
        Render                 GitHub Actions              Supabase
   ┌──────────────┐          ┌────────────────┐         ┌──────────┐
   │  Next.js     │          │ daily  06:00   │         │ Postgres │
   │  dashboard   │          │ rotate Mon 12  │────────▶│ Auth     │
   │              │          │ on demand      │         │ RLS      │
   │  publishable │─────────▶│                │         └──────────┘
   │  key + RLS   │ dispatch │ secret key     │              ▲
   └──────────────┘          │ Ollama on the  │              │
          │                  │ runner         │              │
          │                  └────────────────┘              │
          └──────────────────── reads/writes ────────────────┘
```

**Dashboard → Render.** It is a Next.js app that talks to Supabase with the
publishable key; RLS decides what each person can see. `render.yaml` at the
repository root defines the service, so it is version-controlled rather than
clicked together. Nothing in the application code is host-specific — moving
from one platform to another changed configuration and documentation only.

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
button press. The ingest workflow allows 120 minutes and sets `LLM_TIMEOUT=300`
for that reason. A smaller model, or a GPU instance, is the lever if runs start
timing out.

## Deploying, in order

The code work is done. What is left is configuration, and the order matters in
one place: **the dispatch ref is `main`**, so the button runs whatever version
of `ingest.yml` is on `main` — not the branch you developed on. Merging first
is step 1 for that reason, not tidiness.

### 1. Merge to `main`

```bash
git checkout main && git merge <your branch> && git push
```

Until this happens the collect button fails with a 422: the workflow on `main`
has no `date` or `request_id` input, so GitHub rejects the dispatch. Set
`GITHUB_DISPATCH_REF` if you deploy from a different branch.

### 2. Apply every migration

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Seven migrations, all re-runnable. Three are recent and easy to miss:

| Migration | What breaks without it |
|---|---|
| `20260914000001_attach_signup_trigger` | New signups get no profile row and cannot sign in |
| `20260916000001_article_effective_date` | Day tabs read nothing; the queue looks empty |
| `20260918000001_return_to_review` | Sent-back articles keep a withdrawn approval stamp |

Confirm with `psql "$SUPABASE_DB_URL" -c "\\d public.articles"` — you want
`effective_date` in the column list.

### 3. GitHub Actions secrets

**Settings → Secrets and variables → Actions → Secrets:**

| Secret | Value |
|---|---|
| `SUPABASE_URL` | your project URL |
| `SUPABASE_SECRET_KEY` | the secret (service-role) key |

Both are required; everything else is optional. The secret key bypasses RLS —
it belongs here and in `worker/.env`, never in Render.

**Variables** (optional): `OLLAMA_MODEL` defaults to `llama3.2:3b`, `TIMEZONE`
to `America/New_York`.

### 4. Run each workflow by hand, once

**Actions → Collect articles → Run workflow**, with the inputs blank. Then the
same for **Rotate the editorial week**.

Do this before trusting the schedule, and before deploying the dashboard. It
separates "does the pipeline work" from "does the button work" — and the first
run is the slow one, since it pulls the model before the cache exists.

A green run ends with a line like
`Fetched: 138   Duplicates: 88   Reviewed: 8   Recommended: 1   Inserted: 8`.

### 5. The dispatch token

Settings → Developer settings → **Fine-grained** personal access tokens. Scope
it to this repository only, with exactly one permission:

| Permission | Level |
|---|---|
| **Actions** | **Read and write** |
| Metadata | Read (added automatically) |

Nothing else — see the warning below.

### 6. Render

**New → Blueprint**, pointed at this repository. `render.yaml` supplies
everything except the secrets, which Render prompts for:

| Variable | |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable (anon) key |
| `GITHUB_DISPATCH_TOKEN` | the token from step 5 |

The first two are public by design — they ship in the browser bundle, and RLS
is what protects the data behind them. The third must **not** gain a
`NEXT_PUBLIC_` prefix or it ships too.

`SUPABASE_SECRET_KEY` does **not** go here. It bypasses RLS entirely and
nothing under `web/` reads it.

To create the service by hand instead of from the blueprint, the settings are:

| Setting | Value |
|---|---|
| Runtime | Node |
| Root directory | `web` |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/login` |
| `NODE_VERSION` | `22` |

Two details that are easy to get wrong:

- **No `-p $PORT` on the start command.** `next start` reads `PORT` from the
  environment and binds `0.0.0.0` already, which is exactly what Render
  expects.
- **Health check `/login`, not `/`.** `/` redirects to `/dashboard`, which an
  unauthenticated check follows to `/login` anyway — so check `/login` and get
  a 200 rather than a 307 chain.

> **Changing a `NEXT_PUBLIC_` value needs a deploy, not a restart.** Those two
> variables are inlined into the JavaScript bundle at build time, so a restart
> serves the old build with the old values baked in. Use **Manual Deploy →
> Clear build cache & deploy**. `GITHUB_DISPATCH_TOKEN` is read at runtime on
> the server, so a restart is enough for that one. The asymmetry has cost
> people an afternoon.

### 7. Supabase auth settings

**Authentication → URL Configuration.** Set the Site URL to your Render domain
(`https://<service>.onrender.com`, or your custom domain), and add
`https://<your-domain>/auth/callback` to the redirect allow-list.

Both are required for password recovery. Supabase silently discards a
`redirectTo` that is not on the list and substitutes the Site URL — which is
why a reset email arrives pointing at localhost, or at the site's front page
instead of the reset form.

The app carries a safety net for this: a one-time code arriving on any path is
forwarded to `/auth/callback`, and a recovery session that arrives as a URL
fragment is picked up wherever it lands. That turns the misconfiguration from
a dead link into a working one — but only while the Site URL still points
somewhere real. Set the allow-list anyway.

**Authentication → Emails → SMTP Settings: configure a custom provider before
anyone but you relies on this.** Supabase's built-in sender is capped at **2
messages per hour** and **only delivers to addresses on the project's team**.
Your own address qualifies; a new editor's does not, and their reset link will
simply never arrive with nothing in the UI to say why. Any transactional
provider works.

**Optional: make reset links work across devices.** By default Supabase sends
a PKCE link, which carries a verifier stored in a cookie — so a link requested
on a laptop cannot be opened on a phone. Editing **Authentication → Email
Templates → Reset Password** to use `{{ .TokenHash }}` instead of
`{{ .ConfirmationURL }}` removes that constraint:

```
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">
  Set a new password
</a>
```

`/auth/callback` accepts both shapes, so this can be changed at any time and
links already sent keep working.

**Email confirmation and open signup.** Decide whether new accounts must
confirm their address. Leaving signup open is now safe by default: a new
account is held at *Waiting for approval* and can read nothing until an admin
accepts it on the Users page, with the request lapsing after 72 hours.

### 8. Harden, before real data

- **Rotate the Supabase keys.** They have passed through local files and
  terminal output during setup. Rotating means updating them in three places:
  Actions secrets, Render, and `worker/.env`.
- **Confirm RLS in production.** The local suite proves the policies against a
  throwaway cluster; verify against the real project by signing in as a Content
  Creator and checking the pending queue is empty for them.
- **Promote your account.** Sign up through the deployed app first, then run
  `supabase/seed_admin.sql` with your email.

### Smoke test

In order, after deploying:

1. Sign in. You should land on the dashboard, not a redirect loop.
2. Open **Review**. The day tabs should show counts, not an error banner.
3. Press **Collect today's news**. It should report a run starting and link to
   it. Minutes, not seconds.
4. Approve something, open **Approved**, and send it back.
5. Open **Users**. Your own row's dropdown should be disabled.
6. Click your email in the sidebar, set your name, and confirm it appears in
   **Users**.
7. Sign out, use **Forgot your password?**, and follow the emailed link. If it
   never arrives, that is step 7's SMTP limit, not a bug.

### Why the dispatch token is scoped that narrowly

**Do not grant `Workflows` or `Contents: write`.** `ingest.yml` runs with
`SUPABASE_SECRET_KEY` in its environment, and both of those permissions are a
path to editing what that workflow does — directly, or via a pushed branch.
`Actions: write` can only run the workflow as already committed, which is the
entire reason this token is safe to hold. The dispatch `ref` is pinned in code
(`GITHUB_DISPATCH_REF`, default `main`) and never read from the request.

Rotate or revoke it at Settings → Developer settings → Personal access tokens.
Nothing else in the system depends on it: the daily schedule uses Actions'
own credentials, not this token.

### Pointing at a hosted model instead

Two further Actions secrets switch the workflow away from the runner, with no
code change: `OLLAMA_URL`, and `OLLAMA_AUTH_TOKEN` if it sits behind a proxy.
Leave both unset and the model runs on the runner, which is the default and
costs nothing.

### About the two cron lines

GitHub cron is UTC and ignores daylight saving, so a single expression drifts
an hour twice a year. Each workflow is scheduled at both offsets and decides
whether to act: ingest checks the local hour, and `rotate_week.py` already
refuses unless it is Monday at or after noon **and** the week has ended.

---

## What this does not change

The editorial rules are enforced in the database, so they survive the move
unchanged: the worker still cannot approve, Content Creators still cannot
decide, decisions are still stamped from `auth.uid()`, and the week still
rotates Monday at noon. Deployment moves where code runs, not who is allowed to
do what.
