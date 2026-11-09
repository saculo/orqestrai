#!/usr/bin/env bash
# VPS2, once, as root: firewall, k3s, Argo CD, OpenBao's unseal key, and the root Application.
# After this, Argo CD installs everything else from deploy/ in the repository.
#   ORQ_REVISION  the branch or tag Argo CD follows (default main)
# Run `tailscale up --ssh` yourself first (it needs your login); see deploy/README.md.
set -euo pipefail

K3S_VERSION=v1.37.2+k3s1
ARGOCD_VERSION=v3.6.1
REVISION=${ORQ_REVISION:-main}
RAW=https://raw.githubusercontent.com/saculo/orqestrai/$REVISION/deploy

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
tailscale status >/dev/null 2>&1 || { echo "run 'tailscale up --ssh' first" >&2; exit 1; }

echo "== firewall: from outside only SSH and Tailscale"
apt-get update -qq && apt-get install -y -qq ufw jq openssl >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 41641/udp >/dev/null              # Tailscale's direct connections
ufw allow in on tailscale0 >/dev/null
ufw allow from 10.42.0.0/16 >/dev/null      # k3s pods
ufw allow from 10.43.0.0/16 >/dev/null      # k3s services
ufw --force enable >/dev/null

echo "== k3s $K3S_VERSION: Secrets encrypted on disk, no Traefik, no public load balancer"
mkdir -p /etc/rancher/k3s
cat > /etc/rancher/k3s/config.yaml <<'CFG'
secrets-encryption: true
disable: [traefik, servicelb]
write-kubeconfig-mode: "0600"
CFG
if ! command -v k3s >/dev/null || [ "$(k3s --version | awk 'NR==1{print $3}')" != "$K3S_VERSION" ]; then
  curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=$K3S_VERSION sh -s - >/dev/null
fi
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
until kubectl get nodes >/dev/null 2>&1; do sleep 2; done
kubectl wait --for=condition=Ready node --all --timeout=180s >/dev/null

echo "== Argo CD $ARGOCD_VERSION"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl apply -n argocd --server-side --force-conflicts \
  -f "https://raw.githubusercontent.com/argoproj/argo-cd/$ARGOCD_VERSION/manifests/install.yaml" >/dev/null
kubectl -n argocd rollout status deploy/argocd-repo-server --timeout=300s >/dev/null

echo "== OpenBao's unseal key (made once, kept in an encrypted Secret)"
kubectl create namespace openbao --dry-run=client -o yaml | kubectl apply -f - >/dev/null
if ! kubectl -n openbao get secret openbao-unseal >/dev/null 2>&1; then
  key=$(mktemp)
  openssl rand -out "$key" 32
  kubectl -n openbao create secret generic openbao-unseal --from-file=key="$key" >/dev/null
  shred -u "$key"
fi

echo "== root Application, following $REVISION"
curl -fsSL "$RAW/root.yaml" | sed "s/: main\b/: $REVISION/" | kubectl apply -f - >/dev/null

echo "done. Next: deploy/bootstrap/openbao.sh init, once the openbao pod runs:"
echo "  kubectl -n openbao get pods"
