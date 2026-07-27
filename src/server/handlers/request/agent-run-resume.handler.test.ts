import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES } from "#veryfront/internal-agents/request-body.ts";
import { AgentRunResumeHandler } from "./agent-run-resume.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";

const TEST_SESSION_SCOPE = "proj-1";

describe("server/handlers/request/agent-run-resume.handler", () => {
  it("resumes only the run in the authenticated project scope", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      scopeId: "project-a",
    });
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      scopeId: "project-b",
    });
    const projectAResult = sessionManager.waitForToolResult("run_1", "tool_1", "project-a");
    const projectBResult = sessionManager.waitForToolResult("run_1", "tool_1", "project-b");
    const handler = new AgentRunResumeHandler(sessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { project: "a" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
      projectId: "project-a",
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      { ...createCtx(publicKeyPem), projectId: "project-a" },
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await projectAResult, {
      result: { project: "a" },
      isError: false,
    });
    assertEquals(sessionManager.getRunStatus("run_1", "project-b"), "waiting");
    assertEquals(sessionManager.cancelRun("run_1", "project-b"), true);
    await projectBResult.catch(() => undefined);
    sessionManager.completeRun("run_1", "project-a");
  });

  it("accepts a signed tool result for a waiting run", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      scopeId: TEST_SESSION_SCOPE,
    });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1", TEST_SESSION_SCOPE);

    const handler = new AgentRunResumeHandler(sessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), { accepted: true });
    assertEquals(await pending, { result: { ok: true }, isError: false });
  });

  it("accepts the public control-plane resume route", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      scopeId: TEST_SESSION_SCOPE,
    });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1", TEST_SESSION_SCOPE);

    const handler = new AgentRunResumeHandler(sessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await pending, { result: { ok: true }, isError: false });
  });

  it("returns duplicate=true for a repeated identical tool result", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      scopeId: TEST_SESSION_SCOPE,
    });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1", TEST_SESSION_SCOPE);
    sessionManager.submitToolResult(
      "run_1",
      { toolCallId: "tool_1", result: { ok: true } },
      TEST_SESSION_SCOPE,
    );
    await pending;

    const handler = new AgentRunResumeHandler(sessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), { accepted: true, duplicate: true });
  });

  it("rejects oversized resume payloads before parsing", async () => {
    const handler = new AgentRunResumeHandler(new AgentRunSessionManager());
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: "x".repeat(INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES + 1024),
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 413);
    assertEquals(await result.response.json(), { error: "Payload too large" });
  });

  it("returns 400 for malformed resume payloads", async () => {
    const handler = new AgentRunResumeHandler(new AgentRunSessionManager());
    const body = '{"type":"tool_result"';
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid resume request" });
  });

  it("returns 409 for conflicting duplicate tool results", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      scopeId: TEST_SESSION_SCOPE,
    });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1", TEST_SESSION_SCOPE);
    sessionManager.submitToolResult(
      "run_1",
      { toolCallId: "tool_1", result: { ok: true } },
      TEST_SESSION_SCOPE,
    );
    await pending;

    const handler = new AgentRunResumeHandler(sessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: false },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 409);
    assertEquals(await result.response.json(), { error: "TOOL_RESULT_CONFLICT" });
  });

  it("accepts a tool result before the runtime registers the wait", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      scopeId: TEST_SESSION_SCOPE,
    });
    sessionManager.prepareForToolResult("run_1", "tool_1", TEST_SESSION_SCOPE);

    const handler = new AgentRunResumeHandler(sessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), { accepted: true });
    assertEquals(await sessionManager.waitForToolResult("run_1", "tool_1", TEST_SESSION_SCOPE), {
      result: { ok: true },
      isError: false,
    });
    sessionManager.completeRun("run_1", TEST_SESSION_SCOPE);
  });

  it("returns 409 when a different tool call is submitted while another wait is active", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      scopeId: TEST_SESSION_SCOPE,
    });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1", TEST_SESSION_SCOPE);

    const handler = new AgentRunResumeHandler(sessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_2",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 409);
    assertEquals(await result.response.json(), { error: "TOOL_RESULT_NOT_WAITING" });
    assertEquals(sessionManager.cancelRun("run_1", TEST_SESSION_SCOPE), true);
    await pending.catch(() => undefined);
  });

  it("returns 410 when the run is no longer active", async () => {
    const handler = new AgentRunResumeHandler(new AgentRunSessionManager());
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 410);
    assertEquals(await result.response.json(), { error: "RUN_NOT_ACTIVE" });
  });

  it("returns 500 when session resume fails unexpectedly", async () => {
    const handler = new AgentRunResumeHandler({
      submitToolResult() {
        throw new Error("resume boom");
      },
    } as unknown as AgentRunSessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 500);
    assertEquals(await result.response.json(), { error: "Internal resume failed" });
  });
});
