#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Anchor = { ref: string; label: string };
type Manifest = {
  repository: string;
  range: { start: string; end: string; stride: number };
  anchors: Anchor[];
};

type Mode = "anchors" | "scan" | "auto" | "list";
type Backend = "metal" | "cuda" | "cpu";
type SplitMode = "none" | "layer" | "row" | "tensor";
type CaseName = "text" | "vision" | "post-vision";

type Options = {
  backend: Backend;
  cacheDir: string;
  context: number;
  cooldownMs: number;
  image?: string;
  jobs: number;
  manifest: string;
  maxTokens: number;
  mmproj?: string;
  mode: Mode;
  model?: string;
  only?: string[];
  port: number;
  promptFile?: string;
  refineRadius: number;
  rounds: number;
  splitMode?: SplitMode;
  stride?: number;
  tensorSplit?: string;
  top: number;
};

type Candidate = {
  sha: string;
  shortSha: string;
  labels: string[];
};

type TimingMetrics = {
  draftAcceptance?: number;
  draftAccepted?: number;
  draftGenerated?: number;
  evalMs?: number;
  evalTokens?: number;
  evalTokensPerSecond?: number;
  promptMs?: number;
  promptTokens?: number;
  promptTokensPerSecond?: number;
};

type Sample = TimingMetrics & {
  benchmarkKey?: string;
  caseName: CaseName;
  commit: string;
  error?: string;
  httpStatus?: number;
  label: string;
  outputCharacters: number;
  round: number;
  success: boolean;
  totalMs: number;
  ttftMs?: number;
};

type SummaryRow = {
  caseName: CaseName;
  commit: string;
  label: string;
  medianAcceptance?: number;
  medianEvalTokensPerSecond?: number;
  medianTotalMs?: number;
  medianTtftMs?: number;
  samples: number;
  successfulSamples: number;
};

type ServerHandle = {
  child: ChildProcessWithoutNullStreams;
  getLog: () => string;
  logPath: string;
};

