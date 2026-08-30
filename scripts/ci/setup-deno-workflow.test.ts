import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { parse } from "#std/yaml/parse";

const ACTION_PATH = ".github/actions/setup-deno/action.yml";
const WORKFLOWS_DIR = ".github/workflows";
const LOCAL_ACTION = "./.github/actions/setup-deno";
const CACHE_RESTORE_ACTION =
  "actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9";
const CACHE_SAVE_ACTION =
  "actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9";
const MAX_SETUP_MINUTES = 5;
const MAX_CACHE_SETUP_MINUTES = 10;
const CACHE_PRODUCER_JOB = "tests";
const CHROMIUM_STEP_MINUTES = 20;
const CHROMIUM_OVERHEAD_MARGIN_SECONDS = 120;
/**
 * How long an upstream outage on the REQUIRED Deno archive download must be
 * survivable. It has no fallback, so the retry budget is the only thing
 * between a blip and a red job — and setup-deno runs in ~30 jobs per
 * merge_group, so a per-job failure chance compounds into an ejected batch.
 */
const SURVIVABLE_OUTAGE_SECONDS = 120;
/**
 * The shortest timeout-minutes of any job that runs setup-deno. The worst-case
 * retry budget has to fail *inside* that, so an unreachable upstream reports
 * "Failed to download ..." instead of an opaque job timeout.
 */
const TIGHTEST_SETUP_JOB_MINUTES = 10;
const DOWNLOAD_FAILURE_MARGIN_SECONDS = 120;

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

function isReusableWorkflowCall(value: unknown): value is string {
  return typeof value === "string" &&
    (/^\.\/\.github\/workflows\/[^/]+\.ya?ml$/.test(value) ||
      /^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^/@\s]+\.ya?ml@[^@\s]+$/.test(
        value,
      ));
}

function stepsForSetupScan(job: YamlRecord, context: string): YamlRecord[] {
  if (job.steps === undefined && isReusableWorkflowCall(job.uses)) return [];
  return asSteps(job.steps, `${context}.steps`);
}

function shellInteger(script: string, name: string): number {
  const match = script.match(new RegExp(`^\\s*readonly ${name}=(\\d+)$`, "m"));
  assert(match, `Chromium installer must declare ${name}`);
  return Number(match[1]);
}

/** The argv of the single `curl` in the installer that fetches `urlSuffix`. */
function curlInvocation(install: string, urlSuffix: string): string {
  const invocations = install.split(/\bcurl\b/).slice(1)
    .map((body) => body.slice(0, body.indexOf("--output")))
    .filter((body) => body.includes(urlSuffix));
  assertEquals(
    invocations.length,
    1,
    `the installer must fetch ${urlSuffix} with exactly one curl`,
  );
  return invocations[0];
}

function curlNumber(invocation: string, flag: string): number {
  const match = invocation.match(new RegExp(`${flag}\\s+(\\d+)`));
  assert(match, `curl invocation must pass ${flag}: ${invocation}`);
  return Number(match[1]);
}

async function parseYamlFile(path: string): Promise<YamlRecord> {
  return asRecord(parse(await Deno.readTextFile(path)), path);
}

async function withWorkflowFile(
  name: string,
  content: string,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const path = `${WORKFLOWS_DIR}/${name}`;
  await Deno.writeTextFile(path, content);
  try {
    await fn(path);
  } finally {
    await Deno.remove(path);
  }
}

async function workflowPathsUsingSetupDeno(): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (!entry.isFile || !/\.ya?ml$/.test(entry.name)) continue;
    const path = `${WORKFLOWS_DIR}/${entry.name}`;
    const workflow = await parseYamlFile(path);
    const jobs = asRecord(workflow.jobs, `${path}.jobs`);
    const usesSetupDeno = Object.entries(jobs).some(([jobName, value]) => {
      const job = asRecord(value, `${path}.jobs.${jobName}`);
      return stepsForSetupScan(job, `${path}.jobs.${jobName}`).some((step) =>
        step.uses === LOCAL_ACTION
      );
    });
    if (usesSetupDeno) {
      paths.push(path);
    }
  }
  return paths.sort();
}

/**
 * Runs the real "Install pinned Deno" script from the action with `curl` and
 * `unzip` replaced by stubs on PATH, and with one surgical substitution: the
 * in-repo pinned archive digests are rewritten to the digest of the stub
 * payload, because no stub can produce a preimage of the real pins. Everything
 * else — the single-download contract, the retry flags, the fail-closed
 * comparison — runs exactly as committed. Nothing touches the network, so
 * every upstream response — including the transport failures that redden CI —
 * is reproducible locally.
 */
