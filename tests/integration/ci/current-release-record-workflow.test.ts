import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { parse } from "#std/yaml/parse";

type YamlRecord = Record<string, unknown>;

const WORKFLOW_PATH = new URL("../../../.github/workflows/cicd.yml", import.meta.url);
const VERSION = "0.1.5-rc.10";
const SOURCE_SHA = "3d43cdfb299f95c9befab12fc67ee310c944a8ba";
const TARBALL_URL =
  `https://github.com/veryfront/veryfront/releases/download/v${VERSION}/veryfront-${VERSION}.tgz`;
const TARBALL = new TextEncoder().encode("veryfront release tarball bytes\n");

function asRecord(value: unknown, context: string): YamlRecord {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context} must be an object`,
  );
  return value as YamlRecord;
}

async function jobs(): Promise<YamlRecord> {
  const workflow = asRecord(parse(await Deno.readTextFile(WORKFLOW_PATH)), "cicd.yml");
  return asRecord(workflow.jobs, "cicd.yml jobs");
}

async function recordStep(): Promise<YamlRecord> {
  const job = asRecord((await jobs())["publish-current-release"], "publish-current-release");
  assert(Array.isArray(job.steps));
  assertEquals(job.steps.length, 1);
  return asRecord(job.steps[0], "record step");
}

async function integrityOf(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
  return `sha512-${btoa(String.fromCharCode(...digest))}`;
}

const FAKE_CURL = `#!/usr/bin/env bash
set -euo pipefail
out=""; url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift 2 ;;
    --max-time|--retry|--proto|--proto-redir) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
echo "$url" >> "$STATE/curl.log"
case "$url" in
  "$EXPECTED_BASE/v$VERSION/veryfront-$VERSION.npm-provenance.json") cp "$FIXTURES/provenance.json" "$out" ;;
  "$EXPECTED_BASE/v$VERSION/veryfront-$VERSION.tgz") cp "$FIXTURES/package.tgz" "$out" ;;
  *) echo "unexpected URL $url" >&2; exit 22 ;;
esac
`;

const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$STATE/gh.log"
[ "$1" = release ] || exit 64
[ "$3" = current-release ] || exit 64
notes() { while [ "$#" -gt 0 ]; do [ "$1" = --notes-file ] && { cp "$2" "$STATE/body"; return; }; shift; done; exit 64; }
case "$2" in
  view)
    if [ -n "\${GH_VIEW_ERROR:-}" ]; then echo "$GH_VIEW_ERROR" >&2; exit 1; fi
    if [ -f "$STATE/body" ]; then cat "$STATE/body"; else echo "release not found" >&2; exit 1; fi ;;
  edit|create) notes "$@" ;;
  *) exit 64 ;;
esac
`;

interface Run {
  output: Deno.CommandOutput;
  gh: string[];
  body: string | undefined;
}

