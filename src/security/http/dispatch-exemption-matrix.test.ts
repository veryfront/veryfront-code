/**
 * The full matrix of signed-dispatch exemptions: every dispatch kind against
 * every gate that can stand in front of it.
 *
 * The runtime serves two kinds of caller that are structurally incapable of
 * satisfying a browser-credential gate, each with its own envelope:
 *
 * - a control-plane dispatch, `x-veryfront-control-plane-jws`, verified by
 *   `verifyControlPlaneJws` against the request method and path;
 * - a channel dispatch, `x-veryfront-dispatch-jws`, verified by
 *   `verifyDispatchJws` against the dispatch id, platform, project id and a
 *   hash of the body.
 *
 * Three gates can stand in front of either one, and each was added to the
 * runtime separately: `security.auth`, `security.csrf`, and the project's root
 * `middleware.ts`. Exempting one gate for one caller is what the individual
 * fixes did, and it leaves the caller blocked by the gates nobody looked at:
 * before this matrix existed, a channel dispatch was exempt from CSRF and was
 * still 401'd by `security.auth` and still 403'd by a gating `middleware.ts`,
 * so the caller the CSRF fix set out to unblock was still blocked twice.
 *
 * This file is the artifact that stops the next gate — or the next dispatch
 * kind — from landing with a partial exemption. Adding either means adding a
 * row or a column here, and the empty cells fail.
 *
 * Every cell asserts three directions.
 *
 * Admitted when validly signed, because a gate that blocks the platform's own
 * dispatch takes the project's channels or deploys offline with an error that
 * names neither the gate nor the config.
 *
 * Rejected when unsigned, because the exemption is keyed on the envelope and
 * never on the path: an unsigned request to the very same route is ordinary
 * traffic and must still meet every gate the project configured.
 *
 * Rejected downstream when forged, which is the direction that carries the real
 * security argument. The signature header is attacker-settable — see
 * `a project's CORS policy can make the signature header attachable` below —
 * so a forged one does match the predicate and does skip the gate. That is safe
 * only because the route terminates at a handler that verifies the envelope,
 * never at project code. These cells are what makes that load-bearing.
 *
 * @module security/http/dispatch-exemption-matrix.test
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { AuthHandler } from "#veryfront/security/http/auth.ts";
import { CsrfHandler } from "#veryfront/security/http/csrf/csrf-handler.ts";
import { deriveSecurityContext } from "#veryfront/security/http/config.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { ProjectMiddlewareRuntime } from "#veryfront/server/runtime-handler/project-middleware.ts";
import type { MiddlewareFunction } from "#veryfront/server/dev-server/middleware.ts";
import type { Agent, AgentMessage, AgentResponse } from "#veryfront/agent";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HandlerContext } from "#veryfront/types";
import type { Handler } from "#veryfront/routing/registry/types.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { ChannelInvokeHandler } from "#veryfront/server/handlers/request/channel-invoke.handler.ts";
import { handleCORSPreflight } from "#veryfront/security/http/cors/preflight.ts";
import {
  ProjectRunExecuteHandler,
  type ProjectRunExecuteHandlerDeps,
} from "#veryfront/server/handlers/request/project-run-execute.handler.ts";
import {
  createControlPlaneSignature,
  createCtx as createControlPlaneCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";

const encoder = new TextEncoder();

const RUN_ID = "run_matrix_1";
const EXECUTE_PATH = `/api/control-plane/runs/${RUN_ID}/execute`;
const INVOKE_PATH = "/channels/invoke";

/** What a prepared dispatch needs before a gate is put in front of it. */
interface PreparedDispatch {
  readonly request: Request;
  readonly ctx: HandlerContext;
  /** The handler that owns the dispatch's route. */
  readonly terminal: Handler;
  /** Whether the work behind the route actually ran. */
  readonly reached: () => boolean;
}

/**
 * How the request presents its signature header.
 *
 * `forged` is the case the exemptions actually have to survive. The header is
 * attacker-settable — a permissive project `security.cors` makes the runtime
 * advertise it on a preflight, and the proxy forwards an unverified
 * `x-veryfront-*-jws` from a public request rather than stripping it — so the
 * predicates match on a value nobody has checked yet. Safety comes from what
 * happens next, not from who can set the header.
 */
type SignaturePresentation = "valid" | "absent" | "forged";

const FORGED_JWS = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJmb3JnZWQifQ.not-a-signature";

interface DispatchKind {
  readonly name: string;
  /** Prepare a dispatch presenting its signature header in a given way. */
  readonly prepare: (
    options: { readonly signature: SignaturePresentation },
  ) => Promise<PreparedDispatch>;
}

// --- control-plane dispatch --------------------------------------------------

