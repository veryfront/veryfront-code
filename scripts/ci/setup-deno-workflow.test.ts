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
 * How long an upstream outage on the two REQUIRED Deno downloads must be
 * survivable. Neither has a fallback, so the retry budget is the only thing
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
 * Runs the real "Install pinned Deno" script from the action, unmodified, with
 * `curl` and `unzip` replaced by stubs on PATH. Nothing touches the network, so
 * every upstream response — including the transport failures that redden CI —
 * is reproducible locally.
 */
type ManifestMode =
  | "http-200-bad-hash"
  | "http-404"
  | "http-503"
  | "transport-failure";
type ArchiveMode = "ok" | "corrupt";
/** How an upstream fails while it is degraded. */
type FaultKind = "http-503" | "transport";
/**
 * An upstream outage on one of the two REQUIRED downloads: it fails with
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
 *     31625521721 gave up on the required `.sha256sum` after 2.0s with four
 *     fifths of its `--retry 5` budget unspent.
 *
 * Backoff is simulated, never slept: the clock advances by `--retry-delay` per
 * retry and `--retry-max-time` closes the window, which is what makes the
 * retry budget itself the thing under test.
 */
const CURL_STUB = `#!/usr/bin/env bash
set -uo pipefail

sha_of_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

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
  */checksums.txt)
    # The manifest is optional and 404s for every real release, so it is scripted
    # directly rather than through the outage model.
    case "\${VF_TEST_MANIFEST_MODE}" in
      http-200-bad-hash)
        # A manifest that downloads cleanly but is not the pinned artifact.
        printf 'tampered-checksums-manifest\\n' > "\${output}"
        printf '200'
        exit 0
        ;;
      http-404) printf '404'; exit 22 ;;
      http-503) printf '503'; exit 22 ;;
      transport-failure) printf '000'; exit 56 ;;
    esac
    printf '000'
    exit 1
    ;;
  *.sha256sum) fault="\${VF_TEST_CHECKSUM_FAULT}"; fault_seconds="\${VF_TEST_CHECKSUM_FAULT_SECONDS}" ;;
  *.zip) fault="\${VF_TEST_ZIP_FAULT}"; fault_seconds="\${VF_TEST_ZIP_FAULT_SECONDS}" ;;
  *) printf '000'; exit 1 ;;
esac

serve() {
  case "\${url}" in
    *.sha256sum)
      archive_name="\$(basename "\${url}" .sha256sum)"
      printf '%s  %s\\n' \\
        "\$(printf '%s' "\${VF_TEST_ARCHIVE_BODY}" | sha_of_stdin)" \\
        "\${archive_name}" > "\${output}"
      ;;
    *.zip)
      if [ "\${VF_TEST_ARCHIVE_MODE}" = "corrupt" ]; then
        printf 'tampered-archive-bytes' > "\${output}"
      else
        printf '%s' "\${VF_TEST_ARCHIVE_BODY}" > "\${output}"
      fi
      ;;
  esac
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

async function runInstaller(
  { manifest, archive = "ok", checksumOutage, archiveOutage }: {
    manifest: ManifestMode;
    archive?: ArchiveMode;
    checksumOutage?: Outage;
    archiveOutage?: Outage;
  },
): Promise<InstallerResult> {
  const root = await Deno.makeTempDir({ prefix: "setup-deno-installer-" });
  try {
    const bin = `${root}/bin`;
    await Deno.mkdir(bin);
    await Deno.mkdir(`${root}/runner-temp`);
    await Deno.writeTextFile(`${bin}/curl`, CURL_STUB, { mode: 0o755 });
    await Deno.writeTextFile(`${bin}/unzip`, UNZIP_STUB, { mode: 0o755 });
    await Deno.writeTextFile(`${root}/install.sh`, await installerScript());
    await Deno.writeTextFile(`${root}/github-path`, "");
    // Exporting inside the wrapper keeps the test free of --allow-env.
    await Deno.writeTextFile(
      `${root}/wrapper.sh`,
      [
        "#!/usr/bin/env bash",
        `export PATH="${bin}:\${PATH}"`,
        `export RUNNER_TEMP="${root}/runner-temp"`,
        `export GITHUB_PATH="${root}/github-path"`,
        `export VF_TEST_MANIFEST_MODE="${manifest}"`,
        `export VF_TEST_ARCHIVE_MODE="${archive}"`,
        'export VF_TEST_ARCHIVE_BODY="stub-deno-archive-payload"',
        `export VF_TEST_CHECKSUM_FAULT="${checksumOutage?.kind ?? "none"}"`,
        `export VF_TEST_CHECKSUM_FAULT_SECONDS="${
          checksumOutage?.seconds ?? 0
        }"`,
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
  // The pinned manifest is not published by any Deno release, so every real run
  // takes the "manifest unavailable" path. A transport blip on a URL that is
  // guaranteed to 404 must not be able to redden a job.
  for (
    const [label, manifest] of [
      ["a 503 from the manifest URL", "http-503"],
      ["a died connection (HTTP 000)", "transport-failure"],
      ["a 404 from the manifest URL", "http-404"],
    ] as const satisfies readonly (readonly [string, ManifestMode])[]
  ) {
    it(`falls back to the archive checksum file on ${label}`, async () => {
      const result = await runInstaller({ manifest });

      assertEquals(
        result.code,
        0,
        `installer must not fail on ${label}\n${result.stderr}`,
      );
      assertStringIncludes(result.stderr, "falling back to archive checksum");
      assertStringIncludes(result.stdout, "deno 2.7.7 (stub)");
    });
  }

  // The guard that must survive the fix: a manifest that really does download
  // but does not match its pin is an integrity signal, not a transport blip.
  it("still fails when a downloaded manifest does not match its pinned hash", async () => {
    const result = await runInstaller({ manifest: "http-200-bad-hash" });

    assert(result.code !== 0, "a mismatched manifest must fail the job");
    assertStringIncludes(result.stderr, "Checksums manifest checksum mismatch");
  });

  // Falling back must never mean skipping verification: the archive is still
  // checked against ${archive}.sha256sum on the fallback path.
  it("still verifies the archive against its checksum file on the fallback path", async () => {
    const result = await runInstaller({
      manifest: "http-503",
      archive: "corrupt",
    });

    assert(result.code !== 0, "a tampered archive must fail the job");
    assertStringIncludes(result.stderr, "Deno archive checksum mismatch");
  });

  // The two REQUIRED downloads. Unlike the manifest these have no fallback, so
  // the only lever is the retry budget -- and it has to cover what upstream
  // actually does. Merge-queue run 31625521721 died here: the `.sha256sum` got
  // one 503, waited its 2s, then hit a dead connection and quit, 2.0s in.
  for (
    const [role, outages] of [
      ["archive checksum", (o: Outage) => ({ checksumOutage: o })],
      ["archive", (o: Outage) => ({ archiveOutage: o })],
    ] as const
  ) {
    it(`retries the required ${role} download through a died connection`, async () => {
      const result = await runInstaller({
        manifest: "http-404",
        ...outages({ kind: "transport", seconds: 1 }),
      });

      assertEquals(
        result.code,
        0,
        `a dead connection on the ${role} must be retried, not fatal\n${result.stderr}`,
      );
      assertStringIncludes(result.stdout, "deno 2.7.7 (stub)");
    });

    it(`retries the required ${role} download across a ${SURVIVABLE_OUTAGE_SECONDS}s upstream outage`, async () => {
      const result = await runInstaller({
        manifest: "http-404",
        ...outages({ kind: "http-503", seconds: SURVIVABLE_OUTAGE_SECONDS }),
      });

      assertEquals(
        result.code,
        0,
        `the ${role} retry window must outlast a ${SURVIVABLE_OUTAGE_SECONDS}s outage\n${result.stderr}`,
      );
      assertStringIncludes(result.stdout, "deno 2.7.7 (stub)");
    });

    // The guard that keeps this from becoming "make CI never fail". Neither
    // required download has a fallback, so a resource that truly cannot be
    // obtained must still stop the job rather than install an unverified Deno.
    for (const kind of ["http-503", "transport"] as const) {
      it(`still fails when the required ${role} is never obtainable (${kind})`, async () => {
        const result = await runInstaller({
          manifest: "http-404",
          ...outages({ kind, seconds: "forever" }),
        });

        assert(
          result.code !== 0,
          `an unobtainable ${role} must fail the job`,
        );
        assertStringIncludes(
          result.stderr,
          role === "archive"
            ? "Failed to download Deno archive for"
            : "Failed to download Deno archive checksum for",
        );
        assertEquals(
          result.stdout.includes("deno 2.7.7 (stub)"),
          false,
          "no Deno may be installed when verification inputs are missing",
        );
      });
    }
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
      "https://github.com/denoland/deno/releases/download/v${version}/${archive}.sha256sum",
    );
    assertStringIncludes(
      install,
      "https://github.com/denoland/deno/releases/download/v${version}/checksums.txt",
    );
    assertStringIncludes(
      install,
      'checksum_parse_path="${checksums_manifest_path}"',
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
      'checksums_manifest_actual_sha256="$(compute_sha256 "${checksums_manifest_path}")"',
    );
    assertStringIncludes(
      install,
      'actual_sha256="$(compute_sha256 "${zip_path}")"',
    );
    assertStringIncludes(
      install,
      'if [ "${checksums_manifest_actual_sha256}" != "${checksums_manifest_sha256}" ]',
    );
    assertStringIncludes(
      install,
      'checksums_manifest_http_code="$(curl --fail --location --show-error --retry 5 --retry-delay 2 \\',
    );
    assertStringIncludes(
      install,
      '  if [ "${checksums_manifest_http_code}" != "200" ]; then',
    );
    // Any non-200 must fall back to the archive checksum file. Singling out 404
    // turned every upstream blip on a URL that always 404s into a red job, and
    // because setup-deno runs in every job, one blip reddened many at once.
    assertEquals(
      install.includes('!= "404"'),
      false,
      "an unavailable manifest must fall back regardless of why it was unavailable",
    );
    assertEquals(
      install.includes("Failed to download checksums manifest"),
      false,
      "failing to reach an unpublished manifest must not fail the job",
    );
    assertStringIncludes(
      install,
      "Checksums manifest unavailable for v${version} (HTTP ${checksums_manifest_http_code}); falling back to archive checksum file",
    );
    assertStringIncludes(
      install,
      "Failed to download Deno archive checksum for ${archive}",
    );
    assertStringIncludes(
      install,
      'archive_sha256="$(awk \'BEGIN {IGNORECASE = 1} /^Hash[[:space:]]*:/ { print tolower($3) }\' "${checksum_parse_path}")"',
    );
    assertStringIncludes(
      install,
      'archive_sha256="$(awk -v target="${archive}" \'$2 == target || $2 == "*" target { print tolower($1) }\' "${checksum_parse_path}")"',
    );
    assertStringIncludes(
      install,
      'if [ "${actual_sha256}" != "${archive_sha256}" ]',
    );
    assertStringIncludes(
      install,
      'if [ -z "${archive_sha256}" ]; then',
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

  it("budgets the required Deno downloads for a real upstream outage", async () => {
    const install = await installerScript();
    const manifest = curlInvocation(install, "/checksums.txt");
    const required = {
      "archive checksum": curlInvocation(install, "${archive}.sha256sum"),
      archive: curlInvocation(install, '${archive}"'),
    };

    let worstCaseSeconds = 0;
    for (const [role, invocation] of Object.entries(required)) {
      // curl only treats 5xx and timeouts as transient. A dead connection is
      // exit 56 and a rate-limited 403 is exit 22, and plain --retry abandons
      // both immediately -- which is how run 31625521721 gave up on the
      // required .sha256sum after 2.0s with 4 of its 5 retries unspent.
      assertStringIncludes(
        invocation,
        "--retry-all-errors",
        `the ${role} download must retry transport failures, not only 5xx`,
      );
      // Without this a failed transfer leaves a partial file that the next
      // step would happily read as a checksum or an archive.
      assertStringIncludes(
        invocation,
        "--remove-on-error",
        `the ${role} download must not leave a partial file behind`,
      );

      const retries = curlNumber(invocation, "--retry");
      const retryDelay = curlNumber(invocation, "--retry-delay");
      const retryWindow = curlNumber(invocation, "--retry-max-time");
      const maxTime = curlNumber(invocation, "--max-time");

      assert(
        retryWindow > SURVIVABLE_OUTAGE_SECONDS,
        `the ${role} retry window (${retryWindow}s) must outlast a ${SURVIVABLE_OUTAGE_SECONDS}s outage`,
      );
      // The window is only real if the retry count can reach the end of it;
      // otherwise the count silently becomes the binding constraint again.
      assert(
        retries * retryDelay >= retryWindow,
        `the ${role} retry count (${retries} x ${retryDelay}s) must be able to fill its ${retryWindow}s window`,
      );
      // A new retry may start at the very end of the window and then run for a
      // full per-transfer deadline.
      worstCaseSeconds += retryWindow + maxTime;
    }

    assert(
      worstCaseSeconds <=
        TIGHTEST_SETUP_JOB_MINUTES * 60 - DOWNLOAD_FAILURE_MARGIN_SECONDS,
      `an unreachable upstream must fail inside the tightest setup-deno job with ${DOWNLOAD_FAILURE_MARGIN_SECONDS}s to spare; budget is ${worstCaseSeconds}s`,
    );

    // The manifest is the opposite case: it 404s on every real release, and
    // --retry-all-errors retries 4xx too, so adding it there would make every
    // job in the repo pay the full retry budget for a guaranteed miss.
    assertEquals(
      manifest.includes("--retry-all-errors"),
      false,
      "the optional manifest fetch must not retry its guaranteed 404",
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

    for (const jobName of ["tests-e2e-rsc-browser", "tests-binary-e2e"]) {
      const job = asRecord(
        asRecord(ci.jobs, "cicd jobs")[jobName],
        jobName,
      );
      const chromiumInstall = asSteps(job.steps, `${jobName} steps`).find(
        (step) => step.name === "Install Chromium",
      );
      assert(chromiumInstall, `${jobName} must install Chromium`);
      assertEquals(
        chromiumInstall["timeout-minutes"],
        CHROMIUM_STEP_MINUTES,
        `${jobName} Chromium provisioning needs a total step deadline`,
      );
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
        `${jobName} Chromium retries need at least ${CHROMIUM_OVERHEAD_MARGIN_SECONDS}s of outer-step overhead margin; budget is ${worstCaseSeconds}s`,
      );
    }
  });
});
