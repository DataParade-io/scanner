#!/usr/bin/env bash
set -euo pipefail

# Run the curated corpus through local Plexus evaluate accuracy and persist
# an Evaluation record in Virtuus-backed GraphQL.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

: "${PLEXUS_ROOT:?Set PLEXUS_ROOT to a Plexus checkout with Virtuus + SourceSpanOverlapScore}"
CORPUS_DIR="${CORPUS_DIR:-${REPO_ROOT}/tests/benchmark}"
PORT="${PLEXUS_GRAPHQL_PORT:-8000}"

cd "${REPO_ROOT}"
exec pnpm exec ts-node scripts/run-corpus-eval.ts \
  --corpus-dir "${CORPUS_DIR}" \
  --plexus-root "${PLEXUS_ROOT}" \
  --port "${PORT}" \
  --start-graphql
