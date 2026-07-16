#!/usr/bin/env bash

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${CACHE_DIR:-$ROOT/.benchmark-cache}"
LOG_FILE="$CACHE_DIR/benchmark.log"
SAMPLES_FILE="$CACHE_DIR/results/samples.json"
RESULTS_FILE="$CACHE_DIR/results/summary.md"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "Benchmark log not found: $LOG_FILE" >&2
  exit 1
fi

for command_name in jq grep; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required monitor command not found: $command_name" >&2
    exit 1
  }
done

benchmark_key() {
  sed -n 's/^Benchmark key: //p' "$LOG_FILE" | tail -n 1
}

current_winner() {
  local key="$1"
  jq -r --arg key "$key" '
    def median:
      sort as $values
      | ($values | length) as $count
      | if $count == 0 then null
        elif ($count % 2) == 1 then $values[($count / 2 | floor)]
        else (($values[$count / 2 - 1] + $values[$count / 2]) / 2)
        end;
    [.[] | select(.benchmarkKey == $key and .success == true and (.evalTokensPerSecond != null))]
    | group_by(.commit)
    | map({
        commit: .[0].commit,
        score: (group_by(.caseName) | map(map(.evalTokensPerSecond) | median) | add / length)
      })
    | sort_by(.score) | reverse
    | if length == 0 then "waiting for measured samples"
      else "\(.[0].commit[0:12]) (\(.[0].score * 100 | round / 100) mean median eval tok/s)"
      end
  ' "$SAMPLES_FILE" 2>/dev/null
}

while true; do
  key="$(benchmark_key)"
  complete="$(jq -r --arg key "$key" '[.[] | select(.benchmarkKey == $key and .success == true)] | length' "$SAMPLES_FILE" 2>/dev/null)"
  winner="$(current_winner "$key")"

  if pgrep -f 'node .*llama-mtp-benchmark\.ts' >/dev/null; then
    status='RUNNING'
    color='\033[32m'
  else
    status='STOPPED OR COMPLETE'
    color='\033[33m'
  fi

  printf '\033[2J\033[H'
  printf '\033[1mllama.cpp MTP + vision benchmark\033[0m\n\n'
  printf 'Status:  %b%s\033[0m\n' "$color" "$status"
  printf 'Run key: %s\n' "$key"
  printf 'Successful samples: %s\n\n' "$complete"
  printf '\033[1mCurrent winner:\033[0m %s\n\n' "$winner"
  printf '\033[1mCurrent step:\033[0m\n'
  grep -E 'Preparing worktree|configuring|building llama-server|loading model|r[0-9]+ (text|vision|post-vision)' "$LOG_FILE" 2>/dev/null | tail -n 10
  printf '\nResults: %s\n' "$RESULTS_FILE"
  printf 'Updated: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf '\nCtrl+C closes only this monitor.\n'
  sleep 2
done
