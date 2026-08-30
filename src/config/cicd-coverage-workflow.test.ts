import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { fromFileUrl } from "#veryfront/platform/compat/path/index.ts";

/**
 * Repo files are resolved from this module's own location, never from the
 * process cwd, and are read inside each test rather than at module scope.
 *
 * Both parts matter, and both were learned the hard way:
 *
 * 1. NOT CWD-RELATIVE. Test files are separate isolates sharing ONE process
 *    under `--parallel`, and `src/testing/cwd.ts` chdirs that shared process
 *    (see its own header: "mutates state shared by every test in the process").
 *    It restores in a `finally`, but that only closes the window afterwards — a
 *    concurrent reader inside the window still resolves against the wrong
 *    directory. Which files share a process is decided by the suite planner's
 *    ordinal shard selection (`index % shard count` over the sorted file list), so adding
 *    any test file anywhere reshuffles the pairing. This module read repo files
 *    by cwd-relative path and failed in CI with `NotFound: readfile
 *    '.github/workflows/cicd.yml'` the moment a shard reshuffle put it beside a
 *    chdir. Resolving through `import.meta.url` removes the dependency instead
 *    of trying to coordinate with other tests.
 *
 * 2. NOT AT MODULE SCOPE. A top-level `await` that throws is an *uncaught*
 *    module error: the runner fails the whole file, the shard fails, and
 *    because `tests (unit)` and `coverage gate` both depend on the shard job,
 *    one missing file surfaced as THREE red checks with no useful message.
 *    Read inside the test and the same failure is one legible failing test.
 *
 * The reads go through `#veryfront/platform/compat/fs.ts` rather than the
 * runtime global so this file keeps running on all three runtimes — see the
 * guard at the bottom.
 */
const repoRoot = new URL("../../", import.meta.url);

const readRepoFile = (path: string): Promise<string> =>
  readTextFile(fromFileUrl(new URL(path, repoRoot)));

const readWorkflow = () => readRepoFile(".github/workflows/cicd.yml");

/**
 * Asserts the task exists rather than casting the lookup. A renamed or deleted
 * task is exactly what this test guards, so it should report that by name
 * instead of failing on an `undefined` comparison.
 */
const readDenoTask = async (name: string): Promise<string> => {
  const config = JSON.parse(await readRepoFile("deno.json")) as {
    tasks?: Record<string, string | undefined>;
  };
  const task = config.tasks?.[name];
  assert(
    typeof task === "string",
    `deno.json defines no "${name}" task`,
  );
  return task;
};

/**
 * Slices one job out of the workflow. Job-level and step-level settings are
 * spelled identically (`timeout-minutes: 5` sits on the setup-deno step of a
 * dozen jobs), so a whole-file substring search cannot tell the coverage gate's
 * own timeout from any other job's step timeout. Scope the text first, then
 * match the four-space job-level indent.
 */
const jobBlock = (workflow: string, jobId: string): string => {
  const start = workflow.search(new RegExp(`^ {2}${jobId}:$`, "m"));
  assert(
    start !== -1,
    `.github/workflows/cicd.yml defines no "${jobId}" job`,
  );
  const body = workflow.slice(start);
  const next = body.slice(1).search(/^ {2}\S/m);
  return next === -1 ? body : body.slice(0, next + 1);
};

/**
 * Reads a job's own `timeout-minutes`, which is indented four spaces. Step
 * timeouts sit eight spaces deep and are excluded by the indent alone.
 */
const jobTimeoutMinutes = (workflow: string, jobId: string): number =>
  Number(jobBlock(workflow, jobId).match(/^ {4}timeout-minutes: (\d+)$/m)?.[1]);

/**
 * Slices the setup-deno step out of a job and reads its timeout on its own,
 * so an unrelated key added to the step (name:, id:) or reordered keys cannot
 * fail the invariant.
 */
const assertSetupDenoStepTimeout = (workflow: string, jobId: string): void => {
  const setupDenoStep = jobBlock(workflow, jobId)
    .split(/\n(?= {6}- )/)
    .find((step) => step.includes("uses: ./.github/actions/setup-deno"));
  assert(
    setupDenoStep !== undefined,
    `${jobId} job must run ./.github/actions/setup-deno`,
  );
  assertMatch(
    setupDenoStep,
    /^ {8}timeout-minutes: 5$/m,
    `setup-deno step timeout must stay at 5 minutes inside the ${jobId} job`,
  );
};

