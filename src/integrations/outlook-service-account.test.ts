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
import type { IntegrationToolMeta } from "./schema.ts";
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
  options: {
    /** `null` omits `expires_in` from the token response. */
    expiresIn?: number | null;
    tokens?: string[];
    /** Graph status for a request carrying the given Authorization header. */
    graphStatus?: (authorization: string | null) => number;
  } = {},
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
        ...(options.expiresIn === null ? {} : { expires_in: options.expiresIn ?? 3599 }),
      }));
    }
    const status = options.graphStatus?.(new Headers(request.init.headers).get("authorization"));
    if (status !== undefined && status !== 200) {
      return Promise.resolve(Response.json({ error: { code: "denied" } }, { status }));
    }
    return Promise.resolve(Response.json({ value: [{ id: "message-1" }] }));
  };
  return { requests, transport };
}

function createSource(
  options: Partial<OutlookServiceAccountToolSourceOptions> = {},
  transport: LocalIntegrationEndpointTransport = recordingTransport().transport,
  now?: () => number,
  catalog?: readonly IntegrationToolMeta[],
) {
  return _createOutlookServiceAccountToolSourceForTesting(
    {
      allowedTools: ["outlook__list_emails"],
      credentialProvider: (name) => credentials[name],
      ...options,
    },
    transport,
    now,
    catalog,
  );
}

const MAILBOX_PARAM = {
  type: "string",
  in: "path",
  description: "Mailbox user principal name or Microsoft Graph user ID",
  required: true,
} as const;
const PREFER_PARAM = {
  type: "string",
  in: "header",
  headerName: "Prefer",
  pattern: '^IdType="ImmutableId"$',
  description: "Immutable ID preference",
} as const;
const MESSAGE_ID_PARAM = {
  type: "string",
  in: "path",
  description: "Message ID",
  required: true,
} as const;

