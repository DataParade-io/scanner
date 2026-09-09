#!/usr/bin/env bash
set -euo pipefail
cd /tmp/scanner-spike-incorporation
V8_PID=49921
LOG=/tmp/scorecard-chain.log
exec >>"$LOG" 2>&1
echo "watcher start $(date -u +%Y-%m-%dT%H:%M:%SZ) waiting for pid $V8_PID"
poll=0
while kill -0 "$V8_PID" 2>/dev/null; do
  sleep 30
  poll=$((poll + 1))
  if (( poll % 20 == 0 )); then
    echo "still waiting for v8 pid $V8_PID ($(date -u +%Y-%m-%dT%H:%M:%SZ), poll=$poll)" || true
  fi
done
echo "v8 finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== discourse v8 recall ==="
cat /tmp/discourse-flow-recall-v8.log
echo "=== starting scorecard ==="
pnpm run benchmark:scorecard -- --concurrency=3 --write-report tests/benchmark/reports/scorecard-fix-data-items-recall-60.json
echo "scorecard done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