describe("cicd coverage workflow", () => {
  it("shards unit coverage as portable lcov artifacts", async () => {
    const workflow = await readWorkflow();

    assertStringIncludes(workflow, "coverage-shards:");
    assertStringIncludes(workflow, "name: coverage shard ${{ matrix.shard }}/4");
    assertEquals(
      jobTimeoutMinutes(workflow, "coverage-shards"),
      20,
      "coverage shard job-level timeout must stay at 20 minutes",
    );
    assertSetupDenoStepTimeout(workflow, "coverage-shards");
    assertStringIncludes(workflow, "shard: [1, 2, 3, 4]");
    assertStringIncludes(
      workflow,
      "deno task coverage:ci:shard -- --shard=${{ matrix.shard }}/4 --coverage-dir=coverage-shard-${{ matrix.shard }}",
    );
    assertStringIncludes(workflow, "actions/upload-artifact");
    assertStringIncludes(workflow, "name: coverage-shard-${{ matrix.shard }}");
    assertStringIncludes(
      workflow,
      "path: coverage-shard-${{ matrix.shard }}/lcov.info",
    );
  });

  it("keeps the required coverage gate as a fast merge job", async () => {
    const workflow = await readWorkflow();

    assertStringIncludes(workflow, "coverage:");
    assertStringIncludes(workflow, "name: coverage gate");
    assertStringIncludes(workflow, "needs: [coverage-shards]");
    assertStringIncludes(
      workflow,
      "if: ${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}",
    );
    assertEquals(
      jobTimeoutMinutes(workflow, "coverage"),
      10,
      "coverage gate job-level timeout must stay a fast 10 minutes so the required merge check cannot stall a PR",
    );
    assertSetupDenoStepTimeout(workflow, "coverage");
    assertStringIncludes(workflow, "actions/download-artifact");
    assertStringIncludes(workflow, "Download unit coverage lcov files");
    assertStringIncludes(workflow, "pattern: coverage-shard-*");
    assertStringIncludes(workflow, "sonar:");
    assertStringIncludes(workflow, "name: sonar");
    assertStringIncludes(
      await readRepoFile("sonar-project.properties"),
      "sonar.javascript.node.maxspace=8192",
    );
    assertStringIncludes(
      workflow,
      "deno task coverage:ci:merge coverage-profiles/coverage-shard-*",
    );
    assert(!workflow.includes("timeout_minutes: 22"));
    assert(
      !workflow.includes(
        "command: VF_DISABLE_LRU_INTERVAL=1 deno task coverage:ci",
      ),
    );
  });

  it("exposes shard and merge coverage entrypoints as tasks", async () => {
    assertEquals(
      await readDenoTask("coverage:ci:shard"),
      "deno run --config=scripts/test.deno.json --allow-read --allow-write --allow-run --allow-env scripts/test/coverage-ci.ts shard",
    );
    assertEquals(
      await readDenoTask("coverage:ci:merge"),
      "deno run --config=scripts/test.deno.json --no-npm --allow-read --allow-write --allow-run --allow-env scripts/test/coverage-ci.ts merge",
    );
  });

  it("gates coverage on the ratcheted 80 percent floor", async () => {
    const coverageCiScript = await readRepoFile("scripts/test/coverage-ci.ts");

    assertStringIncludes(
      await readDenoTask("coverage:gate"),
      "scripts/lint/check-coverage.ts 80",
    );
    assertStringIncludes(
      await readDenoTask("coverage:report"),
      "scripts/lint/check-coverage.ts 80",
    );
    assertStringIncludes(
      coverageCiScript,
      'readOption(args, "--threshold") ?? "80"',
    );
  });

  it("keeps every Deno unit coverage path loopback-only", async () => {
    const providerDenyNet =
      "--deny-net=api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.mistral.ai,api.groq.com,api.deepseek.com,openrouter.ai,mcp.context7.com";
    const loopbackAllowNet = "--allow-net=127.0.0.1,localhost,0.0.0.0,[::1],[::]";

    // Integration lanes retain the provider deny-list. Unit coverage imports
    // the stronger loopback-only grant from the same central suite contract.
    const suitesScript = await readRepoFile("scripts/test/suites.ts");
    for (const host of providerDenyNet.slice("--deny-net=".length).split(",")) {
      assertStringIncludes(suitesScript, `"${host}"`);
    }
    assertStringIncludes(suitesScript, loopbackAllowNet);
    for (
      const script of [
        await readRepoFile("scripts/test/coverage-ci.ts"),
        await readRepoFile("scripts/test/run-deno-suite.ts"),
      ]
    ) {
      assertStringIncludes(script, "LOOPBACK_TEST_PERMISSIONS");
      assertStringIncludes(script, 'from "./suites.ts"');
    }

    const legacyCoverageTask = await readDenoTask("test:coverage");
    assertStringIncludes(legacyCoverageTask, "deno task test:coverage:unit");
    assertEquals(legacyCoverageTask.includes("--allow-all"), false);
    assertEquals(legacyCoverageTask.includes("--deny-net="), false);
    const preload = await readRepoFile("src/testing/preload.ts");
    const runtimePrefix = ["De", "no", "."].join("");
    assertStringIncludes(preload, `${runtimePrefix}makeTempDirSync`);
    assertStringIncludes(preload, "__setHttpModuleCacheDirResolverForTests");
    assertStringIncludes(preload, "__setDistributedCacheFallbackForTests");
    assertStringIncludes(preload, "await prepareOfflineReactModulesForTests()");
    assertStringIncludes(preload, `${runtimePrefix}removeSync`);
    assertStringIncludes(
      await readDenoTask("test:coverage:unit"),
      "run-deno-suite.ts --suite=coverage:unit",
    );
    assertStringIncludes(
      await readDenoTask("test:coverage:integration"),
      "run-deno-suite.ts --suite=coverage:integration",
    );
  });

  it("stays runnable on every runtime, not just the one with the global", async () => {
    // `tests/node/run-tests.mjs` drops any file under src/ whose source mentions
    // the runtime global, and `tests/bun/run-tests.mjs` shares that list. This
    // file used the global for both its test registration and its reads, so
    // every assertion above ran on exactly one of the three runtimes and the
    // other two reported a silent pass. Assert the property the runner filters
    // on, so the gap cannot reopen unnoticed.
    //
    // The needle is spelled in parts because a literal occurrence here would
    // itself trip the filter this test exists to satisfy.
    const runtimeGlobal = ["De", "no", "."].join("");
    const source = await readRepoFile("src/config/cicd-coverage-workflow.test.ts");

    assert(
      !source.includes(runtimeGlobal),
      `This test must not use the ${runtimeGlobal}* global — it would be excluded ` +
        `from the Node and Bun runners, leaving its assertions unverified there.`,
    );
  });
});
