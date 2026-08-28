#!/usr/bin/env bash
set -euo pipefail

# Start local Plexus GraphQL as a host uvicorn process with Virtuus file storage.
# No Docker, Compose, Postgres, MinIO, or Qdrant.
#
# Optional:
#   PLEXUS_GRAPHQL_PROXY_DIR — path to services/private-graphql-proxy
#   PLEXUS_ROOT — Plexus repo root (proxy resolved as $PLEXUS_ROOT/services/private-graphql-proxy)
#   PLEXUS_DATA_DIR or PLEXUS_VIRTUUS_DATA_DIR — data directory (default: .plexus/data)
#   PLEXUS_GRAPHQL_HOST — bind address (default: 127.0.0.1)
#   PLEXUS_GRAPHQL_PORT — listen port (default: 8000)
#   PYTHON — Python interpreter (default: python3 from PATH)

PORT="${PLEXUS_GRAPHQL_PORT:-8000}"
HOST="${PLEXUS_GRAPHQL_HOST:-127.0.0.1}"
DATA_DIR="${PLEXUS_DATA_DIR:-${PLEXUS_VIRTUUS_DATA_DIR:-.plexus/data}}"
PYTHON="${PYTHON:-python3}"

resolve_proxy_dir() {
  if [[ -n "${PLEXUS_GRAPHQL_PROXY_DIR:-}" && -f "${PLEXUS_GRAPHQL_PROXY_DIR}/proxy/app.py" ]]; then
    printf '%s' "${PLEXUS_GRAPHQL_PROXY_DIR}"
    return 0
  fi
  if [[ -n "${PLEXUS_ROOT:-}" && -f "${PLEXUS_ROOT}/services/private-graphql-proxy/proxy/app.py" ]]; then
    printf '%s' "${PLEXUS_ROOT}/services/private-graphql-proxy"
    return 0
  fi
  for candidate in \
    "${HOME}/projects/Plexus/services/private-graphql-proxy" \
    "${HOME}/Projects/Plexus/services/private-graphql-proxy"; do
    if [[ -f "${candidate}/proxy/app.py" ]]; then
      printf '%s' "${candidate}"
      return 0
    fi
  done
  return 1
}

PROXY_DIR="$(resolve_proxy_dir || true)"
if [[ -z "${PROXY_DIR}" ]]; then
  echo "error: private-graphql-proxy not found." >&2
  echo "Set PLEXUS_GRAPHQL_PROXY_DIR to services/private-graphql-proxy, or clone Plexus under ~/projects/Plexus." >&2
  exit 1
fi

export PLEXUS_STORE=virtuus
export PLEXUS_DATA_DIR="${DATA_DIR}"
export PLEXUS_BACKEND_MODE=local
export PLEXUS_PROXY_UPSTREAM_DISABLED=true
export PLEXUS_PROXY_AUTH_MODE=trusted_open
unset PLEXUS_PROXY_DATABASE_URL

export PYTHONPATH="${PROXY_DIR}${PYTHONPATH:+:${PYTHONPATH}}"

exec "${PYTHON}" -m uvicorn proxy.app:app \
  --host "${HOST}" \
  --port "${PORT}" \
  --workers 1
