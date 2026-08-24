import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
} from "#veryfront/config/environment-config.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { ToolExecutionContext } from "#veryfront/tool";
import { HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV } from "./local-credential-host-policy.ts";
import { MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES } from "./limits.ts";
import {
  createSalesforceServiceAccountToolSourceWithTransport,
  SALESFORCE_SERVICE_ACCOUNT_ENV_VARS,
} from "./salesforce-service-account.ts";

const [CLIENT_ID_ENV, CLIENT_SECRET_ENV, LOGIN_URL_ENV] = SALESFORCE_SERVICE_ACCOUNT_ENV_VARS;
/** Mirrors the module-private token response cap in salesforce-service-account.ts. */
const TOKEN_RESPONSE_LIMIT_BYTES = 64 * 1024;
const trackedEnv = [...SALESFORCE_SERVICE_ACCOUNT_ENV_VARS] as const;
const originalEnv = new Map(trackedEnv.map((name) => [name, getEnv(name)]));

function restoreEnv(): void {
  for (const name of trackedEnv) {
    const value = originalEnv.get(name);
    if (value === undefined) deleteEnv(name);
    else setEnv(name, value);
  }
}

function setCredentials(
  overrides: Partial<Record<(typeof trackedEnv)[number], string>> = {},
): void {
  for (const name of trackedEnv) deleteEnv(name);
  for (const [name, value] of Object.entries(overrides)) {
    if (value !== undefined) setEnv(name, value);
  }
}

type CapturedRequest = {
  baseUrl: string;
  request: Request;
  body: string;
};

function createTransport(
  handler: (capture: CapturedRequest) => Response | Promise<Response>,
): {
  captures: CapturedRequest[];
  createOriginBoundFetch: (baseUrl: string) => typeof fetch;
} {
  const captures: CapturedRequest[] = [];
  return {
    captures,
    createOriginBoundFetch(baseUrl) {
      return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = input instanceof Request
          ? input
          : new Request(new URL(input.toString(), baseUrl), init);
        const body = request.body === null ? "" : await request.clone().text();
        const capture = { baseUrl, request, body };
        captures.push(capture);
        return await handler(capture);
      };
    },
  };
}

beforeEach(() => setEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV, "1"));

afterEach(() => {
  restoreEnv();
  deleteEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
  _resetEnvironmentConfig();
});

async function assertHostGrantRefusal(call: () => Promise<unknown>): Promise<void> {
  const error = await assertRejects(call, VeryfrontError);
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.slug, "local-integration-config-invalid");
  assertStringIncludes(error.message, HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
}