async function run(
  options: { existing?: unknown; provenance?: unknown; env?: Record<string, string> } = {},
): Promise<Run> {
  const step = await recordStep();
  return await withTempDir(async (dir) => {
    const bin = `${dir}/bin`, state = `${dir}/state`, fixtures = `${dir}/fixtures`;
    for (const path of [bin, state, fixtures, `${dir}/runner`]) await Deno.mkdir(path);
    await Deno.writeTextFile(`${bin}/curl`, FAKE_CURL, { mode: 0o755 });
    await Deno.writeTextFile(`${bin}/gh`, FAKE_GH, { mode: 0o755 });
    await Deno.writeFile(`${fixtures}/package.tgz`, TARBALL);
    const provenance = options.provenance ?? {
      schema_version: 1,
      package: { name: "veryfront", version: VERSION, integrity: await integrityOf(TARBALL) },
      git_head: SOURCE_SHA,
      repository: "https://github.com/veryfront/veryfront-code",
    };
    await Deno.writeTextFile(`${fixtures}/provenance.json`, JSON.stringify(provenance));
    if (options.existing !== undefined) {
      await Deno.writeTextFile(
        `${state}/body`,
        typeof options.existing === "string" ? options.existing : JSON.stringify(options.existing),
      );
    }
    const env = asRecord(step.env, "record step env");
    const output = await new Deno.Command("bash", {
      args: ["-c", String(step.run)],
      env: {
        PATH: `${bin}:${Deno.env.get("PATH")}`,
        STATE: state,
        FIXTURES: fixtures,
        EXPECTED_BASE: String(env.RELEASE_BASE),
        RELEASE_BASE: String(env.RELEASE_BASE),
        RECORD_TAG: String(env.RECORD_TAG),
        VERSION,
        GITHUB_SHA: "1111111111111111111111111111111111111111",
        RUNNER_TEMP: `${dir}/runner`,
        GITHUB_STEP_SUMMARY: `${dir}/summary`,
        ...options.env,
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const gh = (await Deno.readTextFile(`${state}/gh.log`).catch(() => "")).trim().split("\n")
      .filter(Boolean);
    const body = await Deno.readTextFile(`${state}/body`).catch(() => undefined);
    return { output, gh, body };
  });
}

function stderr(result: Run): string {
  return new TextDecoder().decode(result.output.stderr);
}

describe("current release record", () => {
  it("is published only after this run dispatched its release to the components", async () => {
    const all = await jobs();
    const gate = asRecord(all["quality-gate-registry"], "quality-gate-registry");
    assertEquals(
      asRecord(gate.outputs, "registry gate outputs").current_release,
      "${{ steps.sandbox-dispatch.outcome == 'success' && steps.version.outputs.version || '' }}",
    );
    assert(Array.isArray(gate.steps));
    const dispatch = gate.steps.map((step) => asRecord(step, "gate step"))
      .find((step) => step.id === "sandbox-dispatch");
    assertEquals(dispatch?.name, "Trigger sandbox deploy");

    const job = asRecord(all["publish-current-release"], "publish-current-release");
    assertEquals(job.needs, ["quality-gate-registry"]);
    assertEquals(job.permissions, { contents: "write" });
    assertEquals(job.concurrency, { group: "veryfront-current-release", queue: "max" });
    for (
      const clause of [
        "github.event_name != 'pull_request'",
        "github.ref == 'refs/heads/main'",
        "needs.quality-gate-registry.result == 'success'",
        "needs.quality-gate-registry.outputs.current_release != ''",
      ]
    ) assertStringIncludes(String(job.if), clause);
    const step = await recordStep();
    assertEquals(step.uses, undefined, "the record job runs fixed workflow code only");
    assertEquals(String(step.run).includes("scripts/"), false);
  });

  it("creates the record from provenance that matches the published tarball", async () => {
    const result = await run();
    assertEquals(result.output.code, 0, stderr(result));
    assertEquals(JSON.parse(result.body ?? ""), {
      schema_version: 1,
      version: VERSION,
      tarball_url: TARBALL_URL,
      integrity: await integrityOf(TARBALL),
      source_sha: SOURCE_SHA,
    });
    const create = result.gh.find((call) => call.startsWith("release create current-release"));
    assert(create, result.gh.join("\n"));
    assertStringIncludes(create, "--prerelease --latest=false");
    assertStringIncludes(create, "--target 1111111111111111111111111111111111111111");
  });

  it("refuses provenance whose integrity differs from the tarball", async () => {
    const result = await run({
      provenance: {
        schema_version: 1,
        package: {
          name: "veryfront",
          version: VERSION,
          integrity: await integrityOf(new Uint8Array([1])),
        },
        git_head: SOURCE_SHA,
        repository: "https://github.com/veryfront/veryfront-code",
      },
    });
    assert(result.output.code !== 0);
    assertEquals(result.body, undefined);
    assertEquals(result.gh.filter((call) => /^release (create|edit)/.test(call)), []);
  });

  it("refuses provenance for another version or with extra fields", async () => {
    for (
      const provenance of [
        {
          schema_version: 1,
          package: {
            name: "veryfront",
            version: "0.1.5-rc.9",
            integrity: await integrityOf(TARBALL),
          },
          git_head: SOURCE_SHA,
          repository: "https://github.com/veryfront/veryfront-code",
        },
        {
          schema_version: 1,
          package: { name: "veryfront", version: VERSION, integrity: await integrityOf(TARBALL) },
          git_head: SOURCE_SHA,
          repository: "https://github.com/veryfront/veryfront-code",
          extra: true,
        },
      ]
    ) {
      const result = await run({ provenance });
      assert(result.output.code !== 0);
      assertEquals(result.body, undefined);
    }
  });

  it("replaces an older record and never moves a newer one back", async () => {
    const older = await run({ existing: { version: "0.1.5-rc.9" } });
    assertEquals(older.output.code, 0, stderr(older));
    assert(older.gh.some((call) => call.startsWith("release edit current-release")));
    assertEquals(JSON.parse(older.body ?? "").version, VERSION);

    for (const newer of ["0.1.5-rc.11", "0.1.5", "0.1.10-rc.1"]) {
      const result = await run({ existing: { version: newer } });
      assertEquals(result.output.code, 0, stderr(result));
      assertEquals(result.gh.filter((call) => /^release (create|edit)/.test(call)), []);
      assertEquals(JSON.parse(result.body ?? "").version, newer);
    }
  });

  it("replaces an unreadable record with the verified one", async () => {
    const result = await run({ existing: "not json" });
    assertEquals(result.output.code, 0, stderr(result));
    assertEquals(JSON.parse(result.body ?? "").version, VERSION);
  });

  it("fails closed when the current record cannot be read", async () => {
    const result = await run({ env: { GH_VIEW_ERROR: "HTTP 502: Bad Gateway" } });
    assert(result.output.code !== 0);
    assertStringIncludes(
      new TextDecoder().decode(result.output.stdout),
      "Could not read the current release record",
    );
    assertEquals(result.gh.filter((call) => /^release (create|edit)/.test(call)), []);
  });

  it("refuses a malformed version before any download", async () => {
    const result = await run({ env: { VERSION: "0.1.5-rc.10/../x" } });
    assert(result.output.code !== 0);
    assertEquals(result.gh, []);
  });
});
