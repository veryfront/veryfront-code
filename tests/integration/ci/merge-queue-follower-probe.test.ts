import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as RecordValue;
}

describe("issue 2442 never-merge follower", () => {
  it("fails closed after the unchanged Node runtime shard", async () => {
    const workflow = record(parse(
      await Deno.readTextFile(
        new URL("../../../.github/workflows/cicd.yml", import.meta.url),
      ),
    ));
    const jobs = record(workflow.jobs);
    const node = record(jobs["tests-node"]);
    assert(Array.isArray(node.steps));
    const normalIndex = node.steps.findIndex((step) =>
      record(step).name === "Run Node runtime shard"
    );
    assert(normalIndex >= 0);
    const normal = record(node.steps[normalIndex]);
    assertEquals(normal.run, "node ./tests/node/run-tests.mjs --suite=runtime:node");
    const fault = record(node.steps[normalIndex + 1]);
    assertEquals(fault.name, "Issue 2442 never-merge follower probe");
    assertEquals(fault.if, "${{ github.event_name == 'merge_group' && matrix.shard == 2 }}");
    assertEquals(fault["continue-on-error"], undefined);
    const output = await new Deno.Command("bash", {
      args: ["-e", "-o", "pipefail", "-c", String(fault.run)],
      env: { GITHUB_REF: "" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 1);
  });
});
