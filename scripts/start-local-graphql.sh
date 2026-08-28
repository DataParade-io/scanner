#!/usr/bin/env bash
set -euo pipefail

# Start local Plexus GraphQL as a host uvicorn process with Virtuus file storage.
# No Docker, Compose, Postgres, MinIO, or Qdrant.
#
# Requires a Virtuus-capable private-graphql-proxy (proxy/virtuus_store.py and
# proxy/store_factory.py — Plexus PR #612).
#
# Optional:
#   PLEXUS_GRAPHQL_PROXY_DIR — path to services/private-graphql-proxy (Virtuus checkout)
#   PLEXUS_ROOT — Plexus repo root when that working tree includes Virtuus store files
#   PLEXUS_DATA_DIR or PLEXUS_VIRTUUS_DATA_DIR — data directory (default: .plexus/data)
#   PLEXUS_GRAPHQL_HOST — bind address (default: 127.0.0.1)
#   PLEXUS_GRAPHQL_PORT — listen port (default: 8000)
#   PYTHON — Python interpreter (default: python3 from PATH)

PORT="${PLEXUS_GRAPHQL_PORT:-8000}"
HOST="${PLEXUS_GRAPHQL_HOST:-127.0.0.1}"
DATA_DIR="${PLEXUS_DATA_DIR:-${PLEXUS_VIRTUUS_DATA_DIR:-.plexus/data}}"
PYTHON="${PYTHON:-python3}"

is_virtuus_proxy_dir() {
  local dir="$1"
  [[ -f "${dir}/proxy/virtuus_store.py" && -f "${dir}/proxy/store_factory.py" ]]
}

resolve_proxy_dir() {
  local candidate

  if [[ -n "${PLEXUS_GRAPHQL_PROXY_DIR:-}" ]]; then
    candidate="${PLEXUS_GRAPHQL_PROXY_DIR}"
    if is_virtuus_proxy_dir "${candidate}"; then
      printf '%s' "${candidate}"
      return 0
    fi
  fi

  for candidate in \
    "${HOME}/Projects/Plexus_worktrees/virtuus-store/services/private-graphql-proxy"; do
    if is_virtuus_proxy_dir "${candidate}"; then
      printf '%s' "${candidate}"
      return 0
    fi
  done

  if [[ -n "${PLEXUS_ROOT:-}" ]]; then
    candidate="${PLEXUS_ROOT}/services/private-graphql-proxy"
    if is_virtuus_proxy_dir "${candidate}"; then
      printf '%s' "${candidate}"
      return 0
    fi
  fi

  for candidate in \
    "${HOME}/Projects/Plexus/services/private-graphql-proxy" \
    "${HOME}/projects/Plexus/services/private-graphql-proxy"; do
    if is_virtuus_proxy_dir "${candidate}"; then
      printf '%s' "${candidate}"
      return 0
    fi
  done

  return 1
}

PROXY_DIR="$(resolve_proxy_dir || true)"
if [[ -z "${PROXY_DIR}" ]]; then
  echo "error: no Virtuus-capable private-graphql-proxy found." >&2
  echo "The proxy must include proxy/virtuus_store.py and proxy/store_factory.py (Plexus PR #612)." >&2
  echo "Set PLEXUS_GRAPHQL_PROXY_DIR to a Virtuus checkout, for example:" >&2
  echo "  ~/Projects/Plexus_worktrees/virtuus-store/services/private-graphql-proxy" >&2
  exit 1
fi

export PLEXUS_STORE=virtuus
export PLEXUS_DATA_DIR="${DATA_DIR}"
export PLEXUS_VIRTUUS_DATA_DIR="${DATA_DIR}"
export PLEXUS_BACKEND_MODE=local
export PLEXUS_PROXY_UPSTREAM_DISABLED=true
export PLEXUS_PROXY_AUTH_MODE=trusted_open
unset PLEXUS_PROXY_DATABASE_URL

export PYTHONPATH="${PROXY_DIR}${PYTHONPATH:+:${PYTHONPATH}}"

exec "${PYTHON}" -m uvicorn proxy.app:app \
  --host "${HOST}" \
  --port "${PORT}" \
  --workers 1