class PauseRequested extends Error {
  constructor(signal: NodeJS.Signals) {
    super(`Benchmark paused by ${signal}`);
    this.name = "PauseRequested";
  }
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = join(SCRIPT_DIR, "llama-mtp-benchmark.commits.json");
const DEFAULT_CACHE = join(homedir(), ".cache", "co_de", "llama-mtp-benchmark");
const DEFAULT_PROMPT = [
  "You are auditing a local inference runtime.",
  "Explain whether speculative decoding remains active and cite the strongest measurable evidence.",
  "Keep the answer technical and under 220 words.",
].join("\n");
let pauseSignal: NodeJS.Signals | undefined;
let activeProcess: ChildProcessWithoutNullStreams | undefined;

function requestPause(signal: NodeJS.Signals): void {
  if (pauseSignal) {
    activeProcess?.kill("SIGKILL");
    process.exit(130);
    return;
  }
  pauseSignal = signal;
  console.log(`\n${signal} received. Saving completed samples and stopping; rerun the same command to resume.`);
  activeProcess?.kill("SIGTERM");
}

process.on("SIGINT", () => requestPause("SIGINT"));
process.on("SIGTERM", () => requestPause("SIGTERM"));

function throwIfPaused(): void {
  if (pauseSignal) throw new PauseRequested(pauseSignal);
}

function usage(): never {
  console.log(`Usage:
  node --experimental-strip-types tools/llama-mtp-benchmark.ts [options]

Required for benchmark modes:
  --model PATH           Local Qwen3.6 MTP GGUF
  --mmproj PATH          Local vision projector GGUF
  --image PATH           Fixed image used for every vision request

Selection:
  --mode anchors         Test only known anchor commits (default)
  --mode scan            Anchors plus every Nth first-parent commit
  --mode auto            Scan, then refine around the fastest commits
  --mode list            Print resolved candidates without building
  --stride N             Override manifest scan stride
  --only REF[,REF...]    Test an explicit subset without editing the manifest
  --top N                Winners refined by auto mode (default: 2)
  --refine-radius N      First-parent commits on each side (default: 4)

Benchmark:
  --backend NAME        Build backend: metal, cuda, or cpu (default: metal)
  --rounds N             Rotating rounds per commit (default: 3)
  --prompt-file PATH     Stable text context shared by every request
  --max-tokens N         Completion cap (default: 256)
  --context N            llama-server context size (default: 262144)
  --port N               Local server port (default: 18081)
  --cooldown-ms N        Pause after each server run (default: 5000)
  --jobs N               Parallel compiler jobs (default: CPU count)
  --split-mode NAME      Multi-GPU split: none, layer, row, or tensor
  --tensor-split LIST    GPU proportions, for example 1,1
  --cache-dir PATH       Clone, builds, raw logs, CSV and Markdown
  --manifest PATH        Commit manifest JSON

Pause and resume:
  Press Ctrl+C once. Completed cases remain in samples.json; rerun the exact
  command and the runner skips them. Press Ctrl+C twice to force-stop.
  On macOS the runner also holds its own caffeinate assertion until it exits.

Environment aliases:
  LLAMA_BENCH_MODEL, LLAMA_BENCH_MMPROJ, LLAMA_BENCH_IMAGE,
  LLAMA_BENCH_BACKEND, LLAMA_BENCH_SPLIT_MODE, LLAMA_BENCH_TENSOR_SPLIT
`);
  process.exit(0);
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    backend: "metal",
    cacheDir: DEFAULT_CACHE,
    context: 262_144,
    cooldownMs: 5_000,
    jobs: Math.max(1, Number(process.env.NUMBER_OF_PROCESSORS) || 8),
    manifest: DEFAULT_MANIFEST,
    maxTokens: 256,
    mode: "anchors",
    port: 18_081,
    refineRadius: 4,
    rounds: 3,
    top: 2,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--help" || flag === "-h") usage();
    if (flag === "--model") options.model = value, index += 1;
    else if (flag === "--mmproj") options.mmproj = value, index += 1;
    else if (flag === "--image") options.image = value, index += 1;
    else if (flag === "--only") options.only = String(value).split(",").map((ref) => ref.trim()).filter(Boolean), index += 1;
    else if (flag === "--prompt-file") options.promptFile = value, index += 1;
    else if (flag === "--cache-dir") options.cacheDir = resolve(String(value)), index += 1;
    else if (flag === "--manifest") options.manifest = resolve(String(value)), index += 1;
    else if (flag === "--backend") {
      if (!value || !["metal", "cuda", "cpu"].includes(value)) {
        throw new Error("--backend must be metal, cuda, or cpu");
      }
      options.backend = value as Backend;
      index += 1;
    } else if (flag === "--mode") {
      if (!value || !["anchors", "scan", "auto", "list"].includes(value)) {
        throw new Error("--mode must be anchors, scan, auto, or list");
      }
      options.mode = value as Mode;
      index += 1;
    } else if (flag === "--split-mode") {
      if (!value || !["none", "layer", "row", "tensor"].includes(value)) {
        throw new Error("--split-mode must be none, layer, row, or tensor");
      }
      options.splitMode = value as SplitMode;
      index += 1;
    } else if (flag === "--tensor-split") {
      if (!value || !/^\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)+$/.test(value)) {
        throw new Error("--tensor-split requires comma-separated GPU proportions, for example 1,1");
      }
      options.tensorSplit = value;
      index += 1;
    } else if (flag === "--rounds") options.rounds = parsePositiveInt(value, flag), index += 1;
    else if (flag === "--stride") options.stride = parsePositiveInt(value, flag), index += 1;
    else if (flag === "--top") options.top = parsePositiveInt(value, flag), index += 1;
    else if (flag === "--refine-radius") options.refineRadius = parseNonNegativeInt(value, flag), index += 1;
    else if (flag === "--max-tokens") options.maxTokens = parsePositiveInt(value, flag), index += 1;
    else if (flag === "--context") options.context = parsePositiveInt(value, flag), index += 1;
    else if (flag === "--port") options.port = parsePositiveInt(value, flag), index += 1;
    else if (flag === "--cooldown-ms") options.cooldownMs = parseNonNegativeInt(value, flag), index += 1;
    else if (flag === "--jobs") options.jobs = parsePositiveInt(value, flag), index += 1;
    else throw new Error(`Unknown argument: ${flag}`);
  }

  options.model ??= process.env.LLAMA_BENCH_MODEL;
  options.mmproj ??= process.env.LLAMA_BENCH_MMPROJ;
  options.image ??= process.env.LLAMA_BENCH_IMAGE;
  if (process.env.LLAMA_BENCH_BACKEND && options.backend === "metal") {
    const backend = process.env.LLAMA_BENCH_BACKEND;
    if (!["metal", "cuda", "cpu"].includes(backend)) {
      throw new Error("LLAMA_BENCH_BACKEND must be metal, cuda, or cpu");
    }
    options.backend = backend as Backend;
  }
  if (process.env.LLAMA_BENCH_SPLIT_MODE && !options.splitMode) {
    const splitMode = process.env.LLAMA_BENCH_SPLIT_MODE;
    if (!["none", "layer", "row", "tensor"].includes(splitMode)) {
      throw new Error("LLAMA_BENCH_SPLIT_MODE must be none, layer, row, or tensor");
    }
    options.splitMode = splitMode as SplitMode;
  }
  options.tensorSplit ??= process.env.LLAMA_BENCH_TENSOR_SPLIT;
  return options;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function command(commandName: string, args: string[], cwd?: string, capture = true): string {
  const result = spawnSync(commandName, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${commandName} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return String(result.stdout ?? "").trim();
}

async function loadManifest(path: string): Promise<Manifest> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as Manifest;
  if (!manifest.repository || !manifest.range?.start || !manifest.range?.end || !manifest.anchors?.length) {
    throw new Error(`Invalid manifest: ${path}`);
  }
  return manifest;
}

