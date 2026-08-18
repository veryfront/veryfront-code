import "#veryfront/schemas/_test-setup.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
} from "#veryfront/config/environment-config.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { loadRemoteToolsFromSource } from "#veryfront/tool";
import { executeConfiguredTool } from "#veryfront/agent/runtime/tool-helpers.ts";
import { EXPERIMENTAL_INTEGRATIONS_ENV } from "./feature-flags.ts";
import { createLocalIntegrationToolSource, getConnector } from "./index.ts";
import type { LocalIntegrationEndpointTransport } from "./local-endpoint-executor.ts";
import { _createLocalIntegrationToolSourceForTesting } from "./local-tool-source.ts";

const TEST_CREDENTIAL = "LOCAL_INTEGRATION_SECRET_MUST_NOT_LEAK";
const testCredentialProvider = () => TEST_CREDENTIAL;
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function replaceProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): () => void {
  const descriptor = getOwnPropertyDescriptor(target, key);
  defineProperty(target, key, {
    configurable: true,
    value,
    writable: true,
  });
  return () => {
    if (descriptor) defineProperty(target, key, descriptor);
    else deleteProperty(target, key);
  };
}

function appendRestorer(restorers: Array<() => void>, restorer: () => void): void {
  defineProperty(restorers, restorers.length, {
    configurable: true,
    enumerable: true,
    value: restorer,
    writable: true,
  });
}

function replaceDescriptor(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): () => void {
  const previous = getOwnPropertyDescriptor(target, key);
  defineProperty(target, key, descriptor);
  return () => {
    if (previous) defineProperty(target, key, previous);
    else deleteProperty(target, key);
  };
}

function headerValue(request: RequestInit, name: string): string | null {
  return new Headers(request.headers).get(name);
}

async function assertConfigurationError(
  createPromise: () => Promise<unknown>,
  expectedDetail: string,
): Promise<void> {
  const error = await assertRejects(createPromise, VeryfrontError);
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.slug, "local-integration-config-invalid");
  assert(error.message.includes(expectedDetail), error.message);
  assertEquals(error.message.includes(TEST_CREDENTIAL), false);
}

