import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { parse } from "#std/yaml/parse";

const PROBE_PATH = "scripts/ci/probe-localhost-resolution.mjs";
const WORKFLOW_PATH = ".github/workflows/cicd.yml";
const HOSTNAMES = ["veryfront-probe.localhost", "veryfront-probe.preview.localhost"];

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as JsonRecord;
}

async function runProbe(runtime: "node" | "deno"): Promise<JsonRecord[]> {
  const command = runtime === "node" ? "node" : Deno.execPath();
  const args = runtime === "node" ? [PROBE_PATH] : ["run", "--allow-net", PROBE_PATH];
  const output = await new Deno.Command(command, { args }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim().split("\n")
    .map((line) => record(JSON.parse(line), `${runtime} probe record`));
}

describe("wildcard localhost Windows contract", () => {
  for (const runtime of ["node", "deno"] as const) {
    it(`records ${runtime} resolution without leaking resolver detail`, async () => {
      const results = await runProbe(runtime);

      assertEquals(results.map((result) => result.hostname), HOSTNAMES);
      for (const result of results) {
        assertStringIncludes(String(result.runtime), runtime);
        assertEquals(typeof result.resolved, "boolean");
        assert(Array.isArray(result.addressFamilies), "address families must be an array");
        assertEquals(
          "message" in result || "addresses" in result,
          false,
          "resolver reports must omit machine-specific infrastructure detail",
        );
        if (result.resolved) {
          assertEquals(typeof result.loopbackOnly, "boolean");
        } else {
          assertEquals(typeof result.errorCode, "string");
        }
      }
    });
  }

  it("runs resolver, native routing, and browser routing coverage on Windows", async () => {
    const workflow = record(parse(await Deno.readTextFile(WORKFLOW_PATH)), "workflow");
    const jobs = record(workflow.jobs, "workflow jobs");
    const job = record(jobs["tests-windows-localhost"], "Windows localhost job");
    const steps = job.steps;
    assert(Array.isArray(steps), "Windows localhost job steps must be an array");

    assertEquals(job["runs-on"], "windows-2022");
    assertEquals(job["continue-on-error"], undefined);
    const namedSteps = new Map(
      steps.map((value) => {
        const step = record(value, "Windows localhost step");
        return [step.name, step];
      }),
    );
    const probe = record(namedSteps.get("Record wildcard localhost resolution"), "resolver step");
    assertStringIncludes(String(probe.run), `node ${PROBE_PATH}`);
    assertStringIncludes(String(probe.run), `deno run --allow-net ${PROBE_PATH}`);

    const routing = record(namedSteps.get("Exercise local virtual-host routing"), "routing step");
    assertStringIncludes(String(routing.run), "scripts/ci/run-windows-localhost-e2e.ts");
    assertEquals(
      record(routing.env ?? {}, "routing environment").PW_DISABLE_TS_ESM,
      undefined,
      "the E2E package is native ESM and must not be forced through the CommonJS transformer",
    );

    const e2ePackage = record(
      JSON.parse(await Deno.readTextFile("tests/e2e/package.json")),
      "E2E package",
    );
    assertEquals(e2ePackage.type, "module");
    const denoConfig = record(
      JSON.parse(await Deno.readTextFile("deno.json")),
      "Deno config",
    );
    const tasks = record(denoConfig.tasks, "Deno tasks");
    assertEquals(
      String(tasks["test:e2e:playwright"]).includes("PW_DISABLE_TS_ESM"),
      false,
      "the documented E2E task must use the same working ESM path as Windows CI",
    );

    for (const releaseJobName of ["prerelease", "release"]) {
      const releaseJob = record(jobs[releaseJobName], `${releaseJobName} job`);
      assert(Array.isArray(releaseJob.needs), `${releaseJobName} needs must be an array`);
      assert(
        releaseJob.needs.includes("tests-windows-localhost"),
        `${releaseJobName} must wait for Windows localhost coverage`,
      );
    }
  });
});
