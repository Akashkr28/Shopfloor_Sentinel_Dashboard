#!/bin/sh
# Platform volumes (Railway, Fly, ...) mount owned by root. Fix ownership of the
# app's data folders, then run the server as the unprivileged "node" user.
set -e
if [ "$(id -u)" = "0" ]; then
  for dir in "$(dirname "${DB_PATH:-/app/backend/data/sentinel.db}")" "${UPLOADS_DIR:-/app/backend/uploads}" "${EMBEDDINGS_CACHE:-/app/backend/data/models}"; do
    mkdir -p "$dir"
    chown -R node:node "$dir"
  done
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
