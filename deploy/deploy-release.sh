#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

# The deployment identity may publish only this application's bounded declaration.
# All validation and atomic publication logic belongs to ServerPortal/server-operations.
if [[ $EUID -eq 0 && $# -eq 3 && ( $1 == portal || $1 == portal-check ) && $2 =~ ^[0-9a-f]{40}$ && $3 =~ ^[0-9a-f]{64}$ ]]; then
  portal_action=register
  if [[ $1 == portal-check ]]; then portal_action=check-registration; fi
  exec timeout 45 /opt/serverportal/bin/portal "$portal_action" --app yuyan --commit "$2" --sha256 "$3"
fi

if [[ $EUID -ne 0 || $# -ne 2 || ! $1 =~ ^[0-9a-f]{40}$ || ! $2 =~ ^[0-9a-f]{64}$ ]]; then echo 'Usage: deploy-release.sh <commit> <binary-sha256> < binary.gz' >&2; exit 64; fi
commit=$1
expected=$2
app=/opt/yuyan
exec 9>/run/lock/yuyan-deploy.lock
flock -n 9 || { echo 'Another release is running.' >&2; exit 75; }
test -f "$app/data/yuyan.db"
test -x "$app/bin/yuyan"
release=$(mktemp -d "$app/releases/$commit.XXXXXX")
chmod 0755 "$release"
stopped=false
replaced=false
healthy() {
  systemctl is-active --quiet yuyan &&
    curl --fail --silent --max-time 3 http://127.0.0.1:18084/healthz | grep -qx ok &&
    curl --fail --silent --max-time 5 http://127.0.0.1/yuyan/ | grep -q '/yuyan/static/'
}
wait_healthy() { for ((attempt=0;attempt<20;attempt++)); do if healthy; then return 0; fi; sleep 1; done; return 1; }
finish() {
  result=$?
  trap - EXIT HUP INT TERM
  if [[ $result -ne 0 && $stopped == true ]]; then
    systemctl stop yuyan || true
    if [[ $replaced == true ]]; then install -m 0755 "$release/previous" "$app/bin/yuyan.rollback"; mv -f "$app/bin/yuyan.rollback" "$app/bin/yuyan"; fi
    if systemctl start yuyan && wait_healthy; then echo 'Previous program is healthy; database was not rolled back.' >&2;
    else echo 'ROLLBACK FAILED: inspect journalctl -u yuyan.' >&2; fi
  fi
  if [[ $result -eq 0 ]]; then echo success > "$release/result"; else echo failed > "$release/result"; fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
# Receive the local release as gzip; verify the uncompressed program below.
timeout 600 head -c 67108865 > "$release/yuyan.gz"
size=$(stat -c %s "$release/yuyan.gz")
if ((size==0||size>67108864)); then echo 'Compressed upload must be 1 byte to 64 MiB.' >&2; exit 65; fi
gzip -dc "$release/yuyan.gz" | head -c 134217729 > "$release/yuyan"
size=$(stat -c %s "$release/yuyan")
if ((size==0||size>134217728)); then echo 'Binary size must be 1 byte to 128 MiB.' >&2; exit 65; fi
actual=$(sha256sum "$release/yuyan")
if [[ ${actual%% *} != "$expected" ]]; then echo 'Checksum mismatch.' >&2; exit 65; fi
rm -f "$release/yuyan.gz"
chmod 0755 "$release/yuyan"
cp "$app/bin/yuyan" "$release/previous"
chmod 0755 "$release/previous"
printf 'commit=%s\nsha256=%s\n' "$commit" "$expected" > "$release/metadata"
backup="$app/backups/before-deploy-$(basename "$release")"
stopped=true
systemctl stop yuyan
runuser -u yuyan -- timeout 300 "$app/bin/yuyan" backup --data "$app/data" --out "$backup"
# Uploaded executable always runs as the application identity.
runuser -u yuyan -- timeout 60 "$release/yuyan" check --data "$app/data"
install -m 0755 "$release/yuyan" "$app/bin/yuyan.next"
replaced=true
mv -f "$app/bin/yuyan.next" "$app/bin/yuyan"
systemctl start yuyan
wait_healthy
printf '%s\n' "$commit" > "$app/current-commit"
chmod 0644 "$app/current-commit"
printf 'Deployed %s.\n' "$commit"
