import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createLocalIntegrationToolSource } from "./index.ts";
import type { LocalIntegrationEndpointTransport } from "./local-endpoint-executor.ts";
import {
  _createOutlookServiceAccountToolSourceForTesting,
  createOutlookServiceAccountToolSource,
  OUTLOOK_SERVICE_ACCOUNT_ENV_VARS,
  type OutlookServiceAccountToolSourceOptions,
} from "./outlook-service-account.ts";

const CLIENT_SECRET = "outlook-client-secret-must-not-leak";
const ACCESS_TOKEN = "graph-access-token-must-not-leak";
const TOKEN_URL = "https://login.microsoftonline.com/tenant-test.example.test/oauth2/v2.0/token";
const MAILBOX_PATH = "https://graph.microsoft.com/v1.0/users/intake%40example.test";

const credentials: Record<string, string> = {
  OUTLOOK_SERVICE_ACCOUNT_CLIENT_ID: "client-id-test",
  OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET: CLIENT_SECRET,
  OUTLOOK_SERVICE_ACCOUNT_TENANT_ID: "tenant-test.example.test",
  OUTLOOK_SERVICE_ACCOUNT_MAILBOX: "intake@example.test",
};

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

function recordingTransport(
  options: { expiresIn?: number; tokens?: string[] } = {},
): { requests: RecordedRequest[]; transport: LocalIntegrationEndpointTransport } {
  const requests: RecordedRequest[] = [];
  let minted = 0;
  const transport: LocalIntegrationEndpointTransport = (request) => {
    const body = request.init.body;
    requests.push({
      url: request.url.href,
      method: request.init.method ?? "GET",
      headers: new Headers(request.init.headers),
      body: typeof body === "string" ? body : undefined,
    });
    if (request.url.origin === "https://login.microsoftonline.com") {
      const token = options.tokens?.[minted] ?? ACCESS_TOKEN;
      minted += 1;
      return Promise.resolve(Response.json({
        token_type: "Bearer",
        access_token: token,
        expires_in: options.expiresIn ?? 3599,
      }));
    }
    return Promise.resolve(Response.json({ value: [{ id: "message-1" }] }));
  };
  return { requests, transport };
}

function createSource(
  options: Partial<OutlookServiceAccountToolSourceOptions> = {},
  transport: LocalIntegrationEndpointTransport = recordingTransport().transport,
  now?: () => number,
) {
  return _createOutlookServiceAccountToolSourceForTesting(
    {
      allowedTools: ["outlook__list_emails"],
      credentialProvider: (name) => credentials[name],
      ...options,
    },
    transport,
    now,
  );
}

function assertNoSecrets(value: string): void {
  assertEquals(value.includes(CLIENT_SECRET), false, value);
  assertEquals(value.includes(ACCESS_TOKEN), false, value);
}