async function ensureRepository(cacheDir: string, repository: string): Promise<string> {
  const repoDir = join(cacheDir, "llama.cpp.git");
  await mkdir(cacheDir, { recursive: true });
  if (!(await exists(join(repoDir, "HEAD")))) {
    console.log(`Cloning llama.cpp history into ${repoDir}`);
    command("git", ["clone", "--bare", "--filter=blob:none", repository, repoDir], undefined, false);
  }
  command("git", ["fetch", "--force", "--tags", "origin", "+refs/heads/master:refs/heads/master"], repoDir, false);
  return repoDir;
}

function resolveCommit(repoDir: string, ref: string): string {
  return command("git", ["rev-parse", `${ref}^{commit}`], repoDir);
}

function firstParentHistory(repoDir: string, start: string, end: string): string[] {
  const startSha = resolveCommit(repoDir, start);
  const endSha = resolveCommit(repoDir, end);
  const range = command("git", ["rev-list", "--first-parent", "--reverse", `${startSha}..${endSha}`], repoDir)
    .split("\n")
    .filter(Boolean);
  return [startSha, ...range];
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const bySha = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const current = bySha.get(candidate.sha);
    if (current) current.labels.push(...candidate.labels.filter((label) => !current.labels.includes(label)));
    else bySha.set(candidate.sha, { ...candidate, labels: [...candidate.labels] });
  }
  return [...bySha.values()];
}

function anchorCandidates(repoDir: string, manifest: Manifest): Candidate[] {
  return manifest.anchors.map((anchor) => {
    const sha = resolveCommit(repoDir, anchor.ref);
    return { sha, shortSha: sha.slice(0, 12), labels: [anchor.label, anchor.ref] };
  });
}

function scanCandidates(repoDir: string, manifest: Manifest, stride: number): Candidate[] {
  const history = firstParentHistory(repoDir, manifest.range.start, manifest.range.end);
  const sampled = history.filter((_, index) => index % stride === 0 || index === history.length - 1);
  return sampled.map((sha, index) => ({
    sha,
    shortSha: sha.slice(0, 12),
    labels: [`scan-${index}`],
  }));
}

function refineCandidates(repoDir: string, manifest: Manifest, winners: string[], radius: number): Candidate[] {
  const history = firstParentHistory(repoDir, manifest.range.start, manifest.range.end);
  const candidates: Candidate[] = [];
  for (const winner of winners) {
    const index = history.indexOf(winner);
    if (index < 0) continue;
    for (let cursor = Math.max(0, index - radius); cursor <= Math.min(history.length - 1, index + radius); cursor += 1) {
      const sha = history[cursor];
      candidates.push({ sha, shortSha: sha.slice(0, 12), labels: [`refine-${winner.slice(0, 8)}`] });
    }
  }
  return dedupeCandidates(candidates);
}

