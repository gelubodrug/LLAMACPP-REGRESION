# CUDA benchmark preset

This preset runs the same commit selection, text/vision/post-vision protocol,
round rotation, checkpointing, and reports as the published Metal benchmark,
but builds every llama.cpp commit with `GGML_CUDA=ON`.

## Requirements

- Linux with an NVIDIA GPU and a working driver
- NVIDIA CUDA Toolkit with `nvcc` on `PATH`
- Git, CMake, `jq`, and Node.js 22 or newer
- The Qwen3.6-35B-A3B-MTP GGUF and matching `mmproj` GGUF
- Enough VRAM/RAM for the chosen quantization and context

The model files are not included.

## Run

```bash
cd CUDA
MODEL="/absolute/path/to/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf" \
MMPROJ="/absolute/path/to/mmproj-BF16.gguf" \
./run.sh
```

The default is the full comparable protocol: auto commit selection, three
rounds, 256 output tokens, and a 262144-token context. If that context does not
fit, lower it explicitly and report the changed value with your results:

```bash
CONTEXT=65536 MODEL="/path/model.gguf" MMPROJ="/path/mmproj.gguf" ./run.sh
```

Quick validation before a long run:

```bash
DRY_RUN=1 MODEL="/path/model.gguf" MMPROJ="/path/mmproj.gguf" ./run.sh
MODE=anchors ROUNDS=1 ONLY=b9620 CONTEXT=65536 \
  MODEL="/path/model.gguf" MMPROJ="/path/mmproj.gguf" ./run.sh
```

Results are written under `CUDA/.benchmark-cache/results`. Press `Ctrl+C` once
to checkpoint; rerun the identical command to resume. From the `CUDA` folder,
monitor the run in a second terminal with:

```bash
CACHE_DIR="$PWD/.benchmark-cache" ../monitor.sh
```

Do not compare CUDA numbers directly with the included Apple Silicon results as
if they came from the same hardware. Compare commit ordering and regressions
within one fixed CUDA system and configuration.
