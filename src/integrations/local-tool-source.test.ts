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
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { loadRemoteToolsFromSource } from "#veryfront/tool";
import { executeConfiguredTool } from "#veryfront/agent/runtime/tool-helpers.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { EXPERIMENTAL_INTEGRATIONS_ENV } from "./feature-flags.ts";
import { createLocalIntegrationToolSource, getConnector } from "./index.ts";
import { HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV } from "./local-credential-host-policy.ts";
import { MAX_LOCAL_INTEGRATION_TOOLS } from "./limits.ts";
import type { LocalIntegrationEndpointTransport } from "./local-endpoint-executor.ts";
import {
  _createLocalIntegrationToolSourceForTesting,
  type LocalIntegrationToolSourceOptions,
} from "./local-tool-source.ts";

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
  beforeEach(() => {
    setEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV, "1");
  });

  afterEach(() => {
    _resetEnvironmentConfig();
    deleteEnv(EXPERIMENTAL_INTEGRATIONS_ENV);
    deleteEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
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
    setEnv(EXPERIMENTAL_INTEGRATIONS_ENV, "anthropic");
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

  // Deno-only: Node's test runner emits harness diagnostics through
  // Array.prototype.push while the poison window is open across the awaits
  // below, so the poison crashes the runner itself rather than proving
  // anything about the implementation. The intrinsic-safety proof is
  // runtime-independent; every other test in this file still runs on Node
  // and Bun.
  const denoOnlyIt = isDeno ? it : it.skip;
  denoOnlyIt(
    "retains admission semantics after project code mutates ambient primordials",
    async () => {
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
    },
  );

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

  it("rejects malformed source options", async () => {
    await assertConfigurationError(async () => {
      const oversizedSource = createLocalIntegrationToolSource({
        tools: Array.from(
          { length: MAX_LOCAL_INTEGRATION_TOOLS + 1 },
          (_unused, index) => `vercel__list_projects_${index}`,
        ),
        credentialProvider: testCredentialProvider,
      });
      await oversizedSource.listTools();
    }, `${MAX_LOCAL_INTEGRATION_TOOLS} tool limit`);

    await assertConfigurationError(async () => {
      const emptySource = createLocalIntegrationToolSource({
        tools: [],
        credentialProvider: testCredentialProvider,
      });
      await emptySource.listTools();
    }, "at least one");

    await assertConfigurationError(async () => {
      const providerSource = createLocalIntegrationToolSource(
        {
          tools: ["vercel__list_projects"],
          credentialProvider: "nope",
        } as unknown as LocalIntegrationToolSourceOptions,
      );
      await providerSource.listTools();
    }, "credentialProvider must be a function");

    const accessorOptions = { credentialProvider: testCredentialProvider };
    defineProperty(accessorOptions, "tools", {
      configurable: true,
      enumerable: true,
      get: () => ["vercel__list_projects"],
    });
    await assertConfigurationError(async () => {
      const accessorSource = createLocalIntegrationToolSource(
        accessorOptions as unknown as LocalIntegrationToolSourceOptions,
      );
      await accessorSource.listTools();
    }, 'option "tools" must be a data property');
  });

  it("denies unmarked deployment modes through listing and execution", async () => {
    deleteEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
    for (
      const veryfrontMode of [
        "development",
        "production",
        "proxy",
        "saas",
        "single-tenant",
        "unknown",
      ]
    ) {
      _setEnvironmentConfigForTesting({ veryfrontMode, proxyMode: false });
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

      await assertConfigurationError(
        () => source.listTools(),
        HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV,
      );
      await assertConfigurationError(
        () => source.executeTool("vercel__list_projects", {}),
        HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV,
      );
      assertEquals(transportCalls, 0);
      _resetEnvironmentConfig();
    }
  });

  it("allows the exact host grant on any non-proxy deployment mode", async () => {
    for (const veryfrontMode of ["development", "self-hosted", "production"]) {
      _setEnvironmentConfigForTesting({ veryfrontMode, proxyMode: false });
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

      assertEquals((await source.listTools()).length, 1);
      await source.executeTool("vercel__list_projects", {});
      assertEquals(transportCalls, 1);
      _resetEnvironmentConfig();
    }
  });

  it("does not accept the host grant from a project environment", async () => {
    deleteEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
    const source = createLocalIntegrationToolSource({
      tools: ["vercel__list_projects"],
      credentialProvider: testCredentialProvider,
    });

    await runWithProjectEnv(
      { [HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV]: "1" },
      () =>
        assertConfigurationError(() => source.listTools(), HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV),
    );
  });

  it("proxy mode denies an explicit local-credential grant", async () => {
    _setEnvironmentConfigForTesting({ veryfrontMode: "development", proxyMode: true });
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

    await assertConfigurationError(
      () => source.listTools(),
      HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV,
    );
    await assertConfigurationError(
      () => source.executeTool("vercel__list_projects", {}),
      HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV,
    );
    assertEquals(transportCalls, 0);
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

  it("keeps an ungranted tool name out of the error verbatim", async () => {
    const source = createLocalIntegrationToolSource({
      tools: ["vercel__list_projects"],
      credentialProvider: testCredentialProvider,
    });

    const hostile = `vercel__evil\n${"x".repeat(400)}`;
    const error = await assertRejects(
      () => source.executeTool(hostile, {}),
      VeryfrontError,
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-config-invalid");
    assertEquals(error.message.includes(hostile), false);
    assertEquals(error.message.includes("\n"), false);
    assert(error.message.includes("unknown"), error.message);
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

  it("rejects invalid tool arguments before resolving or minting credentials", async () => {
    let credentialProviderCalls = 0;
    let transportCalls = 0;
    const source = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["paypal__list_balances"],
        credentialProvider: () => {
          credentialProviderCalls += 1;
          return TEST_CREDENTIAL;
        },
      },
      () => {
        transportCalls += 1;
        return Promise.resolve(Response.json({ access_token: TEST_CREDENTIAL }));
      },
    );

    const error = await assertRejects(
      () => source.executeTool("paypal__list_balances", { unknown: true }),
      VeryfrontError,
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-request-invalid");
    assertEquals(credentialProviderCalls, 0);
    assertEquals(transportCalls, 0);
  });

  it("rejects a dot-segment path argument before minting credentials", async () => {
    for (const traversal of ["..", ".", ""]) {
      let credentialProviderCalls = 0;
      let transportCalls = 0;
      const source = _createLocalIntegrationToolSourceForTesting(
        {
          tools: ["paypal__get_invoice"],
          credentialProvider: () => {
            credentialProviderCalls += 1;
            return TEST_CREDENTIAL;
          },
        },
        () => {
          transportCalls += 1;
          return Promise.resolve(Response.json({ access_token: TEST_CREDENTIAL }));
        },
      );

      const error = await assertRejects(
        () => source.executeTool("paypal__get_invoice", { invoiceId: traversal }),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-request-invalid");
      assertEquals(credentialProviderCalls, 0);
      assertEquals(transportCalls, 0);
    }
  });

  it("rejects an invalid header argument before minting credentials", async () => {
    let credentialProviderCalls = 0;
    let transportCalls = 0;
    const source = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["mongodb-atlas__list_projects"],
        credentialProvider: () => {
          credentialProviderCalls += 1;
          return TEST_CREDENTIAL;
        },
      },
      () => {
        transportCalls += 1;
        return Promise.resolve(Response.json({ access_token: TEST_CREDENTIAL }));
      },
    );

    const error = await assertRejects(
      () =>
        source.executeTool("mongodb-atlas__list_projects", { accept: "application/json\r\nx: y" }),
      VeryfrontError,
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-request-invalid");
    assertEquals(credentialProviderCalls, 0);
    assertEquals(transportCalls, 0);
  });

  // Deno-only for the same reason as the primordial-poisoning proof above: the
  // poison window spans an await, and Node's runner serializes its own
  // diagnostics through the mutated prototype.
  const bodyDriftIt = isDeno ? it : it.skip;
  bodyDriftIt("sends the body it bound-checked, not one re-serialized after minting", async () => {
    let sentBody: BodyInit | null | undefined;
    let restored = false;
    const restore = (): void => {
      if (restored) return;
      restored = true;
      deleteProperty(Object.prototype, "toJSON");
    };

    const source = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["brevo__create_contact"],
        credentialProvider: () => {
          // Caller-supplied code runs between the pre-auth snapshot and request
          // construction. Re-serializing after this point would send a body
          // nothing ever checked.
          defineProperty(Object.prototype, "toJSON", {
            configurable: true,
            value: () => "POISONED",
            writable: true,
          });
          return TEST_CREDENTIAL;
        },
      },
      (request) => {
        sentBody = request.init.body;
        restore();
        return Promise.resolve(Response.json({ contact: { id: "1" } }));
      },
    );

    try {
      await source.executeTool("brevo__create_contact", {
        email: "ada@example.test",
        attributes: { FIRSTNAME: "Ada" },
      });
    } finally {
      restore();
    }

    // Includes the catalog default, i.e. the assembled body that was bounded.
    assertEquals(
      sentBody,
      '{"email":"ada@example.test","attributes":{"FIRSTNAME":"Ada"},"updateEnabled":false}',
    );
  });

  bodyDriftIt("does not re-serialize the body when a pre-auth body was threaded in", async () => {
    // A `toJSON` that THROWS, not one that returns a value: a discarded second
    // assembly is invisible when the poison returns, but fatal when it throws.
    let sentBody: BodyInit | null | undefined;
    let restored = false;
    const restore = (): void => {
      if (restored) return;
      restored = true;
      deleteProperty(Object.prototype, "toJSON");
    };

    const source = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["brevo__create_contact"],
        credentialProvider: () => {
          defineProperty(Object.prototype, "toJSON", {
            configurable: true,
            value: () => {
              throw new Error("toJSON poisoned after credential resolution");
            },
            writable: true,
          });
          return TEST_CREDENTIAL;
        },
      },
      (request) => {
        sentBody = request.init.body;
        restore();
        return Promise.resolve(Response.json({ contact: { id: "1" } }));
      },
    );

    try {
      await source.executeTool("brevo__create_contact", {
        email: "ada@example.test",
        attributes: { FIRSTNAME: "Ada" },
      });
    } finally {
      restore();
    }

    assertEquals(
      sentBody,
      '{"email":"ada@example.test","attributes":{"FIRSTNAME":"Ada"},"updateEnabled":false}',
    );
  });

  it("rejects pre-aborted execution before resolving credentials", async () => {
    let credentialProviderCalls = 0;
    let transportCalls = 0;
    const source = _createLocalIntegrationToolSourceForTesting(
      {
        tools: ["vercel__list_projects"],
        credentialProvider: () => {
          credentialProviderCalls += 1;
          return TEST_CREDENTIAL;
        },
      },
      () => {
        transportCalls += 1;
        return Promise.resolve(Response.json({ projects: [] }));
      },
    );
    const controller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");
    controller.abort(reason);

    const error = await assertRejects(() =>
      source.executeTool(
        "vercel__list_projects",
        {},
        { abortSignal: controller.signal },
      )
    );

    assertStrictEquals(error, reason);
    assertEquals(credentialProviderCalls, 0);
    assertEquals(transportCalls, 0);
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
