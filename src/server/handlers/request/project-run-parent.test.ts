import { MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES } from "#veryfront/agent/conversation/run-event-limits.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readProjectExecutionParent } from "./project-run-parent.ts";

const runId = "run_parent";
const projectId = "project_parent";
const parent = {
  canonicalRunId: "11111111-1111-4111-8111-111111111111",
  attemptId: "attempt",
  workerId: "worker",
};

function writerToken(length: number): string {
  const payload = btoa(JSON.stringify({
    tokenUse: "run_event_writer",
    runId,
    projectId,
    projectExecutionAttempt: parent,
    integrationGrants: "x".repeat(14 * 1024),
  }));
  const prefix = `test.${payload}.`;
  return prefix + "s".repeat(length - prefix.length);
}

describe("project execution parent writer authority", () => {
  it("accepts the supported root writer token size with integration grants", () => {
    const token = writerToken(MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES);
    assertEquals(token.length, MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES);
    assertEquals(readProjectExecutionParent(token, runId, projectId), {
      canonicalRunId: parent.canonicalRunId,
      attemptId: parent.attemptId,
    });
  });

  it("rejects writer tokens above the shared root writer limit", () => {
    assertThrows(() =>
      readProjectExecutionParent(
        writerToken(MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES + 1),
        runId,
        projectId,
      )
    );
  });

  it("rejects a supported-size token for another project", () => {
    assertThrows(() =>
      readProjectExecutionParent(
        writerToken(MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES),
        runId,
        "another-project",
      )
    );
  });
});
