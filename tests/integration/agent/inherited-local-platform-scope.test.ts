import "#veryfront/schemas/_test-setup.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { acceptInheritedRunAdmission } from "#veryfront/agent/hosted/terminal-credential.ts";
import { runInheritedLocalAgent } from "#veryfront/agent/composition/inherited-local-agent.ts";
import {
  executeLocalChild,
  observeGeneratedAgentTurn,
} from "#veryfront/agent/composition/local-child-execution.ts";
import {
  getActiveHostedRunEventWriterCapability,
  hostedRunCanonicalId,
} from "#veryfront/agent/hosted/child-run-event-writer-token.ts";
import {
  getActiveRuntimeRemoteToolSources,
  runWithExactRuntimeRemoteToolSources,
} from "#veryfront/agent/runtime/remote-tool-source-context.ts";
import type { createConnectedLocalPlatformTools } from "#veryfront/agent/ag-ui/connected-local-platform-tools.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const grandchildId = "33333333-3333-4333-8333-333333333333";
const apiUrl = "https://api.veryfront.com";
function admission(id: string, parent: string, agentId: string) {
  const token = `header.${
    btoa(JSON.stringify({
      runId: `run-${agentId}`,
      canonicalRunId: id,
      dispatchNonce: "fixture-generation",
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
    }))
  }.signature`;
  return Response.json({
    version: 1,
    canonicalRunId: id,
    parentRunId: parent,
    projectId,
    agentId,
    status: "running",
    conversationId: projectId,
    outputMessageId: id,
    dispatchNonce: "fixture-generation",
  }, {
    headers: {
      "Content-Type": "application/vnd.veryfront.inherited-run+json",
      "Cache-Control": "no-store",
      "X-Veryfront-Run-Terminal-Token": token,
      "X-Veryfront-Run-Invocation-Token": `invocation-${agentId}`,
      "X-Veryfront-Run-Renewal-Token": `renewal-${agentId}`,
      "X-Veryfront-Inference-Token": `inference-${agentId}`,
      "X-Veryfront-Run-Event-Token": `events-${agentId}`,
      "X-Veryfront-Run-Event-Sequence": "0",
      "X-Veryfront-Run-External-Event-Sequence": "0",
      "X-Veryfront-Run-Lease-Expires-At": new Date(Date.now() + 60_000).toISOString(),
    },
  });
}

