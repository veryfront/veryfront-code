import { parse } from "#std/yaml/parse";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

type YamlRecord = Record<string, unknown>;

const WORKFLOW_PATH = new URL("../../../.github/workflows/cicd.yml", import.meta.url);

function asRecord(value: unknown, context: string): YamlRecord {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context} must be an object`,
  );
  return value as YamlRecord;
}

describe("ci lint workflow", () => {
  it("installs Node 24 before the lint chain runs the guide's TypeScript snippet", async () => {
    // docs:snippets:check runs a .ts file under Node, which needs Node 22.18+.
    const workflow = asRecord(parse(await Deno.readTextFile(WORKFLOW_PATH)), "CI workflow");
    const ci = asRecord(asRecord(workflow.jobs, "CI workflow jobs").ci, "CI workflow job");
    assert(Array.isArray(ci.steps), "CI workflow job must define steps");
    const steps = ci.steps.map((step) => asRecord(step, "CI workflow step"));

    const setupNode = steps.findIndex((step) =>
      String(step.uses ?? "").startsWith("actions/setup-node@")
    );
    const run = steps.findIndex((step) => step.name === "Run ${{ matrix.check }}");
    assert(setupNode !== -1, "the ci job must set up Node");
    assert(setupNode < run, "Node must be set up before the lint chain runs");
    assertEquals(asRecord(steps[setupNode]?.with, "setup-node inputs")["node-version"], "24");
  });
});