async function runLogged(
  commandName: string,
  args: string[],
  cwd: string | undefined,
  logPath: string,
): Promise<void> {
  throwIfPaused();
  const child = spawn(commandName, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  activeProcess = child;
  let output = "";
  child.stdout.on("data", (chunk) => output += String(chunk));
  child.stderr.on("data", (chunk) => output += String(chunk));
  const status = await new Promise<number | null>((resolveStatus) => child.once("close", resolveStatus));
  if (activeProcess === child) activeProcess = undefined;
  await writeFile(logPath, output);
  throwIfPaused();
  if (status !== 0) throw new Error(`${commandName} failed; see ${logPath}`);
}

async function buildServer(
  repoDir: string,
  cacheDir: string,
  candidate: Candidate,
  jobs: number,
  backend: Backend,
): Promise<string> {
  const buildId = `${backend}-${candidate.shortSha}`;
  const buildDir = join(cacheDir, "builds", buildId);
  const binary = join(buildDir, "bin", "llama-server");
  if (await exists(binary)) return binary;

  const sourceDir = join(cacheDir, "worktrees", buildId);
  const logsDir = join(cacheDir, "logs");
  await mkdir(dirname(sourceDir), { recursive: true });
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  if (await exists(sourceDir)) {
    command("git", ["worktree", "remove", "--force", sourceDir], repoDir, false);
  }
  command("git", ["worktree", "add", "--detach", sourceDir, candidate.sha], repoDir, false);
  try {
    console.log(`[${candidate.shortSha}] configuring ${backend}`);
    const backendFlags = backend === "cuda"
      ? ["-DGGML_CUDA=ON", "-DGGML_METAL=OFF"]
      : backend === "metal"
        ? ["-DGGML_METAL=ON", "-DGGML_CUDA=OFF"]
        : ["-DGGML_METAL=OFF", "-DGGML_CUDA=OFF"];
    await runLogged("cmake", [
      "-S", sourceDir,
      "-B", buildDir,
      "-DCMAKE_BUILD_TYPE=Release",
      ...backendFlags,
      "-DLLAMA_CURL=ON",
      "-DLLAMA_BUILD_UI=OFF",
      "-DLLAMA_USE_PREBUILT_UI=OFF",
    ], undefined, join(logsDir, `${buildId}-configure.log`));

    console.log(`[${candidate.shortSha}] building llama-server`);
    await runLogged("cmake", ["--build", buildDir, "--config", "Release", "--target", "llama-server", "-j", String(jobs)],
      undefined, join(logsDir, `${buildId}-build.log`));
  } finally {
    command("git", ["worktree", "remove", "--force", sourceDir], repoDir, false);
  }
  if (!(await exists(binary))) throw new Error(`Build completed without ${binary}`);
  return binary;
}

function imageDataUrl(path: string, bytes: Buffer): string {
  const mime = new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".webp", "image/webp"],
  ]).get(extname(path).toLowerCase());
  if (!mime) throw new Error(`Unsupported benchmark image format: ${extname(path)}`);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function lastMatch(text: string, regex: RegExp): RegExpMatchArray | undefined {
  return [...text.matchAll(regex)].at(-1);
}

function parseTimings(log: string): TimingMetrics {
  const draft = lastMatch(log, /draft acceptance\s*=\s*([\d.]+)\s*\(\s*(\d+)\s+accepted\s*\/\s*(\d+)\s+generated\)/g);
  const evalTiming = lastMatch(log, /eval time\s*=\s*([\d.]+) ms\s*\/\s*(\d+) tokens.*?([\d.]+) tokens per second/g);
  const promptTiming = lastMatch(log, /prompt eval time\s*=\s*([\d.]+) ms\s*\/\s*(\d+) tokens.*?([\d.]+) tokens per second/g);
  return {
    draftAcceptance: draft ? Number(draft[1]) : undefined,
    draftAccepted: draft ? Number(draft[2]) : undefined,
    draftGenerated: draft ? Number(draft[3]) : undefined,
    evalMs: evalTiming ? Number(evalTiming[1]) : undefined,
    evalTokens: evalTiming ? Number(evalTiming[2]) : undefined,
    evalTokensPerSecond: evalTiming ? Number(evalTiming[3]) : undefined,
    promptMs: promptTiming ? Number(promptTiming[1]) : undefined,
    promptTokens: promptTiming ? Number(promptTiming[2]) : undefined,
    promptTokensPerSecond: promptTiming ? Number(promptTiming[3]) : undefined,
  };
}

async function refreshMetricsFromRawLogs(cacheDir: string, samples: Sample[]): Promise<Sample[]> {
  return Promise.all(samples.map(async (sample) => {
    const rawDir = sample.benchmarkKey
      ? join(cacheDir, "results", "raw", sample.benchmarkKey)
      : join(cacheDir, "results", "raw");
    const logPath = join(rawDir, `${sample.commit.slice(0, 12)}-r${sample.round}-${sample.caseName}.log`);
    if (!(await exists(logPath))) return sample;
    return { ...sample, ...parseTimings(await readFile(logPath, "utf8")) };
  }));
}

