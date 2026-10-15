import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { setEnv } from "#veryfront/platform/compat/process.ts";
import type { AgUiResumeValue } from "#veryfront/agent/ag-ui/tool-shared.ts";
import { createAgentRuntime } from "#veryfront/agent/hosted/cloud-agent-chat-execution.ts";
import { useServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { createHostedAgentServiceRouteSet } from "#veryfront/agent/service/routes.ts";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";
import { startHostedChildForkRuntimeWithHostTools } from "#veryfront/agent/hosted/child-fork-runtime-start.ts";
import { runAgentRuntimeForkStep } from "#veryfront/agent/streaming/fork-runtime-stream.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { registerModelProvider } from "#veryfront/provider";
import { agent as createAgent } from "#veryfront/agent";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { createRuntimeAgentStreamResponse } from "#veryfront/internal-agents/run-stream.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import apiRunEventWriterContract from "../../../../fixtures/contracts/api-run-event-writer-jwt-payload.json" with {
  type: "json",
};
import {
  capturePlatformDependencySource,
  createHostedServiceAuth,
  createVerifiedPlatformToolDependencyRunner,
  getActivePlatformDependencySources,
  getActivePlatformToolDependencies,
  getHostedServiceTokenFromRequest,
  getVerifiedPlatformToolDependencies,
  HostedServiceAuthError,
  type HostedServiceAuthFetch,
  type HostedServiceJwtVerifier,
  registerPlatformDependencyOwner,
  revokePlatformDependencyOwner,
  runWithPlatformDependencyOwner,
  runWithVerifiedPlatformToolDependencies,
} from "#veryfront/agent/service/auth.ts";
import {
  createToolsFromHostDefinitions,
  dynamicTool,
  type ToolExecutionContext,
} from "#veryfront/tool";
import { executeConfiguredTool } from "#veryfront/agent/runtime/tool-helpers.ts";
import { markTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";

import {
  parseHostedChatRequestFromRequest,
  parseRuntimeAgentRunInvocationHostedChatRequestFromRequest,
} from "#veryfront/agent/hosted/chat-request-parser.ts";
import {
  captureHostedPlatformDependencyExecution,
  configureHostedPlatformDependencySource,
  type HostedPlatformDependencyOwner,
  registerHostedChildPlatformDependencies,
  registerHostedPlatformDependencyRequest,
  revokeHostedPlatformDependencies,
  runWithHostedPlatformDependencies,
} from "#veryfront/agent/hosted/platform-dependency-credential.ts";
import {
  hostedInheritedRunAdmitter,
  hostedTerminalToolSourceFactory,
  registerHostedTerminalCredential,
  transferHostedTerminalAuthority,
} from "#veryfront/agent/hosted/terminal-credential.ts";
import { createHostedProjectRemoteToolSources } from "#veryfront/agent/hosted/project-remote-tool-source.ts";

type JwtFixture = {
  token: string;
  publicKeyPem: string;
  keyPair: CryptoKeyPair;
};

type FetchCall = {
  input: string | URL | Request;
  init: RequestInit | undefined;
};

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return encodeBase64UrlBytes(bytes);
}

function encodeBase64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64UrlBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const binary = atob(`${normalized}${"=".repeat(paddingLength)}`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeJsonBase64Url(value: Record<string, unknown>): string {
  return encodeBase64Url(JSON.stringify(value));
}

function spkiDerToPem(der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function pemToSpkiDer(publicKeyPem: string): Uint8Array<ArrayBuffer> {
  const base64 = publicKeyPem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  return decodeBase64UrlBytes(base64.replace(/\+/g, "-").replace(/\//g, "_"));
}

function createUnsignedJwt(payload: Record<string, unknown>): string {
  return [
    encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    encodeBase64Url(JSON.stringify(payload)),
    "signature",
  ].join(".");
}

async function createRs256JwtFixture(
  payload: Record<string, unknown>,
  suppliedKeyPair?: CryptoKeyPair,
): Promise<JwtFixture> {
  const keyPair = suppliedKeyPair ?? await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: issuedAt, exp: issuedAt + 3600 };
  const signingInput = [
    encodeJsonBase64Url({ alg: "RS256", typ: "JWT" }),
    encodeJsonBase64Url(claims),
  ].join(".");
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  return {
    token: `${signingInput}.${encodeBase64UrlBytes(new Uint8Array(signature))}`,
    publicKeyPem: spkiDerToPem(publicKeyDer),
    keyPair,
  };
}

const webCryptoAuthProvider: HostedServiceJwtVerifier = {
  async verifyWithPublicKey(token, publicKeyPem) {
    const [headerPart, payloadPart, signaturePart] = token.split(".");
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new Error("Invalid token");
    }
    const header = JSON.parse(new TextDecoder().decode(decodeBase64UrlBytes(headerPart)));
    if (header?.alg !== "RS256") {
      throw new Error("Invalid token");
    }
    const publicKey = await crypto.subtle.importKey(
      "spki",
      pemToSpkiDer(publicKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signingInput = `${headerPart}.${payloadPart}`;
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decodeBase64UrlBytes(signaturePart),
      new TextEncoder().encode(signingInput),
    );
    if (!valid) {
      throw new Error("Invalid token");
    }
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64UrlBytes(payloadPart)));
    if (typeof payload?.exp === "number" && payload.exp * 1000 < Date.now()) {
      throw new Error("expired");
    }
    return payload;
  },
};

function createFetchMock(response: Response): {
  calls: FetchCall[];
  fetch: HostedServiceAuthFetch;
} {
  const calls: FetchCall[] = [];
  const fetchMock: HostedServiceAuthFetch = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve(response.clone());
  };

  return { calls, fetch: fetchMock };
}

function getAuthorizationHeader(call: FetchCall): string | null {
  const headers = call.init?.headers;
  if (headers instanceof Headers) return headers.get("authorization");
  return null;
}

function getOnlyFetchCall(calls: FetchCall[]): FetchCall {
  assertEquals(calls.length, 1);
  const call = calls[0];
  if (!call) throw new Error("Expected one fetch call");
  return call;
}

function pinHostedWriterFixture(fixture: JwtFixture): void {
  setEnv("OAUTH_PUBLIC_KEY", fixture.publicKeyPem);
  setEnv("SERVICE_ACCOUNT_VERYFRONT_SERVER_ID", apiRunEventWriterContract.payload.serviceAccountId);
}

