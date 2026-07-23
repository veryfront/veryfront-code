import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExecuteProjectTaskRunRequest } from "./worker-types.ts";
import {
  assertValidProjectRunWorkerRequest,
  snapshotProjectRunWorkerResult,
} from "./project-run-worker-contract.ts";

function createValidTaskRequest(): ExecuteProjectTaskRunRequest {
  return {
    type: "execute-project-run",
    id: "request-1",
    projectDir: "/project",
    kind: "task",
    targetId: "sync-calendar",
    modules: [{
      file: "file:///project/tasks/sync-calendar.ts",
      dir: "/project/tasks",
      moduleCode: "export default { run: async () => ({ ok: true }) };",
    }],
    config: {},
    projectId: "project-1",
    debug: false,
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    datasetFiles: [],
  };
}

describe("project run Worker contract", () => {
  it("rejects request envelopes whose required fields are inherited", () => {
    const inherited = Object.create(createValidTaskRequest());

    assertThrows(
      () => assertValidProjectRunWorkerRequest(inherited),
      TypeError,
      "request is invalid",
    );
  });

  it("rejects configuration records with a custom prototype", () => {
    const request = createValidTaskRequest();
    request.config = Object.create({ inherited: true });

    assertThrows(
      () => assertValidProjectRunWorkerRequest(request),
      TypeError,
      "config must be an object",
    );
  });

  it("rejects result envelopes whose required fields are inherited", () => {
    const inherited = Object.create({ success: true, durationMs: 0 });

    assertThrows(
      () => snapshotProjectRunWorkerResult(inherited),
      TypeError,
      "result is invalid",
    );
  });

  it("rejects control characters in Worker transport text", () => {
    const request = createValidTaskRequest();
    request.targetId = "sync\ncalendar";

    assertThrows(
      () => assertValidProjectRunWorkerRequest(request),
      TypeError,
      "target id is invalid",
    );
  });
});
