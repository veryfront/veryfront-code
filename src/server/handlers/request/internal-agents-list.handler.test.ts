import "#veryfront/schemas/_test-setup.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES } from "#veryfront/internal-agents/request-body.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { AuthHandler } from "#veryfront/security/http/auth.ts";
import type { HandlerContext, SecurityConfig } from "#veryfront/types";
import { InternalAgentsListHandler } from "./internal-agents-list.handler.ts";
import { runWithProjectEnv } from "../../project-env/storage.ts";
import {
  createAgentWithConfig,
  createControlPlaneSignature as createTestControlPlaneSignature,
  createCtx,
} from "./internal-agent-run.test-helpers.ts";

function createControlPlaneSignature(
  body: string,
  overrides: Parameters<typeof createTestControlPlaneSignature>[1] = {},
): ReturnType<typeof createTestControlPlaneSignature> {
  return createTestControlPlaneSignature(body, {
    requestMethod: "POST",
    requestPath: "/api/control-plane/agents/list",
    ...overrides,
  });
}

describe("server/handlers/request/internal-agents-list.handler", () => {
  it("returns discovered agents for a valid signed request", async () => {
    let discoveryCalls = 0;
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
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
      new Request("https://example.com/api/control-plane/agents/list", {
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

  it("accepts the public control-plane agents list route", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgentWithConfig("assistant-1") : undefined,
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
      new Request("https://example.com/api/control-plane/agents/list", {
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
  });

  it("returns 401 when the control-plane signature is missing", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/agents/list", {
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
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
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
      new Request("https://example.com/api/control-plane/agents/list", {
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
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
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
      new Request("https://example.com/api/control-plane/agents/list", {
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
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
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
      new Request("https://example.com/api/control-plane/agents/list", {
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
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const body = '{"requestId":"agents-1"';
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "agents-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/agents/list", {
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
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
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
      new Request("https://example.com/api/control-plane/agents/list", {
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

  it("does not forward VERYFRONT_API_TOKEN when the request token is absent", async () => {
    let discoveryCalls = 0;
    let receivedToken: string | undefined;

    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
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

    // A host token must not be combined with request-selected project context.
    // Set it on the real process environment to prove it is not forwarded.
    const tokenKey = "VERYFRONT_API_TOKEN";
    const originalToken = Deno.env.get(tokenKey);
    Deno.env.set(tokenKey, "server-api-token");

    try {
      const ctx = {
        ...createCtx(publicKeyPem),
        adapter: {
          env: {
            get: (key: string) => {
              if (key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") return publicKeyPem;
              return getEnv(key);
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
        new Request("https://example.com/api/control-plane/agents/list", {
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
      assertEquals(receivedToken, "");
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
    } finally {
      if (originalToken === undefined) {
        Deno.env.delete(tokenKey);
      } else {
        Deno.env.set(tokenKey, originalToken);
      }
    }
  });

  it("uses the host verification key when project overlays hide adapter env reads", async () => {
    const handler = new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
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

    const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
    const originalValue = Deno.env.get(envKey);
    Deno.env.set(envKey, publicKeyPem);

    try {
      const ctx = {
        ...createCtx(undefined),
        adapter: {
          env: {
            get: (key: string) => getEnv(key),
            set: () => {},
            toObject: () => ({}),
          },
          fs: {},
        },
      } as unknown as ReturnType<typeof createCtx>;

      const result = await runWithProjectEnv({}, () =>
        handler.handle(
          new Request("https://example.com/api/control-plane/agents/list", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-control-plane-jws": jws,
            },
            body,
          }),
          ctx,
        ));

      assertExists(result.response);
      assertEquals(result.response.status, 200);
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
    } finally {
      if (originalValue === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, originalValue);
      }
    }
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
          new Request("https://example.com/api/control-plane/agents/list", {
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
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/agents/other", {
        method: "POST",
      }),
      createCtx(),
    );

    assertEquals(result.response, undefined);
  });
});

/**
 * Regression: Studio's agent listing must survive a project that configures
 * `security.auth`.
 *
 * `AuthHandler` runs at priority 0 with an empty pattern list, and the registry
 * calls every handler in priority order rather than consulting
 * `metadata.patterns`, so it stands in front of this surface. The control plane
 * sends no `Authorization` header on this call at all — it authorizes with the
 * signed envelope `verifyControlPlaneRequest` checks — so a project that turned
 * on Basic or Bearer auth answered its own agent listing with 401 and Studio
 * showed no agents.
 */
describe("server/handlers/request/internal-agents-list.handler auth gate", () => {
  function createListHandler(): InternalAgentsListHandler {
    return new InternalAgentsListHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgentWithConfig("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
    });
  }

  async function listAgentsThroughChain(
    auth: SecurityConfig["auth"],
    options: { readonly signed?: boolean; readonly path?: string } = {},
  ): Promise<{ status: number }> {
    const path = options.path ?? "/api/control-plane/agents/list";
    const body = JSON.stringify({
      requestId: "agents-1",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "agents-1",
      requestPath: path,
    });

    const headers: Record<string, string> = { "content-type": "application/json" };
    // The control plane sends no `Authorization` header on this call; the
    // request below carries exactly what `runtime-agent-client` sends.
    if (options.signed !== false) headers["x-veryfront-control-plane-jws"] = jws;

    const ctx = createCtx(publicKeyPem);
    ctx.securityConfig = { auth } as HandlerContext["securityConfig"];

    const registry = new RouteRegistry();
    registry.registerAll([new AuthHandler(), createListHandler()]);

    const response = await registry.execute(
      new Request(`https://example.com${path}`, { method: "POST", headers, body }),
      ctx,
    );

    return { status: response?.status ?? 0 };
  }

  it("lists agents for a signed dispatch behind basic auth", async () => {
    const { status } = await listAgentsThroughChain({
      basic: { username: "admin", password: "secret" },
    });
    assertEquals(status, 200);
  });

  it("lists agents for a signed dispatch behind bearer auth", async () => {
    const { status } = await listAgentsThroughChain({
      bearer: { token: "project-authored-token" },
    });
    assertEquals(status, 200);
  });

  it("still challenges the same surface without the signature header", async () => {
    const { status } = await listAgentsThroughChain(
      { basic: { username: "admin", password: "secret" } },
      { signed: false },
    );
    assertEquals(status, 401);
  });

  it("still challenges a project route inside the control-plane namespace", async () => {
    // `/api/control-plane/agents/list/all` is not a registered surface; it
    // falls through to project code, which the auth gate must keep protecting
    // even when the caller attaches a signature header.
    const { status } = await listAgentsThroughChain(
      { basic: { username: "admin", password: "secret" } },
      { path: "/api/control-plane/agents/list/all" },
    );
    assertEquals(status, 401);
  });
});
