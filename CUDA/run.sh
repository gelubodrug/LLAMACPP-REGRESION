#!/usr/bin/env bash

set -euo pipefail

CUDA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$CUDA_DIR/.." && pwd)"

if ! command -v nvcc >/dev/null 2>&1; then
  echo "CUDA compiler not found. Install the NVIDIA CUDA Toolkit and ensure nvcc is on PATH." >&2
  exit 1
fi

export BACKEND=cuda
export CACHE_DIR="${CACHE_DIR:-$CUDA_DIR/.benchmark-cache}"

exec "$ROOT/run.sh" "$@"
