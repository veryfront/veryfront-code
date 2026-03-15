import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { AgentRunResumeHandler } from "./agent-run-resume.handler.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";

const encoder = new TextEncoder();

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function sha256Base64url(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  return base64urlEncodeBytes(new Uint8Array(digest));
}

async function createControlPlaneSignature(
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
    sub: "run_1",
    surface: "studio",
    project_id: "proj-1",
    request_hash: await sha256Base64url(body),
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
    cspUserHeader: null,
    projectSlug: "demo-project",
    projectId: "proj-1",
    isLocalProject: false,
  } as unknown as HandlerContext;
}

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
    const { jws, publicKeyPem } = await createControlPlaneSignature(body);

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/runs/run_1/resume", {
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
    const { jws, publicKeyPem } = await createControlPlaneSignature(body);

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/runs/run_1/resume", {
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
});
