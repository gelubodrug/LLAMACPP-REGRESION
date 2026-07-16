#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${CACHE_DIR:-$ROOT/.benchmark-cache}"
NODE_BIN="${NODE_BIN:-node}"
BACKEND="${BACKEND:-metal}"
MODE="${MODE:-auto}"
ROUNDS="${ROUNDS:-3}"
CONTEXT="${CONTEXT:-262144}"
MAX_TOKENS="${MAX_TOKENS:-256}"
PORT="${PORT:-18081}"
COOLDOWN_MS="${COOLDOWN_MS:-5000}"
IMAGE="${IMAGE:-$ROOT/fixtures/vision.png}"
PROMPT="${PROMPT:-$CACHE_DIR/fixtures/public-prompt.txt}"

for command_name in git cmake "$NODE_BIN"; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command not found: $command_name" >&2
    exit 1
  }
done

node_major="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  echo "Node.js 22 or newer is required; found $($NODE_BIN --version)" >&2
  exit 1
fi

if [[ -z "${MODEL:-}" ]]; then
  MODEL="$(find -L "$HOME/.cache/huggingface/hub" -type f \
    -path '*Qwen3.6-35B-A3B-MTP-GGUF*' -name '*UD-Q4_K_XL.gguf' \
    -print -quit 2>/dev/null || true)"
fi

if [[ -z "${MMPROJ:-}" ]]; then
  MMPROJ="$(find -L "$HOME/.cache/huggingface/hub" -type f \
    -path '*Qwen3.6-35B-A3B-MTP-GGUF*' -name 'mmproj-*.gguf' \
    -print -quit 2>/dev/null || true)"
fi

if [[ -z "$MODEL" || ! -f "$MODEL" ]]; then
  echo 'MODEL must point to a local Qwen3.6 MTP GGUF.' >&2
  exit 1
fi

if [[ -z "$MMPROJ" || ! -f "$MMPROJ" ]]; then
  echo 'MMPROJ must point to the matching vision projector GGUF.' >&2
  exit 1
fi

if [[ ! -f "$IMAGE" ]]; then
  echo "IMAGE does not exist: $IMAGE" >&2
  exit 1
fi

mkdir -p "$CACHE_DIR/fixtures"
if [[ ! -f "$PROMPT" ]]; then
  echo "Generating deterministic public prompt: $PROMPT"
  {
    for ((index = 1; index <= 850; index += 1)); do
      printf 'Benchmark context block %04d: inspect deterministic runtime behavior, memory accounting, request scheduling, image encoding, speculative draft generation, acceptance, and post-vision continuity.\n' "$index"
    done
  } > "$PROMPT"
fi

args=(
  --backend "$BACKEND"
  --cache-dir "$CACHE_DIR"
  --manifest "$ROOT/tools/commits.json"
  --mode "$MODE"
  --rounds "$ROUNDS"
  --max-tokens "$MAX_TOKENS"
  --context "$CONTEXT"
  --port "$PORT"
  --cooldown-ms "$COOLDOWN_MS"
  --prompt-file "$PROMPT"
  --model "$MODEL"
  --mmproj "$MMPROJ"
  --image "$IMAGE"
)

if [[ -n "${ONLY:-}" ]]; then
  args+=(--only "$ONLY")
fi

mkdir -p "$CACHE_DIR"
printf 'Running:'
printf ' %q' "$NODE_BIN" --experimental-strip-types "$ROOT/tools/llama-mtp-benchmark.ts" "${args[@]}"
printf '\n\n'

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  exit 0
fi

"$NODE_BIN" --experimental-strip-types "$ROOT/tools/llama-mtp-benchmark.ts" "${args[@]}" \
  2>&1 | tee -a "$CACHE_DIR/benchmark.log"