type ArchiveMode = "ok" | "corrupt";
/** How an upstream fails while it is degraded. */
type FaultKind = "http-503" | "transport";
/**
 * An upstream outage on the REQUIRED archive download: it fails with
 * `kind` until `seconds` of retry backoff have elapsed, then serves normally.
 * `seconds: "forever"` is a resource that is genuinely unavailable — the case
 * that must still fail the job.
 */
interface Outage {
  kind: FaultKind;
  seconds: number | "forever";
}

interface InstallerResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function installerScript(): Promise<string> {
  const action = await parseYamlFile(ACTION_PATH);
  const runs = asRecord(action.runs, `${ACTION_PATH}.runs`);
  const step = asSteps(runs.steps, `${ACTION_PATH}.runs.steps`).find((entry) =>
    entry.name === "Install pinned Deno"
  );
  assert(step, "setup-deno must install Deno explicitly");
  return String(step.run);
}

/**
 * Stands in for curl and reproduces the subset of its retry semantics the
 * installer depends on, so a test can ask "does this exact argv survive that
 * upstream failure sequence?" without a network. The two rules that decide
 * every case here are curl's own:
 *
 *   - a 5xx under `--fail` is a *transient* error, so plain `--retry` retries it;
 *   - a dead connection (exit 56) is not, so it is only retried when
 *     `--retry-all-errors` is passed. This is exactly why merge-queue run
 *     31625521721 gave up on a required download after 2.0s with four
 *     fifths of its `--retry 5` budget unspent.
 *
 * Backoff is simulated, never slept: the clock advances by `--retry-delay` per
 * retry and `--retry-max-time` closes the window, which is what makes the
 * retry budget itself the thing under test.
 */
const CURL_STUB = `#!/usr/bin/env bash
set -uo pipefail

url=""
output=""
retries=0
retry_delay=0
retry_max_time=0
retry_all_errors=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --retry) retries="$2"; shift 2 ;;
    --retry-delay) retry_delay="$2"; shift 2 ;;
    --retry-max-time) retry_max_time="$2"; shift 2 ;;
    --retry-all-errors) retry_all_errors=1; shift ;;
    --output) output="$2"; shift 2 ;;
    --write-out) shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done

case "\${url}" in
  *.zip) fault="\${VF_TEST_ZIP_FAULT}"; fault_seconds="\${VF_TEST_ZIP_FAULT_SECONDS}" ;;
  *)
    # The pinned digests live in the repository, so the installer has exactly
    # one legitimate download: the archive. Any other fetch — the unpublished
    # checksums.txt manifest, the unpinned same-origin .sha256sum — is a
    # regression to trusting the release origin, and fails the run here.
    echo "curl stub: unexpected download of \${url}" >&2
    exit 1
    ;;
esac

serve() {
  if [ "\${VF_TEST_ARCHIVE_MODE}" = "corrupt" ]; then
    printf 'tampered-archive-bytes' > "\${output}"
  else
    printf '%s' "\${VF_TEST_ARCHIVE_BODY}" > "\${output}"
  fi
}

elapsed=0
attempt=0
while :; do
  attempt=\$((attempt + 1))
  if [ "\${fault}" = "none" ] ||
    { [ "\${fault_seconds}" != "forever" ] && [ "\${elapsed}" -ge "\${fault_seconds}" ]; }; then
    serve
    exit 0
  fi

  # curl only spends a retry when it considers the failure retryable.
  if [ "\${fault}" = "transport" ] && [ "\${retry_all_errors}" != "1" ]; then
    echo "curl: (56) Connection died, tried 5 times before giving up" >&2
    exit 56
  fi
  if [ "\${attempt}" -gt "\${retries}" ]; then break; fi
  elapsed=\$((elapsed + retry_delay))
  # curl declines to start a further retry once the window has closed.
  if [ "\${retry_max_time}" -gt 0 ] && [ "\${elapsed}" -ge "\${retry_max_time}" ]; then break; fi
done

if [ "\${fault}" = "transport" ]; then
  echo "curl: (56) Connection died, tried 5 times before giving up" >&2
  rm -f "\${output}"
  exit 56
fi
echo "curl: (22) The requested URL returned error: 503" >&2
rm -f "\${output}"
exit 22
`;

