import { acceptWorkflowInheritedRunAdmission } from "#veryfront/agent/hosted/terminal-credential.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent/factory.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { StepExecutor } from "#veryfront/workflow/executor/step-executor.ts";
import { DAGExecutor } from "#veryfront/workflow/executor/dag/index.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { WorkflowNode, WorkflowRun } from "#veryfront/workflow/types.ts";
import { step } from "#veryfront/workflow/dsl/step.ts";
import {
  executeLocalChild,
  observeGeneratedAgentTurn,
} from "#veryfront/agent/composition/local-child-execution.ts";
import { createWorkflowAgentNodeRunner } from "./workflow-agent-child.ts";
import { getActiveHostedRunEventWriterCapability } from "#veryfront/agent/hosted/child-run-event-writer-token.ts";

const parentId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const encode = (value: unknown) => `test.${btoa(JSON.stringify(value))}.signature`;
const eventToken = encode({
  tokenUse: "run_event_writer",
  runId: "run_parent",
  projectId: "project",
  projectExecutionAttempt: { canonicalRunId: parentId, workerId: "worker", attemptId: "attempt" },
});
const terminalToken = encode({
  tokenUse: "run_event_writer",
  writerPurpose: "current_run_terminal",
  runId: "run_child",
  projectId: "project",
  canonicalRunId: childId,
  dispatchNonce: "nonce",
});
const json = (value: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
function admission(
  status = "running",
  output: unknown = null,
  id = childId,
  publicId = "run_child",
  parent = parentId,
) {
  return json(
    {
      id,
      status,
      output,
      project_id: "project",
      parent_run_id: parent,
      target: { type: "agent", id: "coordinator" },
      conversation_id: conversationId,
      output_message_id: "44444444-4444-4444-8444-444444444444",
    },
    202,
    {
      "Cache-Control": "no-store",
      "X-Veryfront-Run-Terminal-Token": id === childId ? terminalToken : encode({
        tokenUse: "run_event_writer",
        writerPurpose: "current_run_terminal",
        runId: publicId,
        projectId: "project",
        canonicalRunId: id,
        dispatchNonce: "nonce-child",
      }),
      "X-Veryfront-Run-Invocation-Token": "child-invocation",
      "X-Veryfront-Run-Event-Token": "child-event",
      "X-Veryfront-Run-Renewal-Token": "child-renewal",
      "X-Veryfront-Run-Lease-Expires-At": new Date(Date.now() + 60000).toISOString(),
      "X-Veryfront-Run-Event-Sequence": "0",
      "X-Veryfront-Run-External-Event-Sequence": "0",
    },
  );
}
function runner(send: typeof fetch, token = eventToken) {
  return createWorkflowAgentNodeRunner({
    runId: "run_parent",
    projectId: "project",
    apiUrl: "https://api.example.test",
    eventToken: token,
    authToken: "parent-invocation",
    fetch: send,
  });
}
const invocation = {
  nodeId: "research",
  runId: "run_parent",
  agentId: "coordinator",
  input: { query: "brief" },
};

describe("workflow agent child protocol", () => {
  it("acknowledges node start then admits, executes locally once and finalizes with exact child authority", async () => {
    const order: string[] = [];
    const send: typeof fetch = (_url, init) => {
      const url = String(_url);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body));
      if (url.endsWith(`/runs/${parentId}/events`)) {
        order.push("start");
        assertEquals(headers.get("Authorization"), `Bearer ${eventToken}`);
        assertEquals(body.events, [{ type: "STEP_STARTED", stepId: "research" }]);
        return Promise.resolve(json({}));
      }
      if (url.endsWith("/runs")) {
        order.push("admit");
        assertEquals(headers.get("X-Veryfront-Run-Event-Token"), eventToken);
        assertEquals(headers.get("Authorization"), "Bearer parent-invocation");
        assertEquals(body.parent_run_id, parentId);
        assertEquals(body.node_id, "research");
        assertEquals(body.input, { prompt: JSON.stringify(invocation.input) });
        return Promise.resolve(admission());
      }
      assertEquals(url, `https://api.example.test/runs/${childId}/finalize`);
      order.push("finalize");
      assertEquals(headers.get("Authorization"), "Bearer child-invocation");
      assertEquals(headers.get("X-Veryfront-Run-Terminal-Token"), terminalToken);
      assertEquals(body, { status: "completed", output: { text: "brief" } });
      return Promise.resolve(json({ id: childId, status: "completed" }));
    };
    const result = await runner(send)({
      ...invocation,
      execute: () => {
        order.push("execute");
        assertEquals(typeof getActiveHostedRunEventWriterCapability(), "object");
        return Promise.resolve({ success: true, output: { text: "brief" }, executionTime: 1 });
      },
    });
    assertEquals(result.output, { text: "brief" });
    assertEquals(order, ["start", "admit", "execute", "finalize"]);
    assertEquals(getActiveHostedRunEventWriterCapability(), undefined);
  });

  it("keeps repeated local agent nodes distinct across composite owners and loop iterations with stable replay", async () => {
    const model = scriptedModel([
      { text: "first" },
      { text: "second" },
      { text: "iteration-zero" },
      { text: "iteration-one" },
    ], { only: "generate" });
    const actualAgent = agent({
      id: "coordinator",
      model: "test/workflow",
      system: "Execute this step",
      skills: false,
      resolveModelTransport: () => ({ model }),
    });
    const child = (input: string) => step("research", { agent: actualAgent, input });
    const composite = (id: string, input: string): WorkflowNode => ({
      id,
      config: { type: "subWorkflow", workflow: { id: "nested", steps: [child(input)] } },
    });
    const nodes: WorkflowNode[] = [
      composite("first", "first-input"),
      { ...composite("second", "second-input"), dependsOn: ["first"] },
      {
        id: "repeat",
        dependsOn: ["second"],
        config: {
          type: "loop",
          maxIterations: 2,
          checkpoint: false,
          while: (_context, loop) => loop.iteration < 2,
          steps: (_context, loop) => [child(`iteration-${loop.iteration}`)],
        },
      },
    ];
    const records = new Map<
      string,
      { id: string; publicId: string; input: unknown; output: unknown; status: string }
    >();
    const starts = new Set<string>();
    const cursors = new Map<string, number>();
    const send: typeof fetch = (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body));
      if (path === `/runs/${parentId}/events`) {
        starts.add(body.events[0].stepId);
        return Promise.resolve(json({}));
      }
      if (path === "/runs") {
        assertEquals(starts.has(body.node_id), true);
        const key = new Headers(init?.headers).get("Idempotency-Key")!;
        let record = records.get(key);
        if (!record) {
          const suffix = String(records.size + 1).padStart(12, "0");
          record = {
            id: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
            publicId: `run_node_${suffix}`,
            input: body.input,
            output: null,
            status: "running",
          };
          records.set(key, record);
        }
        return Promise.resolve(admission(record.status, record.output, record.id, record.publicId));
      }
      const id = path.split("/")[2]!;
      if (path.endsWith("/events")) {
        const cursor = (cursors.get(id) ?? 0) + body.events.length;
        cursors.set(id, cursor);
        return Promise.resolve(
          json({
            run_id: id,
            latest_event_id: cursor,
            latest_external_event_sequence: cursor,
            appended_count: body.events.length,
          }),
        );
      }
      const record = [...records.values()].find((value) => value.id === id)!;
      record.status = body.status;
      record.output = body.output;
      return Promise.resolve(json({ id, status: body.status }));
    };
    const freshRun = (): WorkflowRun => ({
      id: "run_parent",
      workflowId: "workflow",
      status: "running",
      input: {},
      context: { input: {} },
      nodeStates: {},
      currentNodes: [],
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
    });
    const run = () =>
      new DAGExecutor({ stepExecutor: new StepExecutor({ runAgentNode: runner(send) }) }).execute(
        nodes,
        freshRun(),
      );
    assertEquals((await run()).completed, true);
    assertEquals(model.callCount, 4);
    assertEquals(records.size, 4);
    assertEquals([...records.values()].map((record) => record.input), [
      { prompt: "first-input" },
      { prompt: "second-input" },
      { prompt: "iteration-0" },
      { prompt: "iteration-1" },
    ]);
    assertEquals((await run()).completed, true);
    assertEquals(model.callCount, 4);
    assertEquals(records.size, 4);
  });

  it("distinguishes a deliberate composite retry from terminal child recovery replay", async () => {
    const model = scriptedModel([
      () => {
        throw new Error("Transient provider failure");
      },
      { text: "recovered" },
    ], { only: "generate" });
    const actualAgent = agent({
      id: "coordinator",
      model: "test/workflow",
      system: "Execute this step",
      skills: false,
      resolveModelTransport: () => ({ model }),
    });
    const child = (input: string) => step("research", { agent: actualAgent, input });
    const composite = (id: string, input: string): WorkflowNode => ({
      id,
      config: { type: "subWorkflow", workflow: { id: "nested", steps: [child(input)] } },
    });
    const nodes: WorkflowNode[] = [{
      ...composite("retrying", "input"),
      config: {
        type: "subWorkflow",
        workflow: { id: "nested", steps: [child("input")] },
        retry: { maxAttempts: 2, initialDelay: 1, maxDelay: 1, retryIf: () => true },
      },
    }];
    const records = new Map<
      string,
      { id: string; publicId: string; input: unknown; output: unknown; status: string }
    >();
    const starts = new Set<string>();
    const cursors = new Map<string, number>();
    const send: typeof fetch = (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body));
      if (path === `/runs/${parentId}/events`) {
        starts.add(body.events[0].stepId);
        return Promise.resolve(json({}));
      }
      if (path === "/runs") {
        assertEquals(starts.has(body.node_id), true);
        const key = new Headers(init?.headers).get("Idempotency-Key")!;
        let record = records.get(key);
        if (!record) {
          const suffix = String(records.size + 1).padStart(12, "0");
          record = {
            id: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
            publicId: `run_node_${suffix}`,
            input: body.input,
            output: null,
            status: "running",
          };
          records.set(key, record);
        }
        return Promise.resolve(admission(record.status, record.output, record.id, record.publicId));
      }
      const id = path.split("/")[2]!;
      if (path.endsWith("/events")) {
        const cursor = (cursors.get(id) ?? 0) + body.events.length;
        cursors.set(id, cursor);
        return Promise.resolve(
          json({
            run_id: id,
            latest_event_id: cursor,
            latest_external_event_sequence: cursor,
            appended_count: body.events.length,
          }),
        );
      }
      const record = [...records.values()].find((value) => value.id === id)!;
      record.status = body.status;
      record.output = body.output;
      return Promise.resolve(json({ id, status: body.status }));
    };
    const freshRun = (): WorkflowRun => ({
      id: "run_parent",
      workflowId: "workflow",
      status: "running",
      input: {},
      context: { input: {} },
      nodeStates: {},
      currentNodes: [],
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
    });
    const run = () =>
      new DAGExecutor({ stepExecutor: new StepExecutor({ runAgentNode: runner(send) }) }).execute(
        nodes,
        freshRun(),
      );
    assertEquals((await run()).completed, true);
    assertEquals(model.callCount, 2);
    assertEquals(records.size, 2);
    assertEquals([...records.values()].map((record) => record.status), ["failed", "completed"]);
    const completedOutput = [...records.values()][1]!.output;
    assertEquals(
      completedOutput && typeof completedOutput === "object" && "text" in completedOutput
        ? completedOutput.text
        : undefined,
      "recovered",
    );
    const admittedKeys = [...records.keys()];
    assertEquals((await run()).completed, true);
    assertEquals(
      model.callCount,
      2,
      "recovery must replay both terminal attempts without execution",
    );
    assertEquals([...records.keys()], admittedKeys);
  });

  it("redacts and bounds provider errors before durable failure persistence", async () => {
    let persisted: { code: string; message: string } | undefined;
    const send: typeof fetch = (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === `/runs/${parentId}/events`) return Promise.resolve(json({}));
      if (path === "/runs") return Promise.resolve(admission());
      assertEquals(path, `/runs/${childId}/finalize`);
      const body = JSON.parse(String(init?.body));
      assertEquals(body.status, "failed");
      persisted = body.error;
      return Promise.resolve(json({ id: childId, status: "failed" }));
    };
    const result = await runner(send)({
      ...invocation,
      execute: () =>
        Promise.reject(
          new Error(
            `Provider request https://placeholder-user:placeholder-password@example.test failed ${
              "x".repeat(6000)
            }`,
          ),
        ),
    });
    assertEquals(result.success, false);
    assertEquals(persisted?.code, "WORKFLOW_AGENT_STEP_FAILED");
    assertEquals(typeof persisted?.message, "string");
    assertEquals(persisted!.message.includes("placeholder-password"), false);
    assertEquals(persisted!.message.includes("[REDACTED]"), true);
    assertEquals(persisted!.message.length <= 2048, true);
    assertEquals(result.error, persisted!.message);
  });

  for (const staleAuthority of [false, true]) {
    it(`settles admitted local work before cancellation and preserves stale authority refusal (${staleAuthority})`, async () => {
      const controller = new AbortController();
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let stopped = false;
      let status = "running";
      let terminals = 0;
      const send: typeof fetch = (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === `/runs/${parentId}/events`) return Promise.resolve(json({}));
        if (path === "/runs") return Promise.resolve(admission());
        assertEquals(path, `/runs/${childId}/cancel`);
        assertEquals(stopped, true, "terminal write must follow actual local settlement");
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("Authorization"), "Bearer child-invocation");
        assertEquals(headers.get("X-Veryfront-Run-Terminal-Token"), terminalToken);
        terminals++;
        if (staleAuthority) return Promise.resolve(json({ code: "AUTHORIZATION_DENIED" }, 403));
        status = "cancelled";
        return Promise.resolve(json({ id: childId, status }));
      };
      const execution = runner(send)({
        ...invocation,
        signal: controller.signal,
        execute: async () => {
          entered.resolve();
          await release.promise;
          stopped = true;
          return { success: true, output: "late output", executionTime: 0 };
        },
      });
      await entered.promise;
      controller.abort(new Error("Workflow cancelled"));
      await Promise.resolve();
      await Promise.resolve();
      assertEquals([status, terminals], ["running", 0]);
      release.resolve();
      if (staleAuthority) {
        await assertRejects(() => execution, Error, "403");
        assertEquals(status, "running");
      } else {
        assertEquals((await execution).success, false);
        assertEquals(status, "cancelled");
      }
      assertEquals(terminals, 1);
    });
  }

  it("keeps root IDs readable and reserves nested IDs without collisions or unstable replay", async () => {
    const identities: string[] = [];
    const keys: string[] = [];
    let started = "";
    const send: typeof fetch = (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/events")) {
        started = body.events[0].stepId;
        return Promise.resolve(json({}));
      }
      assertEquals(body.node_id, started);
      identities.push(body.node_id);
      keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
      return Promise.resolve(admission("completed", "stored"));
    };
    const execute = () => {
      throw new Error("Terminal replay must not execute");
    };
    const run = runner(send);
    await run({ ...invocation, execute });
    const nested = {
      ...invocation,
      executionPath: [
        JSON.stringify(["subWorkflow", "a/b"]),
        JSON.stringify(["iteration", "repeat_iter_0"]),
      ],
      execute,
    };
    await run(nested);
    await run(nested);
    await run({ ...invocation, nodeId: identities[1]!, execute });
    await run({
      ...nested,
      executionPath: [
        JSON.stringify(["subWorkflow", "a"]),
        JSON.stringify(["subWorkflow", "b"]),
        JSON.stringify(["iteration", "repeat_iter_0"]),
      ],
    });
    assertEquals(identities[0], "research");
    assertEquals(identities[1], identities[2]);
    assertEquals(keys[1], keys[2]);
    assertEquals(new Set(identities).size, 4);
    assertEquals(identities.every((id) => id.length <= 128), true);
    assertEquals(keys.every((key) => key.length <= 128), true);
  });

  it("mirrors the actual Agent.generate text, reasoning and ordinary tool turn without changing provider execution", async () => {
    const events: Record<string, unknown>[] = [];
    let cursor = 0;
    let toolExecutions = 0;
    const model = scriptedModel([
      {
        content: [{ type: "reasoning", text: "Inspect facts" }, {
          type: "text",
          text: "Looking up",
        }, {
          type: "tool-call",
          toolCallId: "lookup-call",
          toolName: "lookup",
          input: '{"query":"brief"}',
        }],
        finishReason: "tool-calls",
      },
      { text: "Finished brief" },
    ], { only: "generate" });
    const nestedModel = scriptedModel([{ text: "Private nested output" }], { only: "generate" });
    const nestedAgent = agent({
      id: "nested-helper",
      model: "test/nested",
      system: "Internal helper",
      skills: false,
      resolveModelTransport: () => ({ model: nestedModel }),
    });
    const actualAgent = agent({
      id: "workflow-projection-agent",
      model: "test/workflow",
      system: "Use lookup",
      skills: false,
      maxSteps: 3,
      resolveModelTransport: () => ({ model }),
      tools: {
        lookup: tool({
          id: "lookup",
          description: "Lookup",
          inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
          execute: async () => {
            toolExecutions++;
            await nestedAgent.generate({ input: "Internal work" });
            return { fact: "known" };
          },
        }),
      },
    });
    const send: typeof fetch = (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body));
      if (path === `/runs/${parentId}/events`) return Promise.resolve(json({}));
      if (path === "/runs") return Promise.resolve(admission());
      if (path.endsWith("/events")) {
        events.push(...body.events);
        cursor += body.events.length;
        return Promise.resolve(
          json({
            run_id: childId,
            latest_event_id: cursor,
            latest_external_event_sequence: cursor,
            appended_count: body.events.length,
          }),
        );
      }
      return Promise.resolve(json({ id: childId, status: body.status }));
    };
    const executor = new StepExecutor({ runAgentNode: runner(send) });
    const result = await executor.execute(
      step("research", { agent: actualAgent, input: "Produce brief" }),
      { input: {} },
      undefined,
      "run_parent",
    );
    assertEquals(result.success, true);
    assertEquals([model.callCount, toolExecutions], [2, 1]);
    assertEquals(
      events.filter((event) => event.type === "TEXT_MESSAGE_CONTENT").map((event) => event.delta),
      ["Looking up", "Finished brief"],
    );
    assertEquals(
      events.filter((event) => event.type === "REASONING_MESSAGE_CONTENT").map((event) =>
        event.delta
      ),
      ["Inspect facts"],
    );
    assertEquals(
      events.filter((event) => event.type === "TOOL_CALL_START").map((event) => event.toolCallId),
      ["lookup-call"],
    );
    assertEquals(
      events.filter((event) => event.type === "TOOL_CALL_RESULT").map((event) => event.toolCallId),
      ["lookup-call"],
    );
  });

  it("persists actual coordinator tool evidence before admitting and locally streaming its child", async () => {
    const grandchildId = "44444444-4444-4444-8444-444444444444";
    const order: string[] = [];
    const counts = new Map<string, number>();
    const send: typeof fetch = (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body));
      if (path === `/runs/${parentId}/events`) return Promise.resolve(json({}));
      if (path.endsWith("/events")) {
        const id = path.split("/")[2]!;
        const events = body.events;
        for (const event of events) {
          if (event.type === "TOOL_CALL_START") {
            assertEquals(id, childId);
            assertEquals(event.toolCallId, "call-research");
            assertEquals(event.toolCallName, "invoke_agent");
            order.push("tool-evidence");
          }
          if (event.type === "TEXT_MESSAGE_CONTENT") order.push("child-text");
        }
        const count = (counts.get(id) ?? 0) + events.length;
        counts.set(id, count);
        return Promise.resolve(
          json({
            run_id: id,
            latest_event_id: count,
            latest_external_event_sequence: count,
            appended_count: events.length,
          }),
        );
      }
      if (path === "/runs") {
        if (body.node_id) return Promise.resolve(admission());
        assertEquals(order.includes("tool-evidence"), true);
        assertEquals(body.parent_run_id, childId);
        assertEquals(body.tool_call_id, "call-research");
        assertEquals(body.target.id, "brief-research");
        order.push("admit-research");
        return Promise.resolve(admission("running", null, grandchildId, "run_research"));
      }
      order.push(path.includes(grandchildId) ? "finish-research" : "finish-coordinator");
      return Promise.resolve(json({ id: path.split("/")[2], status: body.status }));
    };
    const result = await runner(send)({
      ...invocation,
      execute: async () => {
        await observeGeneratedAgentTurn("coordinator-message", {
          text: "",
          toolCalls: [{
            toolCallId: "call-research",
            toolName: "invoke_agent",
            input: { agent_id: "brief-research", prompt: "Research" },
          }],
        });
        const output = await executeLocalChild({
          agentId: "brief-research",
          input: "Research",
          toolName: "invoke_agent",
          toolInput: { agent_id: "brief-research", prompt: "Research" },
          context: { toolCallId: "call-research" },
          execute: async (control) => {
            order.push("local-research");
            await control?.onEvent?.({ type: "text-start", id: "text" });
            await control?.onEvent?.({ type: "text-delta", id: "text", delta: "Finding" });
            await control?.onEvent?.({ type: "text-end", id: "text" });
            return { text: "Finding", toolCalls: 0, status: "completed" };
          },
        });
        return { success: true, output, executionTime: 0 };
      },
    });
    assertEquals(result.success, true);
    assertEquals(order, [
      "tool-evidence",
      "admit-research",
      "local-research",
      "child-text",
      "finish-research",
      "finish-coordinator",
    ]);
  });

  for (const staleAuthority of [false, true]) {
    it(`settles timed-out delegated execution before terminal persistence (stale authority: ${staleAuthority})`, async () => {
      const attempt = new AbortController();
      const grandchildId = "44444444-4444-4444-8444-444444444444";
      const cursors = new Map<string, number>();
      const states = new Map<string, string>();
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      let release!: () => void;
      const settle = new Promise<void>((resolve) => {
        release = resolve;
      });
      let stopped = false;
      const send: typeof fetch = (url, init) => {
        const path = new URL(String(url)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (path === "/runs") {
          states.set(body.node_id ? childId : grandchildId, "running");
          return Promise.resolve(
            body.node_id ? admission() : admission("running", null, grandchildId, "run_research"),
          );
        }
        if (path.endsWith("/events")) {
          const id = path.split("/")[2]!;
          const cursor = (cursors.get(id) ?? 0) + body.events.length;
          cursors.set(id, cursor);
          return Promise.resolve(
            json({
              run_id: id,
              latest_event_id: cursor,
              latest_external_event_sequence: cursor,
              appended_count: body.events.length,
            }),
          );
        }
        const id = path.split("/")[2]!;
        assertEquals(stopped, true, "terminal persistence follows actual local settlement");
        if (id === childId && states.get(grandchildId) === "running") {
          return Promise.resolve(json({ code: "RUN_DESCENDANTS_ACTIVE" }, 409));
        }
        if (path.endsWith("/cancel") && staleAuthority) {
          return Promise.resolve(
            json({ code: "PERMISSION_ERROR", message: "Generation replaced" }, 403),
          );
        }
        const status = path.endsWith("/cancel") ? "cancelled" : body.status;
        states.set(id, status);
        return Promise.resolve(json({ id, status }));
      };
      let childSawAbort = false;
      const running = runner(send)({
        ...invocation,
        execute: async () => {
          await observeGeneratedAgentTurn("attempt-message", {
            text: "",
            toolCalls: [{
              toolCallId: "attempt-tool",
              toolName: "invoke_agent",
              input: { agent_id: "brief-research" },
            }],
          });
          const output = await executeLocalChild({
            agentId: "brief-research",
            input: "Research",
            toolName: "invoke_agent",
            toolInput: { agent_id: "brief-research" },
            context: { toolCallId: "attempt-tool", abortSignal: attempt.signal },
            execute: async (control) => {
              attempt.abort(new Error("Step timeout"));
              childSawAbort = control?.signal?.aborted === true;
              started();
              await settle;
              stopped = true;
              control?.signal?.throwIfAborted();
              return { text: "Should stop", toolCalls: 0, status: "completed" };
            },
          });
          return { success: true, output, executionTime: 0 };
        },
      });
      await entered;
      await Promise.resolve();
      assertEquals(states.get(grandchildId), "running");
      release();
      if (staleAuthority) {
        await assertRejects(() => running);
        assertEquals(
          states.get(grandchildId),
          "running",
          "a refused stale generation cannot overwrite durable state",
        );
        assertEquals(
          states.get(childId),
          "running",
          "active descendant policy remains authoritative",
        );
      } else {
        const result = await running;
        assertEquals(states.get(grandchildId), "cancelled");
        assertEquals(states.get(childId), "failed");
        assertEquals(result.success, false);
      }
      assertEquals(childSawAbort, true);
    });
  }

  it("keeps concurrent workflow children and their tool-call authority isolated", async () => {
    const parentB = "55555555-5555-4555-8555-555555555555";
    const childB = "66666666-6666-4666-8666-666666666666";
    const leafA = "77777777-7777-4777-8777-777777777777";
    const leafB = "88888888-8888-4888-8888-888888888888";
    const seen: string[] = [];
    const cursors = new Map<string, number>();
    let entered = 0;
    let release!: () => void;
    const together = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send: typeof fetch = (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      if (path.endsWith("/events")) {
        const id = path.split("/")[2]!;
        const cursor = (cursors.get(id) ?? 0) + body.events.length;
        cursors.set(id, cursor);
        return Promise.resolve(
          json({
            run_id: id,
            latest_event_id: cursor,
            latest_external_event_sequence: cursor,
            appended_count: body.events.length,
          }),
        );
      }
      if (path === "/runs") {
        if (body.node_id) {
          const second = body.parent_run_id === parentB;
          assertEquals(
            headers.get("Authorization"),
            second ? "Bearer parent-b" : "Bearer parent-invocation",
          );
          return Promise.resolve(
            admission(
              "running",
              null,
              second ? childB : childId,
              second ? "run_child_b" : "run_child",
            ),
          );
        }
        seen.push(`${body.parent_run_id}:${body.tool_call_id}:${body.target.id}`);
        const second = body.target.id === "leaf-b";
        assertEquals(body.parent_run_id, second ? childB : childId);
        const token = headers.get("X-Veryfront-Run-Terminal-Token")!;
        assertEquals(JSON.parse(atob(token.split(".")[1]!)).canonicalRunId, body.parent_run_id);
        return Promise.resolve(
          admission("running", null, second ? leafB : leafA, second ? "run_leaf_b" : "run_leaf_a"),
        );
      }
      return Promise.resolve(json({ id: path.split("/")[2], status: body.status }));
    };
    const execute = (target: string) => async () => {
      if (++entered === 2) release();
      await together;
      await observeGeneratedAgentTurn(`message-${target}`, {
        text: "",
        toolCalls: [{
          toolCallId: "same-tool-id",
          toolName: "invoke_agent",
          input: { agent_id: target },
        }],
      });
      const output = await executeLocalChild({
        agentId: target,
        input: target,
        toolName: "invoke_agent",
        toolInput: { agent_id: target },
        context: { toolCallId: "same-tool-id" },
        execute: () => Promise.resolve({ text: target, status: "completed", toolCalls: 0 }),
      });
      return { success: true, output, executionTime: 0 };
    };
    const second = createWorkflowAgentNodeRunner({
      runId: "run_parent_b",
      projectId: "project",
      apiUrl: "https://api.example.test",
      fetch: send,
      authToken: "parent-b",
      eventToken: encode({
        tokenUse: "run_event_writer",
        runId: "run_parent_b",
        projectId: "project",
        projectExecutionAttempt: {
          canonicalRunId: parentB,
          workerId: "worker-b",
          attemptId: "attempt-b",
        },
      }),
    });
    const results = await Promise.all([
      runner(send)({ ...invocation, execute: execute("leaf-a") }),
      second({ ...invocation, runId: "run_parent_b", execute: execute("leaf-b") }),
    ]);
    assertEquals(results.map((value) => value.success), [true, true]);
    assertEquals(
      seen.sort(),
      [`${childId}:same-tool-id:leaf-a`, `${childB}:same-tool-id:leaf-b`].sort(),
    );
  });

  it("refuses invented and mismatched tool invocations before child admission", async () => {
    for (const declared of [undefined, "different-agent"]) {
      let admissions = 0;
      let localExecutions = 0;
      let cursor = 0;
      const send: typeof fetch = (url, init) => {
        const path = new URL(String(url)).pathname;
        const body = JSON.parse(String(init?.body));
        if (path === `/runs/${parentId}/events`) return Promise.resolve(json({}));
        if (path === "/runs") {
          admissions++;
          return Promise.resolve(admission());
        }
        if (path.endsWith("/events")) {
          cursor += body.events.length;
          return Promise.resolve(
            json({
              run_id: childId,
              latest_event_id: cursor,
              latest_external_event_sequence: cursor,
              appended_count: body.events.length,
            }),
          );
        }
        return Promise.resolve(json({ id: childId, status: body.status }));
      };
      const result = await runner(send)({
        ...invocation,
        execute: async () => {
          if (declared) {
            await observeGeneratedAgentTurn("message", {
              text: "",
              toolCalls: [{
                toolCallId: "invented",
                toolName: "invoke_agent",
                input: { agent_id: declared },
              }],
            });
          }
          await executeLocalChild({
            agentId: "research",
            input: "Do work",
            toolName: "invoke_agent",
            toolInput: {},
            context: { toolCallId: "invented" },
            execute: () => {
              localExecutions++;
              return Promise.resolve({ text: "wrong", status: "completed", toolCalls: 0 });
            },
          });
          return { success: true, output: "wrong", executionTime: 0 };
        },
      });
      assertEquals(result.success, false);
      assertEquals(result.error?.includes("no matching admitted tool invocation"), true);
      assertEquals([admissions, localExecutions], [1, 0]);
    }
  });

  it("does not admit or execute when durable node start is refused", async () => {
    let calls = 0;
    await assertRejects(
      () =>
        runner(() => {
          calls++;
          return Promise.resolve(json({}, 403));
        })({
          ...invocation,
          execute: () => {
            throw new Error("must not execute");
          },
        }),
      Error,
      "Workflow node start failed",
    );
    assertEquals(calls, 1);
  });

  it("replays a bound terminal result without execution credentials", async () => {
    const output = { text: "durable" };
    let calls = 0;
    const result = await runner(() =>
      Promise.resolve(
        ++calls === 1 ? json({}) : json(
          {
            id: childId,
            project_id: "project",
            parent_run_id: parentId,
            target: { type: "agent", id: "coordinator" },
            status: "completed",
            output,
            conversation_id: conversationId,
            output_message_id: "44444444-4444-4444-8444-444444444444",
          },
          202,
          { "Cache-Control": "no-store" },
        ),
      )
    )({
      ...invocation,
      execute: () => {
        throw new Error("must not execute");
      },
    });
    assertEquals(result, { success: true, output, executionTime: 0 });
    assertEquals(calls, 2);
  });

  it("replays completed child output without local execution or finalization", async () => {
    const output = { text: "durable", object: { answer: 42 } };
    let calls = 0;
    const result = await runner(() =>
      Promise.resolve(++calls === 1 ? json({}) : admission("completed", output))
    )({
      ...invocation,
      execute: () => {
        throw new Error("must not execute");
      },
    });
    assertEquals(result, { success: true, output, executionTime: 0 });
    assertEquals(calls, 2);
  });

  for (const version of [6, 7, 8]) {
    it(`accepts UUIDv${version} canonical parent routing hints`, async () => {
      const id = `11111111-1111-${version}111-8111-111111111111`;
      const token = encode({
        tokenUse: "run_event_writer",
        runId: "run_parent",
        projectId: "project",
        projectExecutionAttempt: { canonicalRunId: id, workerId: "worker", attemptId: "attempt" },
      });
      let requests = 0;
      const send: typeof fetch = (url, init) => {
        requests++;
        if (String(url).endsWith("/events")) {
          assertEquals(new URL(String(url)).pathname, `/runs/${id}/events`);
          return Promise.resolve(json({}));
        }
        assertEquals(JSON.parse(String(init?.body)).parent_run_id, id);
        return Promise.resolve(admission("completed", "stored", childId, "run_child", id));
      };
      const result = await runner(send, token)({
        ...invocation,
        execute: () => {
          throw new Error("Must replay");
        },
      });
      assertEquals(result.output, "stored");
      assertEquals(requests, 2);
    });
  }

  it("rejects embedded UUIDs rather than routing a partial match", async () => {
    const token = encode({
      tokenUse: "run_event_writer",
      runId: "run_parent",
      projectId: "project",
      projectExecutionAttempt: {
        canonicalRunId: `prefix-${parentId}`,
        workerId: "worker",
        attemptId: "attempt",
      },
    });
    await assertRejects(() =>
      runner(() => {
        throw new Error("Must not send");
      }, token)({
        ...invocation,
        execute: () => {
          throw new Error("Must not execute");
        },
      })
    );
  });

  it("rejects mismatched or missing parent routing authority before HTTP", async () => {
    for (
      const token of [
        "",
        encode({
          tokenUse: "run_event_writer",
          runId: "foreign",
          projectId: "project",
          projectExecutionAttempt: {
            canonicalRunId: parentId,
            workerId: "worker",
            attemptId: "attempt",
          },
        }),
      ]
    ) {
      await assertRejects(
        () =>
          runner(() => {
            throw new Error("must not send");
          }, token)({
            ...invocation,
            execute: () => {
              throw new Error("must not execute");
            },
          }),
        Error,
        "current run authority",
      );
    }
  });
});

