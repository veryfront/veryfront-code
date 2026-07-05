import { assert, assertEquals, assertStringIncludes } from "#std/assert";

const workflow = await Deno.readTextFile(".github/workflows/cicd.yml");
const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
const coverageCiScript = await Deno.readTextFile("scripts/test/coverage-ci.ts");

Deno.test("CI shards Deno unit coverage as portable lcov artifacts", () => {
  assertStringIncludes(workflow, "coverage-shards:");
  assertStringIncludes(workflow, "name: coverage shard ${{ matrix.shard }}/8");
  assertStringIncludes(workflow, "timeout-minutes: 5");
  assertStringIncludes(workflow, "shard: [1, 2, 3, 4, 5, 6, 7, 8]");
  assertStringIncludes(
    workflow,
    "deno task coverage:ci:shard -- --shard=${{ matrix.shard }}/8 --coverage-dir=coverage-shard-${{ matrix.shard }}",
  );
  assertStringIncludes(workflow, "actions/upload-artifact");
  assertStringIncludes(workflow, "name: coverage-shard-${{ matrix.shard }}");
  assertStringIncludes(
    workflow,
    "path: coverage-shard-${{ matrix.shard }}/lcov.info",
  );
});

Deno.test("CI keeps the required coverage gate as a fast merge job", () => {
  assertStringIncludes(workflow, "coverage:");
  assertStringIncludes(workflow, "name: coverage gate");
  assertStringIncludes(workflow, "needs: [coverage-shards]");
  assertStringIncludes(
    workflow,
    "if: ${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}",
  );
  assertStringIncludes(workflow, "timeout-minutes: 5");
  assertStringIncludes(workflow, "actions/download-artifact");
  assertStringIncludes(workflow, "Download unit coverage lcov files");
  assertStringIncludes(workflow, "pattern: coverage-shard-*");
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

Deno.test("deno tasks expose shard and merge coverage entrypoints", () => {
  assertEquals(
    denoJson.tasks["coverage:ci:shard"],
    "deno run --allow-read --allow-write --allow-run --allow-env scripts/test/coverage-ci.ts shard",
  );
  assertEquals(
    denoJson.tasks["coverage:ci:merge"],
    "deno run --allow-read --allow-write --allow-run --allow-env scripts/test/coverage-ci.ts merge",
  );
});

Deno.test("coverage gates require the ratcheted 81 percent floor", () => {
  assertStringIncludes(
    denoJson.tasks["coverage:gate"],
    "scripts/lint/check-coverage.ts 81",
  );
  assertStringIncludes(
    denoJson.tasks["coverage:report"],
    "scripts/lint/check-coverage.ts 81",
  );
  assertStringIncludes(
    coverageCiScript,
    'readOption(args, "--threshold") ?? "81"',
  );
});
