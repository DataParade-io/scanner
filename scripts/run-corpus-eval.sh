#!/usr/bin/env bash
set -euo pipefail

# Run the curated corpus through local Plexus evaluate accuracy and persist
# an Evaluation record in Virtuus-backed GraphQL.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v plexus >/dev/null 2>&1; then
  echo "error: plexus CLI not found on PATH" >&2
  exit 1
fi

CORPUS_DIR="${CORPUS_DIR:-${REPO_ROOT}/tests/benchmark}"
PORT="${PLEXUS_GRAPHQL_PORT:-8000}"

cd "${REPO_ROOT}"
exec pnpm exec ts-node scripts/run-corpus-eval.ts \
  --corpus-dir "${CORPUS_DIR}" \
  --port "${PORT}" \
  --start-graphql
