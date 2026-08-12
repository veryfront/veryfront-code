/**
 * Regression: a project that configures `security.csrf` must still receive its
 * own channel dispatches.
 *
 * A Slack/Discord/etc. message reaches an agent because the platform channel
 * dispatcher POSTs `/channels/invoke` with a signed dispatch envelope in
 * `x-veryfront-dispatch-jws`; `resolveRuntimeOwnerInvokeUrl` re-dispatches to
 * the same route when the owning runtime instance is a different pod. Neither
 * caller is a browser, so neither holds a `__Host-vf_csrf` cookie to echo.
 *
 * `CsrfHandler` runs at priority 5 with an empty pattern list, ahead of
 * `ChannelInvokeHandler` at 700, so a project whose config enables CSRF at all
 * answers its own channel dispatch with
 * `403 Forbidden - invalid or missing CSRF token`. The agent never runs and the
 * channel simply goes quiet: the failure names neither CSRF nor config.
 *
 * PR #3641 exempted the control-plane surfaces, but a channel dispatch carries
 * a different envelope (`verifyDispatchJws`, bound to dispatch id, platform,
 * project id and body hash) under a different header, so
 * `isSignedControlPlaneDispatch` does not and must not match it.
 *
 * @module channels/invoke-dispatch-security.test
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { CsrfHandler } from "#veryfront/security/http/csrf/csrf-handler.ts";
import { deriveSecurityContext } from "#veryfront/security/http/config.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import type { Agent, AgentMessage, AgentResponse } from "#veryfront/agent";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { ChannelInvokeHandler } from "#veryfront/server/handlers/request/channel-invoke.handler.ts";

const INVOKE_PATH = "/channels/invoke";
const encoder = new TextEncoder();

type CsrfSetting = VeryfrontConfig["security"] extends infer S
  ? S extends { csrf?: infer C } ? C : never
  : never;

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function sha256Base64url(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  return base64urlEncodeBytes(new Uint8Array(digest));
}

async function createDispatchSignature(
  body: string,
): Promise<{ jws: string; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyPem = encodePem("PUBLIC KEY", publicKeyDer);
  const now = Math.floor(Date.now() / 1000);

  const header = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payload = base64urlEncode(JSON.stringify({
    iss: "veryfront-api",
    aud: "demo-project",
    sub: "dispatch-1",
    project_id: "proj-1",
    platform: "slack",
    body_sha256: await sha256Base64url(body),
    iat: now,
    exp: now + 60,
  }));

  const signingInput = encoder.encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, signingInput);

  return {
    publicKeyPem,
    jws: `${header}.${payload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
}

function createInvokeBody(): string {
  return JSON.stringify({
    dispatchId: "dispatch-1",
    conversationId: "conversation-1",
    projectId: "proj-1",
    assistantId: "agent-1",
    platform: "slack",
    inboundMessage: {
      text: "Hello from Slack",
      userId: "U123",
      userName: "Alice",
      isDirectMessage: false,
    },
    conversationHistory: [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Hello from Slack" }] },
    ],
  });
}

function createAgentResponse(): AgentResponse {
  const assistantMessage: AgentMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text: "Hello from the agent" }],
  };
  return {
    text: "Hello from the agent",
    messages: [assistantMessage],
    toolCalls: [],
    status: "completed",
    usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
  };
}

function createCtx(publicKeyPem?: string): HandlerContext {
  return {
    projectDir: "/project",
    adapter: {
      env: {
        get: (key: string) =>
          key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY" ? publicKeyPem : undefined,
      },
      fs: {},
    },
    securityConfig: null,
    projectSlug: "demo-project",
    projectId: "proj-1",
    isLocalProject: false,
  } as unknown as HandlerContext;
}

interface DispatchOutcome {
  /** Whether the agent behind the channel dispatch was reached at all. */
  readonly answered: boolean;
  readonly status: number;
  readonly body: string;
}

interface DispatchOverrides {
  readonly method?: string;
  readonly path?: string;
  /** Replaces the dispatch signature header name, or drops it when null. */
  readonly signatureHeader?: string | null;
}

/**
 * Drive the real handler chain the runtime uses for a channel dispatch: the
 * security handlers first, then the channel invoke handler.
 */
