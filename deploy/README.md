# Deploying orqestrai

Two machines, both set up from this folder.

```
VPS1 (Claude Code sessions, in Fence)          VPS2 (k3s, run by Argo CD from deploy/)
  orq, orq mcp  ── Tailscale, tcp 7400 ──►  orq serve ── TLS ──► Postgres (psql01)
  no secrets                                  OpenBao ─► External Secrets ─► orq-db Secret
```

- VPS2 holds every credential, in OpenBao. External Secrets copies each one into the
  Kubernetes Secret that needs it. It logs in to OpenBao with its service account, so no
  token is stored anywhere. `orq serve` reads the database login from its Secret.
- VPS1 holds none. Its sessions call `orq serve` over Tailscale. The Tailscale policy lets
  VPS1 reach that one port and nothing else on VPS2.
- Argo CD deploys `deploy/apps` from this repository: OpenBao, External Secrets, the
  Tailscale operator, the store and policies (`deploy/platform`), and `orq serve`
  (`deploy/orq`). A change is a commit.

## Once: Tailscale

1. Paste [`tailscale-policy.hujson`](tailscale-policy.hujson) into login.tailscale.com,
   under Access controls.
2. Create an OAuth client for the Kubernetes operator: Settings, OAuth clients. It needs
   write access to Devices Core, Auth Keys and Services, with tag `tag:k8s-operator`.
   Keep its id and secret for step 4 below.
3. Tag VPS1: `sudo tailscale up --ssh --advertise-tags=tag:vps1`.

## VPS2, as root

1. Join the tailnet: `tailscale up --ssh --advertise-tags=tag:vps2` (install Tailscale
   first: `curl -fsSL https://tailscale.com/install.sh | sh`).
2. Bootstrap. Read the script first; it sets up the firewall, k3s, Argo CD, OpenBao's unseal
   key, and the root Application:
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/saculo/orqestrai/main/deploy/bootstrap/vps2.sh
   curl -fsSLO https://raw.githubusercontent.com/saculo/orqestrai/main/deploy/bootstrap/openbao.sh
   less vps2.sh openbao.sh
   bash vps2.sh
   ```
3. When `kubectl -n openbao get pods` shows `openbao-0` running, run `bash openbao.sh init`.
   It prints a recovery key and a root token once. Keep both in your password manager.
   OpenBao unseals itself after a reboot, so you need them only to change credentials.
4. Store the credentials. Each command asks for the root token, then for the values:
   ```bash
   bash openbao.sh tailscale   # the OAuth client id and secret from above
   bash openbao.sh db          # PGHOST psql01.mikr.us, PGDATABASE, PGUSER, PGPASSWORD,
                               # PGSSLMODE verify-ca, and the path to psql01's certificate
   ```
5. Check:
   ```bash
   kubectl -n argocd get applications    # all Synced and Healthy
   kubectl -n orq get pods               # orq-serve 1/1 Running: it reached the database
   tailscale status | grep orq-server    # the operator's device for orq serve
   ```

The image `ghcr.io/saculo/orqestrai` must be public, so k3s can pull it without a login.
Once, after the first release: GitHub, Packages, orqestrai, Package settings, Change visibility.

## VPS1, as root

```bash
curl -fsSLO https://raw.githubusercontent.com/saculo/orqestrai/main/deploy/bootstrap/vps1.sh
less vps1.sh
bash vps1.sh
```

This script:
- installs `orq` from the latest release into `/usr/local/bin`, owned by root, so a session
  cannot replace it
- installs the Claude Code plugin for user `orq`
- sets `ORQ_SERVER`
- writes the Fence config: no database host, `orq-server` allowed, and the config itself
  read-only inside the sandbox
- tells you to remove the old Bitwarden token, which VPS1 no longer needs

## Changes later

- **A new orq:**
  1. Bump the version in `package.json` and `plugin/.claude-plugin/plugin.json`.
  2. Tag `v<version>`. The release job builds the binary and the image.
  3. Set `newTag` in `deploy/orq/kustomization.yaml`. Argo CD rolls it out.
  4. On VPS1, run `ORQ_VERSION=<version> bash vps1.sh`.
- **A credential:** run `openbao.sh db` or `openbao.sh tailscale` again. External Secrets
  picks the change up within an hour. To restart orq at once:
  `kubectl -n orq rollout restart deploy/orq-serve`.
- **A new secret** (GitHub, Slack):
  1. Add a path to the `external-secrets` policy in `openbao.sh`.
  2. Add an `ExternalSecret` next to the app that uses it.

## What was tested

These steps ran end to end in a local kind cluster:
- Argo CD synced every Application from this branch.
- `openbao.sh init` and `db` set up OpenBao, which unsealed itself from the static key.
- External Secrets created `orq-db`.
- `orq serve` reached the database and became ready.

Network policies:
- In kind, calls to orq from outside the `tailscale` namespace were blocked.
- On k3s (`rancher/k3s:v1.37.2-k3s1`), the egress rule let orq reach only psql01: no other
  database and no internet.

Not tested here: the Tailscale operator (it needs the OAuth client) and the real psql01.