async function prepareControlPlaneDispatch(
  { signature }: { readonly signature: SignaturePresentation },
): Promise<PreparedDispatch> {
  const body = JSON.stringify({
    runId: RUN_ID,
    kind: "task",
    target: "task:release-asset-build",
    projectId: "proj-1",
    config: { release_id: "rel-1", release_version: 1 },
  });
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    requestId: RUN_ID,
    projectId: "proj-1",
    requestMethod: "POST",
    requestPath: EXECUTE_PATH,
  });

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature === "valid") headers["x-veryfront-control-plane-jws"] = jws;
  if (signature === "forged") headers["x-veryfront-control-plane-jws"] = FORGED_JWS;

  const request = new Request(`https://demo-project.example.test${EXECUTE_PATH}`, {
    method: "POST",
    headers,
    body,
  });

  let reached = false;
  const deps = {
    executeReleaseAssetBuild: () => {
      reached = true;
      return Promise.resolve({
        success: true,
        result: { state: "ready", moduleCount: 1, cssCount: 1, routeCount: 1 },
        logs: null,
        duration_ms: 10,
      });
    },
    now: () => 0,
  } as unknown as ProjectRunExecuteHandlerDeps;

  return {
    request,
    ctx: createControlPlaneCtx(publicKeyPem),
    terminal: new ProjectRunExecuteHandler(deps),
    reached: () => reached,
  };
}

// --- channel dispatch --------------------------------------------------------

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
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const publicKeyPem = encodePem(
    "PUBLIC KEY",
    await crypto.subtle.exportKey("spki", keyPair.publicKey),
  );
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
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    encoder.encode(`${header}.${payload}`),
  );

  return {
    publicKeyPem,
    jws: `${header}.${payload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
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

function createChannelCtx(publicKeyPem: string): HandlerContext {
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

async function prepareChannelDispatch(
  { signature }: { readonly signature: SignaturePresentation },
): Promise<PreparedDispatch> {
  const body = JSON.stringify({
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
  const { jws, publicKeyPem } = await createDispatchSignature(body);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature === "valid") headers["x-veryfront-dispatch-jws"] = jws;
  if (signature === "forged") headers["x-veryfront-dispatch-jws"] = FORGED_JWS;

  const request = new Request(`https://demo-project.example.test${INVOKE_PATH}`, {
    method: "POST",
    headers,
    body,
  });

  let reached = false;
  const assistantMessage: AgentMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text: "Hello from the agent" }],
  };
  const terminal = new ChannelInvokeHandler({
    ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
    getAgent: () =>
      createAgent(() => {
        reached = true;
        return Promise.resolve({
          text: "Hello from the agent",
          messages: [assistantMessage],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
        });
      }),
    getAllAgentIds: () => ["agent-1"],
  });

  return {
    request,
    ctx: createChannelCtx(publicKeyPem),
    terminal,
    reached: () => reached,
  };
}

const DISPATCH_KINDS: readonly DispatchKind[] = [
  { name: "control-plane dispatch", prepare: prepareControlPlaneDispatch },
  { name: "channel dispatch", prepare: prepareChannelDispatch },
];

// --- gates -------------------------------------------------------------------

interface GateOutcome {
  readonly status: number;
  readonly reached: boolean;
}

interface Gate {
  readonly name: string;
  /** The status this gate answers with when it turns a request away. */
  readonly rejectedStatus: number;
  readonly run: (prepared: PreparedDispatch) => Promise<GateOutcome>;
}

function applySecurity(prepared: PreparedDispatch, security: Record<string, unknown>): void {
  const { securityConfig } = deriveSecurityContext(
    { security } as VeryfrontConfig,
    // The runtime that serves a dispatch resolves as a preview environment, so
    // production defaults are off and only explicit config turns a gate on.
    { productionDefaults: false },
  );
  prepared.ctx.securityConfig = securityConfig;
}

async function runChain(
  prepared: PreparedDispatch,
  front: Handler,
): Promise<GateOutcome> {
  const registry = new RouteRegistry();
  registry.registerAll([front, prepared.terminal]);
  const response = await registry.execute(prepared.request, prepared.ctx);
  return { status: response?.status ?? 0, reached: prepared.reached() };
}

const GATES: readonly Gate[] = [
  {
    name: "security.csrf",
    rejectedStatus: 403,
    run: (prepared) => {
      applySecurity(prepared, { csrf: true });
      return runChain(prepared, new CsrfHandler());
    },
  },
  {
    name: "security.auth",
    rejectedStatus: 401,
    run: (prepared) => {
      applySecurity(prepared, { auth: { basic: { username: "admin", password: "secret" } } });
      return runChain(prepared, new AuthHandler());
    },
  },
  {
    name: "project middleware.ts",
    rejectedStatus: 401,
    run: async (prepared) => {
      applySecurity(prepared, {});
      // Ordinary project code: a root middleware that authorizes every request.
      // It cannot recognise a dispatch, because `createApplicationRequest`
      // withholds every `x-veryfront-*` header from project code.
      const gating: MiddlewareFunction[] = [
        (c, next) =>
          c.req.headers.get("authorization")
            ? next()
            : Promise.resolve(new Response("Unauthorized", { status: 401 })),
      ];
      const registry = new RouteRegistry();
      registry.registerAll([prepared.terminal]);
      const runtime = new ProjectMiddlewareRuntime({
        loadMiddleware: () => Promise.resolve(gating),
      });
      const response = await runtime.execute({
        request: prepared.request,
        handlerContext: prepared.ctx,
        isSharedProxy: false,
        next: async () => (await registry.execute(prepared.request, prepared.ctx)) ?? undefined,
      });
      return { status: response?.status ?? 0, reached: prepared.reached() };
    },
  },
];