async function waitForServer(port: number, child: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`llama-server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Model loading is still in progress.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error("Timed out waiting for llama-server health");
}

async function startServer(
  binary: string,
  candidate: Candidate,
  options: Options,
  logPath: string,
): Promise<ServerHandle> {
  const args = [
    "-m", String(options.model),
    "--mmproj", String(options.mmproj),
    "-ngl", "99",
    "-c", String(options.context),
    "-fa", "on",
    "-np", "1",
    "--spec-type", "draft-mtp",
    "--spec-draft-n-max", "2",
    "--host", "127.0.0.1",
    "--port", String(options.port),
  ];
  if (options.splitMode) args.push("--split-mode", options.splitMode);
  if (options.tensorSplit) args.push("--tensor-split", options.tensorSplit);
  if (options.splitMode === "tensor") args.push("--fit", "off");
  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  activeProcess = child;
  let log = "";
  child.stdout.on("data", (chunk) => log += String(chunk));
  child.stderr.on("data", (chunk) => log += String(chunk));
  child.once("close", () => void writeFile(logPath, log));
  console.log(`[${candidate.shortSha}] loading model`);
  try {
    await waitForServer(options.port, child);
  } catch (error) {
    if (activeProcess === child) activeProcess = undefined;
    throwIfPaused();
    throw error;
  }
  return { child, getLog: () => log, logPath };
}

async function stopServer(server: ServerHandle): Promise<void> {
  if (server.child.exitCode === null) {
    server.child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveClose) => server.child.once("close", resolveClose)),
      new Promise((resolveWait) => setTimeout(resolveWait, 10_000)),
    ]);
  }
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
  if (activeProcess === server.child) activeProcess = undefined;
  await writeFile(server.logPath, server.getLog());
}

function benchmarkMessages(caseName: CaseName, prompt: string, imageUrl: string, round: number): unknown[] {
  const system = `${prompt}\n\nBenchmark nonce: ${caseName}-${round}.`;
  if (caseName === "text") {
    return [{ role: "system", content: system }, { role: "user", content: "Analyze MTP behavior for this text-only turn." }];
  }
  const imageTurn = {
    role: "user",
    content: [
      { type: "text", text: "Describe the attached benchmark image and identify the most relevant technical evidence." },
      { type: "image_url", image_url: { url: imageUrl } },
    ],
  };
  if (caseName === "vision") return [{ role: "system", content: system }, imageTurn];
  return [
    { role: "system", content: system },
    imageTurn,
    { role: "assistant", content: "The image contains a local inference configuration and measured runtime evidence." },
    { role: "user", content: "Now give a text-only conclusion about whether MTP remained active after the image." },
  ];
}

async function streamCompletion(port: number, body: Record<string, unknown>): Promise<{
  httpStatus: number;
  output: string;
  totalMs: number;
  ttftMs?: number;
}> {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status}: ${detail.slice(0, 1_000)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let ttftMs: number | undefined;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trimStart();
      if (payload === "[DONE]") continue;
      const event = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
      };
      const delta = event.choices?.[0]?.delta;
      const text = delta?.content ?? delta?.reasoning_content ?? "";
      if (text && ttftMs === undefined) ttftMs = performance.now() - started;
      output += text;
    }
  }
  return { httpStatus: response.status, output, totalMs: performance.now() - started, ttftMs };
}

async function runSample(
  server: ServerHandle,
  candidate: Candidate,
  caseName: CaseName,
  round: number,
  options: Options,
  prompt: string,
  imageUrl: string,
  rawDir: string,
  benchmarkKey: string,
): Promise<Sample> {
  const logStart = server.getLog().length;
  const label = candidate.labels.join("+");
  try {
    const completion = await streamCompletion(options.port, {
      model: "benchmark",
      messages: benchmarkMessages(caseName, prompt, imageUrl, round),
      max_tokens: options.maxTokens,
      temperature: 0,
      seed: 42,
      stream: true,
      cache_prompt: false,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const logSegment = server.getLog().slice(logStart);
    const metrics = parseTimings(logSegment);
    await writeFile(join(rawDir, `${candidate.shortSha}-r${round}-${caseName}.log`), logSegment);
    await writeFile(join(rawDir, `${candidate.shortSha}-r${round}-${caseName}.txt`), completion.output);
    return {
      ...metrics,
      benchmarkKey,
      caseName,
      commit: candidate.sha,
      httpStatus: completion.httpStatus,
      label,
      outputCharacters: completion.output.length,
      round,
      success: true,
      totalMs: completion.totalMs,
      ttftMs: completion.ttftMs,
    };
  } catch (error) {
    const logSegment = server.getLog().slice(logStart);
    await writeFile(join(rawDir, `${candidate.shortSha}-r${round}-${caseName}-failed.log`), logSegment);
    throwIfPaused();
    return {
      caseName,
      commit: candidate.sha,
      error: error instanceof Error ? error.message : String(error),
      label,
      outputCharacters: 0,
      round,
      success: false,
      totalMs: 0,
    };
  }
}

function median(values: Array<number | undefined>): number | undefined {
  const sorted = values.filter((value): value is number => value !== undefined && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function recordSample(samples: Sample[], sample: Sample): void {
  const existing = samples.findIndex((current) =>
    current.benchmarkKey === sample.benchmarkKey &&
    current.commit === sample.commit &&
    current.round === sample.round &&
    current.caseName === sample.caseName
  );
  if (existing >= 0) samples.splice(existing, 1, sample);
  else samples.push(sample);
}

function summarize(samples: Sample[]): SummaryRow[] {
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    const key = `${sample.commit}:${sample.caseName}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.values()].map((group) => {
    const successful = group.filter((sample) => sample.success);
    return {
      caseName: group[0].caseName,
      commit: group[0].commit,
      label: group[0].label,
      medianAcceptance: median(successful.map((sample) => sample.draftAcceptance)),
      medianEvalTokensPerSecond: median(successful.map((sample) => sample.evalTokensPerSecond)),
      medianTotalMs: median(successful.map((sample) => sample.totalMs)),
      medianTtftMs: median(successful.map((sample) => sample.ttftMs)),
      samples: group.length,
      successfulSamples: successful.length,
    };
  });
}