describe("createOutlookServiceAccountToolSource", () => {
  it("declares the hosted service-account variable names", () => {
    assertEquals([...OUTLOOK_SERVICE_ACCOUNT_ENV_VARS], [
      "OUTLOOK_SERVICE_ACCOUNT_CLIENT_ID",
      "OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET",
      "OUTLOOK_SERVICE_ACCOUNT_TENANT_ID",
      "OUTLOOK_SERVICE_ACCOUNT_MAILBOX",
    ]);
  });

  it("mints an app-only token and calls Graph for the configured mailbox only", async () => {
    const { requests, transport } = recordingTransport();
    const readNames: string[] = [];
    const source = createSource({
      credentialProvider: (name) => {
        readNames.push(name);
        return credentials[name];
      },
    }, transport);

    const result = await source.executeTool("outlook__list_emails", { $top: 5 });

    // Only the four service-account variables are read: no Veryfront API token.
    assertEquals([...new Set(readNames)], [...OUTLOOK_SERVICE_ACCOUNT_ENV_VARS]);

    // The catalog response transform unwraps Graph's `value` collection.
    assertEquals(result, [{ id: "message-1" }]);
    assertEquals(requests.length, 2);
    const [token, graph] = requests;
    assertEquals(token!.method, "POST");
    assertEquals(token!.url, TOKEN_URL);
    assertEquals(token!.headers.get("content-type"), "application/x-www-form-urlencoded");
    const form = new URLSearchParams(token!.body);
    assertEquals(form.get("grant_type"), "client_credentials");
    assertEquals(form.get("scope"), "https://graph.microsoft.com/.default");
    assertEquals(form.get("client_id"), "client-id-test");
    assertEquals(form.get("client_secret"), CLIENT_SECRET);
    assertStringIncludes(token!.body!, "scope=https%3A%2F%2Fgraph.microsoft.com%2F.default");

    assertEquals(graph!.method, "GET");
    assert(
      graph!.url.startsWith(`${MAILBOX_PATH}/mailFolders/inbox/messages?`),
      graph!.url,
    );
    assertEquals(graph!.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);

    for (const request of requests) {
      assertEquals(request.url.includes("/me/"), false, request.url);
      assert(
        request.url.startsWith("https://login.microsoftonline.com/") ||
          request.url.startsWith("https://graph.microsoft.com/"),
        request.url,
      );
      assertEquals(request.url.includes("veryfront"), false, request.url);
    }
  });

  it("reuses the cached token until it nears expiry", async () => {
    let clock = 1_000_000;
    const { requests, transport } = recordingTransport({
      expiresIn: 3600,
      tokens: ["token-one", "token-two"],
    });
    const source = createSource({}, transport, () => clock);

    await source.executeTool("outlook__list_emails", {});
    await source.executeTool("outlook__list_emails", {});
    assertEquals(requests.map((request) => request.url.startsWith(TOKEN_URL)), [
      true,
      false,
      false,
    ]);
    assertEquals(requests[2]!.headers.get("authorization"), "Bearer token-one");

    clock += 3600 * 1_000;
    await source.executeTool("outlook__list_emails", {});
    assertEquals(requests.length, 5);
    assertEquals(requests[3]!.url, TOKEN_URL);
    assertEquals(requests[4]!.headers.get("authorization"), "Bearer token-two");
  });

  it("re-mints when a credential changes", async () => {
    const { requests, transport } = recordingTransport();
    const values = { ...credentials };
    const source = createSource({ credentialProvider: (name) => values[name] }, transport);

    await source.executeTool("outlook__list_emails", {});
    values.OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET = "rotated-secret";
    await source.executeTool("outlook__list_emails", {});

    assertEquals(requests.filter((request) => request.url === TOKEN_URL).length, 2);
  });

  it("names every missing variable and sends no request", async () => {
    const { requests, transport } = recordingTransport();
    const source = createSource({
      credentialProvider: (name) =>
        name === "OUTLOOK_SERVICE_ACCOUNT_CLIENT_ID" ? "client-id-test" : undefined,
    }, transport);

    for (
      const operation of [
        () => source.listTools(),
        () => source.executeTool("outlook__list_emails", {}),
      ]
    ) {
      const error = await assertRejects(operation, VeryfrontError);
      assertEquals(error.slug, "local-integration-credentials-missing");
      assertStringIncludes(
        error.message,
        "OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET, OUTLOOK_SERVICE_ACCOUNT_TENANT_ID, " +
          "OUTLOOK_SERVICE_ACCOUNT_MAILBOX",
      );
    }
    assertEquals(requests.length, 0);
  });

  it("rejects an invalid tenant or mailbox by variable name", async () => {
    for (
      const [name, value] of [
        ["OUTLOOK_SERVICE_ACCOUNT_TENANT_ID", "common"],
        ["OUTLOOK_SERVICE_ACCOUNT_TENANT_ID", "tenant/../other"],
        ["OUTLOOK_SERVICE_ACCOUNT_MAILBOX", ".."],
        ["OUTLOOK_SERVICE_ACCOUNT_MAILBOX", "not a mailbox"],
      ]
    ) {
      const { requests, transport } = recordingTransport();
      const source = createSource({
        credentialProvider: (key) => key === name ? value : credentials[key],
      }, transport);
      const error = await assertRejects(
        () => source.executeTool("outlook__list_emails", {}),
        VeryfrontError,
      );
      assertEquals(error.slug, "local-integration-config-invalid");
      assertStringIncludes(error.message, name!);
      assertEquals(requests.length, 0);
    }
  });

  it("lists granted tools without contacting Microsoft", async () => {
    const { requests, transport } = recordingTransport();
    const source = createSource({
      allowedTools: ["outlook__list_emails", "outlook__get_attachment"],
    }, transport);

    const definitions = await source.listTools();

    assertEquals(definitions.map((definition) => definition.name), [
      "outlook__list_emails",
      "outlook__get_attachment",
    ]);
    assertEquals(requests.length, 0);
    assertNoSecrets(JSON.stringify(definitions));
  });

  it("does not grant a write tool unless writes are explicitly allowed", async () => {
    const error = assertThrows(
      () => createSource({ allowedTools: ["outlook__move_email"] }),
      VeryfrontError,
    );
    assertEquals(error.slug, "local-integration-config-invalid");
    assertStringIncludes(error.message, "allowWrites");

    const { requests, transport } = recordingTransport();
    const source = createSource(
      { allowedTools: ["outlook__move_email"], allowWrites: true },
      transport,
    );
    await source.executeTool("outlook__move_email", {
      messageId: "message-1",
      destinationId: "archive",
    });
    assertEquals(requests[1]!.method, "POST");
    assertEquals(requests[1]!.url, `${MAILBOX_PATH}/messages/message-1/move`);
  });

  it("rejects tools that let the caller choose another mailbox", () => {
    const error = assertThrows(
      () => createSource({ allowedTools: ["outlook__list_shared_mailbox_emails"] }),
      VeryfrontError,
    );
    assertStringIncludes(error.message, "configured mailbox");
  });

  it("rejects tools whose Graph operation is delegated-only", () => {
    const error = assertThrows(
      () => createSource({ allowedTools: ["outlook__find_meeting_times"] }),
      VeryfrontError,
    );
    assertStringIncludes(error.message, "requires delegated access");
  });

  it("rejects unknown, non-Outlook and duplicate tools", () => {
    for (
      const allowedTools of [
        [],
        ["outlook__does_not_exist"],
        ["slack__list_channels"],
        ["outlook__list_emails", "outlook__list_emails"],
      ]
    ) {
      assertThrows(() => createSource({ allowedTools }), VeryfrontError);
    }
  });

  it("keeps token and secret values out of errors", async () => {
    const transport: LocalIntegrationEndpointTransport = (request) =>
      Promise.resolve(
        request.url.origin === "https://login.microsoftonline.com"
          ? Response.json({ token_type: "Bearer", access_token: ACCESS_TOKEN, expires_in: 3599 })
          : new Response(`denied ${ACCESS_TOKEN}`, { status: 403 }),
      );
    const source = createSource({}, transport);

    const error = await assertRejects(
      () => source.executeTool("outlook__list_emails", {}),
      VeryfrontError,
    );
    assertStringIncludes(error.message, "403");
    assertNoSecrets(error.message);
  });

  it("is exported with a public factory", () => {
    assertEquals(typeof createOutlookServiceAccountToolSource, "function");
  });

  it("keeps the delegated catalog connector out of the local catalog source", () => {
    const error = assertThrows(
      () => createLocalIntegrationToolSource({ tools: ["outlook__list_emails"] }),
      VeryfrontError,
    );
    assertStringIncludes(error.message, "unsupported authorization-code credentials");
  });
});
