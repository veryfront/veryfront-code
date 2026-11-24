import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

/** Resolved from this file, not the process cwd, which parallel tests may move. */
const REPO_ROOT = new URL("../../../", import.meta.url);
const ACTION_PATH = ".github/actions/fetch-denort/action.yml";
const LOCAL_ACTION = "./.github/actions/fetch-denort";
const WORKFLOWS_DIR = ".github/workflows";
const COMPILE_SCRIPT = "scripts/build/compile-binary.ts";
/**
 * Step commands that reach `deno compile`: the script itself, `deno task build`
 * (deno.json), and the binary e2e suite (tests/e2e/setup/binary.ts).
 */
const COMPILE_STEP =
  /scripts\/build\/compile-binary\.ts|\bdeno task build(?![\w:-])|test:e2e:binary/;
/** The deno.json tasks that run compile-binary.ts and COMPILE_STEP recognizes. */
const COMPILE_TASKS = ["build"];
/** What `deno compile` targets without --target on the x64 Ubuntu runners. */
const HOST_TARGET = "x86_64-unknown-linux-gnu";
/** setup-deno's worst case is 150s of retries plus one 120s attempt. */
const MIN_FETCH_STEP_MINUTES = 5;
const PIN_PATTERN = /denort_sha256="[0-9a-f]{64}"/g;

type YamlRecord = Record<string, unknown>;

function asRecord(value: unknown, context: string): YamlRecord {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context} must be an object`,
  );
  return value as YamlRecord;
}

function asSteps(value: unknown, context: string): YamlRecord[] {
  assert(Array.isArray(value), `${context} must be an array`);
  return value.map((step, index) => asRecord(step, `${context}[${index}]`));
}

function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL(path, REPO_ROOT));
}

async function parseYamlFile(path: string): Promise<YamlRecord> {
  return asRecord(parse(await readRepoFile(path)), path);
}

/** The Deno version `.tool-versions` pins. */
async function readPinnedDenoVersion(): Promise<string> {
  const match = (await readRepoFile(".tool-versions")).match(/^deno\s+(\S+)\s*$/m);
  assert(match?.[1], ".tool-versions must pin a deno version");
  return match[1];
}

async function fetchScript(): Promise<string> {
  const action = await parseYamlFile(ACTION_PATH);
  const steps = asSteps(asRecord(action.runs, "runs").steps, "runs.steps");
  const step = steps.find((entry) => entry.name === "Fetch pinned denort");
  assert(step, "fetch-denort must fetch denort in one named step");
  return String(step.run);
}

interface CompileJob {
  path: string;
  jobName: string;
  job: YamlRecord;
  steps: YamlRecord[];
  compileIndex: number;
}

/** Every workflow job that runs `deno compile` through compile-binary.ts. */
async function compileJobs(): Promise<CompileJob[]> {
  const found: CompileJob[] = [];
  for await (const entry of Deno.readDir(new URL(`${WORKFLOWS_DIR}/`, REPO_ROOT))) {
    if (!entry.isFile || !/\.ya?ml$/.test(entry.name)) continue;
    const path = `${WORKFLOWS_DIR}/${entry.name}`;
    const jobs = asRecord((await parseYamlFile(path)).jobs, `${path}.jobs`);
    for (const [jobName, value] of Object.entries(jobs)) {
      const job = asRecord(value, `${path}.jobs.${jobName}`);
      if (job.steps === undefined) continue;
      const steps = asSteps(job.steps, `${path}.jobs.${jobName}.steps`);
      steps.forEach((step, compileIndex) => {
        if (COMPILE_STEP.test(stepCommand(step))) {
          found.push({ path, jobName, job, steps, compileIndex });
        }
      });
    }
  }
  return found;
}

/** A step's shell command, whether in `run` or a retry action's `with.command`. */
function stepCommand(step: YamlRecord): string {
  if (step.run !== undefined) return String(step.run);
  const inputs = step.with as YamlRecord | undefined;
  return String(inputs?.command ?? "");
}

/** The --target a compile step passes, or the runner's own target without one. */
function compileTarget({ job, steps, compileIndex }: CompileJob): string {
  const command = stepCommand(steps[compileIndex]);
  const match = command.match(/--target\s+(\$\{\{.*?\}\}|\S+)/);
  if (match?.[1]) return match[1];
  const runsOn = String(job["runs-on"]);
  assert(
    /ubuntu/.test(runsOn) && !/arm/.test(runsOn),
    `a compile step without --target must run on an x64 Ubuntu runner: ${command}`,
  );
  return HOST_TARGET;
}

function matrixTargets(job: YamlRecord): string[] {
  const strategy = job.strategy as YamlRecord | undefined;
  const matrix = strategy?.matrix as YamlRecord | undefined;
  const include = matrix?.include;
  if (!Array.isArray(include)) return [];
  return include.map((entry) => String(asRecord(entry, "matrix entry").target));
}

/**
 * Stands in for curl with just enough of its retry semantics to decide whether
 * the committed argv survives a dropped connection: a transport error is only
 * retried under --retry-all-errors, and backoff advances a simulated clock
 * that --retry-max-time closes. Nothing touches the network.
 */
const CURL_STUB = `#!/usr/bin/env bash
set -uo pipefail
url=""; output=""; retries=0; retry_delay=0; retry_max_time=0; retry_all_errors=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --retry) retries="$2"; shift 2 ;;
    --retry-delay) retry_delay="$2"; shift 2 ;;
    --retry-max-time) retry_max_time="$2"; shift 2 ;;
    --retry-all-errors) retry_all_errors=1; shift ;;
    --output) output="$2"; shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
