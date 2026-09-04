#!/usr/bin/env bash
set -euo pipefail

# Start local Plexus GraphQL as a host uvicorn process with Virtuus file storage.
# No Docker, Compose, Postgres, MinIO, or Qdrant.
#
# Requires a Virtuus-capable private-graphql-proxy (proxy/virtuus_store.py and
# proxy/store_factory.py — Plexus PR #612).
#
# Static Plexus settings live in .plexus/config.yaml (store, backend_mode, proxy).
#
# Optional runtime overrides:
#   PLEXUS_GRAPHQL_PROXY_DIR — path to services/private-graphql-proxy (Virtuus checkout)
#   PLEXUS_ROOT — Plexus repo root when that working tree includes Virtuus store files
#   PLEXUS_DATA_DIR — override data directory (tests often use a temp dir)
#   PLEXUS_GRAPHQL_HOST — bind address (default: 127.0.0.1)
#   PLEXUS_GRAPHQL_PORT — listen port (default: 8000)
#   PYTHON — Python interpreter (default: python3 from PATH)

PORT="${PLEXUS_GRAPHQL_PORT:-8000}"
HOST="${PLEXUS_GRAPHQL_HOST:-127.0.0.1}"
PYTHON="${PYTHON:-python3}"

is_virtuus_proxy_dir() {
  local dir="$1"
  [[ -f "${dir}/proxy/virtuus_store.py" && -f "${dir}/proxy/store_factory.py" ]]
}

is_yaml_config_proxy_dir() {
  local dir="$1"
  grep -q 'load_config' "${dir}/proxy/config.py" 2>/dev/null
}

resolve_proxy_dir() {
  local candidate
  local fallback=""

  if [[ -n "${PLEXUS_GRAPHQL_PROXY_DIR:-}" ]]; then
    candidate="${PLEXUS_GRAPHQL_PROXY_DIR}"
    if is_virtuus_proxy_dir "${candidate}"; then
      printf '%s' "${candidate}"
      return 0
    fi
  fi

  for candidate in \
    "${HOME}/Projects/Plexus_worktrees/virtuus-store/services/private-graphql-proxy" \
    "${PLEXUS_ROOT:+"${PLEXUS_ROOT}/services/private-graphql-proxy"}" \
    "${HOME}/Projects/Plexus/services/private-graphql-proxy" \
    "${HOME}/projects/Plexus/services/private-graphql-proxy"; do
    [[ -z "${candidate}" ]] && continue
    if is_virtuus_proxy_dir "${candidate}"; then
      if is_yaml_config_proxy_dir "${candidate}"; then
        printf '%s' "${candidate}"
        return 0
      fi
      if [[ -z "${fallback}" ]]; then
        fallback="${candidate}"
      fi
    fi
  done

  if [[ -n "${fallback}" ]]; then
    printf '%s' "${fallback}"
    return 0
  fi

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

if [[ -n "${PLEXUS_DATA_DIR:-}" ]]; then
  export PLEXUS_DATA_DIR
fi

export PYTHONPATH="${PROXY_DIR}${PYTHONPATH:+:${PYTHONPATH}}"

exec "${PYTHON}" -m uvicorn proxy.app:app \
  --host "${HOST}" \
  --port "${PORT}" \
  --workers 1
