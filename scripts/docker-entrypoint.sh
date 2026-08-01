#!/bin/sh
set -eu

case "${PUID:-99}" in *[!0-9]*|'') echo "PUID must be numeric" >&2; exit 64;; esac
case "${PGID:-100}" in *[!0-9]*|'') echo "PGID must be numeric" >&2; exit 64;; esac

if [ "$(id -u)" = "0" ]; then
  current_uid="$(id -u vynode)"
  if getent group "$PGID" >/dev/null 2>&1; then
    usermod -g "$PGID" vynode
  else
    groupmod -g "$PGID" vynode
  fi
  [ "$current_uid" = "$PUID" ] || usermod -u "$PUID" vynode
  mkdir -p /var/lib/vynode /media /tmp/vynode-home/.config /tmp/vynode-home/.cache
  # Linux/Unraid bind mounts support ownership changes. Docker Desktop file
  # sharing may not; it still supplies writable mounts through its VM layer.
  chown "$PUID:$PGID" /var/lib/vynode 2>/dev/null || true
  chown -R "$PUID:$PGID" /tmp/vynode-home
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
