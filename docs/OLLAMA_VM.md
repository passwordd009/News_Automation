# Where the model runs

The worker needs a model it can reach. On your laptop that is Ollama on
localhost. In production there are three answers, and the cheapest is also the
simplest.

---

## The duty cycle decides this

The daily run screens a few dozen articles and stops. Call it 15 minutes a day
— **under two hours a week.** Any option that bills by the hour is idle about
99% of the time.

| | Cost shape | Idle cost |
|---|---|---|
| **Runner-hosted** (default) | free on a public repo | none — nothing exists between runs |
| **Hosted API** | per article screened | none |
| **Always-on VM** | per hour, all week | ~99% of the bill |

## Runner-hosted — what this repo does now

`.github/workflows/ingest.yml` installs Ollama on the GitHub Actions runner,
restores the weights from cache, screens the articles, and throws the whole
machine away when the job ends.

There is nothing to provision, nothing to patch, no port to protect and no
token to leak — the model only ever listens on the runner's own localhost, for
the life of one job.

**Cost: nothing.** Actions minutes are free and unlimited on public
repositories, and this one is public.

### What you give up

The runner has no GPU, so screening is slower per article than a machine you
would pick for the job. That is why the workflow defaults to a small model
(`llama3.2:3b`) rather than `llama3.1` — on CPU, an 8B model spends
considerably longer per article for judgement that is not obviously better at
"is this useful to a New Yorker".

Weights are cached between runs, so only the first run pays the download. A
daily schedule keeps the cache warm; GitHub evicts entries unused for a week.

### Changing the model

Set the `OLLAMA_MODEL` repository **variable**. Larger is slower:

| Model | |
|---|---|
| `llama3.2:3b` | the default — quick enough on runner CPU |
| `llama3.1` | 8B, noticeably slower per article |

The first run on a new model pays the download again, since the cache key
includes the name.

---

## Hosted API — when the runner is too slow

If runs start taking too long, or the small model's judgement is not good
enough, a hosted API is the next step rather than a VM. It has the same "pay
only when running" shape and needs no infrastructure.

`LLMClient` (`worker/app/llm/client.py`) is an interface with one
implementation. Adding Claude, OpenAI or Gemini is a class plus a line in
`_PROVIDERS`, and `LLM_PROVIDER` selects it. The reviewer, the prompts and the
pipeline do not change.

---

## Always-on VM — probably not worth it

Worth it only if you want a specific large model, already have a machine, or
have enough other work to keep it busy. For this workload it is the most
expensive option and the only one with a security surface to maintain.

If you do go this way, `scripts/setup_ollama_vm.sh` provisions it and
`scripts/check_ollama_vm.sh` verifies it from outside. Setting the `OLLAMA_URL`
secret switches the workflow to it automatically — no code change.

The reason it needs a proxy at all: **Ollama has no authentication**, and this
repository is public. The tidy arrangement — a self-hosted runner on the VM,
model on localhost — would let anyone's pull request run on that machine. So
the setup script binds Ollama to `127.0.0.1`, puts Caddy in front demanding a
bearer token, and closes the firewall.

```bash
scp scripts/setup_ollama_vm.sh you@your-vm:~
ssh you@your-vm && sudo bash setup_ollama_vm.sh ollama.yourdomain.com

# then, from your laptop — it also times a real review
./scripts/check_ollama_vm.sh https://ollama.yourdomain.com YOUR_TOKEN
```

Add `OLLAMA_URL` and `OLLAMA_AUTH_TOKEN` as Actions secrets and the workflow
uses the VM instead of the runner.

**Tailscale** is the stronger variant: the runner joins your tailnet and the VM
never appears on the public internet at all.

---

## Pointing your laptop at a hosted instance

Put the same two values in `worker/.env`:

```
OLLAMA_URL=https://ollama.yourdomain.com
OLLAMA_AUTH_TOKEN=...
```

The worker sends the token when it is set and omits it when it is not, so
switching back to a local Ollama needs no other change.
