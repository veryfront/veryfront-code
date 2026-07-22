import "#veryfront/schemas/_test-setup.ts";
import { ChannelInvokeRequestSchema } from "#veryfront/channels/invoke.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { readSignedChannelDispatchRequest } from "./channel-dispatch-request.ts";

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

async function createDispatchSignature(
  body: string,
  overrides: Partial<{
    platform: string;
    projectId: string;
    subject: string;
  }> = {},
): Promise<{ jws: string; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyPem = encodePem("PUBLIC KEY", publicKeyDer);
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payload = base64urlEncode(JSON.stringify({
    iss: "veryfront-api",
    aud: "demo-project",
    sub: overrides.subject ?? "dispatch-1",
    project_id: overrides.projectId ?? "proj-1",
    platform: overrides.platform ?? "slack",
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

function createCtx(publicKeyPem?: string): HandlerContext {
  return {
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

function createValidBody(overrides: { projectId?: string } = {}): string {
  return JSON.stringify({
    dispatchId: "dispatch-1",
    conversationId: "conversation-1",
    projectId: overrides.projectId ?? "proj-1",
    assistantId: "agent-1",
    platform: "slack",
    inboundMessage: {
      text: "Hello from Slack",
      userId: "U123",
      userName: "Alice",
      isDirectMessage: false,
    },
    conversationHistory: [],
  });
}

async function readFixture(req: Request, ctx: HandlerContext) {
  return await readSignedChannelDispatchRequest(req, ctx, {
    builder: new ResponseBuilder(),
    endpointName: "channel invoke",
    invalidRequestError: "Invalid channel invoke request",
    schema: ChannelInvokeRequestSchema,
    logWarn: () => {},
    validateClaims: (claims, payload) =>
      claims.sub === payload.dispatchId &&
      claims.project_id === payload.projectId &&
      claims.platform === payload.platform,
  });
}

describe("server/handlers/request/channel-dispatch-request", () => {
  it("returns parsed payload and signed claims for a valid dispatch request", async () => {
    const body = createValidBody();
    const { jws, publicKeyPem } = await createDispatchSignature(body);

    const result = await readFixture(
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": jws },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.rawBody, body);
      assertEquals(result.payload.dispatchId, "dispatch-1");
      assertEquals(result.claims.sub, "dispatch-1");
    }
  });

  it("preserves the shared setup error responses", async () => {
    const missingKey = await readFixture(
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        body: createValidBody(),
      }),
      createCtx(),
    );

    assertEquals(missingKey.ok, false);
    if (!missingKey.ok) {
      assertEquals(missingKey.response.status, 500);
      assertEquals(await missingKey.response.json(), {
        error: "Channel dispatch verification is not configured",
      });
    }

    const missingProject = await readFixture(
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        body: createValidBody(),
      }),
      {
        ...createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"),
        projectSlug: "",
      },
    );

    assertEquals(missingProject.ok, false);
    if (!missingProject.ok) {
      assertEquals(missingProject.response.status, 400);
      assertEquals(await missingProject.response.json(), {
        error: "Project context is unavailable",
      });
    }
  });

  it("preserves dispatch signature error responses", async () => {
    const missingSignature = await readFixture(
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        body: createValidBody(),
      }),
      createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"),
    );

    assertEquals(missingSignature.ok, false);
    if (!missingSignature.ok) {
      assertEquals(missingSignature.response.status, 401);
      assertEquals(await missingSignature.response.json(), { error: "Missing dispatch signature" });
    }

    const invalidSignature = await readFixture(
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": "invalid.signature.value" },
        body: createValidBody(),
      }),
      createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"),
    );

    assertEquals(invalidSignature.ok, false);
    if (!invalidSignature.ok) {
      assertEquals(invalidSignature.response.status, 401);
      assertEquals(await invalidSignature.response.json(), { error: "Invalid dispatch signature" });
    }
  });

  for (
    const { bodyOptions, label, signatureOptions } of [
      {
        label: "subject",
        signatureOptions: { subject: "another-dispatch" },
      },
      {
        bodyOptions: { projectId: "another-project" },
        label: "project",
        signatureOptions: {},
      },
      {
        label: "platform",
        signatureOptions: { platform: "another-platform" },
      },
    ]
  ) {
    it(`rejects a valid signature whose ${label} claim is not bound to the body`, async () => {
      const body = createValidBody(bodyOptions);
      const { jws, publicKeyPem } = await createDispatchSignature(body, signatureOptions);

      const result = await readFixture(
        new Request("https://example.com/channels/invoke", {
          method: "POST",
          headers: { "x-veryfront-dispatch-jws": jws },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.response.status, 401);
        assertEquals(await result.response.json(), { error: "Invalid dispatch signature" });
      }
    });
  }

  it("preserves caller-specific schema error responses", async () => {
    const body = JSON.stringify({ dispatchId: "dispatch-1" });
    const { jws, publicKeyPem } = await createDispatchSignature(body);

    const result = await readFixture(
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": jws },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      assertEquals(await result.response.json(), { error: "Invalid channel invoke request" });
    }
  });
});
