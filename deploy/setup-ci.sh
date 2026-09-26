#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 1 ]]; then echo 'Usage: sudo bash deploy/setup-ci.sh <public-key.pub>' >&2; exit 64; fi
public_key=$(realpath "$1")
scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ssh-keygen -l -f "$public_key" >/dev/null
if [[ $(wc -l < "$public_key") -ne 1 ]] || ! grep -q '^ssh-ed25519 ' "$public_key"; then echo 'Expected one Ed25519 public key.' >&2; exit 64; fi
test -x /opt/yuyan/bin/yuyan
if id yuyan-deploy >/dev/null 2>&1 || [[ -e /etc/sudoers.d/yuyan-deploy ]]; then echo 'CI identity already exists.' >&2; exit 1; fi
useradd --system --home-dir /opt/yuyan/deploy-user --shell /bin/bash yuyan-deploy
install -d -m 0755 /opt/yuyan/deploy-user /opt/yuyan/deploy-user/.ssh
install -m 0755 "$scripts/deploy-ssh.sh" "$scripts/deploy-release.sh" /opt/yuyan/bin/
printf 'restrict,command="/opt/yuyan/bin/deploy-ssh.sh" %s\n' "$(< "$public_key")" > /opt/yuyan/deploy-user/.ssh/authorized_keys
chmod 0644 /opt/yuyan/deploy-user/.ssh/authorized_keys
printf 'yuyan-deploy ALL=(root) NOPASSWD: /opt/yuyan/bin/deploy-release.sh\n' > /etc/sudoers.d/yuyan-deploy
chmod 0440 /etc/sudoers.d/yuyan-deploy
visudo -cf /etc/sudoers.d/yuyan-deploy