describe("signed dispatch exemptions: every dispatch kind against every gate", () => {
  for (const kind of DISPATCH_KINDS) {
    for (const gate of GATES) {
      it(`admits a signed ${kind.name} through ${gate.name}`, async () => {
        const prepared = await kind.prepare({ signature: "valid" });
        const outcome = await gate.run(prepared);
        assertEquals(
          outcome.reached,
          true,
          `${gate.name} blocked a signed ${kind.name}: the runtime answered ${outcome.status}. ` +
            `Every gate must exempt every signed dispatch kind; a partial exemption leaves the ` +
            `caller blocked by whichever gate nobody looked at.`,
        );
        assertEquals(outcome.status, 200);
      });

      it(`rejects a forged ${kind.name} downstream of ${gate.name}`, async () => {
        // The premise this replaces: earlier docstrings argued the exemption was
        // safe because "a browser cannot attach the signature header to a
        // cross-origin request without a preflight the runtime does not grant".
        // The runtime does grant it — see the preflight test alongside this one.
        // The header is attacker-settable, the predicate matches, and the gate
        // is skipped. That is fine, and this is why: the route terminates at a
        // handler that verifies the envelope, so the forgery buys a different
        // rejection and never project code.
        const prepared = await kind.prepare({ signature: "forged" });
        const outcome = await gate.run(prepared);
        assertEquals(
          outcome.reached,
          false,
          `a forged signature header reached the work behind a ${kind.name}. The exemption ` +
            `relies entirely on the owning handler verifying the envelope; if that check is ` +
            `gone, skipping ${gate.name} is a bypass rather than a shortcut.`,
        );
        assertEquals(
          outcome.status,
          401,
          `a forged ${kind.name} was answered with ${outcome.status} rather than 401 by the ` +
            `handler that owns the route.`,
        );
      });

      it(`rejects an unsigned ${kind.name} at ${gate.name}`, async () => {
        const prepared = await kind.prepare({ signature: "absent" });
        const outcome = await gate.run(prepared);
        assertEquals(
          outcome.status,
          gate.rejectedStatus,
          `${gate.name} let an unsigned request through on the dispatch route for a ` +
            `${kind.name}. The exemption is keyed on the signature envelope, never on the ` +
            `method and path, so the same route without a signature is ordinary project ` +
            `traffic and must still meet the gate.`,
        );
        assertEquals(outcome.reached, false);
      });
    }
  }
});

describe("signed dispatch exemptions: what the safety argument may not rest on", () => {
  it("a project's CORS policy can make the signature header attachable", async () => {
    // #3641's docstring, and the copy of it #3647 inherited, argued the
    // exemption was safe because "a browser cannot attach the signature header
    // to a cross-origin request without a preflight the runtime does not
    // grant". The runtime grants it. With no configured `allowedHeaders`,
    // `resolveNormalizedCORSPreflightPolicy` reflects whatever
    // `Access-Control-Request-Headers` asked for, so any project whose CORS
    // policy admits an origin also advertises the signature header to it.
    //
    // This test exists so the claim cannot be reinstated. If it ever starts
    // failing, the runtime has become stricter and the docstrings may be
    // revisited — but the argument must still be made from the downstream
    // signature check, which is the thing an attacker cannot forge.
    for (const config of [true, { origin: "*" }, { origin: "https://attacker.example" }]) {
      const preflight = await handleCORSPreflight({
        request: new Request(`https://demo-project.example.test${EXECUTE_PATH}`, {
          method: "OPTIONS",
          headers: {
            origin: "https://attacker.example",
            "access-control-request-method": "POST",
            "access-control-request-headers": "x-veryfront-control-plane-jws",
          },
        }),
        config,
      } as never);

      assertEquals(preflight.status, 204, `preflight rejected under ${JSON.stringify(config)}`);
      assertEquals(
        preflight.headers.get("Access-Control-Allow-Headers"),
        "x-veryfront-control-plane-jws",
        `The runtime declined to advertise the dispatch signature header under ` +
          `${JSON.stringify(config)}. That is stricter than when this was written; do not ` +
          `take it as licence to argue the exemption is safe because the header is ` +
          `unattachable. Safety comes from the downstream signature verification.`,
      );
    }
  });
});
