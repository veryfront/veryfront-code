import { RunStopRegistry } from "#veryfront/internal-agents/run-stop-registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { AgentRunCancelHandler } from "./agent-run-cancel.handler.ts";
import {
  createControlPlaneSignature,
  createCtx,
  stubApplicationErrorReporter,
  withRecordedActiveSpan,
} from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/agent-run-cancel.handler", () => {
  it("keeps an absent execution distinguishable when stop confirmation is requested", async () => {
    const runId = "run_missing_stop";
    const body = JSON.stringify({ runId, confirmStopped: true });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: runId,
      requestMethod: "DELETE",
      requestPath: `/api/control-plane/runs/${runId}`,
    });
    const handler = new AgentRunCancelHandler(new AgentRunSessionManager());
    const result = await handler.handle(
      new Request(`https://example.com/api/control-plane/runs/${runId}`, {
        method: "DELETE",
        body,
        headers: { "content-type": "application/json", "x-veryfront-control-plane-jws": jws },
      }),
      createCtx(publicKeyPem),
    );
    assertExists(result.response);
    assertEquals(result.response.status, 204);
  });

  it("retries stop signalling until the owned execution positively settles", async () => {
    const runId = "run_stop_delivery";
    let signals = 0;
    const sessionManager = new AgentRunSessionManager();
    const settled = sessionManager.stopRegistry.register(runId, () => {
      signals++;
    });
    const handler = new AgentRunCancelHandler(sessionManager);
    const body = JSON.stringify({ runId, confirmStopped: true });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: runId,
      requestMethod: "DELETE",
      requestPath: `/api/control-plane/runs/${runId}`,
    });
    const send = () =>
      handler.handle(
        new Request(`https://example.com/api/control-plane/runs/${runId}`, {
          method: "DELETE",
          body,
          headers: { "content-type": "application/json", "x-veryfront-control-plane-jws": jws },
        }),
        createCtx(publicKeyPem),
      );
    const pending = await send();
    assertExists(pending.response);
    assertEquals(await pending.response.json(), { accepted: true, stopped: false });
    assertEquals(signals, 1);
    settled();
    const acknowledgement = await send();
    assertExists(acknowledgement.response);
    assertEquals(await acknowledgement.response.json(), { accepted: true, stopped: true });
  });

  it("cancels an active run with a valid control-plane signature", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const handler = new AgentRunCancelHandler(sessionManager);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
      requestMethod: "DELETE",
      requestPath: "/api/control-plane/runs/run_1",
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
    assertEquals(await result.response.json(), { accepted: true });
    assertEquals(sessionManager.getRunStatus("run_1"), null);
    // Parking an agent must allow the same durable run to resume.
    const settled = sessionManager.stopRegistry.register("run_1", () => {});
    settled();
  });

  it("accepts the public control-plane cancel route", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const handler = new AgentRunCancelHandler(sessionManager);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
      requestMethod: "DELETE",
      requestPath: "/api/control-plane/runs/run_1",
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
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });

  it("rejects a resume signature replayed against DELETE cancel", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const handler = new AgentRunCancelHandler(sessionManager);
    const body = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool_1",
      result: { ok: true },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
      requestMethod: "POST",
      requestPath: "/api/control-plane/runs/run_1/resume",
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
    assertEquals(sessionManager.getRunStatus("run_1"), "running");
    sessionManager.cancelRun("run_1");
  });

  it("returns 204 when the run is already inactive", async () => {
    const handler = new AgentRunCancelHandler(new AgentRunSessionManager());
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
      requestMethod: "DELETE",
      requestPath: "/api/control-plane/runs/run_1",
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
    assertEquals(result.response.status, 204);
    assertEquals(await result.response.text(), "");
  });

  it("returns 500 when cancel handling fails unexpectedly", async () => {
    const handler = new AgentRunCancelHandler({
      stopRegistry: new RunStopRegistry(),
      getServingSpanAttributes: () => undefined,
      cancelRun() {
        throw new Error("cancel boom");
      },
    } as unknown as AgentRunSessionManager);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
      requestMethod: "DELETE",
      requestPath: "/api/control-plane/runs/run_1",
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

  it("returns 500 when session cancel fails unexpectedly, and reports it", async () => {
    const thrown = new Error("cancel boom");
    const { captures, restore } = stubApplicationErrorReporter();

    try {
      const handler = new AgentRunCancelHandler({
        stopRegistry: new RunStopRegistry(),
        getServingSpanAttributes: () => undefined,
        cancelRun() {
          throw thrown;
        },
      } as unknown as AgentRunSessionManager);
      const body = JSON.stringify({ runId: "run_1" });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
        requestMethod: "DELETE",
        requestPath: "/api/control-plane/runs/run_1",
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
      assertEquals(result.response.status, 500);
      assertEquals(await result.response.json(), { error: "Internal cancel failed" });

      assertEquals(captures.length, 1);
      const captured = captures[0];
      assertExists(captured);
      assertEquals(captured.error, thrown);
      assertEquals(captured.context.boundary, "agent.run.cancel");
      assertEquals(captured.context.requestId, "run_1");
      assertEquals(captured.context.attributes?.["http.status"], 500);
    } finally {
      restore();
    }
  });
});

describe("agent-run-cancel.handler serving identity", () => {
  const productionIdentity = {
    projectId: "proj-1",
    spanAttributes: { "veryfront.environment_name": "staging", "release.id": "rel-1" },
  };

  // The request carries release headers the proxy never set; none may reach the span.
  async function cancel(sessionManager: AgentRunSessionManager) {
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
      requestMethod: "DELETE",
      requestPath: "/api/control-plane/runs/run_1",
    });
    // Through the registry, so the attributes are those of routing.registry.execute.
    const { result, attributes } = await withRecordedActiveSpan(() =>
      new RouteRegistry().register(new AgentRunCancelHandler(sessionManager)).execute(
        new Request("https://example.com/api/control-plane/runs/run_1", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
            "x-release-id": "rel-untrusted",
            "x-environment-name": "untrusted",
          },
          body,
        }),
        {
          ...createCtx(publicKeyPem),
          resolvedEnvironment: "production",
          releaseId: "rel-untrusted",
          environmentName: "untrusted",
        },
      )
    );
    return { status: result?.status, attributes };
  }

  it("stamps the release the owned run's stream was served from", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      servingIdentity: productionIdentity,
    });

    const { status, attributes } = await cancel(sessionManager);

    assertEquals(status, 202);
    assertEquals(attributes["release.id"], "rel-1");
    assertEquals(attributes["veryfront.environment_name"], "staging");
  });

  it("stamps the branch of an owned preview run", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      servingIdentity: {
        projectId: "proj-1",
        spanAttributes: { "branch.id": "branch-1", "branch.name": "feature" },
      },
    });

    const { status, attributes } = await cancel(sessionManager);

    assertEquals(status, 202);
    assertEquals(attributes["branch.name"], "feature");
    assertEquals(attributes["release.id"], undefined);
  });

  it("stamps no release for a run this pod does not own", async () => {
    const { status, attributes } = await cancel(new AgentRunSessionManager());

    assertEquals(status, 204);
    assertEquals(attributes["release.id"], undefined);
    assertEquals(attributes["veryfront.environment_name"], undefined);
  });

  it("stamps nothing when the run was served for another project", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      servingIdentity: { ...productionIdentity, projectId: "proj-other" },
    });

    const { attributes } = await cancel(sessionManager);

    assertEquals(attributes["release.id"], undefined);
    assertEquals(attributes["veryfront.environment_name"], undefined);
  });
});
