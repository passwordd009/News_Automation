#!/usr/bin/env bash
#
# Provision an Ollama host for the Hestia worker.
#
# Run this ON THE VM, as root, on Debian or Ubuntu. It is idempotent — running
# it again is safe and will not lose your token.
#
#   sudo bash setup_ollama_vm.sh ollama.example.com
#   sudo bash setup_ollama_vm.sh ollama.example.com --model llama3.1
#
# What it does, and why:
#
#   1. Installs Ollama and binds it to 127.0.0.1. Ollama has NO authentication
#      of its own, so it must never listen on a public interface.
#   2. Installs Caddy as a reverse proxy that demands a bearer token and gets
#      an HTTPS certificate automatically.
#   3. Closes every port except 22, 80 and 443.
#   4. Pulls the model.
#
# Before running, point an A record for your domain at this machine's public IP
# — Caddy needs it to obtain a certificate.

set -euo pipefail

DOMAIN="${1:-}"
MODEL="llama3.1"
TOKEN_FILE="/etc/hestia/ollama-token"

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="${2:?--model needs a value}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[[ -n "$DOMAIN" ]] || die "Usage: sudo bash setup_ollama_vm.sh <domain> [--model NAME]"
[[ $EUID -eq 0 ]] || die "Run this as root (sudo bash setup_ollama_vm.sh ...)."
command -v apt-get >/dev/null || die "This script expects Debian or Ubuntu."

# ---------------------------------------------------------------------------
step "Checking DNS for $DOMAIN"
# ---------------------------------------------------------------------------
# Caddy cannot get a certificate if the name does not resolve here, and the
# failure surfaces much later as a confusing TLS error.
public_ip="$(curl -fsS --max-time 10 https://api.ipify.org || echo "")"
resolved="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || echo "")"

if [[ -z "$resolved" ]]; then
  die "$DOMAIN does not resolve. Add an A record pointing at this machine first."
elif [[ -n "$public_ip" && "$resolved" != "$public_ip" ]]; then
  echo "WARNING: $DOMAIN resolves to $resolved but this machine appears to be $public_ip."
  echo "         Certificate issuance will fail unless that is a proxy you control."
  read -r -p "         Continue anyway? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || exit 1
else
  echo "$DOMAIN -> $resolved ✓"
fi

# ---------------------------------------------------------------------------
step "Installing Ollama"
# ---------------------------------------------------------------------------
if command -v ollama >/dev/null; then
  echo "Already installed: $(ollama --version 2>&1 | head -1)"
else
  curl -fsSL https://ollama.com/install.sh | sh
fi

# ---------------------------------------------------------------------------
step "Binding Ollama to localhost only"
# ---------------------------------------------------------------------------
# The single most important line in this script. Without it Ollama listens on
# 0.0.0.0:11434 with no password, and scanners find that quickly.
install -d /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'UNIT'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
# Keep the model resident so a run does not pay load time per article.
Environment="OLLAMA_KEEP_ALIVE=30m"
UNIT

systemctl daemon-reload
systemctl enable --now ollama
systemctl restart ollama
sleep 3

ss -lntp 2>/dev/null | grep -q '127.0.0.1:11434' \
  && echo "Ollama is listening on 127.0.0.1:11434 only ✓" \
  || echo "WARNING: could not confirm the listen address — check 'ss -lntp'."

# ---------------------------------------------------------------------------
step "Creating the access token"
# ---------------------------------------------------------------------------
install -d -m 700 /etc/hestia
if [[ -s "$TOKEN_FILE" ]]; then
  echo "Reusing the existing token at $TOKEN_FILE"
else
  openssl rand -hex 32 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "Generated a new token."
fi
TOKEN="$(cat "$TOKEN_FILE")"

# ---------------------------------------------------------------------------
step "Installing Caddy"
# ---------------------------------------------------------------------------
if ! command -v caddy >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
fi

# ---------------------------------------------------------------------------
step "Configuring the authenticating proxy"
# ---------------------------------------------------------------------------
cat > /etc/caddy/Caddyfile <<CADDY
# Hestia — authenticating proxy in front of Ollama.
#
# Ollama has no authentication, so this is what stands between the model and
# the internet. Requests without the exact bearer token get 401 and never
# reach it.

$DOMAIN {
	@unauthorized not header Authorization "Bearer $TOKEN"
	respond @unauthorized "Unauthorized" 401

	reverse_proxy 127.0.0.1:11434 {
		# Screening an article on CPU can take a while; do not cut it off.
		transport http {
			read_timeout 600s
		}
	}

	log {
		output file /var/log/caddy/ollama.log
		format json
	}
}
CADDY

# The token lives in this file, so keep it off world-readable mode.
chown root:caddy /etc/caddy/Caddyfile
chmod 640 /etc/caddy/Caddyfile
install -d -o caddy -g caddy /var/log/caddy

caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
  || die "The generated Caddyfile is invalid. Check /etc/caddy/Caddyfile."

systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

# ---------------------------------------------------------------------------
step "Closing the firewall"
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null; then
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp >/dev/null    # do not lock yourself out
  ufw allow 80/tcp >/dev/null    # Caddy, for certificate issuance
  ufw allow 443/tcp >/dev/null   # Caddy
  ufw --force enable >/dev/null
  echo "Allowed 22, 80, 443. Everything else denied — including 11434."
else
  echo "WARNING: ufw is not installed. Close port 11434 with your provider's firewall."
fi

# ---------------------------------------------------------------------------
step "Pulling $MODEL"
# ---------------------------------------------------------------------------
# This downloads several GB and can take a while.
ollama pull "$MODEL"

# ---------------------------------------------------------------------------
step "Verifying"
# ---------------------------------------------------------------------------
sleep 2
code_without="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/tags" || echo "000")"
code_with="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "https://$DOMAIN/api/tags" || echo "000")"

echo "  no token   -> HTTP $code_without  (expect 401)"
echo "  with token -> HTTP $code_with  (expect 200)"

if [[ "$code_without" != "401" || "$code_with" != "200" ]]; then
  echo
  echo "Not working yet. Certificates can take a minute on first run; retry the"
  echo "two curl commands above. If 000 persists, check: journalctl -u caddy -n 50"
fi

cat <<SUMMARY

────────────────────────────────────────────────────────────────────────
Done.

Add these to GitHub → Settings → Secrets and variables → Actions:

  OLLAMA_URL          https://$DOMAIN
  OLLAMA_AUTH_TOKEN   $TOKEN

And as a repository *variable* (not a secret):

  OLLAMA_MODEL        $MODEL

The token is also kept at $TOKEN_FILE. It is the only thing protecting
the model — treat it like a password, and re-run this script after
changing it so Caddy picks it up.

Check it from your own machine:

  ./scripts/check_ollama_vm.sh https://$DOMAIN $TOKEN
────────────────────────────────────────────────────────────────────────
SUMMARY
