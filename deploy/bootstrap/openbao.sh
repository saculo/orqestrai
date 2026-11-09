#!/usr/bin/env bash
# OpenBao on VPS2, as root. Secrets are read from your terminal and go to OpenBao over stdin,
# never through arguments or files.
#   openbao.sh init        once: initialise; set up the KV store, Kubernetes login and the
#                          read-only role for External Secrets. Prints the recovery key and
#                          root token: keep both in your own password manager.
#   openbao.sh db          the database login: secret/orq/db
#   openbao.sh tailscale   the Tailscale operator's OAuth client: secret/tailscale/operator
set -euo pipefail
export KUBECONFIG=${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}

# Runs a shell in the OpenBao pod; the first stdin line is the token, the rest goes to the script.
in_bao() { kubectl -n openbao exec -i openbao-0 -- sh -c "read -r BAO_TOKEN; export BAO_TOKEN; $1"; }
ask() { local v; read -r -p "$1: " v </dev/tty; printf '%s' "$v"; }
ask_secret() { local v; read -r -s -p "$1: " v </dev/tty; echo >/dev/tty; printf '%s' "$v"; }

case "${1:-}" in
init)
  if kubectl -n openbao exec openbao-0 -- bao status -format=json | jq -e .initialized >/dev/null; then
    echo "OpenBao is initialised already"
  else
    echo "Save the recovery key and the root token below in your password manager."
    kubectl -n openbao exec openbao-0 -- bao operator init -recovery-shares=1 -recovery-threshold=1
  fi
  token=$(ask_secret "root token")
  { echo "$token"; cat <<'SH'; } | in_bao "sh -s"
set -e
bao secrets list -format=json | grep -q '"secret/"' || bao secrets enable -path=secret kv-v2
bao auth list -format=json | grep -q '"kubernetes/"' || bao auth enable kubernetes
bao write auth/kubernetes/config kubernetes_host=https://kubernetes.default.svc >/dev/null
bao policy write external-secrets - >/dev/null <<'HCL'
path "secret/data/orq/*"       { capabilities = ["read"] }
path "secret/data/tailscale/*" { capabilities = ["read"] }
HCL
bao write auth/kubernetes/role/external-secrets \
  bound_service_account_names=external-secrets bound_service_account_namespaces=external-secrets \
  policies=external-secrets ttl=1h >/dev/null
echo "OpenBao is set up"
SH
  ;;
db)
  token=$(ask_secret "root token")
  host=$(ask "PGHOST") port=$(ask "PGPORT [5432]") db=$(ask "PGDATABASE") user=$(ask "PGUSER")
  password=$(ask_secret "PGPASSWORD") mode=$(ask "PGSSLMODE [verify-ca]")
  ca=$(ask "path to the server's CA certificate (for verify-ca; empty for none)")
  json=$(jq -n --arg h "$host" --arg p "${port:-5432}" --arg d "$db" --arg u "$user" --arg w "$password" \
    --arg m "${mode:-verify-ca}" --arg c "$([ -n "$ca" ] && cat "$ca")" \
    '{PGHOST: $h, PGPORT: $p, PGDATABASE: $d, PGUSER: $u, PGPASSWORD: $w, PGSSLMODE: $m, "ca.crt": $c}')
  printf '%s\n%s\n' "$token" "$json" | in_bao "bao kv put -mount=secret orq/db - >/dev/null && echo stored secret/orq/db"
  ;;
tailscale)
  token=$(ask_secret "root token")
  json=$(jq -n --arg i "$(ask "OAuth client id")" --arg s "$(ask_secret "OAuth client secret")" '{client_id: $i, client_secret: $s}')
  printf '%s\n%s\n' "$token" "$json" | in_bao "bao kv put -mount=secret tailscale/operator - >/dev/null && echo stored secret/tailscale/operator"
  ;;
*)
  sed -n '2,9p' "$0"
  exit 1
  ;;
esac
