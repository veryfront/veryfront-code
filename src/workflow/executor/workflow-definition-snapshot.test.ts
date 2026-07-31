import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { WaitNodeConfig, WorkflowDefinition, WorkflowNode } from "../types.ts";
import { captureWorkflowDefinition } from "./workflow-definition-snapshot.ts";

function workflowWith(node: WorkflowNode): WorkflowDefinition {
  return { id: "test-workflow", steps: [node] };
}

function step(overrides: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: "step",
    config: { type: "step", tool: "test", ...overrides },
  } as WorkflowNode;
}

describe("workflow definition snapshot", () => {
  it("rejects hostile timer and retry values without invoking Proxy hooks", () => {
    let hooks = 0;
    const hostile = new Proxy({}, {
      get() {
        hooks++;
        throw new Error("must not run");
      },
      getOwnPropertyDescriptor() {
        hooks++;
        throw new Error("must not run");
      },
      ownKeys() {
        hooks++;
        throw new Error("must not run");
      },
    });

    assertThrows(
      () =>
        captureWorkflowDefinition({
          id: "hostile-timeout",
          timeout: hostile as unknown as number,
          steps: [step()],
        }),
      Error,
      "timeout must be a string or number",
    );
    assertThrows(
      () =>
        captureWorkflowDefinition(workflowWith(step({
          retry: { backoff: hostile },
        }))),
      Error,
      "retry backoff must be a string",
    );
    assertThrows(
      () =>
        captureWorkflowDefinition(workflowWith({
          id: "loop",
          config: {
            type: "loop",
            while: () => false,
            steps: [],
            maxIterations: 1,
            iterationTimeout: hostile as unknown as number,
          },
        })),
      Error,
      "iterationTimeout must be a string or number",
    );

    assertEquals(hooks, 0);
  });

  it("rejects invalid executable step contracts at admission", () => {
    assertThrows(
      () => captureWorkflowDefinition(workflowWith(step({ tool: undefined }))),
      Error,
      "must configure exactly one of agent or tool",
    );
    assertThrows(
      () => captureWorkflowDefinition(workflowWith(step({ agent: "agent" }))),
      Error,
      "must configure exactly one of agent or tool",
    );
    assertThrows(
      () => captureWorkflowDefinition(workflowWith(step({ timeout: 0 }))),
      Error,
      "timeout must be greater than zero",
    );
  });

  it("marks raw events using the legacy delay transport name as explicit events", () => {
    const captured = captureWorkflowDefinition(workflowWith({
      id: "not-a-delay",
      config: {
        type: "wait",
        waitType: "event",
        eventName: "__delay__",
        timeout: 5,
        checkpoint: true,
      },
    }));
    const config = captured.steps[0]?.config as WaitNodeConfig & { _waitKind?: string };

    assertEquals(config.eventName, "__delay__");
    assertEquals(config._waitKind, "event");
  });

  it("rejects Proxy callbacks without invoking them", () => {
    let calls = 0;
    const builder = new Proxy(() => [step()], {
      apply() {
        calls++;
        return [step()];
      },
    });

    assertThrows(
      () => captureWorkflowDefinition({ id: "proxy-builder", steps: builder }),
      Error,
      "steps builder must be a non-Proxy function",
    );
    assertEquals(calls, 0);
  });
});
