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

## Multi-GPU split modes

llama.cpp's default `layer` mode uses pipeline parallelism. It is the most
compatible choice and often favors prompt processing. The experimental
`tensor` mode uses tensor parallelism and can be faster for token generation
on multiple NVIDIA GPUs with a fast interconnect. Neither mode is universally
faster, so benchmark both on the same machine instead of assuming `layer` is
optimal.

For two identical GPUs, run the same protocol twice with isolated result
directories:

```bash
# Compatible baseline: pipeline parallelism
CACHE_DIR="$PWD/.benchmark-cache-layer" \
SPLIT_MODE=layer TENSOR_SPLIT=1,1 \
MODEL="/path/model.gguf" MMPROJ="/path/mmproj.gguf" ./run.sh

# Experimental: tensor parallelism
CACHE_DIR="$PWD/.benchmark-cache-tensor" \
SPLIT_MODE=tensor TENSOR_SPLIT=1,1 \
MODEL="/path/model.gguf" MMPROJ="/path/mmproj.gguf" ./run.sh
```

The runner already enables Flash Attention and disables auto-fit for tensor
mode. Tensor mode performs best when llama.cpp was built with NCCL available;
check the CMake/server logs for an NCCL warning. It is not implemented for
every model architecture, does not currently support every KV-cache option,
and may lose performance on a slow PCIe topology. If a historical commit does
not support `--split-mode tensor`, that commit cannot participate in the
tensor-mode comparison and its failure will be recorded.

See llama.cpp's official
[multi-GPU guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/multi-gpu.md)
for the current backend requirements and architecture limitations.

For unequal GPUs, set `TENSOR_SPLIT` to the intended proportions, such as
`3,1`. Always report split mode, tensor split, GPU models/VRAM, PCIe topology,
context, and whether NCCL was active with shared benchmark results.

Results are written under `CUDA/.benchmark-cache/results`. Press `Ctrl+C` once
to checkpoint; rerun the identical command to resume. From the `CUDA` folder,
monitor the run in a second terminal with:

```bash
CACHE_DIR="$PWD/.benchmark-cache" ../monitor.sh
```

Do not compare CUDA numbers directly with the included Apple Silicon results as
if they came from the same hardware. Compare commit ordering and regressions
within one fixed CUDA system and configuration.