echo "\${url}" >> "\${VF_TEST_CURL_LOG}"
if [ "\${url}" != "https://dl.deno.land/release/v\${VF_TEST_VERSION}/denort-\${DENORT_TARGET}.zip" ]; then
  echo "curl stub: unexpected download of \${url}" >&2
  exit 1
fi
elapsed=0; attempt=0
while :; do
  attempt=$((attempt + 1))
  if [ "\${VF_TEST_FAULT_SECONDS}" != "forever" ] && [ "\${elapsed}" -ge "\${VF_TEST_FAULT_SECONDS}" ]; then
    printf '%s' "\${VF_TEST_BODY}" > "\${output}"
    exit 0
  fi
  if [ "\${retry_all_errors}" != "1" ]; then break; fi
  if [ "\${attempt}" -gt "\${retries}" ]; then break; fi
  elapsed=$((elapsed + retry_delay))
  if [ "\${retry_max_time}" -gt 0 ] && [ "\${elapsed}" -ge "\${retry_max_time}" ]; then break; fi
done
echo "curl: (56) error reading a body from connection" >&2
rm -f "\${output}"
exit 56
`;

const UNZIP_STUB = `#!/usr/bin/env bash
set -euo pipefail
dest=""; prev=""
for arg in "$@"; do
  if [ "\${prev}" = "-d" ]; then dest="\${arg}"; fi
  prev="\${arg}"
