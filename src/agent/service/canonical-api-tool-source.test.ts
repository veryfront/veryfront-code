import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseBrokerRuntimeAgentIngress } from "./broker-ingress.ts";
import { invocation, options, projectId, signedRequest } from "./broker-ingress.test-helpers.ts";
import { createCanonicalApiToolSource } from "./canonical-api-tool-source.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";

async function fixture(
  wait: (id: string) => Promise<AgUiResumeValue> = async () => ({ result: "ok", isError: false }),
) {
  const sourceId = "00000000-0000-4000-8000-000000000099";
  const base = invocation();
  const signed = await signedRequest(
    invocation({
      run: { ...base.run, project: { ...base.run.project, runtimeTargetBranchName: "main" } },
      sourceProject: {
        projectId: sourceId,
        projectSlug: "private-source",
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "00000000-0000-4000-8000-000000000098",
        runtimeTargetEnvironmentName: "Production",
      },
      agentEntrypoint: { path: "agents/selected.ts" },
      tools: [{
        name: "review_claim",
        description: "Review a claim",
        parameters: { type: "object", properties: {} },
      }],
    }),
    { projectId: sourceId, audience: "private-source" },
  );
  const ingress = await parseBrokerRuntimeAgentIngress(signed.request, {
    ...options(signed.publicKeyPem),
    projectId: sourceId,
    audience: "private-source",
    expectedOwner: { scopeKind: "project", projectId: sourceId },
  });
  const lifetime = new AbortController();
  return {
    ingress,
    lifetime,
    capability: createCanonicalApiToolSource({
      ingress,
      signal: lifetime.signal,
      waitForToolResult: wait,
    }),
  };
}

describe("canonical API tools", () => {
  it("binds the consuming identity and keeps credentials out of its catalog", async () => {
    const f = await fixture();
    assertEquals(f.capability.context.projectId, projectId);
    const tools = await f.capability.source.listTools(f.capability.context);
    assertEquals(tools.map((tool) => tool.name), ["review_claim"]);
    tools[0]!.name = "mutated";
    assertEquals(
      (await f.capability.source.listTools(f.capability.context))[0]!.name,
      "review_claim",
    );
    const projection = JSON.stringify(f.capability);
    assertEquals(projection.includes("token"), false);
  });
  for (const field of ["projectId", "runId", "agentId", "userId"] as const) {
    it(`rejects a foreign ${field} before waiting for a result`, async () => {
      let calls = 0;
      const f = await fixture(async () => {
        calls++;
        return { result: "wrong", isError: false };
      });
      await assertRejects(() =>
        f.capability.source.executeTool("review_claim", {}, {
          ...f.capability.context,
          toolCallId: "tool-1",
          [field]: "foreign",
        })
      );
      assertEquals(calls, 0);
    });
  }
  it("refuses undeclared tools and missing call IDs without invoking the result waiter", async () => {
    let calls = 0;
    const f = await fixture(async () => {
      calls++;
      return { result: null, isError: false };
    });
    await assertRejects(() =>
      f.capability.source.executeTool("unlisted", {}, {
        ...f.capability.context,
        toolCallId: "tool-1",
      })
    );
    await assertRejects(() =>
      f.capability.source.executeTool("review_claim", {}, f.capability.context)
    );
    assertEquals(calls, 0);
  });
  it("rejects concurrent reuse of a call ID and returns only its authenticated result", async () => {
    const result = Promise.withResolvers<AgUiResumeValue>();
    let calls = 0;
    const f = await fixture(() => {
      calls++;
      return result.promise;
    });
    const context = { ...f.capability.context, toolCallId: "tool-1" };
    const pending = f.capability.source.executeTool("review_claim", {}, context);
    await assertRejects(() => f.capability.source.executeTool("review_claim", {}, context));
    assertEquals(calls, 1);
    result.resolve({ result: { approved: true }, isError: false });
    assertEquals(await pending, { approved: true });
  });
  it("does not return a late result after cancellation", async () => {
    const result = Promise.withResolvers<AgUiResumeValue>();
    const f = await fixture(() => result.promise);
    const pending = f.capability.source.executeTool("review_claim", {}, {
      ...f.capability.context,
      toolCallId: "tool-1",
    });
    f.lifetime.abort();
    result.resolve({ result: "late", isError: false });
    await assertRejects(() => pending);
  });
  it("preserves API tool failure semantics", async () => {
    const f = await fixture(async () => ({ result: "Claim not found", isError: true }));
    await assertRejects(
      () =>
        f.capability.source.executeTool("review_claim", {}, {
          ...f.capability.context,
          toolCallId: "tool-1",
        }),
      Error,
      "Claim not found",
    );
  });
});