async function createHostedDependencyHarness(
  options: {
    parentHasNoDependencies?: boolean;
    childProjectId?: string;
    deferSource?: boolean;
    legacyDefaultRoot?: boolean;
  } = {},
) {
  const scope = {
    projectId: "11111111-1111-4111-8111-111111111111",
    runId: "run_1",
    agentId: "ingestion-agent",
  };
  const dependencies = [{ toolId: "intake", platformTools: ["veryfront__create_file"] }];
  const fixture = await createRs256JwtFixture({
    ...apiRunEventWriterContract.payload,
    agentId: scope.agentId,
    ...(options.parentHasNoDependencies || options.legacyDefaultRoot
      ? {}
      : { platformToolDependencies: dependencies }),
  });
  pinHostedWriterFixture(fixture);
  const auth = createHostedServiceAuth({
    authProvider: webCryptoAuthProvider,
    getConfig: () => ({
      OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
      SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
      NODE_ENV: "production",
      VERYFRONT_API_URL: "https://api.example.test",
    }),
  });
  const runtimeSource = { type: "release", releaseId: "release-fixture" } as const;
  const ingressRequest = new Request("https://agent.example.test/api/runs", {
    method: "POST",
    headers: { "X-Veryfront-Run-Event-Token": fixture.token },
    body: JSON.stringify(
      options.legacyDefaultRoot
        ? {
          messages: [{
            id: "user-fixture",
            role: "user",
            parts: [{ type: "text", text: "Persist selected artifact" }],
          }],
          context: {
            conversationId: "10000000-1000-4000-8000-100000000001",
            projectId: scope.projectId,
            projectSlug: "fixture-project",
            branchId: null,
          },
          durableRootRun: { runId: scope.runId, messageId: "10000000-1000-4000-8000-100000000002" },
          allowDelegation: true,
        }
        : {
          run: {
            agentServiceId: "runtime-provider",
            agentId: scope.agentId,
            conversationId: "10000000-1000-4000-8000-100000000001",
            runId: scope.runId,
            messageId: "10000000-1000-4000-8000-100000000002",
            inputAnchorMessageId: "10000000-1000-4000-8000-100000000003",
            requestedByUserId: "10000000-1000-4000-8000-100000000004",
            project: {
              projectId: scope.projectId,
              projectSlug: "fixture-project",
              runtimeTargetKind: "main_branch",
            },
          },
          messages: [{
            id: "user-fixture",
            role: "user",
            parts: [{ type: "text", text: "Persist selected artifact" }],
          }],
          agentSource: runtimeSource,
        },
    ),
  });
  const parse = options.legacyDefaultRoot
    ? parseHostedChatRequestFromRequest
    : parseRuntimeAgentRunInvocationHostedChatRequestFromRequest;
  const parsed = await parse(
    ingressRequest.clone(),
    {
      authenticate: async () => ({ userId: "fixture-user", authToken: "fixture-session" }),
      verifyProjectAccess: async () => ({ success: true }),
      verifyRunEventAppendToken: auth.verifyRunEventAppendToken,
      runtimeSource,
    },
  );
  assert(
    !(parsed instanceof Response),
    parsed instanceof Response ? await parsed.text() : undefined,
  );
  const childScope = {
    ...scope,
    projectId: options.childProjectId ?? scope.projectId,
    runId: "run_inherited_fixture",
    agentId: "attachment-child",
  };
  const childDependencies = [{
    toolId: "persist_attachment",
    platformTools: [
      "veryfront__create_file",
      "outlook__upload_attachment",
      "veryfront__get_file_version",
    ],
  }];
  const childFixture = await createRs256JwtFixture({
    ...apiRunEventWriterContract.payload,
    ...childScope,
    platformToolDependencies: childDependencies,
  }, fixture.keyPair);
  const terminalToken = (runId: string, canonicalRunId: string) =>
    createUnsignedJwt({
      runId,
      canonicalRunId,
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
      dispatchNonce: "fixture-generation",
    });
  const parentCanonicalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const childCanonicalId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  registerHostedTerminalCredential(
    parsed,
    terminalToken(scope.runId, parentCanonicalId),
    fixture.token,
  );
  const controls: {
    eventToken: string;
    deniedOperations: string[];
    failSource: boolean;
    failedOwner?: HostedPlatformDependencyOwner;
    discoveryWait?: Promise<void>;
    onDiscovery?: () => void;
  } = { eventToken: childFixture.token, deniedOperations: [], failSource: false };
  const effects: string[] = [];
  const persisted = new Map<string, unknown>();
  if (!options.deferSource) {
    await configureHostedPlatformDependencySource(parsed, async (sourceScope, authToken, owner) => {
      if (controls.failSource && sourceScope.runId === childScope.runId) {
        controls.failedOwner = owner;
        throw new Error("Fixture source configuration failed");
      }
      return createHostedProjectRemoteToolSources({
        mcpServers: [{ kind: "veryfront-api", toolPolicy: { deny: controls.deniedOperations } }],
        authToken,
        apiMcpUrl: "https://api.example.test/mcp",
        getProjectId: () => sourceScope.projectId,
        defaultProjectId: sourceScope.projectId,
        createRemoteToolSource: hostedTerminalToolSourceFactory(
          owner,
          "https://api.example.test/mcp",
          (config) => ({
            id: "fixture-api",
            listTools: async () => {
              controls.onDiscovery?.();
              await controls.discoveryWait;
              return ["create_file", "outlook__upload_attachment", "get_file_version"].map((
                name,
              ) => ({
                name,
                description: name,
                parameters: { type: "object", properties: {} },
              }));
            },
            executeTool: async (name, input, context) => {
              const headers = new Headers(
                typeof config.headers === "function"
                  ? await config.headers(context)
                  : config.headers,
              );
              if (name === "create_file") {
                assertEquals(headers.get("X-Veryfront-Run-Event-Token"), childFixture.token);
                persisted.set("fixture-record", input);
              }
              if (name !== "get_tool_access_profile") effects.push(name);
              if (name === "create_file") {
                return {
                  version_id: "10000000-1000-4000-8000-100000000020",
                  path: "fixture-record",
                };
              }
              if (name === "get_file_version") {
                assertEquals(input.version_id, "10000000-1000-4000-8000-100000000020");
                return { path: "fixture-record", historical: persisted.get("fixture-record") };
              }
              return { persisted: persisted.has("fixture-record"), operation: name };
            },
          }),
        ),
      })[0];
    });
  }
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assertEquals(request.url, "https://api.example.test/runs");
    assertEquals((await request.json()).target, { type: "agent", id: childScope.agentId });
    return Response.json({
      id: childCanonicalId,
      conversation_id: "10000000-1000-4000-8000-100000000010",
      output_message_id: "10000000-1000-4000-8000-100000000011",
      status: "running",
    }, {
      status: 202,
      headers: {
        "Cache-Control": "no-store",
        "X-Veryfront-Run-Terminal-Token": terminalToken(childScope.runId, childCanonicalId),
        "X-Veryfront-Inference-Token": "child-inference-fixture",
        "X-Veryfront-Run-Invocation-Token": "child-invocation-fixture",
        "X-Veryfront-Run-Renewal-Token": "child-renewal-fixture",
        "X-Veryfront-Run-Event-Token": controls.eventToken,
        "X-Veryfront-Run-Event-Sequence": "0",
        "X-Veryfront-Run-External-Event-Sequence": "0",
      },
    });
  };
  const admit = hostedInheritedRunAdmitter(parsed, {
    apiUrl: "https://api.example.test",
    fetch: send,
  });
  assert(admit);
  const admitChild = () =>
    admit("fixture-delegation", "Persist selected artifact")({
      apiUrl: "https://api.example.test",
      authToken: "fixture-session",
      projectId: childScope.projectId,
      agentId: childScope.agentId,
      parentRunId: scope.runId,
    });
  let retainedCallback: ToolExecutionContext["executePlatformTool"];
  const tools = createToolsFromHostDefinitions({
    persist_attachment: dynamicTool({
      id: "persist_attachment",
      description: "Persist selected attachment",
      inputSchema: {},
      inputSchemaJson: { type: "object", properties: {} },
      delegatedPlatformTools: [
        "veryfront__create_file",
        "outlook__upload_attachment",
        "veryfront__get_file_version",
      ],
      execute: async (_input: unknown, context?: ToolExecutionContext) => {
        assertEquals(context?.projectId, childScope.projectId);
        assertEquals(context?.runId, childScope.runId);
        assertEquals(context?.agentId, childScope.agentId);
        assertEquals(context?.authToken, undefined);
        retainedCallback = context?.executePlatformTool;
        const created = await context?.executePlatformTool?.("veryfront__create_file", {
          path: "fixture-record",
        }) as { version_id: string };
        await context?.executePlatformTool?.("outlook__upload_attachment", {
          record: "fixture-record",
        });
        return await context?.executePlatformTool?.("veryfront__get_file_version", {
          file_path: "fixture-record",
          version_id: created.version_id,
          ref: { type: "main" },
        });
      },
    }),
  });
  return {
    scope,
    ingressRequest,
    runtimeSource,
    verify: auth.verifyRunEventAppendToken,
    childScope,
    childDependencies,
    dependencies,
    fixture,
    parsed,
    childFixture,
    effects,
    persisted,
    controls,
    admitChild,
    tools,
    retainedCallback: () => retainedCallback,
  };
}