function commitScores(rows: SummaryRow[]): Map<string, number> {
  const scores = new Map<string, number[]>();
  for (const row of rows) {
    if (row.successfulSamples && row.medianEvalTokensPerSecond !== undefined) {
      scores.set(row.commit, [...(scores.get(row.commit) ?? []), row.medianEvalTokensPerSecond]);
    }
  }
  return new Map([...scores].map(([sha, values]) => [sha, values.reduce((sum, value) => sum + value, 0) / values.length]));
}

function csvCell(value: unknown): string {
  if (value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeReports(
  cacheDir: string,
  samples: Sample[],
  benchmarkKey: string,
  backend: Backend,
): Promise<SummaryRow[]> {
  const resultsDir = join(cacheDir, "results");
  await mkdir(resultsDir, { recursive: true });
  const activeSamples = samples.filter((sample) => sample.benchmarkKey === benchmarkKey);
  const rows = summarize(activeSamples);
  const fields: Array<keyof SummaryRow> = [
    "commit", "label", "caseName", "samples", "successfulSamples", "medianEvalTokensPerSecond",
    "medianAcceptance", "medianTtftMs", "medianTotalMs",
  ];
  const csv = [fields.join(","), ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(","))].join("\n") + "\n";
  await writeFile(join(resultsDir, "summary.csv"), csv);
  const sampleFields: Array<keyof Sample> = [
    "benchmarkKey", "commit", "label", "round", "caseName", "success", "error", "httpStatus",
    "evalTokensPerSecond", "evalTokens", "evalMs", "draftAcceptance", "draftAccepted", "draftGenerated",
    "promptTokensPerSecond", "promptTokens", "promptMs", "ttftMs", "totalMs", "outputCharacters",
  ];
  const sampleCsv = [
    sampleFields.join(","),
    ...activeSamples.map((sample) => sampleFields.map((field) => csvCell(sample[field])).join(",")),
  ].join("\n") + "\n";
  await writeFile(join(resultsDir, "samples.csv"), sampleCsv);
  await writeFile(join(resultsDir, "samples.json"), JSON.stringify(samples, null, 2) + "\n");

  const scores = commitScores(rows);
  const ranking = [...scores].sort((a, b) => b[1] - a[1]);
  const markdown = [
    "# llama.cpp MTP + vision benchmark",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Platform: ${platform()}`,
    `Backend: ${backend}`,
    `Benchmark key: \`${benchmarkKey}\``,
    "",
    "| rank | commit | mean median eval tok/s |",
    "|---:|---|---:|",
    ...ranking.map(([sha, score], index) => `| ${index + 1} | \`${sha.slice(0, 12)}\` | ${score.toFixed(2)} |`),
    "",
    "| commit | case | median eval tok/s | median acceptance | median TTFT ms | success |",
    "|---|---|---:|---:|---:|---:|",
    ...rows.map((row) => `| \`${row.commit.slice(0, 12)}\` | ${row.caseName} | ${row.medianEvalTokensPerSecond?.toFixed(2) ?? "-"} | ${row.medianAcceptance?.toFixed(4) ?? "-"} | ${row.medianTtftMs?.toFixed(0) ?? "-"} | ${row.successfulSamples}/${row.samples} |`),
    "",
    "Ranking uses the mean of each case's median llama.cpp eval throughput. Inspect acceptance, TTFT and raw logs before declaring a winner.",
    "",
  ].join("\n");
  await writeFile(join(resultsDir, "summary.md"), markdown);
  return rows;
}

async function benchmarkCandidates(
  repoDir: string,
  candidates: Candidate[],
  options: Options,
  prompt: string,
  imageUrl: string,
  existingSamples: Sample[],
  benchmarkKey: string,
): Promise<Sample[]> {
  const samples = [...existingSamples];
  const rawDir = join(options.cacheDir, "results", "raw", benchmarkKey);
  const serverLogs = join(options.cacheDir, "logs", benchmarkKey);
  await mkdir(rawDir, { recursive: true });
  await mkdir(serverLogs, { recursive: true });
  const unbuildable = new Set<string>();

  for (let round = 1; round <= options.rounds; round += 1) {
    const order = [...candidates.slice(round - 1), ...candidates.slice(0, round - 1)];
    for (const candidate of order) {
      throwIfPaused();
      if (unbuildable.has(candidate.sha)) continue;
      const completedCases = new Set(
        samples
          .filter((sample) =>
            sample.benchmarkKey === benchmarkKey &&
            sample.commit === candidate.sha &&
            sample.round === round &&
            sample.success
          )
          .map((sample) => sample.caseName),
      );
      if (completedCases.size === 3) continue;
      let binary: string;
      try {
        binary = await buildServer(repoDir, options.cacheDir, candidate, options.jobs, options.backend);
      } catch (error) {
        throwIfPaused();
        const message = `Build failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[${candidate.shortSha}] ${message}`);
        unbuildable.add(candidate.sha);
        for (const caseName of ["text", "vision", "post-vision"] as const) {
          recordSample(samples, {
            benchmarkKey,
            caseName,
            commit: candidate.sha,
            error: message,
            label: candidate.labels.join("+"),
            outputCharacters: 0,
            round,
            success: false,
            totalMs: 0,
          });
        }
        await writeReports(options.cacheDir, samples, benchmarkKey, options.backend);
        continue;
      }
      let server: ServerHandle;
      try {
        server = await startServer(binary, candidate, options, join(serverLogs, `${candidate.shortSha}-r${round}-server.log`));
      } catch (error) {
        throwIfPaused();
        const message = `Server failed to start: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[${candidate.shortSha}] ${message}`);
        unbuildable.add(candidate.sha);
        for (const caseName of ["text", "vision", "post-vision"] as const) {
          if (completedCases.has(caseName)) continue;
          recordSample(samples, {
            benchmarkKey,
            caseName,
            commit: candidate.sha,
            error: message,
            label: candidate.labels.join("+"),
            outputCharacters: 0,
            round,
            success: false,
            totalMs: 0,
          });
        }
        await writeReports(options.cacheDir, samples, benchmarkKey, options.backend);
        continue;
      }
      try {
        for (const caseName of ["text", "vision", "post-vision"] as const) {
          if (completedCases.has(caseName)) continue;
          const sample = await runSample(server, candidate, caseName, round, options, prompt, imageUrl, rawDir, benchmarkKey);
          recordSample(samples, sample);
          console.log(
            `[${candidate.shortSha}] r${round} ${caseName}: ` +
            `${sample.evalTokensPerSecond?.toFixed(2) ?? "-"} tok/s, ` +
            `accept ${sample.draftAcceptance?.toFixed(3) ?? "-"}`,
          );
          await writeReports(options.cacheDir, samples, benchmarkKey, options.backend);
          throwIfPaused();
        }
      } finally {
        await stopServer(server);
      }
      if (options.cooldownMs) await new Promise((resolveWait) => setTimeout(resolveWait, options.cooldownMs));
    }
  }
  return samples;
}

