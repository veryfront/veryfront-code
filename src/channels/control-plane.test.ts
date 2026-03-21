import type { Agent } from "#veryfront/agent";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import {
  listRuntimeAgents,
  RuntimeAgentListResponseSchema,
  verifyControlPlaneJws,
} from "./control-plane.ts";

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
  overrides: Partial<{
    audience: string;
    projectId: string;
    requestId: string;
    surface: "studio" | "channels" | "a2a" | "mcp";
    requestHash: string;
    iat: number;
    exp: number;
  }> = {},
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
    aud: overrides.audience ?? "demo-project",
    sub: overrides.requestId ?? "agents-1",
    surface: overrides.surface ?? "studio",
    project_id: overrides.projectId ?? "proj-1",
    request_hash: overrides.requestHash ?? await sha256Base64url(body),
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + 60,
  }));

  const signingInput = encoder.encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, signingInput);

  return {
    publicKeyPem,
    jws: `${header}.${payload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
}

function createHandlerContext(): HandlerContext {
  return {
    projectDir: "/project",
    adapter: {
      env: { get: () => undefined },
      fs: {},
    },
    securityConfig: null,
    cspUserHeader: null,
    projectSlug: "demo-project",
    projectId: "proj-1",
    isLocalProject: false,
  } as unknown as HandlerContext;
}

function createAgent(overrides: {
  id?: string;
  name?: string;
  description?: string;
  model?: string;
  version?: string;
} = {}): Agent {
  return {
    id: overrides.id ?? "agent-1",
    config: {
      system: "You are helpful.",
      model: overrides.model ?? "anthropic/claude-sonnet-4-6",
      name: overrides.name ?? "Support",
      description: overrides.description ?? "Helps with support questions",
      version: overrides.version ?? "2.0.0",
    } as unknown as Agent["config"],
    generate: async () => ({}) as never,
    stream: async () => ({ toDataStreamResponse: () => new Response() } as never),
    respond: async () => new Response(),
    getMemory: () => ({} as never),
    getMemoryStats: async () => ({
      totalMessages: 0,
      estimatedTokens: 0,
      type: "conversation",
    }),
    clearMemory: async () => {},
  };
}

describe("channels/control-plane", () => {
  describe("verifyControlPlaneJws", () => {
    it("accepts a valid control-plane signature", async () => {
      const body = JSON.stringify({
        requestId: "agents-1",
        projectId: "proj-1",
        surface: "studio",
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body);

      const claims = await verifyControlPlaneJws(jws, body, {
        audience: "demo-project",
        expectedProjectId: "proj-1",
        expectedSubject: "agents-1",
        expectedSurface: "studio",
        publicKeyPem,
        maxAgeSeconds: 60,
      });

      assertEquals(claims.surface, "studio");
      assertEquals(claims.project_id, "proj-1");
      assertEquals(claims.request_hash, await sha256Base64url(body));
    });

    it("rejects a control-plane signature when the body hash does not match", async () => {
      const body = JSON.stringify({
        requestId: "agents-1",
        projectId: "proj-1",
        surface: "studio",
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body);

      await assertRejects(() =>
        verifyControlPlaneJws(jws, `${body} `, {
          audience: "demo-project",
          expectedProjectId: "proj-1",
          publicKeyPem,
          maxAgeSeconds: 60,
        })
      );
    });
  });

  describe("listRuntimeAgents", () => {
    it("returns canonical runtime agents sorted by name", async () => {
      let discoveryCalls = 0;

      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => {
          discoveryCalls += 1;
        },
        getAgent: (id) => {
          if (id === "assistant-b") {
            return createAgent({
              id,
              name: "Beta",
              description: "Second assistant",
              model: "openai/gpt-5",
              version: "1.1.0",
            });
          }

          if (id === "assistant-a") {
            return createAgent({
              id,
              name: "Alpha",
              description: "Primary assistant",
              model: "anthropic/claude-sonnet-4-6",
              version: "2.0.0",
            });
          }

          return undefined;
        },
        getAllAgentIds: () => ["assistant-b", "assistant-a"],
      });

      assertEquals(discoveryCalls, 1);
      assertEquals(
        response,
        RuntimeAgentListResponseSchema.parse({
          agents: [
            {
              id: "assistant-a",
              name: "Alpha",
              description: "Primary assistant",
              model: "anthropic/claude-sonnet-4-6",
              version: "2.0.0",
              skills: [],
            },
            {
              id: "assistant-b",
              name: "Beta",
              description: "Second assistant",
              model: "openai/gpt-5",
              version: "1.1.0",
              skills: [],
            },
          ],
        }),
      );
    });
  });
});