done
echo unzip >> "\${VF_TEST_CURL_LOG}"
printf 'stub-denort' > "\${dest}/denort"
printf 'stub-denort' > "\${dest}/denort.exe"
`;

const STUB_BODY = "stub-denort-archive-payload";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface FetchResult {
  code: number;
  stdout: string;
  stderr: string;
  githubEnv: string;
  calls: string[];
  denortBinExists: boolean;
}

/**
 * Runs the committed fetch script with curl and unzip stubbed. The only edit
 * is rewriting the pinned digests to the stub payload's digest, since no stub
 * can produce a preimage of a real pin; the comparison itself runs as written.
 */
async function runFetch(
  { target = "x86_64-unknown-linux-gnu", corrupt = false, faultSeconds = 0 }: {
    target?: string;
    corrupt?: boolean;
    faultSeconds?: number | "forever";
  } = {},
): Promise<FetchResult> {
  const root = await Deno.makeTempDir({ prefix: "fetch-denort-" });
  try {
    const bin = `${root}/bin`;
    await Deno.mkdir(bin);
    await Deno.mkdir(`${root}/runner-temp`);
    await Deno.writeTextFile(`${bin}/curl`, CURL_STUB, { mode: 0o755 });
    await Deno.writeTextFile(`${bin}/unzip`, UNZIP_STUB, { mode: 0o755 });
    await Deno.writeTextFile(`${root}/github-env`, "");
    await Deno.writeTextFile(`${root}/calls`, "");
    const script = (await fetchScript()).replaceAll(
      PIN_PATTERN,
      `denort_sha256="${await sha256Hex(STUB_BODY)}"`,
    );
    await Deno.writeTextFile(`${root}/fetch.sh`, script);
    await Deno.writeTextFile(
      `${root}/wrapper.sh`,
      [
        "#!/usr/bin/env bash",
        `export PATH="${bin}:\${PATH}"`,
        `export RUNNER_TEMP="${root}/runner-temp"`,
        `export GITHUB_ENV="${root}/github-env"`,
        `export DENORT_TARGET="${target}"`,
        `export VF_TEST_VERSION="${await readPinnedDenoVersion()}"`,
        `export VF_TEST_CURL_LOG="${root}/calls"`,
        `export VF_TEST_BODY="${corrupt ? "tampered-bytes" : STUB_BODY}"`,
        `export VF_TEST_FAULT_SECONDS="${faultSeconds}"`,
        `exec bash "${root}/fetch.sh"`,
        "",
      ].join("\n"),
    );
    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [`${root}/wrapper.sh`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const githubEnv = await Deno.readTextFile(`${root}/github-env`);
    const denortBin = githubEnv.match(/^DENORT_BIN=(.*)$/m)?.[1];
    let denortBinExists = false;
    if (denortBin) {
      denortBinExists = (await Deno.stat(denortBin)).isFile;
    }
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
      githubEnv,
      calls: (await Deno.readTextFile(`${root}/calls`)).split("\n").filter(Boolean),
      denortBinExists,
    };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

describe("deno compile base binary", () => {
  it("is pre-fetched with a retry budget before every compile step", async () => {
    const jobs = await compileJobs();
    assert(
      jobs.some((entry) => entry.jobName === "build-binaries"),
      "the release build-binaries job must be among the compile jobs",
    );
    for (const entry of jobs) {
      const { path, jobName, steps, compileIndex } = entry;
      const context = `${path} ${jobName}`;
      const fetchIndex = steps.findIndex((step) => step.uses === LOCAL_ACTION);
      // Without DENORT_BIN, deno compile downloads denort with no retry, and
      // one dropped connection fails the leg ("Setting up base binary").
      assert(
        fetchIndex !== -1 && fetchIndex < compileIndex,
        `${context} must run ${LOCAL_ACTION} before compiling`,
      );
      const fetch = steps[fetchIndex];
      assertEquals(
        asRecord(fetch.with, `${context} fetch-denort with`).target,
        compileTarget(entry),
        `${context} must fetch the denort for the target it compiles`,
      );
      const minutes = Number(fetch["timeout-minutes"]);
      assert(
        minutes >= MIN_FETCH_STEP_MINUTES,
        `${context} must bound the fetch step with timeout-minutes >= ${MIN_FETCH_STEP_MINUTES}`,
      );
    }
  });

  it("recognizes every compile path, not only the build-binaries job", async () => {
    const jobNames = new Set((await compileJobs()).map((entry) => entry.jobName));
    for (const jobName of ["build-binaries", "tests-proxy-binary", "tests-binary-e2e"]) {
      assert(jobNames.has(jobName), `${jobName} compiles a binary and must be checked`);
    }
    const config = JSON.parse(await readRepoFile("deno.json")) as {
      tasks: Record<string, string | { command?: string }>;
    };
    const compileTasks = Object.entries(config.tasks)
      .filter(([, task]) =>
        (typeof task === "string" ? task : task.command ?? "").includes(COMPILE_SCRIPT)
      )
      .map(([name]) => name);
    assertEquals(
      compileTasks,
      COMPILE_TASKS,
      "a new deno.json task that compiles must be recognized by COMPILE_STEP",
    );
  });

  it("pins a distinct digest for every target the workflows compile", async () => {
    const script = await fetchScript();
    const pins = script.match(PIN_PATTERN) ?? [];
    assertEquals(new Set(pins).size, pins.length, "denort pins must be distinct");
    const targets = new Set<string>();
    for (const entry of await compileJobs()) {
      const target = compileTarget(entry);
      if (target === "${{ matrix.target }}") {
        matrixTargets(entry.job).forEach((matrixTarget) => targets.add(matrixTarget));
      } else {
        targets.add(target);
      }
    }
    assert(targets.size > 0);
    for (const target of targets) {
      assertMatch(
        script,
        new RegExp(
          `^\\s*${target.replaceAll(".", "\\.")}\\)\\s*\\n\\s*denort_sha256="[0-9a-f]{64}"`,
          "m",
        ),
        `${ACTION_PATH} must pin the denort digest for ${target}`,
      );
    }
  });

  it("fetches the denort of the pinned Deno version", async () => {
    const script = await fetchScript();
    const versions = [...script.matchAll(/^\s*version="([^"]+)"$/gm)].map((m) => m[1]);
    assertEquals(versions, [await readPinnedDenoVersion()]);
  });

  it("exports a verified denort as DENORT_BIN", async () => {
    const result = await runFetch();
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(
      result.stdout,
      "denort-x86_64-unknown-linux-gnu.zip matches pinned SHA-256",
    );
    assertMatch(result.githubEnv, /^DENORT_BIN=.*\/denort$/m);
    assert(result.denortBinExists, "DENORT_BIN must name the extracted binary");
  });

  it("exports the .exe denort for Windows targets", async () => {
    const result = await runFetch({ target: "x86_64-pc-windows-msvc" });
    assertEquals(result.code, 0, result.stderr);
    assertMatch(result.githubEnv, /^DENORT_BIN=.*\/denort\.exe$/m);
    assert(result.denortBinExists);
  });

  it("retries through a dropped connection instead of failing the leg", async () => {
    const result = await runFetch({ faultSeconds: 120 });
    assertEquals(result.code, 0, result.stderr);
    assertMatch(result.githubEnv, /^DENORT_BIN=/m);
  });

  it("fails with a clear message when the download never recovers", async () => {
    const result = await runFetch({ faultSeconds: "forever" });
    assert(result.code !== 0);
    assertStringIncludes(result.stderr, "Failed to download denort-x86_64-unknown-linux-gnu.zip");
    assertEquals(result.githubEnv, "");
  });

  it("fails closed when the archive does not match its pinned digest", async () => {
    const result = await runFetch({ corrupt: true });
    assert(result.code !== 0, "a digest mismatch must fail the step");
    assertStringIncludes(result.stderr, "denort checksum mismatch");
    assertEquals(result.githubEnv, "", "an unverified denort must never be exported");
    assertEquals(
      result.calls.includes("unzip"),
      false,
      "an unverified archive must not be extracted",
    );
  });

  it("refuses a target without a pinned digest", async () => {
    const result = await runFetch({ target: "riscv64gc-unknown-linux-gnu" });
    assert(result.code !== 0);
    assertStringIncludes(
      result.stderr,
      "No pinned denort checksum for riscv64gc-unknown-linux-gnu",
    );
    assertEquals(result.calls, [], "an unpinned target must not be downloaded");
  });
});