describe("createLocalIntegrationToolSource", () => {
  afterEach(() => {
    _resetEnvironmentConfig();
    Deno.env.delete(EXPERIMENTAL_INTEGRATIONS_ENV);
  });

  it("lists only explicitly granted catalog tools with credential-free metadata", async () => {
    const source = createLocalIntegrationToolSource({
      tools: ["vercel__get_project", "vercel__list_projects"],
      credentialProvider: testCredentialProvider,
    });

    const definitions = await source.listTools();

    assertEquals(source.id, "veryfront-local-integrations");
    assertEquals(definitions.map((definition) => definition.name), [
      "vercel__get_project",
      "vercel__list_projects",
    ]);
    assertEquals(definitions[0]?.parameters, {
      type: "object",
      properties: {
        idOrName: {
          type: "string",
          description: "Project ID (prj_...) or project name",
        },
        teamId: {
          type: "string",
          description: "Team ID to perform the request on behalf of",
        },
        slug: {
          type: "string",
          description: "Team slug, alternative to teamId",
        },
      },
      required: ["idOrName"],
      additionalProperties: false,
    });

    const serialized = JSON.stringify(definitions);
    assertEquals(serialized.includes("VERCEL_TOKEN"), false);
    assertEquals(serialized.includes(TEST_CREDENTIAL), false);
  });

  it("removes credential variable names from model-facing catalog descriptions", async () => {
    const source = createLocalIntegrationToolSource({
      tools: ["openai__get_costs"],
      credentialProvider: testCredentialProvider,
    });

    const serialized = JSON.stringify(await source.listTools());

    assertEquals(serialized.includes("OPENAI_API_KEY"), false);
    assertEquals(serialized.includes(TEST_CREDENTIAL), false);
  });

  it("snapshots its allowlist before caller mutation", async () => {
    const tools = ["vercel__list_projects"];
    const source = createLocalIntegrationToolSource({
      tools,
      credentialProvider: testCredentialProvider,
    });

    tools.push("vercel__get_project");

    assertEquals((await source.listTools()).map((definition) => definition.name), [
      "vercel__list_projects",
    ]);
  });

  it("does not trust catalog metadata mutated through the public connector API", async () => {
    _setEnvironmentConfigForTesting({ veryfrontMode: "production", proxyMode: false });
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "anthropic");
    const connector = getConnector("anthropic");
    const publicTool = connector?.tools.find((tool) => tool.id === "anthropic__list_workspaces");
    assert(publicTool?.endpoint);
    const originalUrl = publicTool.endpoint.url;
    let requestUrl: string | undefined;
    let apiKey: string | null = null;

    try {
      publicTool.endpoint.url = "https://attacker.example/collect";
      const source = _createLocalIntegrationToolSourceForTesting(
        {
          tools: ["anthropic__list_workspaces"],
          credentialProvider: () => TEST_CREDENTIAL,
        },
        (request) => {
          requestUrl = request.url.href;
          apiKey = headerValue(request.init, "x-api-key");
          return Promise.resolve(Response.json({ data: [] }));
        },
      );

      await source.executeTool("anthropic__list_workspaces", {});
    } finally {
      publicTool.endpoint.url = originalUrl;
    }

    assertEquals(requestUrl, "https://api.anthropic.com/v1/organizations/workspaces?limit=20");
    assertEquals(apiKey, TEST_CREDENTIAL);
  });

  it("retains admission semantics after project code mutates ambient primordials", async () => {
    _setEnvironmentConfigForTesting({ veryfrontMode: "production", proxyMode: false });
    const restorers: Array<() => void> = [];
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("ambient primordial used");
    };
    let source: ReturnType<typeof createLocalIntegrationToolSource> | undefined;
    let definitions: readonly { name: string }[] | undefined;

    try {
      appendRestorer(restorers, replaceProperty(Array, "isArray", () => poison()));
      appendRestorer(restorers, replaceProperty(Array.prototype, "map", poison));
      appendRestorer(restorers, replaceProperty(Array.prototype, "push", poison));
      appendRestorer(restorers, replaceProperty(Map.prototype, "get", poison));
      appendRestorer(restorers, replaceProperty(Map.prototype, "has", poison));
      appendRestorer(restorers, replaceProperty(Map.prototype, "set", poison));
      appendRestorer(restorers, replaceProperty(globalThis, "Map", poison));
      appendRestorer(restorers, replaceProperty(Object, "create", poison));
      appendRestorer(restorers, replaceProperty(Object, "defineProperty", poison));
      appendRestorer(restorers, replaceProperty(Object, "entries", poison));
      appendRestorer(restorers, replaceProperty(Object, "freeze", poison));
      appendRestorer(restorers, replaceProperty(Object, "getOwnPropertyDescriptor", poison));
      appendRestorer(restorers, replaceProperty(Object, "values", poison));
      appendRestorer(
        restorers,
        replaceProperty(Reflect, "getOwnPropertyDescriptor", poison),
      );
      appendRestorer(restorers, replaceProperty(Set.prototype, "add", poison));
      appendRestorer(restorers, replaceProperty(Set.prototype, "has", poison));
      appendRestorer(restorers, replaceProperty(globalThis, "Set", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "charCodeAt", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "includes", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "indexOf", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "lastIndexOf", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "replace", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "replaceAll", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "slice", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "startsWith", poison));
      appendRestorer(restorers, replaceProperty(globalThis, "URL", poison));
      appendRestorer(
        restorers,
        replaceDescriptor(Array.prototype, "0", {
          configurable: true,
          set: poison,
        }),
      );

      source = createLocalIntegrationToolSource({
        tools: ["vercel__list_projects"],
        credentialProvider: testCredentialProvider,
      });
      definitions = await source.listTools();
    } finally {
      for (let index = restorers.length - 1; index >= 0; index--) restorers[index]?.();
    }

    assertEquals(poisonCalls, 0);
    assert(source);
    assert(Object.isFrozen(source));
    assertEquals(definitions?.map((definition) => definition.name), [
      "vercel__list_projects",
    ]);
  });

  it("validates configured credential names before exposing tools", async () => {
    const calls: string[] = [];
    const source = createLocalIntegrationToolSource({
      tools: ["sendcloud__list_shipments"],
      credentialProvider: (name) => {
        calls.push(name);
        return name === "SENDCLOUD_PUBLIC_KEY" ? "public-key" : undefined;
      },
    });

    const error = await assertRejects(() => source.listTools(), VeryfrontError);
    assertEquals(calls, ["SENDCLOUD_PUBLIC_KEY", "SENDCLOUD_SECRET_KEY"]);
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-credentials-missing");
    assertEquals(error.message.includes("SENDCLOUD_SECRET_KEY"), true);
    assertEquals(error.message.includes("public-key"), false);
  });

  it("fails closed for malformed, unknown, duplicate, and unsupported tools", async () => {
    const fixtures = [
      { tool: "vercel", detail: "canonical" },
      { tool: "vercel__missing", detail: "unknown" },
      { tool: "aws__list-s3-buckets", detail: "endpoint" },
      { tool: "github__list_issues", detail: "GraphQL" },
      { tool: "gmail__list_emails", detail: "enrichment" },
      { tool: "algolia__list_indices", detail: "fixed HTTPS URL" },
      { tool: "alphavantage__quote", detail: "query" },
      { tool: "slack__list_channels", detail: "authorization-code" },
    ] as const;

    for (const fixture of fixtures) {
      await assertConfigurationError(async () => {
        const source = createLocalIntegrationToolSource({
          tools: [fixture.tool],
          credentialProvider: testCredentialProvider,
        });
        await source.listTools();
      }, fixture.detail);
    }

    await assertConfigurationError(async () => {
      const duplicateSource = createLocalIntegrationToolSource({
        tools: ["vercel__list_projects", "vercel__list_projects"],
        credentialProvider: testCredentialProvider,
      });
      await duplicateSource.listTools();
    }, "duplicate");
  });

  it("rejects local credential execution in hosted and proxy runtimes", async () => {
    for (
      const environment of [
        { veryfrontMode: "hosted", proxyMode: false },
        { veryfrontMode: "production", proxyMode: true },
      ]
    ) {
      _setEnvironmentConfigForTesting(environment);
      const source = createLocalIntegrationToolSource({
        tools: ["vercel__list_projects"],
        credentialProvider: testCredentialProvider,
      });

      await assertConfigurationError(() => source.listTools(), "local or self-hosted");
      _resetEnvironmentConfig();
    }
  });

  it("never executes a catalog tool outside its exact source grant", async () => {
    const source = createLocalIntegrationToolSource({
      tools: ["vercel__list_projects"],
      credentialProvider: testCredentialProvider,
    });

    await assertConfigurationError(
      () => source.executeTool("vercel__get_project", { idOrName: "demo" }),
      "not granted",
    );
  });

  it("executes admitted API-key and Basic tools with project-owned credentials", async () => {
    const directRequests: string[] = [];
    const transport: LocalIntegrationEndpointTransport = (request) => {
      directRequests.push(request.url.href);
      if (request.url.hostname === "api.vercel.com") {
        assertEquals(headerValue(request.init, "authorization"), `Bearer ${TEST_CREDENTIAL}`);
        return Promise.resolve(Response.json({ projects: [{ id: "project-1" }] }));
      }
      assertEquals(request.url.hostname, "panel.sendcloud.sc");
      assertEquals(
        headerValue(request.init, "authorization"),
        `Basic ${btoa(`public-key:${TEST_CREDENTIAL}`)}`,
      );
      return Promise.resolve(Response.json({ data: [{ id: "shipment-1" }] }));
    };

    const vercel = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["vercel__list_projects"],
        credentialProvider: testCredentialProvider,
      },
      transport,
    );
    const sendcloud = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["sendcloud__list_shipments"],
        credentialProvider: (name) =>
          name === "SENDCLOUD_PUBLIC_KEY" ? "public-key" : TEST_CREDENTIAL,
      },
      transport,
    );

    assertEquals(await vercel.executeTool("vercel__list_projects", {}), {
      projects: [{ id: "project-1" }],
    });
    assertEquals(await sendcloud.executeTool("sendcloud__list_shipments", {}), [
      { id: "shipment-1" },
    ]);
    assertEquals(directRequests, [
      "https://api.vercel.com/v10/projects?limit=20",
      "https://panel.sendcloud.sc/api/v3/shipments?page_size=40",
    ]);
  });

  it("mints client credentials before executing a fixed-origin provider tool", async () => {
    const requests: string[] = [];
    const transport: LocalIntegrationEndpointTransport = (request) => {
      requests.push(request.url.href);
      if (request.url.pathname === "/v1/oauth2/token") {
        assertEquals(request.init.method, "POST");
        assertEquals(
          headerValue(request.init, "authorization"),
          `Basic ${btoa(`paypal-client:${TEST_CREDENTIAL}`)}`,
        );
        assertEquals(request.init.body, "grant_type=client_credentials");
        return Promise.resolve(Response.json({
          access_token: "paypal-access-token",
          token_type: "Bearer",
        }));
      }
      assertEquals(headerValue(request.init, "authorization"), "Bearer paypal-access-token");
      return Promise.resolve(Response.json({ balances: [{ currency_code: "USD" }] }));
    };
    const source = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["paypal__list_balances"],
        credentialProvider: (name) =>
          name === "PAYPAL_CLIENT_ID" ? "paypal-client" : TEST_CREDENTIAL,
      },
      transport,
    );

    assertEquals(await source.executeTool("paypal__list_balances", {}), {
      balances: [{ currency_code: "USD" }],
    });
    assertEquals(requests, [
      "https://api-m.paypal.com/v1/oauth2/token",
      "https://api-m.paypal.com/v1/reporting/balances",
    ]);
  });

  it("uses only a validated Salesforce instance origin from service-account tokens", async () => {
    const requests: string[] = [];
    const transport: LocalIntegrationEndpointTransport = (request) => {
      requests.push(request.url.href);
      if (request.url.pathname === "/services/oauth2/token") {
        assertEquals(request.url.origin, "https://acme.my.salesforce.com");
        assertEquals(
          request.init.body,
          [
            "grant_type=client_credentials",
            "client_id=salesforce-client",
            `client_secret=${TEST_CREDENTIAL}`,
          ].join("&"),
        );
        return Promise.resolve(Response.json({
          access_token: "salesforce-access-token",
          instance_url: "https://customer.my.salesforce.com",
          token_type: "Bearer",
        }));
      }
      assertEquals(request.url.origin, "https://customer.my.salesforce.com");
      assertEquals(
        headerValue(request.init, "authorization"),
        "Bearer salesforce-access-token",
      );
      return Promise.resolve(Response.json({ records: [{ Id: "contact-1" }] }));
    };
    const source = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["salesforce__find_customer"],
        credentialProvider: (name) => {
          if (name === "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID") return "salesforce-client";
          if (name === "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL") {
            return "https://acme.my.salesforce.com";
          }
          return TEST_CREDENTIAL;
        },
      },
      transport,
    );

    assertEquals(await source.executeTool("salesforce__find_customer", {}), [
      { Id: "contact-1" },
    ]);
    assertEquals(requests.length, 2);
    assert(
      requests[1]?.startsWith(
        "https://customer.my.salesforce.com/services/data/v61.0/query?q=SELECT+Id",
      ),
    );
  });

  it("rejects malformed Salesforce token payloads before endpoint execution", async () => {
    const invalidPayloads = [
      {},
      { access_token: TEST_CREDENTIAL },
      {
        access_token: TEST_CREDENTIAL,
        instance_url: "https://example.com",
        token_type: "Bearer",
      },
      {
        access_token: TEST_CREDENTIAL,
        instance_url: "http://acme.my.salesforce.com",
        token_type: "Bearer",
      },
      {
        access_token: TEST_CREDENTIAL,
        instance_url: "https://127.0.0.1",
        token_type: "Bearer",
      },
      {
        access_token: TEST_CREDENTIAL,
        instance_url: "https://acme.my.salesforce.com/private",
        token_type: "Bearer",
      },
      {
        access_token: TEST_CREDENTIAL,
        instance_url: "https://user@acme.my.salesforce.com",
        token_type: "Bearer",
      },
      {
        access_token: TEST_CREDENTIAL,
        instance_url: "https://acme.my.salesforce.com:8443",
        token_type: "Bearer",
      },
    ];

    for (const payload of invalidPayloads) {
      let calls = 0;
      const source = _createLocalIntegrationToolSourceForTesting(
        {
          tools: ["salesforce__find_customer"],
          credentialProvider: (name) =>
            name === "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL"
              ? "https://acme.my.salesforce.com"
              : TEST_CREDENTIAL,
        },
        () => {
          calls += 1;
          return Promise.resolve(Response.json(payload));
        },
      );

      const error = await assertRejects(
        () => source.executeTool("salesforce__find_customer", {}),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-response-invalid");
      assertEquals(error.message.includes(TEST_CREDENTIAL), false);
      assertEquals(error.cause, undefined);
      assertEquals(calls, 1);
    }
  });

  it("keeps source integration policy narrowing over materialized local tools", async () => {
    let transportCalls = 0;
    const source = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["vercel__list_projects"],
        credentialProvider: testCredentialProvider,
      },
      () => {
        transportCalls += 1;
        return Promise.resolve(Response.json({ projects: [] }));
      },
    );
    const tools = await loadRemoteToolsFromSource(source);

    await assertRejects(
      () =>
        executeConfiguredTool(
          "vercel__list_projects",
          {},
          tools,
          undefined,
          ["vercel__list_projects"],
          undefined,
          {
            schemaVersion: 1,
            mode: "allowlist",
            integrations: { vercel: { allowedToolIds: ["get_project"] } },
          },
        ),
      Error,
      'Tool "vercel__list_projects" is not allowed by the source integration policy',
    );
    assertEquals(transportCalls, 0);
  });
});