async function dispatchChannelInvoke(
  csrf: CsrfSetting | undefined,
  overrides: DispatchOverrides = {},
): Promise<DispatchOutcome> {
  const config = {
    security: csrf === undefined ? {} : { csrf },
  } as VeryfrontConfig;
  const { securityConfig } = deriveSecurityContext(config, { productionDefaults: false });

  const body = createInvokeBody();
  const { jws, publicKeyPem } = await createDispatchSignature(body);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (overrides.signatureHeader !== null) {
    headers[overrides.signatureHeader ?? "x-veryfront-dispatch-jws"] = jws;
  }

  const request = new Request(
    `https://demo-project.example.test${overrides.path ?? INVOKE_PATH}`,
    { method: overrides.method ?? "POST", headers, body },
  );

  let answered = false;
  const handler = new ChannelInvokeHandler({
    ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
    getAgent: () =>
      createAgent(() => {
        answered = true;
        return Promise.resolve(createAgentResponse());
      }),
    getAllAgentIds: () => ["agent-1"],
  });

  const ctx = createCtx(publicKeyPem);
  ctx.securityConfig = securityConfig;

  const registry = new RouteRegistry();
  registry.registerAll([new CsrfHandler(), handler]);

  const response = await registry.execute(request, ctx);
  return {
    answered,
    status: response?.status ?? 0,
    body: response ? await response.text() : "",
  };
}

function createAgent(generate: () => Promise<AgentResponse>): Agent {
  return {
    id: "agent-1",
    config: {} as Agent["config"],
    generate: generate as unknown as Agent["generate"],
    stream: async () => ({ toDataStreamResponse: () => new Response() } as never),
    respond: async () => new Response(),
    getMemory: () => ({} as never),
    getMemoryStats: async () => ({ totalMessages: 0, estimatedTokens: 0, type: "conversation" }),
    clearMemory: async () => {},
  };
}

describe("channels: signed channel dispatch vs a project CSRF policy", () => {
  it("answers a dispatch when the project leaves csrf unset", async () => {
    const outcome = await dispatchChannelInvoke(undefined);
    assertEquals(outcome.status, 200);
    assertEquals(outcome.answered, true);
  });

  it("answers a dispatch when the project enables csrf with a boolean", async () => {
    const outcome = await dispatchChannelInvoke(true);
    assertEquals(
      outcome.answered,
      true,
      `channel dispatch never reached the agent; runtime answered ${outcome.status}: ${outcome.body}`,
    );
    assertEquals(outcome.status, 200);
  });

  it("answers a dispatch when the project excludes an unrelated path from csrf", async () => {
    const outcome = await dispatchChannelInvoke({ excludePaths: ["/api/ag-ui"] });
    assertEquals(
      outcome.answered,
      true,
      `channel dispatch never reached the agent; runtime answered ${outcome.status}: ${outcome.body}`,
    );
    assertEquals(outcome.status, 200);
  });

  it("still rejects an invoke POST that carries no dispatch signature", async () => {
    // A cross-site form POST cannot attach the signature header. Without it the
    // request is browser shaped and must present a CSRF token.
    const outcome = await dispatchChannelInvoke(true, { signatureHeader: null });
    assertEquals(outcome.status, 403);
    assertEquals(outcome.answered, false);
  });

  it("still rejects an invoke POST that carries only a control-plane signature", async () => {
    // The two envelopes are not interchangeable. A control-plane JWS binds a
    // method/path pair under `/api/control-plane/`, and the invoke handler
    // verifies a dispatch JWS instead, so presenting the wrong header must not
    // buy the exemption.
    const outcome = await dispatchChannelInvoke(true, {
      signatureHeader: "x-veryfront-control-plane-jws",
    });
    assertEquals(outcome.status, 403);
    assertEquals(outcome.answered, false);
  });

  it("still rejects a genuinely signed dispatch aimed at a look-alike route", async () => {
    // `/channels/` is reserved but not exclusively routed, so a project route
    // can sit beside or beneath the one dispatch route. A real envelope, minted
    // for a real dispatch, must not exempt a neighbouring path or a method the
    // invoke handler does not serve.
    for (
      const route of [
        { method: "POST", path: "/channels/invoke/application-route" },
        { method: "POST", path: "/channels/invoker" },
        { method: "PUT", path: INVOKE_PATH },
      ]
    ) {
      const outcome = await dispatchChannelInvoke(true, route);
      assertEquals(
        outcome.status,
        403,
        `${route.method} ${route.path} skipped the CSRF gate`,
      );
      assertEquals(outcome.answered, false);
    }
  });
});