describe("agent/agent-service-auth", () => {
  it("creates typed agent service auth errors", () => {
    const unauthenticated = new HostedServiceAuthError(401, "Token required");
    assertEquals(unauthenticated.name, "HostedServiceAuthError");
    assertEquals(unauthenticated.statusCode, 401);
    assertEquals(unauthenticated.errorCode, "UNAUTHENTICATED");
    assertEquals(unauthenticated.message, "Token required");

    const forbidden = new HostedServiceAuthError(403, "No access");
    assertEquals(forbidden.statusCode, 403);
    assertEquals(forbidden.errorCode, "FORBIDDEN");
  });

  it("extracts auth tokens from cookies before bearer headers", () => {
    const request = new Request("https://agent.test/run", {
      headers: {
        authorization: "Bearer bearer-token",
        cookie: "theme=dark; authToken=cookie-token; other=value",
      },
    });

    assertEquals(getHostedServiceTokenFromRequest(request), "cookie-token");
  });

  it("ignores cookies whose name merely ends with authToken", () => {
    const bearerRequest = new Request("https://agent.test/run", {
      headers: {
        authorization: "Bearer bearer-token",
        cookie: "xauthToken=wrong-token",
      },
    });

    assertEquals(
      getHostedServiceTokenFromRequest(bearerRequest),
      "bearer-token",
      "a cookie name suffixed with authToken must not shadow the bearer token",
    );

    const cookieOnlyRequest = new Request("https://agent.test/run", {
      headers: { cookie: "myauthToken=wrong-token" },
    });

    assertStrictEquals(
      getHostedServiceTokenFromRequest(cookieOnlyRequest),
      null,
      "only an exact authToken cookie may supply the token",
    );
  });

  it("extracts bearer auth tokens when no auth cookie exists", () => {
    const request = new Request("https://agent.test/run", {
      headers: { authorization: "Bearer bearer-token" },
    });

    assertEquals(getHostedServiceTokenFromRequest(request), "bearer-token");
  });

  it("does not expose request headers through a replaced prototype getter", () => {
    const request = new Request("https://agent.test/run", {
      headers: {
        authorization: "Bearer bearer-token",
        "x-veryfront-inference-token": "private-inference-token",
      },
    });
    let replacementCalled = false;
    Object.defineProperty(request, "headers", {
      configurable: true,
      get() {
        replacementCalled = true;
        throw new Error("project getter must not receive the request");
      },
    });
    assertEquals(getHostedServiceTokenFromRequest(request), "bearer-token");
    assertEquals(replacementCalled, false);
  });

  it("returns null when no auth token exists", () => {
    const request = new Request("https://agent.test/run");
    assertStrictEquals(getHostedServiceTokenFromRequest(request), null);
  });

  it("verifies RS256 JWTs with configured public key", async () => {
    const fixture = await createRs256JwtFixture({
      userId: "user-1",
      email: "user@example.test",
    });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(fixture.token);

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected JWT verification to succeed");
    assertEquals(result.userId, "user-1");
    assertEquals(result.email, "user@example.test");
    assertEquals(result.token, fixture.token);
  });

  it("accepts only the dedicated writer claims for exactly one project and run", async () => {
    assertEquals(apiRunEventWriterContract.contractId, "veryfront.run-event-writer.jwt-payload.v2");
    assertEquals(apiRunEventWriterContract.serviceIdentity, "veryfront-server");
    const fixture = await createRs256JwtFixture(apiRunEventWriterContract.payload);
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    // The verifier reports the token's claims rather than a bare boolean, so
    // a caller can read the integration grant it carries. The binding itself is
    // unchanged: `verified` is true only for the exact project and run.
    assertEquals(
      (await auth.verifyRunEventAppendToken({
        token: fixture.token,
        projectId: "11111111-1111-4111-8111-111111111111",
        runId: "run_1",
      })).verified,
      true,
    );
    const wrongRun = await auth.verifyRunEventAppendToken({
      token: fixture.token,
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "run_other",
    });
    assertEquals(wrongRun.verified, false);
    // A rejected token must not leak a grant to the caller either.
    assertEquals(wrongRun.integrationTools, undefined);
  });

  it("reads the replay digest only from own signed data without invoking accessors", async () => {
    for (const ownAccessor of [false, true]) {
      let getterCalled = false;
      const writerClaims = {
        sub: apiRunEventWriterContract.payload.userId,
        ...apiRunEventWriterContract.payload,
      };
      const payload: typeof writerClaims = ownAccessor ? { ...writerClaims } : Object.create(
        { resumeToolCallSha256: "a".repeat(64) },
        Object.getOwnPropertyDescriptors(writerClaims),
      );
      if (ownAccessor) {
        Object.defineProperty(payload, "resumeToolCallSha256", {
          enumerable: true,
          get() {
            getterCalled = true;
            return "a".repeat(64);
          },
        });
      }
      const auth = createHostedServiceAuth({
        authProvider: { verifyWithPublicKey: () => Promise.resolve(payload) },
        getConfig: () => ({
          OAUTH_PUBLIC_KEY: "public-key",
          SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
          NODE_ENV: "production",
          VERYFRONT_API_URL: "https://api.example.test",
        }),
      });
      assertEquals(
        await auth.verifyRunEventAppendToken({
          token: "verified-writer",
          projectId: "11111111-1111-4111-8111-111111111111",
          runId: "run_1",
        }),
        { verified: !ownAccessor },
      );
      assertEquals(getterCalled, false);
    }
  });

  it("returns only a valid signed resume digest for the exact writer run", async () => {
    for (const digest of ["a".repeat(64), "A".repeat(64), "a".repeat(63), 1]) {
      const fixture = await createRs256JwtFixture({
        ...apiRunEventWriterContract.payload,
        resumeToolCallSha256: digest,
      });
      const auth = createHostedServiceAuth({
        authProvider: webCryptoAuthProvider,
        getConfig: () => ({
          OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
          SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
          NODE_ENV: "production",
          VERYFRONT_API_URL: "https://api.example.test",
        }),
      });
      const result = await auth.verifyRunEventAppendToken({
        token: fixture.token,
        projectId: "11111111-1111-4111-8111-111111111111",
        runId: "run_1",
      });
      assertEquals(
        result,
        digest === "a".repeat(64)
          ? { verified: true, resumeToolCallSha256: digest }
          : { verified: false },
      );
      assertEquals(
        await auth.verifyRunEventAppendToken({
          token: fixture.token,
          projectId: "11111111-1111-4111-8111-111111111111",
          runId: "run_other",
        }),
        { verified: false },
      );
    }
  });

  it("returns only a valid signed tool exposure checkpoint digest for the exact writer run", async () => {
    for (const digest of ["b".repeat(64), "B".repeat(64), "b".repeat(63), 1]) {
      const fixture = await createRs256JwtFixture({
        ...apiRunEventWriterContract.payload,
        toolExposureCheckpointSha256: digest,
      });
      const auth = createHostedServiceAuth({
        authProvider: webCryptoAuthProvider,
        getConfig: () => ({
          OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
          SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
          NODE_ENV: "production",
          VERYFRONT_API_URL: "https://api.example.test",
        }),
      });
      assertEquals(
        await auth.verifyRunEventAppendToken({
          token: fixture.token,
          projectId: "11111111-1111-4111-8111-111111111111",
          runId: "run_1",
        }),
        digest === "b".repeat(64)
          ? { verified: true, toolExposureCheckpointSha256: digest }
          : { verified: false },
      );
    }
  });

  it("returns the integration tool grant carried by the signed payload", async () => {
    const grantFixture = await createRs256JwtFixture({
      ...apiRunEventWriterContract.payload,
      integrationTools: ["outlook__list_emails"],
    });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: grantFixture.publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    assertEquals(
      await auth.verifyRunEventAppendToken({
        token: grantFixture.token,
        projectId: "11111111-1111-4111-8111-111111111111",
        runId: "run_1",
      }),
      { verified: true, integrationTools: ["outlook__list_emails"] },
      "a verified token returns the grant carried in its signed payload",
    );
  });

  it("denies tenant-configured public auth helpers access to genuine hosted platform transport", async () => {
    const harness = await createHostedDependencyHarness();
    const child = await harness.admitChild();
    const genuineSources = await runWithHostedPlatformDependencies(
      child,
      async () => getActivePlatformDependencySources(harness.childScope),
    );
    assertEquals(genuineSources.length, 1);
    const tenant = await createRs256JwtFixture({
      ...apiRunEventWriterContract.payload,
      ...harness.childScope,
      platformToolDependencies: harness.childDependencies,
    });
    const tenantAuth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: tenant.publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });
    const verification = await tenantAuth.verifyRunEventAppendToken({
      token: tenant.token,
      ...harness.childScope,
    });
    assertEquals(verification.verified, true);
    await assertRejects(async () => {
      const runner = createVerifiedPlatformToolDependencyRunner(verification, harness.childScope);
      runner.captureSource(genuineSources[0]!);
      await runner.run(async () => {
        await executeConfiguredTool(
          "persist_attachment",
          {},
          harness.tools,
          { ...harness.childScope, toolCallId: "tenant-forged-wrapper" },
          [],
          [],
          undefined,
          { strictConfiguredToolsOnly: true },
        );
      });
    });
    assertEquals(getVerifiedPlatformToolDependencies(verification, harness.childScope), undefined);
    assertEquals(harness.effects, []);
    const rewritingAuth = createHostedServiceAuth({
      authProvider: {
        verifyWithPublicKey: async () => ({
          ...apiRunEventWriterContract.payload,
          sub: apiRunEventWriterContract.payload.serviceAccountId,
          ...harness.childScope,
          platformToolDependencies: [{
            toolId: "persist_attachment",
            platformTools: ["veryfront__delete_file"],
          }],
        }),
      },
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: harness.fixture.publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });
    const rewritten = await rewritingAuth.verifyRunEventAppendToken({
      token: harness.childFixture.token,
      ...harness.childScope,
    });
    assertEquals(
      getVerifiedPlatformToolDependencies(rewritten, harness.childScope),
      harness.childDependencies,
    );
  });

  it("pins hosted dependency proof to boot operator keys outside test overlays", async () => {
    const scope = {
      projectId: apiRunEventWriterContract.payload.projectId,
      runId: apiRunEventWriterContract.payload.runId,
      agentId: "ingestion-agent",
    };
    const dependencies = [{ toolId: "intake", platformTools: ["veryfront__create_file"] }];
    const operator = await createRs256JwtFixture({
      ...apiRunEventWriterContract.payload,
      ...scope,
      platformToolDependencies: dependencies,
    });
    const tenant = await createRs256JwtFixture({
      ...apiRunEventWriterContract.payload,
      ...scope,
      platformToolDependencies: dependencies,
    });
    const noAgent = await createRs256JwtFixture({
      ...apiRunEventWriterContract.payload,
      ...scope,
      agentId: undefined,
      platformToolDependencies: dependencies,
    }, operator.keyPair);
    const noMap = await createRs256JwtFixture(
      { ...apiRunEventWriterContract.payload, ...scope },
      operator.keyPair,
    );
    const program = `
      import { createHostedServiceAuth, getVerifiedPlatformToolDependencies } from "#veryfront/agent/service/auth.ts";
      const data = JSON.parse(await new Response(Deno.stdin.readable).text());
      Deno.env.set("OAUTH_PUBLIC_KEY", data.tenantKey);
      const auth = createHostedServiceAuth({
        getConfig: () => ({ OAUTH_PUBLIC_KEY: data.tenantKey, SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: data.serviceAccountId, NODE_ENV: "production" }),
      });
      const result = await auth.verifyRunEventAppendToken({ token: data.tenantToken, ...data.scope });
      const forged = createHostedServiceAuth({
        authProvider: { verifyWithPublicKey: async () => data.payload },
        getConfig: () => ({ OAUTH_PUBLIC_KEY: data.tenantKey, SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: data.serviceAccountId, NODE_ENV: "production" }),
      });
      const forgedResult = await forged.verifyRunEventAppendToken({ token: data.tenantToken, ...data.scope });
      const genuine = createHostedServiceAuth({ getConfig: () => ({ OAUTH_PUBLIC_KEY: data.operatorKey, SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: data.serviceAccountId, NODE_ENV: "production" }) });
      const genuineResult = await genuine.verifyRunEventAppendToken({ token: data.operatorToken, ...data.scope });
      Object.defineProperty(Object.prototype, "agentId", { value: data.scope.agentId, configurable: true });
      Object.defineProperty(Object.prototype, "platformToolDependencies", { value: data.dependencies, configurable: true });
      let inheritedAgent, inheritedMap;
      try {
        inheritedAgent = getVerifiedPlatformToolDependencies(await forged.verifyRunEventAppendToken({ token: data.noAgentToken, ...data.scope }), data.scope) ?? null;
        inheritedMap = getVerifiedPlatformToolDependencies(await forged.verifyRunEventAppendToken({ token: data.noMapToken, ...data.scope }), data.scope) ?? null;
      } finally {
        delete Object.prototype.agentId;
        delete Object.prototype.platformToolDependencies;
      }
      console.log(JSON.stringify({ compatibility: result.verified, tenant: getVerifiedPlatformToolDependencies(result, data.scope) ?? null, forged: getVerifiedPlatformToolDependencies(forgedResult, data.scope) ?? null, genuine: getVerifiedPlatformToolDependencies(genuineResult, data.scope) ?? null, inheritedAgent, inheritedMap }));
    `;
    const env: Record<string, string> = {
      DENO_TESTING: "0",
      NODE_ENV: "production",
      OAUTH_PUBLIC_KEY: operator.publicKeyPem,
      SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
    };
    for (const name of ["HOME", "DENO_DIR"]) {
      const value = Deno.env.get(name);
      if (value) env[name] = value;
    }
    const child = new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config", "deno.json", program],
      clearEnv: true,
      env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify({
      tenantKey: tenant.publicKeyPem,
      tenantToken: tenant.token,
      operatorKey: operator.publicKeyPem,
      operatorToken: operator.token,
      noAgentToken: noAgent.token,
      noMapToken: noMap.token,
      dependencies,
      serviceAccountId: apiRunEventWriterContract.payload.serviceAccountId,
      scope,
      payload: {
        ...apiRunEventWriterContract.payload,
        ...scope,
        platformToolDependencies: dependencies,
      },
    })));
    await writer.close();
    const result = await child.output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(JSON.parse(new TextDecoder().decode(result.stdout)), {
      compatibility: true,
      tenant: null,
      forged: null,
      genuine: dependencies,
      inheritedAgent: null,
      inheritedMap: null,
    });
  });

  it("revokes captured preparation authority after route failure or detached settlement", async () => {
    for (const failPreparation of [true, false]) {
      const harness = await createHostedDependencyHarness();
      let captured: ReturnType<typeof captureHostedPlatformDependencyExecution> | undefined;
      const tracker = createDetachedRunTracker<AgUiResumeValue>();
      const routeSet = createHostedAgentServiceRouteSet({
        tracker,
        runtimeSource: harness.runtimeSource,
        authenticateRequest: async () => ({ userId: "fixture-user", authToken: "fixture-session" }),
        verifyProjectAccess: async () => ({ success: true }),
        verifyRunEventAppendToken: harness.verify,
        prepareExecution: async () => {
          captured = captureHostedPlatformDependencyExecution();
          await captured(async () =>
            assertEquals(getActivePlatformToolDependencies(harness.scope), harness.dependencies)
          );
          if (failPreparation) throw new Error("Fixture preparation failed");
          return {};
        },
        streamExecutionToAgUiResponse: () => new Response(),
        startDetachedExecution: async () => {},
      });
      const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
        request: harness.ingressRequest,
        runId: harness.scope.runId,
      });
      assertEquals(response.status, failPreparation ? 500 : 202);
      assert(captured);
      await tracker.waitForDrain({ timeoutMs: 1000, pollIntervalMs: 1 });
      await assertRejects(async () => await captured!(async () => {}));
    }
  });

  it("revokes active dependency execution immediately when the hosted run is cancelled", async () => {
    const harness = await createHostedDependencyHarness();
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    let captured: ReturnType<typeof captureHostedPlatformDependencyExecution> | undefined;
    let release!: () => void;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const routeSet = createHostedAgentServiceRouteSet({
      tracker,
      runtimeSource: harness.runtimeSource,
      authenticateRequest: async () => ({ userId: "fixture-user", authToken: "fixture-session" }),
      verifyProjectAccess: async () => ({ success: true }),
      verifyRunEventAppendToken: harness.verify,
      prepareExecution: async () => ({}),
      streamExecutionToAgUiResponse: () => new Response(),
      startDetachedExecution: async () => {
        captured = captureHostedPlatformDependencyExecution();
        await settled;
      },
    });
    const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
      request: harness.ingressRequest,
      runId: harness.scope.runId,
    });
    assertEquals(response.status, 202);
    assert(captured);
    await captured(async () =>
      assertEquals(getActivePlatformToolDependencies(harness.scope), harness.dependencies)
    );
    assert(tracker.cancelRun(harness.scope.runId));
    try {
      await assertRejects(async () => await captured!(async () => {}));
    } finally {
      release();
      await tracker.waitForDrain({ timeoutMs: 1000, pollIntervalMs: 1 });
    }
    assertEquals(harness.effects, []);
  });

  it("derives child grants from its own signed admission when the parent has no dependencies", async () => {
    const harness = await createHostedDependencyHarness({ parentHasNoDependencies: true });
    await runWithHostedPlatformDependencies(harness.parsed, async () => {
      assertEquals(getActivePlatformToolDependencies(harness.scope), undefined);
    });
    const child = await harness.admitChild();
    await runWithHostedPlatformDependencies(child, async () => {
      assertEquals(
        getActivePlatformToolDependencies(harness.childScope),
        harness.childDependencies,
      );
    });
    assertEquals(harness.effects, []);
  });

  it("rejects mutated and wrong-scope child admission JWTs before dispatch", async () => {
    const harness = await createHostedDependencyHarness();
    const parts = harness.childFixture.token.split(".");
    parts[1] = encodeJsonBase64Url({
      ...apiRunEventWriterContract.payload,
      ...harness.childScope,
      agentId: "forged-agent",
    });
    const tokens = [parts.join(".")];
    for (
      const wrongScope of [
        { runId: "sibling-run" },
        { agentId: "sibling-agent" },
        { projectId: "22222222-2222-4222-8222-222222222222" },
      ]
    ) {
      tokens.push(
        (await createRs256JwtFixture({
          ...apiRunEventWriterContract.payload,
          ...harness.childScope,
          ...wrongScope,
          platformToolDependencies: harness.childDependencies,
        }, harness.fixture.keyPair)).token,
      );
    }
    for (const token of tokens) {
      harness.controls.eventToken = token;
      await assertRejects(() => harness.admitChild());
    }
    assertEquals(harness.effects, []);
  });

  it("preserves explicit child source denial for hidden platform dependencies", async () => {
    const harness = await createHostedDependencyHarness();
    harness.controls.deniedOperations = ["create_file", "veryfront__create_file"];
    const child = await harness.admitChild();
    await assertRejects(() =>
      runWithHostedPlatformDependencies(child, async () => {
        await executeConfiguredTool(
          "persist_attachment",
          {},
          harness.tools,
          { ...harness.childScope, toolCallId: "denied-wrapper" },
          [],
          [],
          undefined,
          { strictConfiguredToolsOnly: true },
        );
      })
    );
    assertEquals(harness.effects, []);
  });

  it("revokes partial child authority when source configuration fails", async () => {
    const harness = await createHostedDependencyHarness();
    harness.controls.failSource = true;
    await assertRejects(() => harness.admitChild());
    assert(harness.controls.failedOwner);
    await assertRejects(async () =>
      await runWithHostedPlatformDependencies(harness.controls.failedOwner!, async () => {})
    );
    assertEquals(harness.effects, []);
  });

  it("revokes a child while discovery is suspended when its parent settles", async () => {
    const harness = await createHostedDependencyHarness();
    const child = await harness.admitChild();
    let resume!: () => void;
    let entered!: () => void;
    const enteredDiscovery = new Promise<void>((resolve) => {
      entered = resolve;
    });
    harness.controls.discoveryWait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    harness.controls.onDiscovery = entered;
    const operation = runWithHostedPlatformDependencies(child, async () => {
      await executeConfiguredTool(
        "persist_attachment",
        {},
        harness.tools,
        { ...harness.childScope, toolCallId: "settled-wrapper" },
        [],
        [],
        undefined,
        { strictConfiguredToolsOnly: true },
      );
    });
    await enteredDiscovery;
    revokeHostedPlatformDependencies(harness.parsed);
    resume();
    await assertRejects(() => operation);
    await assertRejects(async () => await runWithHostedPlatformDependencies(child, async () => {}));
    assertEquals(harness.effects, []);
  });

  it("binds cross-project inherited admission to the exact child project", async () => {
    const harness = await createHostedDependencyHarness({
      childProjectId: "22222222-2222-4222-8222-222222222222",
    });
    const child = await harness.admitChild();
    await runWithHostedPlatformDependencies(child, async () => {
      assertEquals(
        getActivePlatformToolDependencies(harness.childScope),
        harness.childDependencies,
      );
      assertEquals(
        getActivePlatformToolDependencies({
          ...harness.childScope,
          projectId: harness.scope.projectId,
        }),
        undefined,
      );
    });
    assertEquals(harness.effects, []);
  });

  it("executes source-owned platform dependencies through actual admitted hosted child forks", async () => {
    for (const legacyDefaultRoot of [false, true]) {
      const harness = await createHostedDependencyHarness({ legacyDefaultRoot });
      if (legacyDefaultRoot) {
        assertEquals(harness.parsed.agentId, undefined);
        await runWithHostedPlatformDependencies(harness.parsed, async () => {
          assertEquals(getActivePlatformToolDependencies(harness.scope), undefined);
        });
      }
      const { scope, childScope, childDependencies, effects, persisted, tools } = harness;
      const child = await harness.admitChild();
      assertEquals(Object.keys(tools), ["persist_attachment"]);
      const context = { ...childScope, toolCallId: "fixture-source-wrapper" };
      for (
        const invalidContext of [
          { ...context, projectId: "22222222-2222-4222-8222-222222222222" },
          { ...context, runId: scope.runId },
          { ...context, agentId: scope.agentId },
          { ...context, abortSignal: AbortSignal.abort() },
        ]
      ) {
        await assertRejects(() =>
          runWithHostedPlatformDependencies(child, async () => {
            await executeConfiguredTool(
              "persist_attachment",
              {},
              tools,
              invalidContext,
              [],
              [],
              undefined,
              { strictConfiguredToolsOnly: true },
            );
          })
        );
      }
      await assertRejects(() =>
        runWithHostedPlatformDependencies({ ...child }, async () => {
          await executeConfiguredTool("persist_attachment", {}, tools, context, [], [], undefined, {
            strictConfiguredToolsOnly: true,
          });
        })
      );
      assertEquals(effects, []);
      await runWithHostedPlatformDependencies(child, async () => {
        assertEquals(getActivePlatformToolDependencies(childScope), childDependencies);
        await executeConfiguredTool("persist_attachment", {}, tools, context, [], [], undefined, {
          strictConfiguredToolsOnly: true,
        });
      });
      assertEquals(effects, ["create_file", "outlook__upload_attachment", "get_file_version"]);
      assertEquals(persisted.get("fixture-record"), { path: "fixture-record" });
      effects.length = 0;
      const identifiers = {
        childConversationId: child.conversationId,
        childMessageId: child.messageId,
        childRunId: child.runId,
        childCanonicalRunId: child.canonicalRunId,
        latestEventId: 0,
        latestExternalEventSequence: 0,
      };
      transferHostedTerminalAuthority(child, identifiers);
      const model: ModelRuntime<ModelRuntimeCallOptions> = {
        provider: "fixture",
        modelId: "fixture/hosted-dependency",
        doGenerate: async () => {
          throw new Error("unused");
        },
        doStream: async (options) => {
          assertEquals(options.tools?.map((tool) => tool.name), ["persist_attachment"]);
          return {
            stream: new ReadableStream<unknown>({
              start(controller) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "actual-fork-wrapper",
                  toolName: "persist_attachment",
                  input: {},
                });
                controller.enqueue({
                  type: "finish",
                  finishReason: "tool-calls",
                  usage: { inputTokens: 1, outputTokens: 1 },
                });
                controller.close();
              },
            }),
          };
        },
      };
      await runWithHostedPlatformDependencies(child, async () => {
        const started = startHostedChildForkRuntimeWithHostTools({
          apiUrl: "https://api.example.test",
          authToken: "fixture-session",
          projectId: childScope.projectId,
          durableChildRun: identifiers,
          monitorChildRunStatus: async () => {},
          forkTools: tools,
          provider: "fixture",
          forkModel: "fixture/hosted-dependency",
          maxSteps: 1,
          buildInstructions: () => "Persist selected artifact",
          prompt: "Persist selected artifact",
          runStep: async (stepInput) => {
            stepInput.resolveModelRuntime = () => model;
            return await runAgentRuntimeForkStep(stepInput);
          },
        });
        for await (
          const _part of started.streamResult.fullStream
        ) { /* Consume actual runtime tool execution. */ }
        await started.streamResult.steps;
        await started.childRunMonitorPromise;
      });
      assertEquals(effects, ["create_file", "outlook__upload_attachment", "get_file_version"]);
      const callback = harness.retainedCallback();
      assert(callback);
      await assertRejects(() => callback("veryfront__create_file", {}));
      revokeHostedPlatformDependencies(child);
      await assertRejects(async () =>
        await runWithHostedPlatformDependencies(child, async () => {
          await executeConfiguredTool("persist_attachment", {}, tools, context, [], [], undefined, {
            strictConfiguredToolsOnly: true,
          });
        })
      );
      assertEquals(effects.length, 3);
    }
  });

  it("executes verified wrapper dependencies through the internal framework AgentRuntime", async () => {
    const harness = await createHostedDependencyHarness();
    const scope = harness.childScope;
    const verification = await harness.verify({ token: harness.childFixture.token, ...scope });
    assert(verification.verified);
    const input = {
      threadId: "internal-dependency-thread",
      runId: scope.runId,
      messages: [{ id: "message-1", role: "user" as const, content: "Persist attachment" }],
      tools: [],
      context: [],
    };
    registerPlatformDependencyOwner(input, verification, scope);
    const effects: string[] = [];
    capturePlatformDependencySource(
      input,
      markTrustedPlatformSource({
        id: "internal-dependency-source",
        listTools: async () => [{
          name: "outlook__upload_attachment",
          description: "Upload attachment",
          parameters: { type: "object", properties: {} },
        }],
        executeTool: async (name) => {
          effects.push(name);
          return { uploaded: true };
        },
      }),
    );
    const tools = createToolsFromHostDefinitions({
      persist_attachment: dynamicTool({
        id: "persist_attachment",
        description: "Persist attachment",
        inputSchema: {},
        inputSchemaJson: { type: "object", properties: {} },
        delegatedPlatformTools: ["outlook__upload_attachment"],
        execute: async (_, context) => {
          assertEquals(context?.projectId, scope.projectId);
          assertEquals(context?.runId, scope.runId);
          assertEquals(context?.agentId, scope.agentId);
          return await context!.executePlatformTool!("outlook__upload_attachment", {});
        },
      }),
    });
    const model = scriptedModel([{
      toolCalls: [{
        id: "internal-wrapper-call",
        name: "persist_attachment",
        input: {},
      }],
    }], { provider: "internal-dependency-fixture", only: "stream" });
    const unregister = registerModelProvider("internal-dependency-fixture", () => model);
    try {
      const response = await createRuntimeAgentStreamResponse(
        input,
        createAgent({
          id: scope.agentId,
          model: "internal-dependency-fixture/test",
          system: "Persist attachment",
          skills: false,
          maxSteps: 1,
          tools,
        }),
        {
          sessionManager: new AgentRunSessionManager(),
          projectAgentSandbox: { projectId: scope.projectId },
        },
      );
      const body = await response.text();
      assertEquals(model.toolNames(), ["persist_attachment"]);
      assertEquals(effects, ["outlook__upload_attachment"], body);
      assert(body.includes("event: RunFinished"), body);
    } finally {
      unregister();
      revokePlatformDependencyOwner(input);
    }
  });

  it("binds wrapper grants to verified writer identity and does not brand clones", async () => {
    const platformToolDependencies = [{
      toolId: "intake",
      platformTools: ["outlook__upload_attachment"],
    }];
    const fixture = await createRs256JwtFixture({
      ...apiRunEventWriterContract.payload,
      agentId: "ingestion-agent",
      platformToolDependencies,
    });
    pinHostedWriterFixture(fixture);
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });
    const scope = {
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "run_1",
      agentId: "ingestion-agent",
    };
    const verification = await auth.verifyRunEventAppendToken({ token: fixture.token, ...scope });
    assertEquals(
      getVerifiedPlatformToolDependencies(verification, scope),
      platformToolDependencies,
    );
    assertEquals(getVerifiedPlatformToolDependencies({ ...verification }, scope), undefined);
    for (const forged of [{ ...verification }, { verified: true }]) {
      const parent = { runId: scope.runId };
      const child = { runId: scope.runId };
      registerHostedPlatformDependencyRequest(
        parent,
        forged,
        scope,
        auth.verifyRunEventAppendToken,
        "fixture-session",
      );
      await registerHostedChildPlatformDependencies(
        parent,
        child,
        scope,
        fixture.token,
        "fixture-session",
      );
      assertEquals(
        await runWithHostedPlatformDependencies(
          child,
          async () => getActivePlatformToolDependencies(scope),
        ),
        undefined,
      );
    }

    assertEquals(
      getVerifiedPlatformToolDependencies(verification, { ...scope, runId: "run_other" }),
      undefined,
    );
    assertEquals(
      getVerifiedPlatformToolDependencies(verification, { ...scope, agentId: "other-agent" }),
      undefined,
    );
    assertEquals(
      await auth.verifyRunEventAppendToken({
        token: fixture.token,
        ...scope,
        agentId: "other-agent",
      }),
      { verified: false },
    );
  });

  it("rechecks platform authority after tool discovery before dispatch", async () => {
    const platformToolDependencies = [{
      toolId: "intake",
      platformTools: ["outlook__upload_attachment"],
    }];
    const fixture = await createRs256JwtFixture({
      ...apiRunEventWriterContract.payload,
      agentId: "ingestion-agent",
      platformToolDependencies,
    });
    pinHostedWriterFixture(fixture);
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });
    const scope = {
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "run_1",
      agentId: "ingestion-agent",
    };
    const verification = await auth.verifyRunEventAppendToken({ token: fixture.token, ...scope });
    for (const ending of ["wrapper", "owner", "abort"] as const) {
      const discovered = Promise.withResolvers<void>();
      const releaseDiscovery = Promise.withResolvers<void>();
      const releaseWrapper = Promise.withResolvers<void>();
      const controller = new AbortController();
      let effects = 0;
      let pending: Promise<unknown> | undefined;
      const source = markTrustedPlatformSource({
        id: `delayed-${ending}`,
        listTools: async () => {
          discovered.resolve();
          await releaseDiscovery.promise;
          return [{
            name: "outlook__upload_attachment",
            description: "Upload",
            parameters: { type: "object" as const, properties: {} },
          }];
        },
        executeTool: async () => {
          effects++;
          return { uploaded: true };
        },
      });
      const intake = dynamicTool({
        id: "intake",
        description: "Intake",
        inputSchema: {},
        delegatedPlatformTools: ["outlook__upload_attachment"],
        execute: async (_, context) => {
          pending = context!.executePlatformTool!("outlook__upload_attachment", {});
          // Retain the original promise for the rejection assertion below.
          pending.catch(() => {});
          await discovered.promise;
          if (ending !== "wrapper") await releaseWrapper.promise;
          return { scheduled: true };
        },
      });
      const owner = {
        runId: scope.runId,
        agentId: scope.agentId,
        threadId: "platform-owner",
        messages: [],
        tools: [],
        context: [],
      };
      registerPlatformDependencyOwner(owner, verification, scope);
      const execution = runWithPlatformDependencyOwner(owner, () =>
        executeConfiguredTool(
          "intake",
          {},
          { intake },
          { ...scope, abortSignal: controller.signal },
          [],
          [source],
        ));
      try {
        await discovered.promise;
        if (ending === "wrapper") await execution;
        if (ending === "owner") revokePlatformDependencyOwner(owner);
        if (ending === "abort") controller.abort();
        releaseDiscovery.resolve();
        await assertRejects(() => pending!);
        assertEquals(effects, 0, `${ending} must revoke authority before the remote effect`);
      } finally {
        releaseDiscovery.resolve();
        releaseWrapper.resolve();
        await execution;
        await pending?.catch(() => {});
        revokePlatformDependencyOwner(owner);
      }
    }
  });

  it("executes only the signed wrapper dependency during its exact active invocation", async () => {
    const platformToolDependencies = [{
      toolId: "intake",
      platformTools: ["outlook__upload_attachment"],
    }];
    const fixture = await createRs256JwtFixture({
      ...apiRunEventWriterContract.payload,
      agentId: "ingestion-agent",
      platformToolDependencies,
    });
    pinHostedWriterFixture(fixture);
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });
    const scope = {
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "run_1",
      agentId: "ingestion-agent",
    };
    const verification = await auth.verifyRunEventAppendToken({ token: fixture.token, ...scope });
    let effects = 0;
    let saved: ToolExecutionContext["executePlatformTool"];
    const source = markTrustedPlatformSource({
      id: "platform",
      listTools: async () => [{
        name: "outlook__upload_attachment",
        description: "Upload",
        parameters: { type: "object" as const, properties: {} },
      }],
      executeTool: async () => {
        effects++;
        return { uploaded: true };
      },
    });
    const intake = dynamicTool({
      id: "intake",
      description: "Intake",
      inputSchema: {},
      delegatedPlatformTools: ["outlook__upload_attachment"],
      execute: async (_, context) => {
        saved = context?.executePlatformTool;
        if (context?.runId === scope.runId && !context.abortSignal) {
          assertStrictEquals(context, scope);
        }
        // A live callback copied into another wrapper must fail while its owner
        // is still executing, not merely because its owner already settled.
        await assertRejects(() =>
          executeConfiguredTool("other", {}, { other }, context, [], [source])
        );
        return await saved!("outlook__upload_attachment", {});
      },
    });
    const other = dynamicTool({
      id: "other",
      description: "Other",
      inputSchema: {},
      delegatedPlatformTools: ["outlook__upload_attachment"],
      execute: async () => await saved!("outlook__upload_attachment", {}),
    });
    await assertRejects(() => executeConfiguredTool("intake", {}, { intake }, scope, [], [source]));
    assertEquals(effects, 0);
    await runWithVerifiedPlatformToolDependencies(verification, scope, async () => {
      assertEquals(await executeConfiguredTool("intake", {}, { intake }, scope, [], [source]), {
        uploaded: true,
      });
      await assertRejects(() => executeConfiguredTool("other", {}, { other }, scope, [], [source]));
      await assertRejects(() => saved!("outlook__upload_attachment", {}));
      const borrower = dynamicTool({
        id: "other",
        description: "Other",
        inputSchema: {},
        delegatedPlatformTools: ["outlook__upload_attachment"],
        execute: async (_, context) =>
          await context!.executePlatformTool!("outlook__upload_attachment", {}),
      });
      const originalFind = Array.prototype.find;
      const admittedMap = getVerifiedPlatformToolDependencies(verification, scope)!;
      Object.defineProperty(Array.prototype, "find", {
        configurable: true,
        writable: true,
        value: function (this: unknown, ...arguments_: unknown[]) {
          return this === admittedMap
            ? admittedMap[0]
            : Reflect.apply(originalFind, this, arguments_);
        },
      });
      try {
        await assertRejects(() =>
          executeConfiguredTool("other", {}, { other: borrower }, scope, [], [source])
        );
      } finally {
        Object.defineProperty(Array.prototype, "find", {
          value: originalFind,
          configurable: true,
          writable: true,
        });
      }
      await assertRejects(() =>
        executeConfiguredTool("intake", {}, { intake }, { ...scope, runId: "run_other" }, [], [
          source,
        ])
      );
      await assertRejects(() =>
        executeConfiguredTool(
          "intake",
          {},
          { intake },
          { ...scope, abortSignal: AbortSignal.abort() },
          [],
          [source],
        )
      );
    });
    await assertRejects(() =>
      runWithVerifiedPlatformToolDependencies(
        { ...verification },
        scope,
        async () => executeConfiguredTool("intake", {}, { intake }, scope, [], [source]),
      )
    );
    assertEquals(effects, 1);
    // The actual host execution object holds authority across stream pulls.
    // Hidden sources do not have to enter the model-facing source list.
    const owner = {
      runId: scope.runId,
      agentId: scope.agentId,
      threadId: "platform-owner",
      messages: [],
      tools: [],
      context: [],
    };
    registerPlatformDependencyOwner(owner, verification, scope);
    capturePlatformDependencySource(owner, source);
    await assertRejects(async () =>
      await runWithPlatformDependencyOwner(
        { ...owner },
        async () => executeConfiguredTool("intake", {}, { intake }, scope, [], []),
      )
    );
    assertEquals(effects, 1);
    await runWithPlatformDependencyOwner(owner, async () => {
      assertEquals(await executeConfiguredTool("intake", {}, { intake }, scope, [], []), {
        uploaded: true,
      });
    });
    assertEquals(effects, 2);
    revokePlatformDependencyOwner(owner);
    await assertRejects(async () =>
      await runWithPlatformDependencyOwner(
        owner,
        async () => executeConfiguredTool("intake", {}, { intake }, scope, [], []),
      )
    );
    await assertRejects(() => saved!("outlook__upload_attachment", {}));
    assertEquals(effects, 2);
  });

  it("drops a non-array integration tool grant claim", async () => {
    const malformedFixture = await createRs256JwtFixture({
      ...apiRunEventWriterContract.payload,
      integrationTools: "outlook__list_emails",
    });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: malformedFixture.publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: apiRunEventWriterContract.payload.serviceAccountId,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    assertEquals(
      await auth.verifyRunEventAppendToken({
        token: malformedFixture.token,
        projectId: "11111111-1111-4111-8111-111111111111",
        runId: "run_1",
      }),
      { verified: true },
      "a non-array grant claim is dropped rather than returned",
    );
  });

  it("temporarily accepts the exact route-only v1 writer credential", async () => {
    const v1Payload = {
      ...apiRunEventWriterContract.payload,
      scopes: undefined,
      scope: ["projects:read", "runs:write"],
    };
    const fixture = await createRs256JwtFixture(v1Payload);
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: v1Payload.serviceAccountId,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    assertEquals(
      (await auth.verifyRunEventAppendToken({
        token: fixture.token,
        projectId: v1Payload.projectId,
        runId: v1Payload.runId,
      })).verified,
      true,
    );
  });

  it("rejects user, generic service, broader, duplicate, or wrongly bound writer claims", async () => {
    const exactWriterClaims = {
      actorType: "service_account",
      userId: "00000000-0000-0000-0000-000000000001",
      serviceAccountId: "00000000-0000-0000-0000-000000000001",
      tokenUse: "run_event_writer",
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "run_1",
      scopes: ["agent-runs:events:append"],
    };
    const userFixture = await createRs256JwtFixture({
      userId: "user-1",
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "run_1",
      scopes: ["agent-runs:events:append"],
    });
    const invalidPayloads = [
      {
        ...exactWriterClaims,
        tokenUse: "generic_service",
      },
      {
        ...exactWriterClaims,
        scopes: ["agent-runs:events:append", "agent-runs:read"],
      },
      {
        ...exactWriterClaims,
        scopes: ["agent-runs:events:append", "agent-runs:events:append"],
      },
      {
        ...exactWriterClaims,
        scopes: ["agent-runs:*"],
      },
      {
        ...exactWriterClaims,
        scopes: ["agent-runs:events:append", 42],
      },
      {
        ...exactWriterClaims,
        scope: ["projects:read", "runs:write"],
      },
      {
        ...exactWriterClaims,
        scopes: undefined,
        scope: ["projects:read", "runs:write", "agent-runs:events:append"],
      },
      {
        ...exactWriterClaims,
        userId: "another-service-account",
      },
      {
        ...exactWriterClaims,
        userId: "22222222-2222-4222-8222-222222222222",
        serviceAccountId: "22222222-2222-4222-8222-222222222222",
      },
      { ...exactWriterClaims, projectId: "project_other" },
      { ...exactWriterClaims, runId: "run_other" },
      { ...exactWriterClaims, scope: exactWriterClaims.scopes, scopes: undefined },
    ];
    const fixtures = await Promise.all([
      userFixture,
      ...invalidPayloads.map((payload) => createRs256JwtFixture(payload)),
    ]);

    for (const fixture of fixtures) {
      const auth = createHostedServiceAuth({
        authProvider: webCryptoAuthProvider,
        getConfig: () => ({
          OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
          SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: exactWriterClaims.serviceAccountId,
          NODE_ENV: "production",
          VERYFRONT_API_URL: "https://api.example.test",
        }),
      });
      const rejected = await auth.verifyRunEventAppendToken({
        token: fixture.token,
        projectId: "11111111-1111-4111-8111-111111111111",
        runId: "run_1",
      });
      assertEquals(rejected.verified, false);
      assertEquals(rejected.integrationTools, undefined);
    }
  });

  it("uses the built-in AuthProvider for configured public key JWTs", async () => {
    const fixture = await createRs256JwtFixture({
      userId: "user-1",
      email: "user@example.test",
    });
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(fixture.token);

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected JWT verification to succeed");
    assertEquals(result.userId, "user-1");
    assertEquals(result.email, "user@example.test");
  });

  it("uses an AuthProvider to verify configured public key JWTs", async () => {
    const calls: Array<{
      token: string;
      publicKeyPem: string;
      options: { algorithms?: string[] } | undefined;
    }> = [];
    const auth = createHostedServiceAuth({
      authProvider: {
        verifyWithPublicKey(token, publicKeyPem, options) {
          calls.push({ token, publicKeyPem, options });
          return Promise.resolve({
            sub: "user-1",
            userId: "user-1",
            email: "user@example.test",
          });
        },
      },
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: "public-key",
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt("signed-token");

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected JWT verification to succeed");
    assertEquals(result.userId, "user-1");
    assertEquals(result.email, "user@example.test");
    assertEquals(calls, [
      {
        token: "signed-token",
        publicKeyPem: "public-key",
        options: { algorithms: ["RS256"] },
      },
    ]);
  });

  it("returns empty email when a valid JWT has no email claim", async () => {
    const fixture = await createRs256JwtFixture({ userId: "user-1" });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(fixture.token);

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected JWT verification to succeed");
    assertEquals(result.email, "");
  });

  it("rejects JWTs without a userId", async () => {
    const fixture = await createRs256JwtFixture({ email: "user@example.test" });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(fixture.token);

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected JWT verification to fail");
    assertEquals(result.error.statusCode, 401);
    assertEquals(result.error.errorCode, "UNAUTHENTICATED");
    assertEquals(result.error.message, "Invalid token: missing userId");
  });

  it("requires a public key in production", async () => {
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt("token");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected JWT verification to fail");
    assertEquals(result.error.statusCode, 500);
    assertEquals(result.error.errorCode, "SERVER_ERROR");
    assertEquals(result.error.message, "JWT public key not configured");
  });

  it("decodes unsigned JWTs outside production when no public key is configured", async () => {
    const token = createUnsignedJwt({
      userId: "user-åäö",
      email: "åäö@example.test",
    });
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "development",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(token);

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected development JWT decode to succeed");
    assertEquals(result.userId, "user-åäö");
    assertEquals(result.email, "åäö@example.test");
  });

  it("rejects expired unsigned JWTs", async () => {
    const token = createUnsignedJwt({ userId: "user-1", exp: 1 });
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "development",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(token);

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected development JWT decode to fail");
    assertEquals(result.error.message, "Token expired");
  });

  it("rejects malformed unsigned JWTs", async () => {
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "development",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt("not-a-token");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected development JWT decode to fail");
    assertEquals(result.error.message, "Invalid token format");
  });

  it("authenticates requests into agent service auth context", async () => {
    const fixture = await createRs256JwtFixture({ userId: "user-1" });
    const request = new Request("https://agent.test/api/ag-ui", {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.authenticateRequest(request);

    assert(!(result instanceof Response));
    assertEquals(result, { authToken: fixture.token, userId: "user-1" });
  });

  it("returns 401 JSON responses for unauthenticated requests", async () => {
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.authenticateRequest(
      new Request("https://agent.test/api/ag-ui"),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 401);
    assertEquals(await result.json(), { errorCode: "UNAUTHENTICATED" });
  });

  it("checks project access against the configured API origin", async () => {
    const fetchMock = createFetchMock(Response.json({ slug: "verified-project" }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      projectAccessTimeoutMs: 1_000,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test/v1",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected project access to succeed");
    assertEquals(result.projectId, "project-1");
    assertEquals(result.projectSlug, "verified-project");
    const call = getOnlyFetchCall(fetchMock.calls);
    assertEquals(String(call.input), "https://api.example.test/projects/project-1");
    assertEquals(call.init?.method, "GET");
    assertEquals(getAuthorizationHeader(call), "Bearer token-1");
    assertInstanceOf(
      call.init?.signal,
      AbortSignal,
      "the project-access fetch must carry a timeout signal",
    );
  });

  it("fails closed when the project API does not answer before the timeout", async () => {
    const auth = createHostedServiceAuth({
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => {
            reject(signal.reason);
          });
        }),
      projectAccessTimeoutMs: 1,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, false, "a hung project API must fail closed");
    if (result.success) throw new Error("Expected project access to fail");
    assertEquals(
      result.error.errorCode,
      "SERVER_ERROR",
      "a project-access timeout must map to SERVER_ERROR",
    );
    assertEquals(
      result.error.statusCode,
      503,
      "a project-access timeout must map to 503",
    );
  });

  it("omits authorization on project access checks without a token", async () => {
    const fetchMock = createFetchMock(new Response("{}", { status: 200 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    await auth.verifyProjectAccess("project-1", "");

    assertEquals(getAuthorizationHeader(getOnlyFetchCall(fetchMock.calls)), null);
  });

  it("maps missing projects to NOT_FOUND", async () => {
    const fetchMock = createFetchMock(new Response("Not found", { status: 404 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected project access to fail");
    assertEquals(result.error.statusCode, 404);
    assertEquals(result.error.errorCode, "NOT_FOUND");
  });

  it("maps unauthorized project responses to FORBIDDEN", async () => {
    const fetchMock = createFetchMock(new Response("Forbidden", { status: 403 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected project access to fail");
    assertEquals(result.error.statusCode, 403);
    assertEquals(result.error.errorCode, "FORBIDDEN");
  });

  it("fails closed when the project API returns a server error", async () => {
    const fetchMock = createFetchMock(new Response("boom", { status: 500 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, false, "a degraded project API must not grant access");
    if (result.success) throw new Error("Expected project access to fail");
    assertEquals(
      result.error.statusCode,
      503,
      "a degraded project API is reported as a 503",
    );
    assertEquals(
      result.error.errorCode,
      "SERVER_ERROR",
      "a degraded project API is reported as SERVER_ERROR",
    );
  });

  it("reports an unavailable project API without exposing its response body", async () => {
    const fetchMock = createFetchMock(
      new Response("synthetic-private-upstream-body", { status: 503 }),
    );
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({ NODE_ENV: "production", VERYFRONT_API_URL: "https://api.example.test" }),
    });
    const result = await auth.verifyProjectAccess("project-1", "token-1");
    assertEquals(result, {
      success: false,
      error: {
        statusCode: 503,
        errorCode: "SERVER_ERROR",
        message: "Project access could not be verified",
      },
    });
    assertEquals(fetchMock.calls.length, 1, "verification must not replay the request");
  });

  it("keeps an unauthenticated project response as a denial", async () => {
    const fetchMock = createFetchMock(new Response("Unauthorized", { status: 401 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({ NODE_ENV: "production", VERYFRONT_API_URL: "https://api.example.test" }),
    });
    const result = await auth.verifyProjectAccess("project-1", "token-1");
    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected project access to fail");
    assertEquals(result.error.statusCode, 403);
    assertEquals(result.error.errorCode, "FORBIDDEN");
  });

  it("maps failed project access fetches to SERVER_ERROR", async () => {
    const fetchMock: HostedServiceAuthFetch = () => Promise.reject(new Error("boom"));
    const auth = createHostedServiceAuth({
      fetch: fetchMock,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected project access to fail");
    assertEquals(result.error.statusCode, 503);
    assertEquals(result.error.errorCode, "SERVER_ERROR");
  });
});

describe("hosted platform dependency source policy", () => {
  it("keeps hosted hidden grants separate from model allow lists while preserving source denial", async () => {
    for (
      const mode of [
        "disabled",
        "allowed",
        "denied",
        "service-denied",
        "canonical-denied",
        "legacy-denied",
        "child-denied",
        "child-allowed",
        "child-local-canonical-denied",
        "child-local-legacy-denied",
      ] as const
    ) {
      using _catalog = useServedCatalogForTests();
      const remoteChildMode = mode === "child-denied" || mode === "child-allowed";
      const childMode = remoteChildMode || mode === "child-local-canonical-denied" ||
        mode === "child-local-legacy-denied";
      const harness = await createHostedDependencyHarness({
        deferSource: true,
        ...(remoteChildMode ? { childProjectId: "22222222-2222-4222-8222-222222222222" } : {}),
      });
      const createdSources: string[] = [];
      const context = {
        options: {
          mcpServers: [{
            kind: "veryfront-api",
            ...(mode === "service-denied" ? { toolPolicy: { allow: ["get_file"] } } : {}),
          }],
          createRemoteToolSource: () => {
            createdSources.push("api");
            return {
              id: "fixture-api",
              listTools: async () => [{
                name: "create_file",
                description: "Create",
                parameters: { type: "object", properties: {} },
              }],
              executeTool: async () => ({ persisted: true }),
            };
          },
        },
        infrastructure: {
          getConfig: () => ({
            VERYFRONT_API_URL: "https://93.184.216.34",
            VERYFRONT_MCP_URL: "https://93.184.216.34/mcp",
            VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: false,
          }),
          logger: { debug() {}, info() {}, warn() {}, error() {} },
          tracer: {
            trace: (_name: string, operation: () => unknown) => operation(),
            scope: () => ({ active: () => undefined }),
          },
          setActiveSpanAttributes() {},
        },
        discoveryResult: {
          agents: new Map([[harness.childScope.agentId, { id: harness.childScope.agentId }]]),
          tools: new Map(),
          sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
        },
        defaultAgentId: harness.scope.agentId,
        agentConfigs: new Map([harness.scope.agentId, harness.childScope.agentId].map((id) => [id, {
          id,
          ...(id === harness.childScope.agentId && mode === "child-local-canonical-denied"
            ? { deniedTools: ["veryfront__create_file"] }
            : {}),
          ...(id === harness.childScope.agentId && mode === "child-local-legacy-denied"
            ? { deniedTools: ["create_file"] }
            : {}),
          mcpServers: [{ kind: "veryfront-api" }],
        }])),
        projectSteeringByAgentId: new Map(),
        trace: (_name: string, operation: () => unknown) => operation(),
      } as never;
      const runtime = await createAgentRuntime(
        context,
        {
          projectId: harness.scope.projectId,
          branchId: null,
          authToken: "fixture-session",
          instructions: "Use selected tools",
          agentId: harness.scope.agentId,
          model: "anthropic/claude-sonnet-4-5",
          allowedTools: [],
          allowDelegation: false,
          liveProjectSteering: {
            agent: {
              id: harness.scope.agentId,
              name: "Root",
              instructions: "Use selected tools",
              tools: [],
              ...(mode === "canonical-denied" ? { deniedTools: ["veryfront__create_file"] } : {}),
              ...(mode === "legacy-denied" ? { deniedTools: ["create_file"] } : {}),
              mcpServers: mode === "disabled" ? [] : [{
                kind: "veryfront-api",
                toolPolicy: {
                  allow: ["get_file"],
                  ...(mode === "denied" ? { deny: ["create_file"] } : {}),
                },
              }],
            },
            environmentContext: "",
          },
        } as never,
        undefined,
        harness.parsed,
      );
      try {
        assertEquals(createdSources.length > 0, mode !== "disabled");
        let owner: HostedPlatformDependencyOwner = harness.parsed;
        let scope = harness.scope;
        if (childMode) {
          owner = await withMockFetch((url, init) => {
            assertEquals(remoteChildMode, true);
            assertEquals(
              String(url),
              `https://93.184.216.34/projects/${harness.childScope.projectId}/agents/${harness.childScope.agentId}`,
            );
            assertEquals(
              new Headers(observeFetchRequestInit(init).headers).get("authorization"),
              "Bearer child-invocation-fixture",
            );
            return Promise.resolve(Response.json({
              id: harness.childScope.agentId,
              system_prompt: "Child policy",
              tools: mode === "child-denied" ? { veryfront__create_file: false } : {},
              tool_ids: [],
            }));
          }, () => harness.admitChild());
          scope = harness.childScope;
        }
        const toolId = childMode ? "persist_attachment" : "intake";
        const tools = createToolsFromHostDefinitions({
          [toolId]: dynamicTool({
            id: toolId,
            description: "Persist",
            inputSchema: {},
            inputSchemaJson: { type: "object", properties: {} },
            delegatedPlatformTools: ["veryfront__create_file"],
            execute: async (_input: unknown, context?: ToolExecutionContext) =>
              await context?.executePlatformTool?.("veryfront__create_file", { path: "fixture" }),
          }),
        });
        const execute = () =>
          runWithHostedPlatformDependencies(
            owner,
            () =>
              executeConfiguredTool(
                toolId,
                {},
                tools,
                { ...scope, toolCallId: "root-call" },
                [],
                [],
              ),
          );
        if (mode === "allowed" || mode === "child-allowed") {
          assertEquals(await execute(), { persisted: true });
        } else await assertRejects(execute);
      } finally {
        await runtime.cleanup?.();
      }
    }
  });
});
