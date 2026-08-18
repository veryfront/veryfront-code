import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import type { ToolExecutionContext } from "#veryfront/tool";
import {
  createSalesforceServiceAccountToolSourceWithTransport,
  SALESFORCE_SERVICE_ACCOUNT_ENV_VARS,
} from "./salesforce-service-account.ts";

const [CLIENT_ID_ENV, CLIENT_SECRET_ENV, LOGIN_URL_ENV] = SALESFORCE_SERVICE_ACCOUNT_ENV_VARS;
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

afterEach(() => restoreEnv());

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
    assertEquals(definitions[1]?.annotations?.readOnlyHint, false);
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
      allowedTools: ["salesforce__get_case"],
      createOriginBoundFetch: transport.createOriginBoundFetch,
    });

    await assertRejects(
      () => source.executeTool("salesforce__get_case", { caseId: { nested: true } }),
      TypeError,
      'Salesforce tool input "caseId" must be a string',
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
      error: "salesforce_auth_failed",
      integration: "salesforce",
      message: "Salesforce service account authentication failed.",
    });
    assertEquals(JSON.stringify(result).includes(clientSecret), false);
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
});
