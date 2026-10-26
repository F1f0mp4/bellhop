#!/bin/sh
# Drop root and run as PUID:PGID so imported files belong to your user, not root.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR"
  if [ -d "$MEDIA_DIR" ]; then
    mkdir -p "$MEDIA_DIR/.bellhop-tmp"
    chown "$PUID:$PGID" "$MEDIA_DIR/.bellhop-tmp"
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
