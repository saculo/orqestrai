#!/usr/bin/env bash
# VPS1, as root: the orq binary from a release (root-owned, so a session cannot change it), the
# Claude Code plugin for user orq, ORQ_SERVER, and the Fence config. VPS1 then holds no secret.
#   ORQ_VERSION  the release to install (default: the latest)
#   ORQ_USER     the user the sessions run as (default orq)
set -euo pipefail

USER_NAME=${ORQ_USER:-orq}
HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
REPO=https://github.com/saculo/orqestrai
REVISION=${ORQ_VERSION:+v$ORQ_VERSION}
DOWNLOAD=$REPO/releases/${ORQ_VERSION:+download/v$ORQ_VERSION}${ORQ_VERSION:-latest/download}
RAW=https://raw.githubusercontent.com/saculo/orqestrai/${REVISION:-main}/deploy/vps1

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
as_user() { su - "$USER_NAME" -s /bin/bash -c "$1"; }

echo "== orq to /usr/local/bin/orq"
tmp=$(mktemp -d)
curl -fsSL -o "$tmp/orq-linux-x64" "$DOWNLOAD/orq-linux-x64"
curl -fsSL -o "$tmp/orq-linux-x64.sha256" "$DOWNLOAD/orq-linux-x64.sha256"
(cd "$tmp" && sha256sum -c --quiet orq-linux-x64.sha256)
install -o root -g root -m 755 "$tmp/orq-linux-x64" /usr/local/bin/orq
rm -rf "$tmp"
rm -f "$HOME_DIR/.local/bin/orq" # the old link to a checkout
orq --version

echo "== the Claude Code plugin for $USER_NAME"
as_user "claude plugin marketplace add saculo/orqestrai >/dev/null 2>&1 || claude plugin marketplace update orqestrai >/dev/null"
as_user "claude plugin install orq@orqestrai >/dev/null 2>&1 || claude plugin update orq@orqestrai >/dev/null; claude plugin list | grep -A1 orq@orqestrai"

echo "== ORQ_SERVER and the Fence config"
install -d -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.config/fish/conf.d" "$HOME_DIR/.config/fence"
curl -fsSL "$RAW/orq.fish" | install -o "$USER_NAME" -g "$USER_NAME" -m 644 /dev/stdin "$HOME_DIR/.config/fish/conf.d/orq.fish"
curl -fsSL "$RAW/fence.jsonc" | install -o "$USER_NAME" -g "$USER_NAME" -m 644 /dev/stdin "$HOME_DIR/.config/fence/fence.jsonc"

echo "== check: orq reaches orq serve on VPS2"
as_user "ORQ_SERVER=http://orq-server:7400 orq ls >/dev/null && echo 'orq ls: ok'"

if [ -e "$HOME_DIR/.config/bws" ]; then
  echo "VPS1 no longer needs the Bitwarden token. Check, then remove it: rm -r $HOME_DIR/.config/bws"
fi