for (const fail of [false, true]) {
  it(`enters each recursive child's platform scope and revokes it (${fail ? "failure" : "success"})`, async () => {
    const entered: string[] = [], revoked: string[] = [];
    const lifecycle: string[] = [];
    const admissions: string[] = [];
    let admitGrandchild:
      | Parameters<ReturnType<typeof createConnectedLocalPlatformTools>["run"]>[0]["admit"]
      | undefined;
    const finalizations: Array<{ id: string; status: string }> = [];
    const transport = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (path === "/runs") return admission(grandchildId, childId, "grandchild");
      const id = path.split("/")[2]!;
      if (path.endsWith("/events")) {
        return Response.json({
          run_id: id,
          latest_event_id: body.events.length,
          latest_external_event_sequence: body.expected_previous_external_event_sequence +
            body.events.length,
          appended_count: body.events.length,
          tool_call_admissions: (body.tool_call_starts ?? []).map(
            (start: { occurrence_id: string; event_index: number }) => {
              admissions.push(id);
              return {
                occurrence_id: start.occurrence_id,
                tool_call_id: body.events[start.event_index].toolCallId,
                admission_event_id: "fixture-admission",
                start_event_id: "fixture-start",
                public_tool_call_id: body.events[start.event_index].toolCallId,
                project_id: projectId,
                run_id: id,
              };
            },
          ),
        });
      }
      if (path.endsWith("/finalize")) {
        finalizations.push({ id, status: body.status });
        lifecycle.push(`finalize:${id}`);
        return Response.json({ id, status: body.status });
      }
      throw new Error(`Unexpected fixture request ${path}`);
    }) as typeof fetch;
    const child = await acceptInheritedRunAdmission(admission(childId, projectId, "child"), {
      projectId,
      parentRunId: projectId,
      agentId: "child",
      apiUrl,
      fetch: transport,
    });
    const platformTools: Pick<
      ReturnType<typeof createConnectedLocalPlatformTools>,
      "run" | "revoke"
    > = {
      run(input, operation) {
        assertEquals(hostedRunCanonicalId(input.writer, input.scope.runId), input.canonicalRunId);
        entered.push(`${input.scope.agentId}:${input.canonicalRunId}`);
        if (input.scope.agentId === "grandchild") admitGrandchild = input.admit;
        return runWithExactRuntimeRemoteToolSources([{
          id: input.canonicalRunId,
          listTools: async () => [],
          executeTool: async () => null,
        }], operation);
      },
      async revoke(owner) {
        const runId = "runId" in owner ? owner.runId : "unexpected";
        revoked.push(runId);
        lifecycle.push(`revoke:${runId}`);
      },
    };
    const result = await runWithExactRuntimeRemoteToolSources([{
      id: "root-source",
      listTools: async () => [],
      executeTool: async () => null,
    }], async () => {
      const result = await runInheritedLocalAgent(
        child,
        { projectId, apiUrl, fetch: transport },
        async () => {
          assertEquals(getActiveRuntimeRemoteToolSources()?.[0]?.id, childId);
          await observeGeneratedAgentTurn("message", {
            text: "",
            toolCalls: [{ toolCallId: "delegate", toolName: "agent_grandchild", input: {} }],
            toolResults: [],
            finishReason: "tool-calls",
            usage: {},
          });
          const output = await executeLocalChild({
            agentId: "grandchild",
            toolName: "agent_grandchild",
            toolInput: {},
            input: "work",
            context: { toolCallId: "delegate" },
            execute: async () => {
              assertEquals(getActiveRuntimeRemoteToolSources()?.[0]?.id, grandchildId);
              const writer = getActiveHostedRunEventWriterCapability();
              assertEquals(writer && hostedRunCanonicalId(writer, "run-grandchild"), grandchildId);
              const receipt = await admitGrandchild!(
                {
                  occurrenceId: "44444444-4444-4444-8444-444444444444",
                  toolCallId: "platform-tool",
                },
                "veryfront__get_run",
                {},
              );
              assertEquals(receipt.runId, grandchildId);
              if (fail) throw new Error("Grandchild fixture failure");
              return { text: "done", toolCalls: 1, status: "completed" };
            },
          });
          assertEquals(getActiveRuntimeRemoteToolSources()?.[0]?.id, childId);
          return { success: true, output, executionTime: 0 };
        },
        undefined,
        false,
        true,
        { tools: platformTools, agentId: "child" },
      );
      assertEquals(getActiveRuntimeRemoteToolSources()?.[0]?.id, "root-source");
      return result;
    });
    assertEquals(result.success, !fail, result.error);
    assertEquals(entered, [`child:${childId}`, `grandchild:${grandchildId}`]);
    assertEquals(revoked, ["run-grandchild", "run-child"]);
    assertEquals(admissions, [grandchildId]);
    await assertRejects(
      async () =>
        await admitGrandchild!(
          {
            occurrenceId: "44444444-4444-4444-8444-444444444444",
            toolCallId: "late-call",
          },
          "veryfront__get_run",
          {},
        ),
      Error,
      "Inherited local tool writer is unavailable",
    );
    assertEquals(finalizations.map(({ id }) => id), [grandchildId, childId]);
    assertEquals(lifecycle, [
      `revoke:run-grandchild`,
      `finalize:${grandchildId}`,
      `revoke:run-child`,
      `finalize:${childId}`,
    ]);
  });
}

for (const outcome of ["completed", "failed", "cancelled"] as const) {
  it(`attempts ${outcome === "cancelled" ? "cancelled" : "failed"} finalization after an inherited ${outcome} event drain times out`, async () => {
    const finalizations: string[] = [];
    const controller = new AbortController();
    const transport = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/events")) {
        throw TIMEOUT_ERROR.create({ detail: "Fixture append timed out" });
      }
      if (path.endsWith("/finalize") || path.endsWith("/cancel")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        finalizations.push(path.endsWith("/cancel") ? "cancelled" : body.status);
        if (outcome === "completed") {
          assertEquals(body.error?.code, "DURABLE_RUN_EVENT_PERSISTENCE_FAILED");
        }
        return Response.json({ id: childId, status: body.status });
      }
      throw new Error(`Unexpected fixture request ${path}`);
    }) as typeof fetch;
    const child = await acceptInheritedRunAdmission(admission(childId, projectId, "child"), {
      projectId,
      parentRunId: projectId,
      agentId: "child",
      apiUrl,
      fetch: transport,
    });
    const rejected = await assertRejects(() =>
      runInheritedLocalAgent(
        child,
        { projectId, apiUrl, fetch: transport },
        async (_signal, onEvent) => {
          if (outcome === "completed") {
            await onEvent!({
              type: "tool-input-start",
              toolCallId: "pending",
              toolName: "example",
            });
          } else await onEvent!({ type: "text-delta", delta: "partial" });
          if (outcome === "cancelled") controller.abort(new Error("Fixture cancelled"));
          if (outcome === "failed") throw new Error("Fixture execution failed");
          return { success: true, output: "done", executionTime: 0 };
        },
        controller.signal,
        false,
        outcome === "completed",
      )
    );
    assertEquals(
      finalizations,
      [outcome === "cancelled" ? "cancelled" : "failed"],
      String(rejected),
    );
  });
}
