import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES } from "#veryfront/internal-agents/request-body.ts";
import { InternalAgentsListHandler } from "./internal-agents-list.handler.ts";
import {
  createAgentWithConfig,
  createControlPlaneSignature,
  createCtx,
} from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/internal-agents-list.handler", () => {
  it("returns discovered agents for a valid signed request", async () => {
    let discoveryCalls = 0;
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: (id) =>
        id === "assistant-1"
          ? createAgentWithConfig("assistant-1", {
            name: "Support",
            description: "Helps with support issues",
            version: "1.0.0",
          })
          : undefined,
      getAllAgentIds: () => ["assistant-1"],
    });

    const body = JSON.stringify({
      requestId: "agents-1",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "agents-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/list", {
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
    assertEquals(discoveryCalls, 1);
    assertEquals(await result.response.json(), {
      agents: [
        {
          id: "assistant-1",
          name: "Support",
          description: "Helps with support issues",
          model: "anthropic/claude-sonnet-4-6",
          version: "1.0.0",
          skills: [],
        },
      ],
    });
  });

  it("returns 401 when the control-plane signature is missing", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "agents-1",
          projectId: "proj-1",
          surface: "studio",
        }),
      }),
      createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Missing control-plane signature" });
  });

  it("returns 401 when the signed claims do not match the request body", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const body = JSON.stringify({
      requestId: "agents-body",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "agents-signed",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/list", {
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

  it("returns 401 when the project id in the signed claims does not match the body", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const body = JSON.stringify({
      requestId: "agents-1",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      projectId: "proj-2",
      requestId: "agents-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/list", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      {
        ...createCtx(publicKeyPem),
        projectId: undefined,
      },
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Invalid control-plane signature" });
  });

  it("rejects oversized list payloads before parsing", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const body = JSON.stringify({
      requestId: "agents-1",
      projectId: "proj-1",
      surface: "studio",
      metadata: "x".repeat(INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES + 1024),
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "agents-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/list", {
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

  it("returns 400 for malformed internal agents requests", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const body = '{"requestId":"agents-1"';
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "agents-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/list", {
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
    assertEquals(await result.response.json(), { error: "Invalid internal agents request" });
  });

  it("returns 400 when the request body shape is invalid", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const body = JSON.stringify({
      requestId: "agents-1",
      projectId: "proj-1",
      surface: 123,
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "agents-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/list", {
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
    assertEquals(await result.response.json(), { error: "Invalid internal agents request" });
  });

  it("uses VERYFRONT_API_TOKEN for multi-project proxy context when request token is absent", async () => {
    let discoveryCalls = 0;
    let receivedToken: string | undefined;

    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: (id) =>
        id === "assistant-1"
          ? createAgentWithConfig("assistant-1", { name: "Project Smoke Agent" })
          : undefined,
      getAllAgentIds: () => ["assistant-1"],
    });

    const body = JSON.stringify({
      requestId: "agents-1",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "agents-1",
    });

    const ctx = {
      ...createCtx(publicKeyPem),
      adapter: {
        env: {
          get: (key: string) => {
            if (key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") return publicKeyPem;
            if (key === "VERYFRONT_API_TOKEN") return "server-api-token";
            return undefined;
          },
          set: () => {},
          toObject: () => ({}),
        },
        fs: {
          isMultiProjectMode: () => true,
          runWithContext: async (
            _projectSlug: string,
            token: string,
            fn: () => Promise<unknown>,
          ) => {
            receivedToken = token;
            return await fn();
          },
        },
      },
      proxyToken: undefined,
      resolvedEnvironment: "production",
      requestContext: { token: "", slug: "demo-project", branch: null, mode: "production" },
    } as unknown as ReturnType<typeof createCtx>;

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/list", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      ctx,
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(receivedToken, "server-api-token");
    assertEquals(discoveryCalls, 1);
    assertEquals(await result.response.json(), {
      agents: [
        {
          id: "assistant-1",
          name: "Project Smoke Agent",
          description: null,
          model: "anthropic/claude-sonnet-4-6",
          version: null,
          skills: [],
        },
      ],
    });
  });

  it("rethrows unexpected discovery failures", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {
        throw new Error("discovery boom");
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const body = JSON.stringify({
      requestId: "agents-1",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "agents-1",
    });

    await assertRejects(
      () =>
        handler.handle(
          new Request("https://example.com/internal/agents/list", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-control-plane-jws": jws,
            },
            body,
          }),
          createCtx(publicKeyPem),
        ),
      Error,
      "discovery boom",
    );
  });

  it("ignores non-matching agents list routes", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/other", {
        method: "POST",
      }),
      createCtx(),
    );

    assertEquals(result.response, undefined);
  });
});
