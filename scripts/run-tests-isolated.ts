#!/usr/bin/env -S deno run -A
/*
 Run each test file in its own Deno process with a reset env and fresh temp dir.
 Useful to detect hidden inter-test coupling and env leakage.
*/

import { walk } from "jsr:@std/fs@^1.0.2/walk";

const ROOT = new URL("../tests/", import.meta.url).pathname;

const encoder = new TextEncoder();
function log(msg: string) { Deno.stdout.writeSync(encoder.encode(msg + "\n")); }
function err(msg: string) { Deno.stderr.writeSync(encoder.encode(msg + "\n")); }

// Discover test files and filter to common test naming patterns only
const files: string[] = [];
const TEST_FILE_RE = /(?:^|\/)\w+\.(?:test|spec)\.(?:ts|tsx)$|(?:^|\/)\w+_(?:test|spec)\.(?:ts|tsx)$/i;
for await (const e of walk(ROOT, { includeFiles: true, includeDirs: false, exts: [".ts", ".tsx"], followSymlinks: false })) {
  if (TEST_FILE_RE.test(e.path)) files.push(e.path);
}
files.sort();

const MAX_CONCURRENCY = Number(Deno.env.get("VF_ISO_TEST_JOBS") ?? 2);
let active = 0;
let index = 0;
let failed = false;

const DENO_CONFIG = new URL("../deno.json", import.meta.url).pathname;

async function runOne(path: string) {
  const tmp = await Deno.makeTempDir({ prefix: "vf-iso-" });
  // Reset key env vars for isolation
  const env: Record<string, string> = {
    TMPDIR: tmp,
    VERYFRONT_EXPERIMENTAL_RSC: "",
    VERYFRONT_DEBUG: "",
    VERYFRONT_OTEL: "",
    VERYFRONT_OTEL_BUILD: "",
  };
  log(`→ ${path}`);
  const quiet = (Deno.env.get("VF_ISO_QUIET") ?? "1") !== "0";
  const showPassed = (Deno.env.get("VF_ISO_SHOW_PASSED_OUTPUT") ?? "0") === "1";
  const isoLogLevel = Deno.env.get("VF_ISO_LOG_LEVEL");
  if (isoLogLevel) env.LOG_LEVEL = isoLogLevel;
  // default quiet: reduce deno's chatter
  const baseArgs = ["test", "-A", "-c", DENO_CONFIG];
  const args = quiet ? baseArgs.concat(["--quiet", path]) : baseArgs.concat([path]);
  // Per-file timeout with abort controller
  const timeoutMs = Number(Deno.env.get("VF_ISO_TEST_FILE_TIMEOUT_MS") ?? 180_000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort("timeout"), timeoutMs);
  let code = 0;
  let textOut = "";
  let textErr = "";
  try {
    const out = await new Deno.Command("deno", {
      args,
      env,
      stdout: "piped",
      stderr: "piped",
      signal: ac.signal as AbortSignal,
    }).output();
    code = out.code;
    textOut = new TextDecoder().decode(out.stdout ?? new Uint8Array());
    textErr = new TextDecoder().decode(out.stderr ?? new Uint8Array());
  } catch (e) {
    code = 124; // timeout/aborted
    const reason = (e && (e as any).name === "AbortError") ? `timeout ${timeoutMs}ms` : String((e as any)?.message || e);
    textErr = `[iso] test process aborted for ${path}: ${reason}`;
  } finally {
    clearTimeout(timer);
  }
  try { await Deno.remove(tmp, { recursive: true }); } catch (e) {
    err(`[iso] cleanup failed for ${tmp}: ${(e as any)?.message || String(e)}`);
  }
  if (code !== 0) {
    err(`✘ ${path}`);
    if (textOut) err(textOut.trim());
    if (textErr) err(textErr.trim());
    failed = true;
  } else {
    if (showPassed) {
      log(`✔ ${path}`);
      if (textOut.trim()) log(textOut.trim());
    } else {
      log(`✔ ${path}`);
    }
  }
}

async function pump(queue: string[], concurrency: number) {
  // Maintain a set of in-flight tasks that persists across iterations
  const inFlight = new Set<Promise<void>>();

  const startNext = () => {
    if (index >= queue.length || active >= concurrency) return false;
    const f = queue[index++]!;
    active++;
    const p: Promise<void> = (async () => {
      try {
        await runOne(f);
      } finally {
        active--;
      }
    })();
    inFlight.add(p);
    // Ensure we remove the exact promise when it settles
    p.finally(() => { inFlight.delete(p); });
    return true;
  };

  // Prime the pool
  while (startNext()) {/* fill up to concurrency */}

  // Drain until no tasks left and no more work to start
  while (inFlight.size > 0) {
    // Wait for at least one task to finish
    await Promise.race(inFlight);
    // Start more tasks if capacity allows
    while (startNext()) {/* keep pool full */}
  }
}

// Split into parallel-safe and serial tests. Server tests run serially to avoid port races across processes.
const parallelFiles = files.filter((f) => !f.includes("/tests/server/"));
const serialFiles = files.filter((f) => f.includes("/tests/server/"));

// Run parallel-safe tests with configured concurrency
index = 0; active = 0;
await pump(parallelFiles, MAX_CONCURRENCY);

// Run server tests serially
index = 0; active = 0;
await pump(serialFiles, 1);

if (failed) Deno.exit(1);
log("Isolated test run complete.");
Deno.exit(0);