describe("Salesforce service-account integration source", () => {
  it("rejects empty, non-Salesforce, and duplicate allowlists", () => {
    assertThrows(
      () =>
        createSalesforceServiceAccountToolSourceWithTransport({
          allowedTools: [],
          createOriginBoundFetch: createTransport(() => Response.json({})).createOriginBoundFetch,
        }),
      TypeError,
      "requires at least one allowed tool",
    );
    assertThrows(
      () =>
        createSalesforceServiceAccountToolSourceWithTransport({
          allowedTools: ["github__get_issue"],
          createOriginBoundFetch: createTransport(() => Response.json({})).createOriginBoundFetch,
        }),
      TypeError,
      "must use the canonical salesforce__tool_id name",
    );
    assertThrows(
      () =>
        createSalesforceServiceAccountToolSourceWithTransport({
          allowedTools: ["salesforce__get_case", "salesforce__get_case"],
          createOriginBoundFetch: createTransport(() => Response.json({})).createOriginBoundFetch,
        }),
      TypeError,
      'allowed tool "salesforce__get_case" is duplicated',
    );
  });

  it("lists only explicitly allowed tools without reading credentials", async () => {
    setCredentials();
    const transport = createTransport(() => {
      throw new Error("discovery must not access the network");
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case", "salesforce__update_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const definitions = await source.listTools();

    assertEquals(definitions.map((definition) => definition.name), [
      "salesforce__get_case",
      "salesforce__update_case",
    ]);
    assertEquals(definitions[0]?.parameters, {
      type: "object",
      properties: {
        caseId: {
          type: "string",
          description: "Salesforce Case ID",
        },
      },
      required: ["caseId"],
    });
    assertEquals(definitions[0]?.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    assertEquals(definitions[1]?.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    assertEquals(transport.captures, []);

    const serialized = JSON.stringify(definitions);
    for (const secretName of SALESFORCE_SERVICE_ACCOUNT_ENV_VARS) {
      assertEquals(serialized.includes(secretName), false);
    }
  });

  it("fails closed with credential names only when configuration is incomplete", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id-secret-value",
    });
    const transport = createTransport(() => {
      throw new Error("incomplete credentials must not access the network");
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const result = await source.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
    });

    assertEquals(result, {
      error: "missing_credentials",
      integration: "salesforce",
      missingEnvVars: [CLIENT_SECRET_ENV, LOGIN_URL_ENV],
      message:
        `Salesforce service account credentials are not configured. Set ${CLIENT_SECRET_ENV} and ${LOGIN_URL_ENV}.`,
    });
    assertEquals(JSON.stringify(result).includes("client-id-secret-value"), false);
    assertEquals(transport.captures, []);
  });

  it("rejects invalid endpoint input types before credential exchange", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    const transport = createTransport(() => {
      throw new Error("invalid input must not access the network");
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case", "salesforce__update_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    await assertRejects(
      () => source.executeTool("salesforce__get_case", { caseId: { nested: true } }),
      TypeError,
      'Salesforce tool input "caseId" must be a string',
    );
    await assertRejects(
      () =>
        source.executeTool("salesforce__update_case", {
          caseId: "500000000000001",
          Reason: null,
        }),
      TypeError,
      'Salesforce tool input "Reason" must be a string',
    );
    assertEquals(transport.captures, []);
  });

  it("exchanges credentials and executes a read without exposing secrets", async () => {
    const clientId = "local-client-id-secret";
    const clientSecret = "local-client-secret";
    const accessToken = "salesforce-access-token";
    setCredentials({
      [CLIENT_ID_ENV]: clientId,
      [CLIENT_SECRET_ENV]: clientSecret,
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    const transport = createTransport(({ request }) => {
      if (request.url.endsWith("/services/oauth2/token")) {
        return Response.json({
          access_token: accessToken,
          instance_url: "https://na123.salesforce.com",
          token_type: "Bearer",
        });
      }
      return Response.json({
        Id: "500000000000001",
        Subject: "Example case",
      });
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const result = await source.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
      ignored: clientSecret,
    });

    assertEquals(result, {
      Id: "500000000000001",
      Subject: "Example case",
    });
    assertEquals(transport.captures.length, 2);
    const [tokenRequest, providerRequest] = transport.captures;
    assertEquals(tokenRequest?.baseUrl, "https://acme.my.salesforce.com");
    assertEquals(tokenRequest?.request.method, "POST");
    assertEquals(
      tokenRequest?.request.headers.get("content-type"),
      "application/x-www-form-urlencoded",
    );
    const tokenBody = new URLSearchParams(tokenRequest?.body);
    assertEquals(tokenBody.get("grant_type"), "client_credentials");
    assertEquals(tokenBody.get("client_id"), clientId);
    assertEquals(tokenBody.get("client_secret"), clientSecret);
    assertEquals(providerRequest?.baseUrl, "https://na123.salesforce.com");
    assertEquals(
      providerRequest?.request.url,
      "https://na123.salesforce.com/services/data/v61.0/sobjects/Case/500000000000001",
    );
    assertEquals(providerRequest?.request.headers.get("authorization"), `Bearer ${accessToken}`);
    assertEquals(providerRequest?.request.url.includes(clientSecret), false);
    assertEquals(JSON.stringify(result).includes(clientSecret), false);
  });

  it("uses the active project credential scope without host fallback", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "host-client-id",
      [CLIENT_SECRET_ENV]: "host-client-secret",
      [LOGIN_URL_ENV]: "https://host.my.salesforce.com",
    });
    const projectCredentials = {
      [CLIENT_ID_ENV]: "project-client-id",
      [CLIENT_SECRET_ENV]: "project-client-secret",
      [LOGIN_URL_ENV]: "https://project.my.salesforce.com",
    };
    const transport = createTransport(({ baseUrl, request, body }) => {
      if (request.url.endsWith("/services/oauth2/token")) {
        assertEquals(baseUrl, projectCredentials[LOGIN_URL_ENV]);
        assertStringIncludes(body, "client_id=project-client-id");
        assertStringIncludes(body, "client_secret=project-client-secret");
        return Response.json({
          access_token: "project-access-token",
          instance_url: "https://project-instance.my.salesforce.com",
        });
      }
      assertEquals(request.headers.get("authorization"), "Bearer project-access-token");
      return Response.json({ Id: "500000000000001" });
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const result = await runWithProjectEnv(
      projectCredentials,
      () => source.executeTool("salesforce__get_case", { caseId: "500000000000001" }),
    );

    assertEquals(result, { Id: "500000000000001" });
    const serializedCaptures = JSON.stringify(transport.captures.map((capture) => ({
      baseUrl: capture.baseUrl,
      body: capture.body,
    })));
    assertEquals(serializedCaptures.includes("host-client"), false);
    assertEquals(
      transport.captures.some((capture) => capture.baseUrl === "https://host.my.salesforce.com"),
      false,
    );
  });

  it("applies safe query defaults, response transforms, and a bounded token cache", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    let tokenRequests = 0;
    const transport = createTransport(({ request }) => {
      if (request.url.endsWith("/services/oauth2/token")) {
        tokenRequests++;
        return Response.json({
          access_token: "access-token",
          instance_url: "https://na123.salesforce.com",
        });
      }
      return Response.json({
        totalSize: 1,
        records: [{ Id: "500000000000001" }],
      });
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__list_cases"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const first = await source.executeTool("salesforce__list_cases", {});
    const second = await source.executeTool("salesforce__list_cases", {});

    assertEquals(first, [{ Id: "500000000000001" }]);
    assertEquals(second, first);
    assertEquals(tokenRequests, 1);
    const providerRequests = transport.captures.filter((capture) =>
      capture.request.url.includes("/services/data/")
    );
    assertEquals(providerRequests.length, 2);
    const query = new URL(providerRequests[0]!.request.url).searchParams.get("q");
    assertStringIncludes(query ?? "", "FROM Case");
    assertStringIncludes(query ?? "", "LIMIT 50");
  });

  it("mints a fresh token when a second credential set reuses the same source", async () => {
    setCredentials();
    let tokenRequests = 0;
    const transport = createTransport(({ baseUrl, request }) => {
      if (request.url.endsWith("/services/oauth2/token")) {
        tokenRequests++;
        return baseUrl === "https://a.my.salesforce.com"
          ? Response.json({
            access_token: "token-a",
            instance_url: "https://na-a.salesforce.com",
          })
          : Response.json({
            access_token: "token-b",
            instance_url: "https://na-b.salesforce.com",
          });
      }
      return Response.json({ totalSize: 0, records: [] });
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__list_cases"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    await runWithProjectEnv(
      {
        [CLIENT_ID_ENV]: "client-a",
        [CLIENT_SECRET_ENV]: "secret-a",
        [LOGIN_URL_ENV]: "https://a.my.salesforce.com",
      },
      () => source.executeTool("salesforce__list_cases", {}),
    );
    await runWithProjectEnv(
      {
        [CLIENT_ID_ENV]: "client-b",
        [CLIENT_SECRET_ENV]: "secret-b",
        [LOGIN_URL_ENV]: "https://b.my.salesforce.com",
      },
      () => source.executeTool("salesforce__list_cases", {}),
    );

    assertEquals(tokenRequests, 2, "a second credential set must mint its own token");
    const providerRequests = transport.captures.filter((capture) =>
      capture.request.url.includes("/services/data/")
    );
    assertEquals(
      providerRequests.length,
      2,
      "each credential set must issue its own provider request",
    );
    assertEquals(
      providerRequests[1]?.request.headers.get("authorization"),
      "Bearer token-b",
      "the second project must not reuse the first project's bearer token",
    );
    assertEquals(
      new URL(providerRequests[1]!.request.url).origin,
      "https://na-b.salesforce.com",
      "the second project must not reuse the first project's instance origin",
    );
  });

  async function assertCacheKeyDimensionMintsSeparately(
    first: Record<string, string>,
    second: Record<string, string>,
    dimension: string,
  ): Promise<void> {
    setCredentials();
    let tokenRequests = 0;
    const transport = createTransport(({ body, request }) => {
      if (request.url.endsWith("/services/oauth2/token")) {
        tokenRequests++;
        // Both credential sets share a login origin, so the minted identity is
        // keyed off the posted client credentials rather than the request URL.
        const form = new URLSearchParams(body);
        const isFirst = form.get("client_id") === first[CLIENT_ID_ENV] &&
          form.get("client_secret") === first[CLIENT_SECRET_ENV];
        return Response.json({
          access_token: isFirst ? "token-first" : "token-second",
          instance_url: isFirst
            ? "https://na-first.salesforce.com"
            : "https://na-second.salesforce.com",
        });
      }
      return Response.json({ totalSize: 0, records: [] });
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__list_cases"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    await runWithProjectEnv(first, () => source.executeTool("salesforce__list_cases", {}));
    await runWithProjectEnv(second, () => source.executeTool("salesforce__list_cases", {}));

    assertEquals(
      tokenRequests,
      2,
      `a changed ${dimension} must mint its own token`,
    );
    const providerRequests = transport.captures.filter((capture) =>
      capture.request.url.includes("/services/data/")
    );
    assertEquals(
      providerRequests.length,
      2,
      `a changed ${dimension} must issue its own provider request`,
    );
    assertEquals(
      providerRequests[1]?.request.headers.get("authorization"),
      "Bearer token-second",
      `a changed ${dimension} must not reuse the cached bearer token`,
    );
    assertEquals(
      new URL(providerRequests[1]!.request.url).origin,
      "https://na-second.salesforce.com",
      `a changed ${dimension} must not reuse the cached instance origin`,
    );
  }

  it("mints a fresh token when only the client id changes on one login origin", async () => {
    await assertCacheKeyDimensionMintsSeparately(
      {
        [CLIENT_ID_ENV]: "client-a",
        [CLIENT_SECRET_ENV]: "shared-secret",
        [LOGIN_URL_ENV]: "https://shared.my.salesforce.com",
      },
      {
        [CLIENT_ID_ENV]: "client-b",
        [CLIENT_SECRET_ENV]: "shared-secret",
        [LOGIN_URL_ENV]: "https://shared.my.salesforce.com",
      },
      "client id",
    );
  });

  it("mints a fresh token when only the client secret changes on one login origin", async () => {
    await assertCacheKeyDimensionMintsSeparately(
      {
        [CLIENT_ID_ENV]: "shared-client",
        [CLIENT_SECRET_ENV]: "secret-a",
        [LOGIN_URL_ENV]: "https://shared.my.salesforce.com",
      },
      {
        [CLIENT_ID_ENV]: "shared-client",
        [CLIENT_SECRET_ENV]: "secret-b",
        [LOGIN_URL_ENV]: "https://shared.my.salesforce.com",
      },
      "client secret",
    );
  });

  it("rejects oversized token and provider responses before buffering them", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    const oversizedTokenTransport = createTransport(({ request }) => {
      if (!request.url.endsWith("/services/oauth2/token")) return Response.json({ Id: "leaked" });
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          instance_url: "https://na123.salesforce.com",
        }),
        {
          headers: {
            "content-length": String(TOKEN_RESPONSE_LIMIT_BYTES + 1),
            "content-type": "application/json",
          },
        },
      );
    });
    const oversizedTokenSource = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: oversizedTokenTransport.createOriginBoundFetch,
    });

    const oversizedToken = await oversizedTokenSource.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
    });

    assertEquals(
      oversizedToken,
      {
        error: "salesforce_api_error",
        integration: "salesforce",
        message: "Salesforce API request failed.",
      },
      "an over-length token response must fail before it is buffered",
    );
    assertEquals(
      oversizedTokenTransport.captures.filter((capture) =>
        capture.request.url.includes("/services/data/")
      ).length,
      0,
      "the content-length pre-check must fire before any provider call",
    );

    const oversizedProviderTransport = createTransport(({ request }) => {
      if (request.url.endsWith("/services/oauth2/token")) {
        return Response.json({
          access_token: "access-token",
          instance_url: "https://na123.salesforce.com",
        });
      }
      return new Response("x".repeat(MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES + 1));
    });
    const oversizedProviderSource = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: oversizedProviderTransport.createOriginBoundFetch,
    });

    const oversizedProvider = await oversizedProviderSource.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
    });

    assertEquals(
      oversizedProvider,
      {
        error: "salesforce_api_error",
        integration: "salesforce",
        message: "Salesforce API request failed.",
      },
      "an over-length provider response must be rejected instead of returned",
    );
  });

  it("refreshes once after a provider 401 and sends only declared write fields", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    let tokenRequests = 0;
    let providerRequests = 0;
    const transport = createTransport(({ request }) => {
      if (request.url.endsWith("/services/oauth2/token")) {
        tokenRequests++;
        return Response.json({
          access_token: `access-token-${tokenRequests}`,
          instance_url: "https://na123.salesforce.com",
        });
      }
      providerRequests++;
      if (providerRequests === 1) {
        return Response.json({ message: "expired" }, { status: 401 });
      }
      return new Response(null, { status: 204 });
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__update_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const result = await source.executeTool("salesforce__update_case", {
      caseId: "500000000000001",
      Reason: "User Education",
      Type: "Problem",
      undeclaredSecret: "must-not-leave-process",
    });

    assertEquals(result, { success: true });
    assertEquals(tokenRequests, 2);
    assertEquals(providerRequests, 2);
    const writes = transport.captures.filter((capture) => capture.request.method === "PATCH");
    assertEquals(writes.map((capture) => capture.request.headers.get("authorization")), [
      "Bearer access-token-1",
      "Bearer access-token-2",
    ]);
    assertEquals(writes.map((capture) => JSON.parse(capture.body)), [
      { Reason: "User Education", Type: "Problem" },
      { Reason: "User Education", Type: "Problem" },
    ]);
  });

  it("classifies a provider transport failure after token refresh as an API error", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    let providerRequests = 0;
    const transport = createTransport(({ request }) => {
      if (request.url.endsWith("/services/oauth2/token")) {
        return Response.json({
          access_token: "access-token",
          instance_url: "https://na123.salesforce.com",
        });
      }
      providerRequests++;
      if (providerRequests === 1) {
        return Response.json({ message: "expired" }, { status: 401 });
      }
      throw new Error("provider transport failed");
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const result = await source.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
    });

    assertEquals(result, {
      error: "salesforce_api_error",
      integration: "salesforce",
      message: "Salesforce API request failed.",
    });
  });

  it("preserves a provider 403 as an API error without refreshing credentials", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    let tokenRequests = 0;
    const transport = createTransport(({ request }) => {
      if (request.url.endsWith("/services/oauth2/token")) {
        tokenRequests++;
        return Response.json({
          access_token: "access-token",
          instance_url: "https://na123.salesforce.com",
        });
      }
      return Response.json([{ errorCode: "INSUFFICIENT_ACCESS" }], { status: 403 });
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const result = await source.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
    });

    assertEquals(result, {
      error: "salesforce_api_error",
      integration: "salesforce",
      status: 403,
      message: "Salesforce API request failed.",
    });
    assertEquals(tokenRequests, 1);
  });

  it("rejects unsafe login and token-returned origins before provider execution", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://login.salesforce.com",
    });
    const blockedLoginTransport = createTransport(() => {
      throw new Error("unsafe login origin must not access the network");
    });
    const blockedLoginSource = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: blockedLoginTransport.createOriginBoundFetch,
    });

    const blockedLogin = await blockedLoginSource.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
    });
    assertEquals(blockedLogin, {
      error: "invalid_credentials",
      integration: "salesforce",
      message: `${LOGIN_URL_ENV} must be a Salesforce My Domain HTTPS origin.`,
    });
    assertEquals(blockedLoginTransport.captures, []);

    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    const blockedInstanceTransport = createTransport(({ request }) => {
      assert(request.url.endsWith("/services/oauth2/token"));
      return Response.json({
        access_token: "access-token",
        instance_url: "http://127.0.0.1:8080",
      });
    });
    const blockedInstanceSource = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: blockedInstanceTransport.createOriginBoundFetch,
    });

    const blockedInstance = await blockedInstanceSource.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
    });
    assertEquals(blockedInstance, {
      error: "salesforce_auth_failed",
      integration: "salesforce",
      message: "Salesforce service account authentication failed.",
    });
    assertEquals(blockedInstanceTransport.captures.length, 1);
  });

  it("does not surface credential-bearing transport errors", async () => {
    const clientSecret = "transport-secret-value";
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: clientSecret,
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    const transport = createTransport(() => {
      throw new Error(`provider rejected ${clientSecret}`);
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const result = await source.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
    });

    assertEquals(result, {
      error: "salesforce_api_error",
      integration: "salesforce",
      message: "Salesforce API request failed.",
    });
    assertEquals(JSON.stringify(result).includes(clientSecret), false);
  });

  it("preserves token-endpoint availability failures as API errors", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    const transport = createTransport(({ request }) => {
      assert(request.url.endsWith("/services/oauth2/token"));
      return Response.json({ message: "temporarily unavailable" }, { status: 503 });
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    const result = await source.executeTool("salesforce__get_case", {
      caseId: "500000000000001",
    });

    assertEquals(result, {
      error: "salesforce_api_error",
      integration: "salesforce",
      status: 503,
      message: "Salesforce API request failed.",
    });
    assertEquals(transport.captures.length, 1);
  });

  it("propagates caller cancellation without converting it into an auth error", async () => {
    setCredentials({
      [CLIENT_ID_ENV]: "client-id",
      [CLIENT_SECRET_ENV]: "client-secret",
      [LOGIN_URL_ENV]: "https://acme.my.salesforce.com",
    });
    const transport = createTransport(() => {
      throw new Error("an already-aborted call must not access the network");
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const context: ToolExecutionContext = { abortSignal: controller.signal };

    await assertRejects(
      () =>
        source.executeTool(
          "salesforce__get_case",
          { caseId: "500000000000001" },
          context,
        ),
      DOMException,
      "cancelled",
    );
    assertEquals(transport.captures, []);
  });
  it("denies listing and execution when the host grant is missing", async () => {
    deleteEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
    setCredentials({
      SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID: "client-id",
      SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET: "client-secret",
      SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL: "https://acme.my.salesforce.com",
    });
    const transport = createTransport(() => {
      throw new Error("an ungranted host must not reach Salesforce");
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    await assertHostGrantRefusal(() => source.listTools());
    await assertHostGrantRefusal(
      () => source.executeTool("salesforce__get_case", { caseId: "500000000000001" }),
    );
    assertEquals(transport.captures, []);
  });

  it("denies a malformed host grant and a project-supplied one", async () => {
    setCredentials({
      SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID: "client-id",
      SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET: "client-secret",
      SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL: "https://acme.my.salesforce.com",
    });
    const transport = createTransport(() => {
      throw new Error("an ungranted host must not reach Salesforce");
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    for (const value of ["", "0", "true", " 1 "]) {
      setEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV, value);
      await assertHostGrantRefusal(() => source.listTools());
    }

    deleteEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
    await runWithProjectEnv(
      { [HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV]: "1" },
      () => assertHostGrantRefusal(() => source.listTools()),
    );
    assertEquals(transport.captures, []);
  });

  it("denies a granted host that runs in proxy mode", async () => {
    _setEnvironmentConfigForTesting({ proxyMode: true });
    const transport = createTransport(() => {
      throw new Error("a proxy runtime must not reach Salesforce");
    });
    const source = createSalesforceServiceAccountToolSourceWithTransport({
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    await assertHostGrantRefusal(() => source.listTools());
    await assertHostGrantRefusal(
      () => source.executeTool("salesforce__get_case", { caseId: "500000000000001" }),
    );
    assertEquals(transport.captures, []);
  });
});