const UNZIP_STUB = `#!/usr/bin/env bash
set -euo pipefail
dest=""
prev=""
for arg in "$@"; do
  if [ "\${prev}" = "-d" ]; then dest="\${arg}"; fi
  prev="\${arg}"
done
mkdir -p "\${dest}"
printf '#!/usr/bin/env bash\\necho "deno 2.7.7 (stub)"\\n' > "\${dest}/deno"
printf '#!/usr/bin/env bash\\necho "deno 2.7.7 (stub)"\\n' > "\${dest}/deno.exe"
`;

const STUB_ARCHIVE_BODY = "stub-deno-archive-payload";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The committed installer with exactly one substitution: every pinned archive
 * digest is rewritten to the digest of the stub payload. The pins are the one
 * part of the script a stubbed upstream cannot satisfy — serving bytes that
 * hash to a real pin would require a SHA-256 preimage — and rewriting them
 * (rather than the comparison) keeps the fail-closed comparison itself, and
 * everything around it, exactly as committed.
 */
async function stubPinnedInstallerScript(): Promise<string> {
  const install = await installerScript();
  const pins = install.match(/archive_sha256="[0-9a-f]{64}"/g) ?? [];
  assert(
    pins.length > 0,
    "the installer must pin archive digests in the repository",
  );
  return install.replaceAll(
    /archive_sha256="[0-9a-f]{64}"/g,
    `archive_sha256="${await sha256Hex(STUB_ARCHIVE_BODY)}"`,
  );
}

