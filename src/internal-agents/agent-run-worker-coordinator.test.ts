import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRunControlBindingError, AgentRunControlRouter } from "./run-control.ts";
import {
  AgentRunWorkerCapacityError,
  AgentRunWorkerCoordinator,
  type AgentRunWorkerTransport,
  AgentRunWorkerUnavailableError,
} from "./agent-run-worker-coordinator.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import type {
  AgentRunWorkerControlCommand,
  AgentRunWorkerControlResult,
} from "#veryfront/security/sandbox/agent-run-worker-contract.ts";

const binding = {
  projectId: "10000000-1000-4000-8000-100000000005",
  projectSlug: "demo-project",
};

class RecordingTransport implements AgentRunWorkerTransport {
  readonly commands: AgentRunWorkerControlCommand[] = [];
  readonly terminations: string[] = [];

  constructor(
    private readonly respond: (
      command: AgentRunWorkerControlCommand,
    ) => AgentRunWorkerControlResult | Promise<AgentRunWorkerControlResult>,
  ) {}

  requestControl(command: AgentRunWorkerControlCommand): Promise<AgentRunWorkerControlResult> {
    this.commands.push(command);
    return Promise.resolve(this.respond(command));
  }

  terminate(reason: string): void {
    this.terminations.push(reason);
  }
}

function successResult(command: AgentRunWorkerControlCommand): AgentRunWorkerControlResult {
  return command.type === "agent-run-resume"
    ? {
      type: "agent-run-control-result",
      commandId: command.commandId,
      runId: command.runId,
      operation: "resume",
      ok: true,
      accepted: true,
    }
    : {
      type: "agent-run-control-result",
      commandId: command.commandId,
      runId: command.runId,
      operation: command.type === "agent-run-cancel" ? "cancel" : "detach",
      ok: true,
      accepted: true,
    };
}

describe("internal-agents/agent-run-worker-coordinator", () => {
  it("routes resume commands asynchronously to the worker that owns the run", async () => {
    const coordinator = new AgentRunWorkerCoordinator();
    const transport = new RecordingTransport(successResult);
    coordinator.registerRun({ runId: "run_1", binding, transport });

    assertEquals(
      await coordinator.submitToolResult("run_1", {
        toolCallId: "tool_1",
        result: { ok: true },
      }, binding),
      { accepted: true },
    );
    assertEquals(transport.commands[0]?.type, "agent-run-resume");
  });

  it("rejects a different signed project before contacting the worker", async () => {
    const coordinator = new AgentRunWorkerCoordinator();
    const transport = new RecordingTransport(successResult);
    coordinator.registerRun({ runId: "run_1", binding, transport });

    await assertRejects(
      () =>
        coordinator.submitToolResult("run_1", {
          toolCallId: "tool_1",
          result: null,
        }, { ...binding, projectSlug: "other-project" }),
      AgentRunControlBindingError,
    );
    assertEquals(transport.commands, []);
  });

  it("terminates and tombstones a worker after explicit cancellation", async () => {
    const coordinator = new AgentRunWorkerCoordinator();
    const transport = new RecordingTransport(successResult);
    coordinator.registerRun({ runId: "run_1", binding, transport });

    assertEquals(await coordinator.cancelRun("run_1", binding), true);
    assertEquals(transport.terminations, ["cancelled"]);
    assertEquals(coordinator.getRunOwnership("run_1", binding), "owned");
    assertEquals(await coordinator.cancelRun("run_1", binding), false);
  });

  it("enforces the isolated-run concurrency limit", () => {
    const coordinator = new AgentRunWorkerCoordinator({ maxConcurrentRuns: 1 });
    coordinator.registerRun({
      runId: "run_1",
      binding,
      transport: new RecordingTransport(successResult),
    });
    assertThrows(
      () =>
        coordinator.registerRun({
          runId: "run_2",
          binding,
          transport: new RecordingTransport(successResult),
        }),
      AgentRunWorkerCapacityError,
    );
  });

  it("terminates an unresponsive worker on a bounded control timeout", async () => {
    const coordinator = new AgentRunWorkerCoordinator({ controlTimeoutMs: 5 });
    const transport = new RecordingTransport(() => new Promise(() => {}));
    coordinator.registerRun({ runId: "run_1", binding, transport });

    await assertRejects(
      () => coordinator.cancelRun("run_1", binding),
      AgentRunWorkerUnavailableError,
    );
    assertEquals(transport.terminations, ["control-timeout"]);
  });

  it("falls back to local sessions only when no isolated owner or tombstone exists", async () => {
    const coordinator = new AgentRunWorkerCoordinator();
    const local = new AgentRunSessionManager();
    const router = new AgentRunControlRouter(coordinator, local);
    local.startRun({ runId: "local_1", threadId: crypto.randomUUID() });
    local.prepareForToolResult("local_1", "tool_1");

    assertEquals(
      await router.submitToolResult("local_1", {
        toolCallId: "tool_1",
        result: "done",
      }, binding),
      { accepted: true },
    );

    const transport = new RecordingTransport(successResult);
    coordinator.registerRun({ runId: "remote_1", binding, transport });
    await coordinator.cancelRun("remote_1", binding);
    await assertRejects(
      () =>
        router.submitToolResult("remote_1", {
          toolCallId: "tool_1",
          result: "late",
        }, binding),
      Error,
      "not active",
    );
  });
});
