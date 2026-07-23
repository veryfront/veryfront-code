import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  type AgentRunControl,
  AgentRunControlBindingError,
} from "#veryfront/internal-agents/run-control.ts";
import { AgentRunCancelHandler } from "./agent-run-cancel.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/agent-run-cancel.handler", () => {
  it("cancels an active run with a valid control-plane signature", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const handler = new AgentRunCancelHandler(sessionManager);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 202);
    assertEquals(await result.response.json(), { accepted: true });
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });

  it("accepts the public control-plane cancel route", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const handler = new AgentRunCancelHandler(sessionManager);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 202);
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });

  it("decodes and validates the run id before addressing session state", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const handler = new AgentRunCancelHandler(sessionManager);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/%72un_1", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 202);
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });

  it("rejects malformed encoded run ids before addressing session state", async () => {
    let cancelCalls = 0;
    const handler = new AgentRunCancelHandler({
      cancelRun() {
        cancelCalls += 1;
        throw new Error("session state must not be addressed");
      },
    } as unknown as AgentRunSessionManager);

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/%", {
        method: "DELETE",
      }),
      createCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid run id" });
    assertEquals(cancelCalls, 0);
  });

  it("returns 204 when the run is already inactive", async () => {
    const handler = new AgentRunCancelHandler(new AgentRunSessionManager());
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 204);
    assertEquals(await result.response.text(), "");
  });

  it("returns 500 when cancel handling fails unexpectedly", async () => {
    const handler = new AgentRunCancelHandler({
      cancelRun() {
        throw new Error("cancel boom");
      },
    } as unknown as AgentRunSessionManager);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1", {
        method: "DELETE",
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
    assertEquals(await result.response.json(), { error: "Internal cancel failed" });
  });

  it("returns 401 when the control-plane signature is missing", async () => {
    const handler = new AgentRunCancelHandler(new AgentRunSessionManager());

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ runId: "run_1" }),
      }),
      createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Missing control-plane signature" });
  });

  it("ignores non-matching cancel routes", async () => {
    const handler = new AgentRunCancelHandler(new AgentRunSessionManager());
    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/extra", {
        method: "DELETE",
      }),
      createCtx(),
    );

    assertEquals(result.response, undefined);
  });

  it("awaits worker-owned cancellation and passes the verified project binding", async () => {
    let observedBinding: unknown;
    const control: AgentRunControl = {
      submitToolResult: () => ({ accepted: true }),
      async cancelRun(_runId, binding) {
        await Promise.resolve();
        observedBinding = binding;
        return true;
      },
    };
    const handler = new AgentRunCancelHandler(control);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 202);
    assertEquals(observedBinding, { projectId: "proj-1", projectSlug: "demo-project" });
  });

  it("does not expose isolated cancellation across signed project bindings", async () => {
    const control: AgentRunControl = {
      submitToolResult: () => ({ accepted: true }),
      cancelRun() {
        throw new AgentRunControlBindingError();
      },
    };
    const handler = new AgentRunCancelHandler(control);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1", {
        method: "DELETE",
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
