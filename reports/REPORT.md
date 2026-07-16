# llama.cpp MTP + vision regression benchmark report

## Result

The published run completed **153/153 requests** successfully across **17 llama.cpp commits**, **3 rotating rounds**, and **3 cases per round**: text, vision, and post-vision.

The best aggregate commit was `57fe1f07c3b6` (`b9620`) with **95.95 mean median eval tok/s**. The slowest aggregate commit was `b11f7c16bc1c` with **75.35 mean median eval tok/s**.

## Why the result is interesting

The aggregate winner was not the fastest commit in every individual case. The surprise is that `57fe1f07c3b6` won because it stayed fast after the vision turn.

| Case | Fastest commit | Median eval tok/s |
|---|---|---:|
| Text | `e9fb3b3fc030` | 90.00 |
| Vision | `6ee0f65793da` | 100.74 |
| Post-vision | `57fe1f07c3b6` | 99.24 |

For `57fe1f07c3b6`:

| Case | Median eval tok/s |
|---|---:|
| Text | 89.82 |
| Vision | 98.80 |
| Post-vision | 99.24 |
| Mean | 95.95 |

## Methodology

- Same Qwen3.6-35B-A3B-MTP GGUF model.
- Same matching `mmproj` vision projector.
- Same hardware.
- Same image: `fixtures/vision.png`.
- Same prompt fixture / benchmark key.
- Same output cap: 256 tokens.
- Temperature 0, seed 42, streaming enabled.

Server flags included:

```bash
--mmproj
-ngl 99
-c 262144
-fa on
--spec-type draft-mtp
--spec-draft-n-max 2
```

Ranking uses the mean of the three per-case median eval speeds: text, vision, and post-vision.

## Reproducibility

Run the canonical full scan with:

```bash
MODEL="/absolute/path/to/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf" \
MMPROJ="/absolute/path/to/mmproj-BF16.gguf" \
MODE=auto ROUNDS=3 CONTEXT=262144 MAX_TOKENS=256 \
./run.sh
```

The public runner can generate a deterministic public prompt fixture. For exact workload comparisons, provide your own prompt with `PROMPT=/path/to/file`.
