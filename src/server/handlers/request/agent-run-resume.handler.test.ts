import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  type AgentRunControl,
  AgentRunControlBindingError,
} from "#veryfront/internal-agents/run-control.ts";
import { INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES } from "#veryfront/internal-agents/request-body.ts";
import { AgentRunResumeHandler } from "./agent-run-resume.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/agent-run-resume.handler", () => {
  it("accepts a signed tool result for a waiting run", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1");

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
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1");

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

  it("decodes and validates the run id before addressing session state", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1");
    const handler = new AgentRunResumeHandler(sessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/%72un_1/resume", {
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

  it("rejects malformed encoded run ids before addressing session state", async () => {
    let submitCalls = 0;
    const handler = new AgentRunResumeHandler({
      submitToolResult() {
        submitCalls += 1;
        throw new Error("session state must not be addressed");
      },
    } as unknown as AgentRunSessionManager);

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/%/resume", {
        method: "POST",
      }),
      createCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid run id" });
    assertEquals(submitCalls, 0);
  });

  it("returns duplicate=true for a repeated identical tool result", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1");
    sessionManager.submitToolResult("run_1", { toolCallId: "tool_1", result: { ok: true } });
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
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1");
    sessionManager.submitToolResult("run_1", { toolCallId: "tool_1", result: { ok: true } });
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
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    sessionManager.prepareForToolResult("run_1", "tool_1");

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
    assertEquals(await sessionManager.waitForToolResult("run_1", "tool_1"), {
      result: { ok: true },
      isError: false,
    });
    sessionManager.completeRun("run_1");
  });

  it("returns 409 when a different tool call is submitted while another wait is active", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForToolResult("run_1", "tool_1");

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
    assertEquals(sessionManager.cancelRun("run_1"), true);
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

  it("awaits worker-owned resume control and passes the verified project binding", async () => {
    let observedBinding: unknown;
    const control: AgentRunControl = {
      async submitToolResult(_runId, _input, binding) {
        await Promise.resolve();
        observedBinding = binding;
        return { accepted: true, duplicate: true };
      },
      cancelRun: () => false,
    };
    const handler = new AgentRunResumeHandler(control);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
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
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(await result.response.json(), { accepted: true, duplicate: true });
    assertEquals(observedBinding, { projectId: "proj-1", projectSlug: "demo-project" });
  });

  it("does not expose an isolated run across signed project bindings", async () => {
    const control: AgentRunControl = {
      submitToolResult() {
        throw new AgentRunControlBindingError();
      },
      cancelRun: () => false,
    };
    const handler = new AgentRunResumeHandler(control);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: null,
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
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
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Invalid control-plane signature" });
  });
});
