import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as discoveryModule from "./discovery.ts";
import * as taskModule from "./index.ts";
import * as projectRuntimeModule from "./project-runtime.ts";
import * as publicTaskModule from "veryfront/task";
import * as runnerModule from "./runner.ts";
import * as typesModule from "./types.ts";

const expectedRuntimeExports = [
  "deriveTaskId",
  "discoverProjectTaskRuntime",
  "discoverTasks",
  "findProjectRuntimeTask",
  "findTaskById",
  "formatProjectRuntimeDiscoveryErrors",
  "isTaskDefinition",
  "listProjectRuntimeTasks",
  "runTask",
];

describe("task/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/task", () => {
    assertEquals(Object.keys(taskModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicTaskModule).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their owning modules", () => {
    assertStrictEquals(taskModule.deriveTaskId, discoveryModule.deriveTaskId);
    assertStrictEquals(taskModule.discoverTasks, discoveryModule.discoverTasks);
    assertStrictEquals(taskModule.findTaskById, discoveryModule.findTaskById);
    assertStrictEquals(taskModule.runTask, runnerModule.runTask);
    assertStrictEquals(taskModule.isTaskDefinition, typesModule.isTaskDefinition);
    assertStrictEquals(
      taskModule.discoverProjectTaskRuntime,
      projectRuntimeModule.discoverProjectTaskRuntime,
    );
    assertStrictEquals(
      taskModule.findProjectRuntimeTask,
      projectRuntimeModule.findProjectRuntimeTask,
    );
    assertStrictEquals(
      taskModule.formatProjectRuntimeDiscoveryErrors,
      projectRuntimeModule.formatProjectRuntimeDiscoveryErrors,
    );
    assertStrictEquals(
      taskModule.listProjectRuntimeTasks,
      projectRuntimeModule.listProjectRuntimeTasks,
    );
    assertStrictEquals(publicTaskModule.runTask, taskModule.runTask);
    assertStrictEquals(
      publicTaskModule.discoverProjectTaskRuntime,
      taskModule.discoverProjectTaskRuntime,
    );
  });
});
