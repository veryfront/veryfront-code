import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatProjectRuntimeDiscoveryErrors } from "../../../src/task/project-runtime.ts";
import { formatRuntimeDiscoveryWarningLines, parseTaskConfig, taskSourceLabel } from "./command.ts";

describe("task command diagnostics", () => {
  it("uses a concise label for local task discovery", () => {
    assertEquals(taskSourceLabel(undefined), "local tasks");
    assertEquals(taskSourceLabel(null), "local tasks");
    assertEquals(taskSourceLabel({}), "main");
    assertEquals(taskSourceLabel({ branchRef: "feature/task" }), "branch feature/task");
    assertEquals(
      taskSourceLabel({ branchRef: "/" + "private/project" }),
      "branch <LOCAL_PATH>",
    );
    assertEquals(
      taskSourceLabel({ branchRef: "Authorization: Bearer <TOKEN>" }),
      "branch Authorization: Bearer [REDACTED]",
    );
    assertEquals(taskSourceLabel({ branchRef: "feature\nforged" }), "branch feature forged");
  });

  it("accepts only JSON objects as task configuration", () => {
    assertEquals(parseTaskConfig(undefined), {});
    assertEquals(parseTaskConfig('{"batchSize":10}'), { batchSize: 10 });
    for (const value of ["null", "[]", '"text"', "42", "not-json"]) {
      let rejected = false;
      try {
        parseTaskConfig(value);
      } catch {
        rejected = true;
      }
      assert(rejected, `Expected config to be rejected: ${value}`);
    }
  });

  it("formats debug warnings through the shared bounded formatter", () => {
    const projectDir = "/" + "private/project";
    const rawPath = `${projectDir}/tasks/private.ts`;
    const lines = formatRuntimeDiscoveryWarningLines(
      formatProjectRuntimeDiscoveryErrors(
        [{
          file: rawPath,
          error: new Error(
            `Could not load ${rawPath}: https://user:<TOKEN>@example.test/task`,
          ),
        }],
        projectDir,
      ),
      true,
    );

    assertEquals(lines.length, 1);
    assert(lines[0]?.startsWith("  Warning: tasks/private.ts: "));
    assert(!lines[0]?.includes(projectDir));
    assert(!lines[0]?.includes("user:<TOKEN>"));
  });

  it("does not format discovery failures unless debug output is enabled", () => {
    const lines = formatRuntimeDiscoveryWarningLines(
      ["must not be emitted"],
      false,
    );

    assertEquals(lines, []);
  });
});
