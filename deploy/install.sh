#!/usr/bin/env bash
set -euo pipefail
# Shared backup/cleanup lock must exist before enabling the backup timer.
[[ -f /run/lock/ali-release-retention.lock ]] || {
  echo 'Prepare the server-operations retention tmpfiles lock before installing this application.' >&2
  exit 1
}
if [[ $EUID -ne 0 || $# -ne 1 ]]; then
  echo 'Usage: sudo bash deploy/install.sh <linux-binary>' >&2; exit 64
fi
binary=$(realpath "$1")
scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ -e /opt/yuyan || -e /etc/systemd/system/yuyan.service ]] || id yuyan >/dev/null 2>&1; then
  echo 'Existing installation or identity found; use the documented upgrade procedure.' >&2; exit 1
fi
if ss -H -ltn 'sport = :18084' | grep -q .; then echo 'Port 18084 is in use.' >&2; exit 1; fi
useradd --system --home-dir /opt/yuyan --shell /usr/sbin/nologin yuyan
install -d -m 0755 /opt/yuyan /opt/yuyan/bin /opt/yuyan/config /opt/yuyan/docs /opt/yuyan/releases
install -d -m 0700 -o yuyan -g yuyan /opt/yuyan/data /opt/yuyan/backups
install -m 0755 "$binary" /opt/yuyan/bin/yuyan
install -m 0644 "$scripts/nginx-location.conf" "$scripts/yuyan.service" "$scripts/yuyan-backup.service" "$scripts/yuyan-backup.timer" /opt/yuyan/config/
runuser -u yuyan -- /opt/yuyan/bin/yuyan init --data /opt/yuyan/data
systemctl link /opt/yuyan/config/yuyan.service /opt/yuyan/config/yuyan-backup.service /opt/yuyan/config/yuyan-backup.timer
systemctl daemon-reload
systemctl enable --now yuyan.service yuyan-backup.timer
curl --fail --silent --retry 10 --retry-delay 1 --retry-connrefused http://127.0.0.1:18084/healthz
systemctl start yuyan-backup.service
test "$(systemctl show yuyan-backup.service -p Result --value)" = success
echo 'Yuyan installed. Add its Nginx location after local health verification.'
