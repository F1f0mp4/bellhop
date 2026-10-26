#!/bin/sh
# Drop root and run as PUID:PGID so imported files belong to your user, not root.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

case "$PUID$PGID" in
  "" | *[!0-9]*)
    echo "PUID and PGID must be numeric ids, got PUID='$PUID' PGID='$PGID'" >&2
    exit 1
    ;;
esac

# TrueNAS datasets with ACLs can refuse chown; that's fine as long as the user can write.
warn_chown() {
  echo "Warning: could not change ownership of '$1' to $PUID:$PGID; continuing." >&2
}

check_writable() {
  if ! su-exec "$PUID:$PGID" test -w "$1"; then
    echo "Error: '$1' is not writable by $PUID:$PGID. Set PUID/PGID to a user with write access to that dataset." >&2
    exit 1
  fi
}

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR" || warn_chown "$DATA_DIR"
  check_writable "$DATA_DIR"
  if [ -d "$MEDIA_DIR" ]; then
    # Not recursive: a large library would make every start slow.
    mkdir -p "$MEDIA_DIR/.bellhop-tmp"
    chown "$PUID:$PGID" "$MEDIA_DIR/.bellhop-tmp" || warn_chown "$MEDIA_DIR/.bellhop-tmp"
    check_writable "$MEDIA_DIR"
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