async function runInstaller(
  { archive = "ok", archiveOutage }: {
    archive?: ArchiveMode;
    archiveOutage?: Outage;
  } = {},
): Promise<InstallerResult> {
  const root = await Deno.makeTempDir({ prefix: "setup-deno-installer-" });
  try {
    const bin = `${root}/bin`;
    await Deno.mkdir(bin);
    await Deno.mkdir(`${root}/runner-temp`);
    await Deno.writeTextFile(`${bin}/curl`, CURL_STUB, { mode: 0o755 });
    await Deno.writeTextFile(`${bin}/unzip`, UNZIP_STUB, { mode: 0o755 });
    await Deno.writeTextFile(
      `${root}/install.sh`,
      await stubPinnedInstallerScript(),
    );
    await Deno.writeTextFile(`${root}/github-path`, "");
    // Exporting inside the wrapper keeps the test free of --allow-env.
    await Deno.writeTextFile(
      `${root}/wrapper.sh`,
      [
        "#!/usr/bin/env bash",
        `export PATH="${bin}:\${PATH}"`,
        `export RUNNER_TEMP="${root}/runner-temp"`,
        `export GITHUB_PATH="${root}/github-path"`,
        `export VF_TEST_ARCHIVE_MODE="${archive}"`,
        `export VF_TEST_ARCHIVE_BODY="${STUB_ARCHIVE_BODY}"`,
        `export VF_TEST_ZIP_FAULT="${archiveOutage?.kind ?? "none"}"`,
        `export VF_TEST_ZIP_FAULT_SECONDS="${archiveOutage?.seconds ?? 0}"`,
        `exec bash "${root}/install.sh"`,
        "",
      ].join("\n"),
    );

    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [`${root}/wrapper.sh`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

describe("setup-deno installer resilience", () => {
  // The happy path doubles as the single-download contract: the curl stub
  // hard-fails any URL other than the archive, so this passing proves the
  // installer no longer fetches the unpublished checksums.txt manifest or the
  // unpinned same-origin .sha256sum file.
  it("installs a Deno whose archive matches its pinned checksum", async () => {
    const result = await runInstaller();

    assertEquals(
      result.code,
      0,
      `installer must succeed with only the archive download\n${result.stderr}`,
    );
    assertStringIncludes(result.stdout, "deno 2.7.7 (stub)");
  });

  // The point of pinning in-repo: a tampered archive fails no matter what the
  // release origin says about it, because nothing downloaded from that origin
  // can vouch for it.
  it("fails closed when the archive does not match its pinned checksum", async () => {
    const result = await runInstaller({ archive: "corrupt" });

    assert(result.code !== 0, "a tampered archive must fail the job");
    assertStringIncludes(result.stderr, "Deno archive checksum mismatch");
    assertEquals(
      result.stdout.includes("deno 2.7.7 (stub)"),
      false,
      "no Deno may be installed from an unverified archive",
    );
  });

  // The one REQUIRED download. It has no fallback, so the only lever is the
  // retry budget -- and it has to cover what upstream actually does.
  // Merge-queue run 31625521721 died on a required download that got one 503,
  // waited its 2s, then hit a dead connection and quit, 2.0s in.
  it("retries the required archive download through a died connection", async () => {
    const result = await runInstaller({
      archiveOutage: { kind: "transport", seconds: 1 },
    });

    assertEquals(
      result.code,
      0,
      `a dead connection on the archive must be retried, not fatal\n${result.stderr}`,
    );
    assertStringIncludes(result.stdout, "deno 2.7.7 (stub)");
  });

  it(`retries the required archive download across a ${SURVIVABLE_OUTAGE_SECONDS}s upstream outage`, async () => {
    const result = await runInstaller({
      archiveOutage: { kind: "http-503", seconds: SURVIVABLE_OUTAGE_SECONDS },
    });

    assertEquals(
      result.code,
      0,
      `the archive retry window must outlast a ${SURVIVABLE_OUTAGE_SECONDS}s outage\n${result.stderr}`,
    );
    assertStringIncludes(result.stdout, "deno 2.7.7 (stub)");
  });

  // The guard that keeps this from becoming "make CI never fail". The
  // required download has no fallback, so an archive that truly cannot be
  // obtained must still stop the job rather than install an unverified Deno.
  for (const kind of ["http-503", "transport"] as const) {
    it(`still fails when the required archive is never obtainable (${kind})`, async () => {
      const result = await runInstaller({
        archiveOutage: { kind, seconds: "forever" },
      });

      assert(
        result.code !== 0,
        "an unobtainable archive must fail the job",
      );
      assertStringIncludes(
        result.stderr,
        "Failed to download Deno archive for",
      );
      assertEquals(
        result.stdout.includes("deno 2.7.7 (stub)"),
        false,
        "no Deno may be installed when verification inputs are missing",
      );
    });
  }
});

describe("setup-deno CI contract", () => {
  it("skips only valid reusable-workflow jobs without steps", () => {
    assertEquals(
      stepsForSetupScan(
        { uses: "./.github/workflows/reusable.yml" },
        "local reusable job",
      ),
      [],
    );
    assertEquals(
      stepsForSetupScan(
        {
          uses: "veryfront/veryfront-code/.github/workflows/reusable.yml@main",
        },
        "owner reusable job",
      ),
      [],
    );
    assertThrows(
      () => stepsForSetupScan({ "runs-on": "ubuntu-latest" }, "ordinary job"),
      Error,
      "ordinary job.steps must be an array",
    );
    assertThrows(
      () =>
        stepsForSetupScan(
          { uses: "actions/checkout@v7" },
          "invalid job-level action",
        ),
      Error,
      "invalid job-level action.steps must be an array",
    );
    assertThrows(
      () =>
        stepsForSetupScan(
          { uses: "./.github/workflows/nested/reusable.yml" },
          "invalid local reusable job",
        ),
      Error,
      "invalid local reusable job.steps must be an array",
    );
    assertThrows(
      () =>
        stepsForSetupScan(
          { uses: "./.github/workflows/reusable.yml", steps: "invalid" },
          "malformed reusable job",
        ),
      Error,
      "malformed reusable job.steps must be an array",
    );
  });

  it("uses a pinned cache and bounded, frozen dependency warming", async () => {
    const action = await parseYamlFile(ACTION_PATH);
    const runs = asRecord(action.runs, `${ACTION_PATH}.runs`);
    const steps = asSteps(runs.steps, `${ACTION_PATH}.runs.steps`);

    const cacheStep = steps.find((step) => step.uses === CACHE_RESTORE_ACTION);
    assert(
      cacheStep,
      "setup-deno must use the pinned restore-only cache action",
    );
    const cacheEnv = asRecord(cacheStep.env, "cache step env");
    assertEquals(cacheEnv.SEGMENT_DOWNLOAD_TIMEOUT_MINS, "2");
    const cacheInputs = asRecord(cacheStep.with, "cache step inputs");
    const cacheKey = String(cacheInputs.key);
    assertStringIncludes(cacheKey, "${{ runner.os }}");
    assertStringIncludes(cacheKey, "${{ runner.arch }}");
    assertStringIncludes(cacheKey, "2.7.7");
    assertStringIncludes(cacheKey, "veryfront-deno-v2-");
    for (
      const dependencyInput of [
        "'deno.lock'",
        "'scripts/deno.lock'",
        "'deno.json'",
        "'**/deno.json'",
      ]
    ) {
      assertStringIncludes(cacheKey, dependencyInput);
    }
    assertStringIncludes(String(cacheInputs.path), "runner.temp");

    const saveStep = steps.find((step) => step.uses === CACHE_SAVE_ACTION);
    assert(saveStep, "setup-deno must use the pinned save-only cache action");
    assertEquals(
      String(saveStep.if),
      "inputs.warm-cache == 'true' && inputs.warm-redis-cache == 'true' && steps.deno-cache.outputs.cache-hit != 'true'",
    );
    const saveInputs = asRecord(saveStep.with, "cache save inputs");
    assertEquals(
      saveInputs.key,
      "${{ steps.deno-cache.outputs.cache-primary-key }}",
    );

    const installStep = steps.find((step) =>
      step.name === "Install pinned Deno"
    );
    assert(installStep, "setup-deno must install Deno explicitly");
    const install = String(installStep.run);
    assertStringIncludes(install, 'version="2.7.7"');
    assertStringIncludes(install, "--remove-on-error");
    assertStringIncludes(
      install,
      "https://github.com/denoland/deno/releases/download/v${version}/${archive}",
    );
    // Fail closed: the expected archive digests are pinned in the repository,
    // so the release origin is never trusted to vouch for its own bytes. No
    // checksum may be downloaded at all — Deno publishes no checksums.txt
    // manifest (the URL 404s on every real release), and the per-archive
    // .sha256sum assets ship from the same origin as the archives themselves,
    // so fetching either would add no integrity. The archive is the one and
    // only URL the installer may touch.
    assertEquals(
      install.match(/https:\/\/[^\s"']+/g),
      ["https://github.com/denoland/deno/releases/download/v${version}/${archive}"],
      "the installer must download exactly one URL: the pinned-version archive",
    );
    assertEquals(
      install.includes("falling back"),
      false,
      "checksum verification must have no fallback path",
    );
    for (
      const target of [
        "x86_64-unknown-linux-gnu",
        "aarch64-unknown-linux-gnu",
        "x86_64-apple-darwin",
        "aarch64-apple-darwin",
        "x86_64-pc-windows-msvc",
        "aarch64-pc-windows-msvc",
      ]
    ) {
      assertMatch(
        install,
        new RegExp(
          `deno-${target}\\.zip\\)\\s*\\n\\s*archive_sha256="[0-9a-f]{64}"`,
        ),
        `the installer must pin a digest for deno-${target}.zip`,
      );
    }
    assertStringIncludes(
      install,
      "No pinned checksum for ${archive}",
      "an archive without a pinned digest must fail closed",
    );
    // Every checksum backend must read the file on stdin. Passing the path as an
    // argument makes GNU sha256sum/shasum escape filenames containing a backslash
    // by prefixing the output line with a literal "\", which corrupts the parsed
    // digest on Windows runners, where RUNNER_TEMP is always a backslash-separated
    // path and so always triggers the escaping.
    assertStringIncludes(install, 'sha256sum < "$1" | awk');
    assertStringIncludes(install, 'shasum -a 256 < "$1" | awk');
    assertStringIncludes(install, 'openssl dgst -sha256 < "$1" | awk');
    assertStringIncludes(
      install,
      'update(fs.readFileSync(0)).digest(\'hex\'))" < "$1"',
    );
    for (
      const argvForm of [
        'sha256sum "${',
        'shasum -a 256 "${',
        'openssl dgst -sha256 "${',
        "fs.readFileSync(process.argv[1])",
      ]
    ) {
      assertEquals(
        install.includes(argvForm),
        false,
        `checksums must be computed from stdin, not "${argvForm}" (breaks on Windows paths)`,
      );
    }
    assertStringIncludes(
      install,
      'actual_sha256="$(compute_sha256 "${zip_path}")"',
    );
    assertStringIncludes(
      install,
      'if [ "${actual_sha256}" != "${archive_sha256}" ]',
    );
    assertStringIncludes(
      install,
      "Failed to download Deno archive for ${archive}",
    );
    assertEquals(
      /\bnpm\b/.test(install),
      false,
      "the installer must not fall back to npm",
    );

    const redisWarm = steps.find((step) =>
      step.name === "Warm Redis module cache"
    );
    const dependencyWarm = steps.find((step) =>
      step.name === "Warm esm.sh cache"
    );
    assert(redisWarm && dependencyWarm, "both warm-cache steps must exist");

    const templateManifestGenerator = steps.find((step) => {
      const command = String(step.run ?? "");
      return command.includes("generate-templates-manifest.ts") ||
        /\bdeno task generate(?::manifests)?\b/.test(command);
    });
    assertEquals(
      templateManifestGenerator,
      undefined,
      "setup-deno must not regenerate committed template manifests before CI checks drift",
    );

    for (
      const [name, step, deadline, expectedCondition] of [
        [
          "Redis",
          redisWarm,
          "2m",
          "inputs.warm-redis-cache == 'true' && steps.deno-cache.outputs.cache-hit != 'true'",
        ],
        [
          "dependency",
          dependencyWarm,
          "3m",
          "inputs.warm-cache == 'true' && steps.deno-cache.outputs.cache-hit != 'true'",
        ],
      ] as const
    ) {
      const condition = String(step.if);
      const command = String(step.run);
      assertEquals(condition, expectedCondition);
      assertMatch(
        command,
        new RegExp(`timeout[^\\n]+${deadline}`),
        `${name} warming must have a process deadline`,
      );
      assertStringIncludes(command, "deno cache --frozen");
      assertEquals(command.includes("--reload"), false);
      assertEquals(command.includes("|| true"), false);
    }
  });

  it("budgets the required Deno download for a real upstream outage", async () => {
    const install = await installerScript();
    const invocation = curlInvocation(install, '${archive}"');

    // curl only treats 5xx and timeouts as transient. A dead connection is
    // exit 56 and a rate-limited 403 is exit 22, and plain --retry abandons
    // both immediately -- which is how run 31625521721 gave up on a required
    // download after 2.0s with 4 of its 5 retries unspent.
    assertStringIncludes(
      invocation,
      "--retry-all-errors",
      "the archive download must retry transport failures, not only 5xx",
    );
    // Without this a failed transfer leaves a partial file that the next
    // step would happily read as an archive.
    assertStringIncludes(
      invocation,
      "--remove-on-error",
      "the archive download must not leave a partial file behind",
    );
    // The release URL redirects; --location must never be allowed to follow
    // that redirect onto an insecure protocol.
    assertStringIncludes(
      invocation,
      '--proto "=https"',
      "the archive download must be pinned to HTTPS",
    );
    assertStringIncludes(
      invocation,
      '--proto-redir "=https"',
      "the archive download must only follow HTTPS redirects",
    );

    const retries = curlNumber(invocation, "--retry");
    const retryDelay = curlNumber(invocation, "--retry-delay");
    const retryWindow = curlNumber(invocation, "--retry-max-time");
    const maxTime = curlNumber(invocation, "--max-time");

    assert(
      retryWindow > SURVIVABLE_OUTAGE_SECONDS,
      `the archive retry window (${retryWindow}s) must outlast a ${SURVIVABLE_OUTAGE_SECONDS}s outage`,
    );
    // The window is only real if the retry count can reach the end of it;
    // otherwise the count silently becomes the binding constraint again.
    assert(
      retries * retryDelay >= retryWindow,
      `the archive retry count (${retries} x ${retryDelay}s) must be able to fill its ${retryWindow}s window`,
    );
    // A new retry may start at the very end of the window and then run for a
    // full per-transfer deadline.
    const worstCaseSeconds = retryWindow + maxTime;

    assert(
      worstCaseSeconds <=
        TIGHTEST_SETUP_JOB_MINUTES * 60 - DOWNLOAD_FAILURE_MARGIN_SECONDS,
      `an unreachable upstream must fail inside the tightest setup-deno job with ${DOWNLOAD_FAILURE_MARGIN_SECONDS}s to spare; budget is ${worstCaseSeconds}s`,
    );
  });

  it("discovers setup-deno callers through parsed workflow YAML", async () => {
    await withWorkflowFile(
      "zz-setup-deno-quoted.test.yml",
      `
name: quoted setup-deno contract
jobs:
  quoted:
    if: \${{ github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository }}
    runs-on: ubuntu-latest
    steps:
      - uses: "./.github/actions/setup-deno"
        timeout-minutes: 5
`,
      async (path) => {
        const workflowPaths = await workflowPathsUsingSetupDeno();
        assert(
          workflowPaths.includes(path),
          "quoted setup-deno callers must be discovered from parsed YAML",
        );
      },
    );
  });

  it("uses one complete cache producer, caps setup, and excludes fork PRs", async () => {
    const workflowPaths = await workflowPathsUsingSetupDeno();
    assert(
      workflowPaths.length > 0,
      "at least one workflow must use setup-deno",
    );

    let setupCalls = 0;
    let cacheProducerCalls = 0;
    let tightestSetupJobMinutes = Number.POSITIVE_INFINITY;
    for (const path of workflowPaths) {
      const workflow = await parseYamlFile(path);
      const jobs = asRecord(workflow.jobs, `${path}.jobs`);
      for (const [jobName, value] of Object.entries(jobs)) {
        const job = asRecord(value, `${path}.jobs.${jobName}`);
        const steps = stepsForSetupScan(job, `${path}.jobs.${jobName}`);
        const setupSteps = steps.filter((step) => step.uses === LOCAL_ACTION);
        for (const step of setupSteps) {
          setupCalls++;
          const inputs = asRecord(step.with ?? {}, "setup inputs");
          // Only the job that warms BOTH the dependency graph and the Redis
          // cache is the complete cache producer; other jobs may warm the
          // dependency cache alone as consumers.
          const isCompleteCacheProducer = inputs["warm-cache"] === "true" &&
            inputs["warm-redis-cache"] === "true";

          if (isCompleteCacheProducer) {
            cacheProducerCalls++;
            assertEquals(path, `${WORKFLOWS_DIR}/cicd.yml`);
            assertEquals(jobName, CACHE_PRODUCER_JOB);
          }

          assertEquals(
            step["timeout-minutes"],
            isCompleteCacheProducer
              ? MAX_CACHE_SETUP_MINUTES
              : MAX_SETUP_MINUTES,
            `${path} ${jobName} setup-deno must leave time for job work`,
          );
          if (isCompleteCacheProducer) {
            assertEquals(
              job["runs-on"],
              "ubuntu-latest",
              `${path} ${jobName} uses the Linux timeout command while warming`,
            );
          }
        }

        if (setupSteps.length > 0) {
          assertStringIncludes(
            String(job.if),
            "github.event.pull_request.head.repo.full_name == github.repository",
            `${path} ${jobName} must not run repository code or save caches for fork PRs`,
          );
          tightestSetupJobMinutes = Math.min(
            tightestSetupJobMinutes,
            // GitHub's default job timeout when a job declares none.
            Number(job["timeout-minutes"] ?? 360),
          );
        }
      }
    }

    assert(setupCalls > 0, "setup-deno workflow calls must be inspected");
    assertEquals(
      cacheProducerCalls,
      1,
      "exactly one job may pre-warm and save the complete dependency graph",
    );
    // Keeps the download retry budget honest: it is sized against the shortest
    // job that has to absorb it, so shortening a job here must be a deliberate
    // change there too.
    assertEquals(
      tightestSetupJobMinutes,
      TIGHTEST_SETUP_JOB_MINUTES,
      "the Deno download retry budget is sized against the tightest setup-deno job",
    );

    const ci = await parseYamlFile(`${WORKFLOWS_DIR}/cicd.yml`);
    const ciJob = asRecord(asRecord(ci.jobs, "cicd jobs").ci, "ci job");
    const ciRunStep = asSteps(ciJob.steps, "ci steps").find((step) =>
      step.name === "Run ${{ matrix.check }}"
    );
    assert(ciRunStep, "ci matrix job must run the requested check");
    // Contributors can only reproduce this shard before pushing while the case
    // body is nothing but the task name; anything inlined here is a check that
    // exists only in CI, and the first sighting of it is a red run.
    assertMatch(
      String(ciRunStep.run),
      /^\s*lint\) deno task lint:ci ;;$/m,
      "the lint shard must delegate to the lint:ci task",
    );
    assertMatch(
      String(ciRunStep.run),
      /^\s*format\) deno task fmt:check ;;$/m,
      "the format shard must delegate to the fmt:check task",
    );

    const tasks = asRecord(
      asRecord(JSON.parse(await Deno.readTextFile("deno.json")), "deno.json")
        .tasks,
      "deno.json tasks",
    );
    assertStringIncludes(
      String(tasks["lint:ci"]),
      "--allow-read --allow-write --allow-run=bash scripts/ci/setup-deno-workflow.test.ts",
      "required lint shard must allow temporary workflow fixtures and running the installer under stubbed curl",
    );
    assertStringIncludes(
      String(tasks["lint:ci"]),
      "--allow-run=bash,/bin/bash,node,npm,tar,deno",
      "required lint shard must allow the artifact test to launch pinned Deno from PATH",
    );
    assertStringIncludes(
      String(tasks["lint:ci"]),
      "scripts/ci/publish-npm-packages.test.ts",
      "the lint shard must execute the npm publish script regression tests",
    );
    assertStringIncludes(
      String(tasks["lint:ci"]),
      "deno task build:proxy-lock",
      "the lint shard must regenerate the committed proxy dependency lock",
    );
    assertStringIncludes(
      String(tasks["lint:ci"]),
      "git diff --exit-code -- scripts/build/proxy-deno.lock",
      "the lint shard must fail when the committed proxy dependency lock is stale",
    );
    assertStringIncludes(
      String(tasks["test:ci:npm-compatibility-artifact"]),
      "--allow-run=npm,tar,bash,deno",
      "the dedicated artifact task must allow the artifact test to launch pinned Deno from PATH",
    );
    assertStringIncludes(
      String(tasks["lint:ci"]),
      "deno task docs:api-reference:check",
      "the lint shard owns the generated API reference staleness check",
    );

    const coverageShards = asRecord(
      asRecord(ci.jobs, "cicd jobs")["coverage-shards"],
      "coverage-shards job",
    );
    assertEquals(coverageShards["timeout-minutes"], 15);
    const coverageSetup = asSteps(
      coverageShards.steps,
      "coverage-shards steps",
    ).find((step) => step.uses === LOCAL_ACTION);
    assert(coverageSetup, "coverage shards must use setup-deno");
    assertEquals(coverageSetup["timeout-minutes"], MAX_SETUP_MINUTES);

    const chromiumAction = await parseYamlFile(
      ".github/actions/install-chromium/action.yml",
    );
    const chromiumRuns = asRecord(
      chromiumAction.runs,
      "install-chromium runs",
    );
    const chromiumInstall = asSteps(
      chromiumRuns.steps,
      "install-chromium steps",
    ).find((step) => step.name === "Install Chromium");
    assert(chromiumInstall, "the shared action must install Chromium");
    const install = String(chromiumInstall.run);
    for (
      const expected of [
        'for attempt in $(seq 1 "${install_attempts}")',
        '--kill-after="${install_kill_grace_seconds}s" "${install_timeout_minutes}m"',
        'for _ in $(seq 1 "${apt_lock_attempts}")',
        'sleep "${apt_lock_sleep_seconds}"',
        'sleep "${retry_backoff_seconds}"',
      ]
    ) {
      assertStringIncludes(install, expected);
    }
    assertEquals(install.includes("apt-get clean"), false);
    assertEquals(install.includes("rm -rf /var/lib/apt/lists"), false);

    const attempts = shellInteger(install, "install_attempts");
    const installSeconds = shellInteger(
      install,
      "install_timeout_minutes",
    ) * 60;
    const installKillGrace = shellInteger(
      install,
      "install_kill_grace_seconds",
    );
    const aptLockSeconds = shellInteger(install, "apt_lock_attempts") *
      shellInteger(install, "apt_lock_sleep_seconds");
    const backoffSeconds = shellInteger(install, "retry_backoff_seconds");
    const worstCaseSeconds = attempts *
        (aptLockSeconds + installSeconds + installKillGrace) +
      (attempts - 1) * backoffSeconds;
    assert(
      worstCaseSeconds <=
        CHROMIUM_STEP_MINUTES * 60 - CHROMIUM_OVERHEAD_MARGIN_SECONDS,
      `Chromium retries need at least ${CHROMIUM_OVERHEAD_MARGIN_SECONDS}s of outer-step overhead margin; budget is ${worstCaseSeconds}s`,
    );

    for (const jobName of ["tests-e2e-rsc-browser", "tests-binary-e2e"]) {
      const job = asRecord(
        asRecord(ci.jobs, "cicd jobs")[jobName],
        jobName,
      );
      const chromiumStep = asSteps(job.steps, `${jobName} steps`).find(
        (step) => step.uses === "./.github/actions/install-chromium",
      );
      assert(
        chromiumStep,
        `${jobName} must install Chromium via the shared action`,
      );
      assertEquals(
        chromiumStep["timeout-minutes"],
        CHROMIUM_STEP_MINUTES,
        `${jobName} Chromium provisioning needs a total step deadline`,
      );
    }
  });
});