describe("workflow terminal admission result validation", () => {
  const binding = {
    projectId: "project",
    parentRunId: parentId,
    agentId: "coordinator",
    apiUrl: "https://api.example.test",
    fetch,
  };
  const row = {
    id: childId,
    project_id: "project",
    parent_run_id: parentId,
    target: { type: "agent", id: "coordinator" },
    status: "completed",
    output: null,
    conversation_id: conversationId,
    output_message_id: "44444444-4444-4444-8444-444444444444",
  };
  for (const status of ["completed", "failed", "cancelled"] as const) {
    it(`retains ${status} without authority`, async () => {
      const error = { code: "CHILD_FAILED", message: "Stored failure" };
      const result = await acceptWorkflowInheritedRunAdmission(
        json({ ...row, status, ...(status === "failed" ? { error } : {}) }, 202, {
          "Cache-Control": "no-store",
        }),
        binding,
      );
      assertEquals(result, {
        terminalReceipt: { status, output: null, ...(status === "failed" ? { error } : {}) },
      });
    });
  }
  for (
    const change of [
      { project_id: "foreign" },
      { parent_run_id: childId },
      { target: { type: "task", id: "coordinator" } },
      { target: { type: "agent", id: "foreign" } },
      { id: "bad" },
      { conversation_id: "bad" },
      { output_message_id: "bad" },
      { error: { code: 1, message: "bad" } },
    ]
  ) {
    it(`rejects terminal binding ${JSON.stringify(change)}`, async () => {
      await assertRejects(
        () =>
          acceptWorkflowInheritedRunAdmission(
            json({ ...row, ...change }, 202, { "Cache-Control": "no-store" }),
            binding,
          ),
        Error,
        "binding mismatch",
      );
    });
  }
  for (const status of ["pending", "running", "waiting"]) {
    it(`still requires authority for ${status}`, async () => {
      await assertRejects(
        () =>
          acceptWorkflowInheritedRunAdmission(
            json({ ...row, status }, 202, { "Cache-Control": "no-store" }),
            binding,
          ),
        Error,
        "authority is missing",
      );
    });
  }
});
