import "#veryfront/schemas/_test-setup.ts";
import type { DiscoveryResult } from "#veryfront/discovery";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findProjectRuntimeTask,
  formatProjectRuntimeDiscoveryErrors,
  listProjectRuntimeTasks,
} from "./project-runtime.ts";
import type { TaskDefinition } from "./types.ts";

function taskDiscovery(
  entries: Array<[string, TaskDefinition]>,
): DiscoveryResult {
  return { tasks: new Map(entries) } as Pick<DiscoveryResult, "tasks"> as DiscoveryResult;
}

describe("task/project-runtime", () => {
  it("finds a task without replacing its captured definition", () => {
    const definition = { name: "Sync data", run() {} };
    const task = findProjectRuntimeTask(
      taskDiscovery([["sync", definition]]),
      "sync",
    );

    assertEquals(task?.id, "sync");
    assertEquals(task?.name, "Sync data");
    assertStrictEquals(task?.definition, definition);
    assertEquals(
      findProjectRuntimeTask(taskDiscovery([["sync", definition]]), "missing"),
      null,
    );
  });

  it("uses the stable task id when a discovered name is absent or blank", () => {
    const unnamed = { run() {} };
    const blank = { name: "  ", run() {} };

    assertEquals(
      findProjectRuntimeTask(taskDiscovery([["unnamed", unnamed]]), "unnamed")
        ?.name,
      "unnamed",
    );
    assertEquals(
      findProjectRuntimeTask(taskDiscovery([["blank", blank]]), "blank")?.name,
      "blank",
    );
  });

  it("lists tasks in stable id order with resolved names", () => {
    const first = { run() {} };
    const last = { name: "Last task", run() {} };

    const tasks = listProjectRuntimeTasks(taskDiscovery([
      ["z-last", last],
      ["a-first", first],
    ]));

    assertEquals(
      tasks.map(({ id, name }) => ({ id, name })),
      [
        { id: "a-first", name: "a-first" },
        { id: "z-last", name: "Last task" },
      ],
    );
    assertStrictEquals(tasks[0]?.definition, first);
    assertStrictEquals(tasks[1]?.definition, last);
  });

  it("formats every discovery error with its source file", () => {
    const errors: DiscoveryResult["errors"] = [
      { file: "tools/first.ts", error: new Error("missing first import") },
      { file: "tools/second.ts", error: new Error("missing second import") },
    ];

    assertEquals(formatProjectRuntimeDiscoveryErrors(errors), [
      "tools/first.ts: missing first import",
      "tools/second.ts: missing second import",
    ]);
  });
});
