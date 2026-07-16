# llama.cpp MTP + vision regression benchmark

Reproducible headless benchmark for comparing llama.cpp commits with
Qwen3.6-35B-A3B-MTP, an `mmproj` vision projector, and MTP speculative decoding
enabled in the same server process.

## Published result

The included run completed 153/153 requests successfully:

- 17 llama.cpp commits
- 3 rotating rounds
- 3 cases per round: text, vision, and text after vision

| Result | Commit | Git date (CEST) | Mean median eval speed |
|---|---|---|---:|
| Best aggregate | `57fe1f07c3b6` (`b9620`) | 2026-06-13 11:51 | 95.95 tok/s |
| Slowest aggregate | `b11f7c16bc1c` | 2026-06-26 08:43 | 75.35 tok/s |

On this Apple Silicon workload, `b9620` was 27.34% faster than the slowest
tested commit. Read [reports/REPORT.md](reports/REPORT.md) for the interpretation
and [reports/summary.md](reports/summary.md) for every aggregate result.

## Requirements

- macOS on Apple Silicon for Metal, or Linux with NVIDIA CUDA
- Git and CMake
- Node.js 22 or newer
- A local Qwen3.6-35B-A3B-MTP GGUF
- Its matching `mmproj` GGUF
- Enough unified memory for the selected model and context

The model is not included in this repository.

NVIDIA/Linux users should use [`CUDA/run.sh`](CUDA/run.sh). The shared runner
supports Metal, CUDA, and CPU builds without mixing their build or result
caches.

## Run

Pass the model and projector paths:

```bash
MODEL="/absolute/path/to/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf" \
MMPROJ="/absolute/path/to/mmproj-BF16.gguf" \
./run.sh
```

The equivalent npm entry point is `npm run benchmark`; there are no package
dependencies to install.

`run.sh` searches the standard Hugging Face cache when `MODEL` or `MMPROJ` is
not supplied. It generates a deterministic public prompt fixture and uses
`fixtures/vision.png` by default.

Useful overrides:

```bash
DRY_RUN=1 ./run.sh
MODE=anchors ROUNDS=1 ONLY=b9620 ./run.sh
IMAGE="/path/to/image.png" PROMPT="/path/to/prompt.txt" ./run.sh
CONTEXT=65536 MAX_TOKENS=128 PORT=18082 ./run.sh
```

The canonical full scan is:

```bash
MODE=auto ROUNDS=3 CONTEXT=262144 MAX_TOKENS=256 ./run.sh
```

Press `Ctrl+C` once to checkpoint and stop cleanly. Run the same command again
to resume; completed cases are skipped. Do not run two benchmarks on the same
port or at the same time on one machine.

## Monitor

In a second terminal:

```bash
./monitor.sh
```

The monitor is read-only. Its `Ctrl+C` closes only the monitor.

## Result files

- `reports/summary.csv`: 51 aggregate rows, one median per commit and case
- `reports/samples.csv`: all 153 individual measured requests
- `reports/samples.json`: canonical machine-readable samples
- `reports/raw/`: 153 llama.cpp timing logs, one per successful request
- `reports/REPORT.md`: standalone publication draft and conclusions

No model outputs, model weights, credentials, API keys, or private prompt
contents are included.

## Methodology note

The published run used a fixed local source-code prompt of approximately 29K
tokens. That prompt is not distributed here. The public launcher creates a
deterministic prompt of similar size so anyone can run the same protocol without
receiving private source. Supply `PROMPT=/path/to/file` when comparing against a
specific workload. Results from different prompt fixtures should be treated as
separate benchmark configurations; the runner fingerprints each configuration
to prevent accidental mixing.

Ranking is the mean of the three per-case median eval speeds. Always inspect
draft acceptance, TTFT, and raw logs before declaring a universal winner.