/** Synthetic `/users/{mailbox}` catalog entries shaped like delegated shared-mailbox tools. */
const SHARED_MAILBOX_CATALOG: IntegrationToolMeta[] = [
  {
    id: "outlook__synthetic_child_folders",
    name: "Synthetic Child Folders",
    description: "List child folders",
    requiresWrite: false,
    endpoint: {
      method: "GET",
      url: "https://graph.microsoft.com/v1.0/users/{mailbox}/mailFolders/{folderId}/childFolders",
      params: {
        mailbox: MAILBOX_PARAM,
        folderId: { type: "string", in: "path", description: "Folder ID", required: true },
      },
      response: { transform: "value" },
    },
  },
  {
    id: "outlook__synthetic_message_mime",
    name: "Synthetic Message MIME",
    description: "Read original MIME",
    requiresWrite: false,
    endpoint: {
      method: "GET",
      url: "https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{messageId}/$value",
      params: { mailbox: MAILBOX_PARAM, messageId: MESSAGE_ID_PARAM, prefer: PREFER_PARAM },
      // Binary response mode as declared by a catalog that supports it.
      response: { encoding: "base64" } as NonNullable<
        NonNullable<IntegrationToolMeta["endpoint"]>["response"]
      >,
    },
  },
  {
    id: "outlook__synthetic_move",
    name: "Synthetic Move",
    description: "Move a message",
    requiresWrite: true,
    endpoint: {
      method: "POST",
      url: "https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{messageId}/move",
      params: { mailbox: MAILBOX_PARAM, messageId: MESSAGE_ID_PARAM, prefer: PREFER_PARAM },
      body: { destinationId: { type: "string", description: "Folder ID", required: true } },
    },
  },
  {
    id: "outlook__synthetic_query_mailbox",
    name: "Synthetic Query Mailbox",
    description: "Mailbox given as a query parameter",
    requiresWrite: false,
    endpoint: {
      method: "GET",
      url: "https://graph.microsoft.com/v1.0/users/{mailbox}/messages",
      params: { mailbox: { ...MAILBOX_PARAM, in: "query" } },
    },
  },
  {
    id: "outlook__synthetic_second_mailbox",
    name: "Synthetic Second Mailbox",
    description: "Names the mailbox twice",
    requiresWrite: false,
    endpoint: {
      method: "GET",
      url: "https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{mailbox}",
      params: { mailbox: MAILBOX_PARAM },
    },
  },
  {
    id: "outlook__synthetic_user_id",
    name: "Synthetic User ID",
    description: "Mailbox under another parameter name",
    requiresWrite: false,
    endpoint: {
      method: "GET",
      url: "https://graph.microsoft.com/v1.0/users/{userId}/messages",
      params: { userId: MAILBOX_PARAM },
    },
  },
];

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
    for (
      const toolName of [
        // getSchedule reads free/busy for the addresses in its `schedules` body.
        "outlook__get_schedule",
        "outlook__find_free_time",
      ]
    ) {
      const error = assertThrows(
        () => createSource({ allowedTools: [toolName] }),
        VeryfrontError,
      );
      assertStringIncludes(error.message, "configured mailbox", toolName);
    }
  });

  it("binds a /users/{mailbox} catalog tool to the configured mailbox", async () => {
    const { requests, transport } = recordingTransport();
    const source = createSource({
      allowedTools: [
        "outlook__list_shared_mailbox_emails",
        "outlook__search_shared_mailbox_emails",
      ],
    }, transport);

    // The mailbox is not a caller input.
    for (const definition of await source.listTools()) {
      const properties = (definition.parameters as { properties: Record<string, unknown> })
        .properties;
      assertEquals("mailbox" in properties, false, definition.name);
    }

    await source.executeTool("outlook__list_shared_mailbox_emails", { folderId: "inbox" });
    await source.executeTool("outlook__search_shared_mailbox_emails", { query: "invoice" });
    assertEquals(requests.length, 3);
    assert(requests[1]!.url.startsWith(`${MAILBOX_PATH}/mailFolders/inbox/messages?`));
    assert(requests[2]!.url.startsWith(`${MAILBOX_PATH}/messages?`));
  });

  it("refuses a caller-chosen mailbox before any request", async () => {
    const { requests, transport } = recordingTransport();
    const source = createSource(
      { allowedTools: ["outlook__list_shared_mailbox_emails"] },
      transport,
    );

    await assertRejects(
      () =>
        source.executeTool("outlook__list_shared_mailbox_emails", {
          mailbox: "other@example.test",
          folderId: "inbox",
        }),
      VeryfrontError,
    );
    assertEquals(requests.length, 0);
  });

  it("serves child folders, original MIME and the declared Prefer header", async () => {
    const { requests, transport } = recordingTransport();
    const source = createSource(
      {
        allowedTools: ["outlook__synthetic_child_folders", "outlook__synthetic_message_mime"],
      },
      transport,
      undefined,
      SHARED_MAILBOX_CATALOG,
    );

    await source.executeTool("outlook__synthetic_child_folders", { folderId: "inbox" });
    await source.executeTool("outlook__synthetic_message_mime", {
      messageId: "message-1",
      prefer: 'IdType="ImmutableId"',
    });

    assertEquals(requests.map((request) => request.url), [
      TOKEN_URL,
      `${MAILBOX_PATH}/mailFolders/inbox/childFolders`,
      `${MAILBOX_PATH}/messages/message-1/$value`,
    ]);
    assertEquals(requests[2]!.method, "GET");
    assertEquals(requests[2]!.headers.get("prefer"), 'IdType="ImmutableId"');
    assertEquals(requests[2]!.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
  });

  it("keeps a /users/{mailbox} write tool absent unless writes are allowed", async () => {
    const error = assertThrows(
      () =>
        createSource(
          { allowedTools: ["outlook__synthetic_move"] },
          undefined,
          undefined,
          SHARED_MAILBOX_CATALOG,
        ),
      VeryfrontError,
    );
    assertStringIncludes(error.message, "allowWrites");

    const { requests, transport } = recordingTransport();
    const source = createSource(
      { allowedTools: ["outlook__synthetic_move"], allowWrites: true },
      transport,
      undefined,
      SHARED_MAILBOX_CATALOG,
    );
    await source.executeTool("outlook__synthetic_move", {
      messageId: "message-1",
      destinationId: "archive",
      prefer: 'IdType="ImmutableId"',
    });
    assertEquals(requests[1]!.method, "POST");
    assertEquals(requests[1]!.url, `${MAILBOX_PATH}/messages/message-1/move`);
    assertEquals(requests[1]!.headers.get("prefer"), 'IdType="ImmutableId"');
  });

  it("rejects /users tools whose mailbox is not a single path parameter", () => {
    for (
      const toolName of [
        "outlook__synthetic_query_mailbox",
        "outlook__synthetic_second_mailbox",
        "outlook__synthetic_user_id",
      ]
    ) {
      const error = assertThrows(
        () =>
          createSource({ allowedTools: [toolName] }, undefined, undefined, SHARED_MAILBOX_CATALOG),
        VeryfrontError,
      );
      assertStringIncludes(error.message, "configured mailbox", toolName);
    }
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

  it("shares one token request between concurrent cold-cache calls", async () => {
    const { requests, transport } = recordingTransport();
    const source = createSource({}, transport);

    await Promise.all(
      Array.from({ length: 5 }, () => source.executeTool("outlook__list_emails", {})),
    );

    assertEquals(requests.filter((request) => request.url === TOKEN_URL).length, 1);
    assertEquals(requests.length, 6);
  });

  it("does not keep a failed shared token request", async () => {
    let failToken = true;
    const { requests, transport: inner } = recordingTransport();
    const transport: LocalIntegrationEndpointTransport = (request) => {
      if (request.url.href === TOKEN_URL && failToken) {
        failToken = false;
        requests.push({ url: TOKEN_URL, method: "POST", headers: new Headers(), body: undefined });
        return Promise.resolve(new Response("unavailable", { status: 503 }));
      }
      return inner(request);
    };
    const source = createSource({}, transport);

    const results = await Promise.allSettled([
      source.executeTool("outlook__list_emails", {}),
      source.executeTool("outlook__list_emails", {}),
    ]);
    assertEquals(results.map((result) => result.status), ["rejected", "rejected"]);
    await source.executeTool("outlook__list_emails", {});

    assertEquals(requests.filter((request) => request.url === TOKEN_URL).length, 2);
  });

  it("lets an aborted caller leave a shared token request without failing the others", async () => {
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((resolve) => releaseToken = resolve);
    const { requests, transport: inner } = recordingTransport();
    const transport: LocalIntegrationEndpointTransport = async (request) => {
      if (request.url.href === TOKEN_URL) await tokenGate;
      return await inner(request);
    };
    const source = createSource({}, transport);
    const controller = new AbortController();

    const aborted = source.executeTool("outlook__list_emails", {}, {
      abortSignal: controller.signal,
    });
    const other = source.executeTool("outlook__list_emails", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new DOMException("caller left", "AbortError"));
    // The aborted caller must settle while the shared token request is still open.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      aborted.then(() => "resolved", (error: unknown) => error),
      new Promise((resolve) => timer = setTimeout(() => resolve("pending"), 50)),
    ]);
    clearTimeout(timer);
    releaseToken();
    await aborted.catch(() => undefined);
    assert(settled instanceof DOMException, String(settled));
    assertEquals(settled.message, "caller left");

    assertEquals(await other, [{ id: "message-1" }]);
    assertEquals(requests.filter((request) => request.url === TOKEN_URL).length, 1);
    assertEquals(requests.length, 2);
  });

  it("sends nothing when the caller has already aborted", async () => {
    const { requests, transport } = recordingTransport();
    const source = createSource({}, transport);
    const controller = new AbortController();
    controller.abort(new DOMException("stop", "AbortError"));

    await assertRejects(
      () => source.executeTool("outlook__list_emails", {}, { abortSignal: controller.signal }),
      DOMException,
      "stop",
    );
    assertEquals(requests.length, 0);
  });

  it("clears a token Graph rejects with 401 and retries once with a new token", async () => {
    const { requests, transport } = recordingTransport({
      tokens: ["token-revoked", "token-fresh"],
      graphStatus: (authorization) => authorization === "Bearer token-revoked" ? 401 : 200,
    });
    const source = createSource({}, transport);

    assertEquals(await source.executeTool("outlook__list_emails", {}), [{ id: "message-1" }]);
    await source.executeTool("outlook__list_emails", {});

    assertEquals(
      requests.map((request) => request.headers.get("authorization") ?? request.url),
      [TOKEN_URL, "Bearer token-revoked", TOKEN_URL, "Bearer token-fresh", "Bearer token-fresh"],
    );
  });

  it("fails after one retry when Graph keeps rejecting the token", async () => {
    const { requests, transport } = recordingTransport({
      tokens: ["token-one", "token-two", "token-three"],
      graphStatus: () => 401,
    });
    const source = createSource({}, transport);

    const error = await assertRejects(
      () => source.executeTool("outlook__list_emails", {}),
      VeryfrontError,
    );
    assertEquals(error.slug, "local-integration-request-failed");
    assertStringIncludes(error.message, "401");
    assertEquals(requests.length, 4);

    // The rejected token is not reused by the next call.
    await assertRejects(() => source.executeTool("outlook__list_emails", {}), VeryfrontError);
    assertEquals(requests[4]!.url, TOKEN_URL);
  });

  it("does not retry a Graph 403", async () => {
    const { requests, transport } = recordingTransport({ graphStatus: () => 403 });
    const source = createSource({}, transport);

    await assertRejects(() => source.executeTool("outlook__list_emails", {}), VeryfrontError);
    assertEquals(requests.length, 2);
  });

  it("reports a rejected token request as a credential failure, not a tool failure", async () => {
    const requests: string[] = [];
    const transport: LocalIntegrationEndpointTransport = (request) => {
      requests.push(request.url.href);
      return Promise.resolve(
        Response.json({ error: "invalid_client", error_description: CLIENT_SECRET }, {
          status: 401,
        }),
      );
    };
    const source = createSource({}, transport);

    const error = await assertRejects(
      () => source.executeTool("outlook__list_emails", {}),
      VeryfrontError,
    );
    assertEquals(error.slug, "local-integration-request-failed");
    assertStringIncludes(error.message, "token request");
    assertStringIncludes(error.message, "OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET");
    assertStringIncludes(error.message, "401");
    assertEquals(error.message.includes("outlook__list_emails"), false, error.message);
    assertNoSecrets(error.message);
    assertEquals(requests, [TOKEN_URL]);
  });

  it("rejects malformed or non-bearer token responses before calling Graph", async () => {
    for (
      const tokenBody of [
        [],
        { token_type: "Bearer" },
        { token_type: "Bearer", access_token: "   " },
        { token_type: "mac", access_token: ACCESS_TOKEN },
        { access_token: ACCESS_TOKEN },
      ]
    ) {
      const requests: string[] = [];
      const transport: LocalIntegrationEndpointTransport = (request) => {
        requests.push(request.url.href);
        return Promise.resolve(Response.json(tokenBody));
      };
      const source = createSource({}, transport);

      const error = await assertRejects(
        () => source.executeTool("outlook__list_emails", {}),
        VeryfrontError,
      );
      assertEquals(error.slug, "local-integration-response-invalid", JSON.stringify(tokenBody));
      assertNoSecrets(error.message);
      assertEquals(requests, [TOKEN_URL]);
    }
  });

  it("does not cache a token without a usable expires_in", async () => {
    for (const expiresIn of [null, 0, 30, 60]) {
      const { requests, transport } = recordingTransport({ expiresIn });
      const source = createSource({}, transport);

      await source.executeTool("outlook__list_emails", {});
      await source.executeTool("outlook__list_emails", {});

      assertEquals(
        requests.filter((request) => request.url === TOKEN_URL).length,
        2,
        `expires_in ${expiresIn}`,
      );
    }
  });

  it("re-mints exactly 60 seconds before the token expires", async () => {
    const start = 1_000_000;
    let clock = start;
    const { requests, transport } = recordingTransport({ expiresIn: 3600 });
    const source = createSource({}, transport, () => clock);
    const mints = () => requests.filter((request) => request.url === TOKEN_URL).length;

    await source.executeTool("outlook__list_emails", {});
    clock = start + 3_540_000 - 1;
    await source.executeTool("outlook__list_emails", {});
    assertEquals(mints(), 1);
    clock = start + 3_540_000;
    await source.executeTool("outlook__list_emails", {});
    assertEquals(mints(), 2);
  });

  it("reports a throwing credential provider by variable name without a request", async () => {
    const { requests, transport } = recordingTransport();
    const source = createSource({
      credentialProvider: (name) => {
        if (name === "OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET") throw new Error(CLIENT_SECRET);
        return credentials[name];
      },
    }, transport);

    const error = await assertRejects(
      () => source.executeTool("outlook__list_emails", {}),
      VeryfrontError,
    );
    assertEquals(error.slug, "local-integration-credential-unavailable");
    assertStringIncludes(error.message, "OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET");
    assertNoSecrets(error.message);
    assertEquals(requests.length, 0);
  });

  it("rejects a non-boolean allowWrites", () => {
    const error = assertThrows(
      () =>
        createSource({
          allowedTools: ["outlook__move_email"],
          allowWrites: "true" as unknown as boolean,
        }),
      VeryfrontError,
    );
    assertStringIncludes(error.message, "allowWrites must be a boolean");
  });

  it("targets a mailbox given as an Entra user ID", async () => {
    const userId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const { requests, transport } = recordingTransport();
    const source = createSource({
      credentialProvider: (name) =>
        name === "OUTLOOK_SERVICE_ACCOUNT_MAILBOX" ? userId : credentials[name],
    }, transport);

    await source.executeTool("outlook__list_emails", {});

    assert(
      requests[1]!.url.startsWith(
        `https://graph.microsoft.com/v1.0/users/${userId}/mailFolders/inbox/messages`,
      ),
      requests[1]!.url,
    );
  });

  it("rejects a path argument that could leave the mailbox before any request", async () => {
    for (const messageId of ["../../other@example.test", "a/../b", "./a", "..", "a\\b"]) {
      const { requests, transport } = recordingTransport();
      const source = createSource({ allowedTools: ["outlook__get_email"] }, transport);

      const error = await assertRejects(
        () => source.executeTool("outlook__get_email", { messageId }),
        VeryfrontError,
      );
      assertEquals(error.slug, "local-integration-request-invalid", messageId);
      assertEquals(requests.length, 0);
    }
  });

  it("sends an Outlook ID that contains a slash as one encoded segment", async () => {
    const { requests, transport } = recordingTransport();
    const source = createSource({ allowedTools: ["outlook__get_email"] }, transport);

    await source.executeTool("outlook__get_email", { messageId: "AAMk+a/b=" });

    assert(
      requests[1]!.url.startsWith(`${MAILBOX_PATH}/messages/AAMk%2Ba%2Fb%3D?`),
      requests[1]!.url,
    );
  });

  it("returns null for an empty 202 Graph action response", async () => {
    const { requests, transport: inner } = recordingTransport();
    const transport: LocalIntegrationEndpointTransport = (request) =>
      request.url.href.endsWith("/sendMail")
        ? inner(request).then(() => new Response(null, { status: 202 }))
        : inner(request);
    const source = createSource(
      { allowedTools: ["outlook__send_email"], allowWrites: true },
      transport,
    );

    const result = await source.executeTool("outlook__send_email", {
      message: { subject: "Status", toRecipients: [] },
    });

    assertEquals(result, null);
    assertEquals(requests[1]!.url, `${MAILBOX_PATH}/sendMail`);
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
