# Setting up the model VM

The worker needs a model it can reach. On your laptop that is Ollama on
localhost; in production it is a small server, because GitHub's runners cannot
reach your laptop.

Two scripts do the work. Most of this page explains what they do and why, so
you can check them before running anything as root.

---

## Before you start

**A domain name you control.** Caddy gets an HTTPS certificate automatically,
but only for a name with an A record pointing at the VM. A subdomain is fine —
`ollama.yourdomain.com`.

**A VM.** What matters is RAM, because the model is held in memory:

| | Enough for |
|---|---|
| 8 GB RAM, 2 vCPU, 25 GB disk | an 8B model such as `llama3.1`, slowly |
| 16 GB RAM, 4 vCPU | the same model with room to spare, noticeably quicker |
| A GPU instance | fast, and considerably more expensive |

Start at the bottom of that table. The check script measures how long a real
review takes on the hardware you picked, so you can decide with a number rather
than a guess.

**Ubuntu or Debian.** The setup script uses `apt`.

---

## 1. Provision

Copy the script to the VM and run it:

```bash
scp scripts/setup_ollama_vm.sh you@your-vm:~
ssh you@your-vm
sudo bash setup_ollama_vm.sh ollama.yourdomain.com
```

It is idempotent — run it again any time; it keeps the token it already made.

What it does:

1. **Checks DNS first.** A name that does not resolve here fails certificate
   issuance later with a confusing TLS error, so it is worth catching up front.
2. **Installs Ollama and binds it to `127.0.0.1`.** The most important line in
   the script. Ollama has no authentication; left on the default address it
   listens on all interfaces with no password.
3. **Generates a token** into `/etc/hestia/ollama-token`, mode 600.
4. **Installs Caddy** as a reverse proxy that returns 401 without that exact
   bearer token, and gets a certificate automatically.
5. **Closes the firewall** to everything but 22, 80 and 443.
6. **Pulls the model** — several GB, so it takes a few minutes.

At the end it prints the token and the two secrets to add to GitHub.

## 2. Verify from somewhere else

Run this from your laptop. The point is to see the host the way GitHub's
runners will:

```bash
./scripts/check_ollama_vm.sh https://ollama.yourdomain.com YOUR_TOKEN
```

It checks that the host refuses anonymous requests, that port 11434 is not
reachable directly (a proxy is no use if it can be walked around), that the
model is pulled, and then **times one real review**.

That timing is the number to pay attention to:

```
  ✓ generated a reply in 18s
    At ~50 articles a day that is roughly 15 minutes per run.
```

Over about 40 minutes a day and the workflow will hit its timeout. The fix is a
smaller model, a bigger machine, or capping runs with `--limit`.

## 3. Connect it

Add to **GitHub → Settings → Secrets and variables → Actions**:

| Secret | |
|---|---|
| `OLLAMA_URL` | `https://ollama.yourdomain.com` |
| `OLLAMA_AUTH_TOKEN` | the token the script printed |

and as a repository **variable**:

| Variable | |
|---|---|
| `OLLAMA_MODEL` | `llama3.1` |

Then run **Collect articles** from the Actions tab. `ingest.py --check` runs
first and reports Supabase and the model separately.

To point your laptop at the VM instead of a local Ollama, put the same two
values in `worker/.env`:

```
OLLAMA_URL=https://ollama.yourdomain.com
OLLAMA_AUTH_TOKEN=...
```

The worker sends the token when it is set and omits it when it is not, so
switching back to localhost needs no other change.

---

## Why a proxy at all

Because **Ollama has no authentication**, and your repository is public.

The tidiest arrangement would be a self-hosted GitHub runner on the VM itself,
with Ollama never leaving localhost. That is not available here: on a public
repository, anyone can open a pull request, and a self-hosted runner would run
it on your machine.

So GitHub's hosted runners have to reach the VM across the internet, and the
only thing standing in front of the model is the token. Treat it like a
password. If it leaks, generate a new one and re-run the setup script.

**Tailscale** avoids the exposure entirely — the runner joins your tailnet with
`tailscale/github-action` and `OLLAMA_URL` becomes a tailnet address, so the VM
never appears on the public internet. More moving parts; stronger position. The
worker needs no changes either way.

---

## Keeping it running

```bash
systemctl status ollama caddy      # both should be active
journalctl -u ollama -n 50         # model errors
journalctl -u caddy -n 50          # certificate and proxy errors
ollama list                        # what is installed
```

**Cost.** The VM bills whether or not it is screening anything, and it is idle
most of the day. If that stops being worth it, a hosted API is a one-class
change: `LLMClient` is an interface, and `LLM_PROVIDER` selects the
implementation.

**Updates.** `apt upgrade` and the occasional `ollama pull` to refresh the
model. Nothing in the worker pins a model version.