function benchmarkKey(options: Options, prompt: string): string {
  return createHash("sha256").update(JSON.stringify({
    backend: options.backend,
    context: options.context,
    image: resolve(String(options.image)),
    maxTokens: options.maxTokens,
    mmproj: resolve(String(options.mmproj)),
    model: resolve(String(options.model)),
    prompt,
    protocol: 1,
    splitMode: options.splitMode,
    tensorSplit: options.tensorSplit,
  })).digest("hex").slice(0, 12);
}

async function validateInputs(options: Options): Promise<void> {
  if (options.mode === "list") return;
  if (options.splitMode === "tensor" && options.backend !== "cuda") {
    throw new Error("--split-mode tensor is supported by this benchmark preset only with --backend cuda");
  }
  if (options.tensorSplit && !options.splitMode) {
    throw new Error("--tensor-split requires --split-mode so the benchmark configuration is explicit");
  }
  if (options.tensorSplit && !/^\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)+$/.test(options.tensorSplit)) {
    throw new Error("tensor split requires comma-separated GPU proportions, for example 1,1");
  }
  const required = [["--model", options.model], ["--mmproj", options.mmproj], ["--image", options.image]] as const;
  for (const [flag, path] of required) {
    if (!path) throw new Error(`${flag} is required outside list mode`);
    if (!(await exists(path))) throw new Error(`${flag} path does not exist: ${path}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (platform() === "darwin") {
    const assertion = spawn("/usr/bin/caffeinate", ["-imsu", "-w", String(process.pid)], {
      stdio: "ignore",
    });
    assertion.unref();
    console.log(`Sleep prevention active for benchmark PID ${process.pid}`);
  }
  await validateInputs(options);
  const manifest = await loadManifest(options.manifest);
  const repoDir = await ensureRepository(options.cacheDir, manifest.repository);
  const anchors = anchorCandidates(repoDir, manifest);
  const stride = options.stride ?? manifest.range.stride;
  let candidates = options.mode === "anchors"
    ? anchors
    : dedupeCandidates([...anchors, ...scanCandidates(repoDir, manifest, stride)]);
  if (options.only?.length) {
    candidates = dedupeCandidates(options.only.map((ref) => {
      const sha = resolveCommit(repoDir, ref);
      return { sha, shortSha: sha.slice(0, 12), labels: [`explicit-${ref}`] };
    }));
  }

  if (options.mode === "list") {
    for (const candidate of candidates) console.log(`${candidate.sha}  ${candidate.labels.join(", ")}`);
    return;
  }

  const prompt = options.promptFile ? await readFile(options.promptFile, "utf8") : DEFAULT_PROMPT;
  const imageUrl = imageDataUrl(String(options.image), await readFile(String(options.image)));
  const runKey = benchmarkKey(options, prompt);
  console.log(`Backend: ${options.backend}`);
  console.log(`Model: ${basename(String(options.model))}`);
  console.log(`Projector: ${basename(String(options.mmproj))}`);
  console.log(`Image: ${basename(String(options.image))}`);
  console.log(`Split mode: ${options.splitMode ?? "llama.cpp default"}${options.tensorSplit ? `; tensor split: ${options.tensorSplit}` : ""}`);
  console.log(`Candidates: ${candidates.length}; rounds: ${options.rounds}`);
  console.log(`Benchmark key: ${runKey}`);

  let samples: Sample[] = [];
  const priorSamplesPath = join(options.cacheDir, "results", "samples.json");
  if (await exists(priorSamplesPath)) {
    samples = JSON.parse(await readFile(priorSamplesPath, "utf8")) as Sample[];
    samples = await refreshMetricsFromRawLogs(options.cacheDir, samples);
    await writeReports(options.cacheDir, samples, runKey, options.backend);
  }
  samples = await benchmarkCandidates(repoDir, candidates, options, prompt, imageUrl, samples, runKey);

  if (options.mode === "auto") {
    const scores = commitScores(await writeReports(options.cacheDir, samples, runKey, options.backend));
    const winners = [...scores].sort((a, b) => b[1] - a[1]).slice(0, options.top).map(([sha]) => sha);
    const refinement = refineCandidates(repoDir, manifest, winners, options.refineRadius)
      .filter((candidate) => !candidates.some((existing) => existing.sha === candidate.sha));
    if (refinement.length) {
      console.log(`Refining ${refinement.length} commits around ${winners.map((sha) => sha.slice(0, 8)).join(", ")}`);
      samples = await benchmarkCandidates(repoDir, refinement, options, prompt, imageUrl, samples, runKey);
      candidates = dedupeCandidates([...candidates, ...refinement]);
    }
  }

  const rows = await writeReports(options.cacheDir, samples, runKey, options.backend);
  const ranking = [...commitScores(rows)].sort((a, b) => b[1] - a[1]);
  console.log(`\nResults: ${join(options.cacheDir, "results", "summary.md")}`);
  if (ranking[0]) console.log(`Current winner: ${ranking[0][0].slice(0, 12)} (${ranking[0][1].toFixed(2)} mean median eval tok/s)`);
}

main().catch(async (error) => {
  if (error instanceof PauseRequested) {
    console.log(`${error.message}. Rerun the same command to resume completed cases.`);
    process.exit(130);
  }
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
