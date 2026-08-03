import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { parse } from "#std/yaml/parse";

const ACTION_PATH = ".github/actions/setup-deno/action.yml";
const WORKFLOWS_DIR = ".github/workflows";
const LOCAL_ACTION = "./.github/actions/setup-deno";
const CACHE_ACTION = "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9";
const MAX_SETUP_MINUTES = 5;

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

async function parseYamlFile(path: string): Promise<YamlRecord> {
  return asRecord(parse(await Deno.readTextFile(path)), path);
}

async function workflowPathsUsingSetupDeno(): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (!entry.isFile || !/\.ya?ml$/.test(entry.name)) continue;
    const path = `${WORKFLOWS_DIR}/${entry.name}`;
    if ((await Deno.readTextFile(path)).includes(`uses: ${LOCAL_ACTION}`)) {
      paths.push(path);
    }
  }
  return paths.sort();
}

describe("setup-deno CI contract", () => {
  it("uses a pinned cache and bounded, frozen dependency warming", async () => {
    const action = await parseYamlFile(ACTION_PATH);
    const runs = asRecord(action.runs, `${ACTION_PATH}.runs`);
    const steps = asSteps(runs.steps, `${ACTION_PATH}.runs.steps`);

    const cacheStep = steps.find((step) => step.uses === CACHE_ACTION);
    assert(cacheStep, "setup-deno must use the pinned actions/cache release");
    const cacheEnv = asRecord(cacheStep.env, "cache step env");
    assertEquals(cacheEnv.SEGMENT_DOWNLOAD_TIMEOUT_MINS, "2");
    const cacheInputs = asRecord(cacheStep.with, "cache step inputs");
    const cacheKey = String(cacheInputs.key);
    assertStringIncludes(cacheKey, "${{ runner.os }}");
    assertStringIncludes(cacheKey, "${{ runner.arch }}");
    assertStringIncludes(cacheKey, "2.7.7");
    assertStringIncludes(cacheKey, "hashFiles(");
    assertStringIncludes(String(cacheInputs.path), "runner.temp");

    const installStep = steps.find((step) =>
      step.name === "Install pinned Deno"
    );
    assert(installStep, "setup-deno must install Deno explicitly");
    const install = String(installStep.run);
    assertStringIncludes(install, 'version="2.7.7"');
    assertStringIncludes(install, "--retry-max-time 120");
    assertMatch(install, /--connect-timeout\s+20\s+--max-time\s+120/);
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
      const [name, step, deadline] of [
        ["Redis", redisWarm, "2m"],
        ["dependency", dependencyWarm, "3m"],
      ] as const
    ) {
      const condition = String(step.if);
      const command = String(step.run);
      assertStringIncludes(condition, "steps.deno-cache.outputs.cache-hit");
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

  it("caps every workflow setup call and keeps fork PRs out of cache writes", async () => {
    const workflowPaths = await workflowPathsUsingSetupDeno();
    assert(
      workflowPaths.length > 0,
      "at least one workflow must use setup-deno",
    );

    let setupCalls = 0;
    for (const path of workflowPaths) {
      const workflow = await parseYamlFile(path);
      const jobs = asRecord(workflow.jobs, `${path}.jobs`);
      for (const [jobName, value] of Object.entries(jobs)) {
        const job = asRecord(value, `${path}.jobs.${jobName}`);
        const steps = asSteps(job.steps, `${path}.jobs.${jobName}.steps`);
        const setupSteps = steps.filter((step) => step.uses === LOCAL_ACTION);
        for (const step of setupSteps) {
          setupCalls++;
          assertEquals(
            step["timeout-minutes"],
            MAX_SETUP_MINUTES,
            `${path} ${jobName} setup-deno must leave time for job work`,
          );
          const inputs = asRecord(step.with ?? {}, "setup inputs");
          if (
            inputs["warm-cache"] === "true" ||
            inputs["warm-redis-cache"] === "true"
          ) {
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
        }
      }
    }

    assert(setupCalls > 0, "setup-deno workflow calls must be inspected");

    const ci = await parseYamlFile(`${WORKFLOWS_DIR}/cicd.yml`);
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
  });
});
