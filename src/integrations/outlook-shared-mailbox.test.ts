import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { connectors } from "./_data.ts";
import type { IntegrationToolMeta } from "./schema.ts";
import {
  executeLocalIntegrationEndpoint,
  type LocalIntegrationEndpointTransport,
  type LocalIntegrationEndpointTransportRequest,
} from "./local-endpoint-executor.ts";

type IntegrationEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;

const SECRET = "LOCAL_ENDPOINT_SECRET_MUST_NOT_LEAK";

function outlookEndpoint(toolId: string): IntegrationEndpoint {
  const tool = connectors.find((connector) => connector.name === "outlook")?.tools.find(
    (item) => item.id === `outlook__${toolId}`,
  );
  assert(tool?.endpoint, `Expected outlook__${toolId} to have an endpoint`);
  return tool.endpoint;
}

describe("Outlook shared-mailbox catalog routes", () => {
  const graph = "https://graph.microsoft.com";
  const mailbox = "shared@example.test";
  const messageId = "AAMk/a+b= c";
  const attachmentId = "AAMk/att+1=";
  const encodedMessage = "/v1.0/users/shared%40example.test/messages/AAMk%2Fa%2Bb%3D%20c";

  function recordingTransport(requests: LocalIntegrationEndpointTransportRequest[]) {
    const transport: LocalIntegrationEndpointTransport = (request) => {
      requests.push(request);
      return Promise.resolve(Response.json({ id: "result", value: [] }));
    };
    return transport;
  }

  it("sends every message, attachment, folder, and move route to the selected mailbox", async () => {
    const cases: Array<{
      toolId: string;
      args: Record<string, unknown>;
      method: string;
      path: string;
      body?: string;
    }> = [
      {
        toolId: "get_shared_mailbox_email",
        args: { mailbox, messageId },
        method: "GET",
        path: encodedMessage,
      },
      {
        toolId: "list_shared_mailbox_folders",
        args: { mailbox },
        method: "GET",
        path: "/v1.0/users/shared%40example.test/mailFolders",
      },
      {
        toolId: "list_shared_mailbox_child_folders",
        args: { mailbox, folderId: "AAMk/inbox+1=" },
        method: "GET",
        path: "/v1.0/users/shared%40example.test/mailFolders/AAMk%2Finbox%2B1%3D/childFolders",
      },
      {
        toolId: "list_shared_mailbox_attachments",
        args: { mailbox, messageId },
        method: "GET",
        path: `${encodedMessage}/attachments`,
      },
      {
        toolId: "get_shared_mailbox_attachment",
        args: { mailbox, messageId, attachmentId },
        method: "GET",
        path: `${encodedMessage}/attachments/AAMk%2Fatt%2B1%3D`,
      },
      {
        toolId: "move_shared_mailbox_email",
        args: { mailbox, messageId, destinationId: "AAMk/folder+1=" },
        method: "POST",
        path: `${encodedMessage}/move`,
        body: '{"destinationId":"AAMk/folder+1="}',
      },
    ];

    for (const testCase of cases) {
      const requests: LocalIntegrationEndpointTransportRequest[] = [];
      await executeLocalIntegrationEndpoint({
        connectorName: "outlook",
        toolId: `outlook__${testCase.toolId}`,
        endpoint: outlookEndpoint(testCase.toolId),
        args: testCase.toolId.includes("folders")
          ? testCase.args
          : { ...testCase.args, prefer: 'IdType="ImmutableId"' },
        authHeaders: { Authorization: `Bearer ${SECRET}` },
        allowedOrigin: graph,
        transport: recordingTransport(requests),
      });

      assertEquals(requests.length, 1, testCase.toolId);
      const request = requests[0]!;
      assertEquals(request.url.origin, graph, testCase.toolId);
      assertEquals(request.url.pathname, testCase.path, testCase.toolId);
      assertEquals(request.url.pathname.includes("/me/"), false, testCase.toolId);
      assertEquals(request.init.method, testCase.method, testCase.toolId);
      assertEquals(request.init.body, testCase.body, testCase.toolId);
      assertEquals(
        new Headers(request.init.headers).get("prefer"),
        testCase.toolId.includes("folders") ? null : 'IdType="ImmutableId"',
        testCase.toolId,
      );
    }
  });

  it("rejects a missing or dot-segment mailbox and a foreign Prefer value before any request", async () => {
    const requests: LocalIntegrationEndpointTransportRequest[] = [];
    const attempts: Array<{ toolId: string; args: Record<string, unknown> }> = [];
    for (
      const toolId of [
        "get_shared_mailbox_email",
        "list_shared_mailbox_folders",
        "list_shared_mailbox_child_folders",
        "list_shared_mailbox_attachments",
        "get_shared_mailbox_attachment",
        "move_shared_mailbox_email",
      ]
    ) {
      const base = { messageId, attachmentId, folderId: "inbox", destinationId: "archive" };
      const declared = outlookEndpoint(toolId);
      const known = (args: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(args).filter(([name]) =>
            name in (declared.params ?? {}) || name in (declared.body ?? {})
          ),
        );
      attempts.push({ toolId, args: known(base) });
      for (const traversal of ["..", ".", ""]) {
        attempts.push({ toolId, args: known({ ...base, mailbox: traversal }) });
      }
      if (declared.params?.prefer) {
        attempts.push({
          toolId,
          args: known({ ...base, mailbox, prefer: 'IdType="RestId", odata.maxpagesize=1' }),
        });
      }
    }

    for (const attempt of attempts) {
      const error = await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            connectorName: "outlook",
            toolId: `outlook__${attempt.toolId}`,
            endpoint: outlookEndpoint(attempt.toolId),
            args: attempt.args,
            authHeaders: { Authorization: `Bearer ${SECRET}` },
            allowedOrigin: graph,
            transport: recordingTransport(requests),
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-request-invalid", attempt.toolId);
      assertEquals(error.message.includes(SECRET), false);
    }

    assertEquals(requests, []);
  });

  it("lists attachment metadata without file contents", async () => {
    const requests: LocalIntegrationEndpointTransportRequest[] = [];
    await executeLocalIntegrationEndpoint({
      connectorName: "outlook",
      toolId: "outlook__list_shared_mailbox_attachments",
      endpoint: outlookEndpoint("list_shared_mailbox_attachments"),
      args: { mailbox, messageId },
      authHeaders: { Authorization: `Bearer ${SECRET}` },
      allowedOrigin: graph,
      transport: recordingTransport(requests),
    });

    const select = requests[0]?.url.searchParams.get("$select")?.split(",") ?? [];
    for (const field of ["id", "name", "contentType", "size", "isInline"]) {
      assert(select.includes(field), field);
    }
    assertEquals(select.includes("contentBytes"), false);
  });

  it("expands an attached item only on request and only as the item attachment", async () => {
    const requests: LocalIntegrationEndpointTransportRequest[] = [];
    const run = (args: Record<string, unknown>) =>
      executeLocalIntegrationEndpoint({
        connectorName: "outlook",
        toolId: "outlook__get_shared_mailbox_attachment",
        endpoint: outlookEndpoint("get_shared_mailbox_attachment"),
        args: { mailbox, messageId, attachmentId, ...args },
        authHeaders: { Authorization: `Bearer ${SECRET}` },
        allowedOrigin: graph,
        transport: recordingTransport(requests),
      });

    await run({});
    await run({ $expand: "microsoft.graph.itemattachment/item" });
    assertEquals(requests[0]?.url.searchParams.has("$expand"), false);
    assertEquals(
      requests[1]?.url.searchParams.get("$expand"),
      "microsoft.graph.itemattachment/item",
    );

    await assertRejects(
      () => run({ $expand: "microsoft.graph.message/attachments" }),
      VeryfrontError,
    );
    assertEquals(requests.length, 2);
  });

  it("reports a completed move as succeeded when Graph returns an oversized message", async () => {
    for (
      const [toolId, args] of [
        ["move_email", { messageId, destinationId: "archive" }],
        ["move_shared_mailbox_email", { mailbox, messageId, destinationId: "archive" }],
      ] as const
    ) {
      let attempts = 0;
      const result = await executeLocalIntegrationEndpoint({
        connectorName: "outlook",
        toolId: `outlook__${toolId}`,
        endpoint: outlookEndpoint(toolId),
        args,
        authHeaders: { Authorization: `Bearer ${SECRET}` },
        allowedOrigin: graph,
        transport: () => {
          attempts += 1;
          const body = { id: "moved", body: { content: "x".repeat(4 * 1024 * 1024) } };
          return Promise.resolve(Response.json(body, { status: 201 }));
        },
      });

      assertEquals(result, { success: true, status: 201, response_omitted: "too_large" }, toolId);
      assertEquals(attempts, 1, toolId);
    }
  });

  it("returns the next-page link from $skip-paged lists and accepts it as $skip", async () => {
    const window = { startDateTime: "2026-01-01T00:00:00Z", endDateTime: "2026-02-01T00:00:00Z" };
    for (
      const [toolId, args] of [
        ["list_folders", {}],
        ["list_shared_mailbox_folders", { mailbox }],
        ["list_shared_mailbox_child_folders", { mailbox, folderId: "inbox" }],
        ["list_emails", {}],
        ["list_drafts", {}],
        ["list_threads", {}],
        ["list_conversation_messages", { conversationId: "conversation-1" }],
        ["list_shared_mailbox_emails", { mailbox }],
        ["list_calendars", {}],
        ["list_events", { calendarId: "calendar-1" }],
        ["list_calendar_view", window],
        ["get_event_instances", { eventId: "event-1", ...window }],
      ] as const
    ) {
      const requests: LocalIntegrationEndpointTransportRequest[] = [];
      const nextLink = `${graph}/v1.0/me/mailFolders?%24skip=2`;
      const result = await executeLocalIntegrationEndpoint({
        connectorName: "outlook",
        toolId: `outlook__${toolId}`,
        endpoint: outlookEndpoint(toolId),
        args: { ...args, $top: 2, $skip: 2 },
        authHeaders: { Authorization: `Bearer ${SECRET}` },
        allowedOrigin: graph,
        transport: (request) => {
          requests.push(request);
          return Promise.resolve(Response.json({
            value: [{ id: "item-1" }, { id: "item-2" }],
            "@odata.nextLink": nextLink,
          }));
        },
      });

      assertEquals(requests[0]?.url.searchParams.get("$skip"), "2", toolId);
      assertEquals(
        result,
        { value: [{ id: "item-1" }, { id: "item-2" }], "@odata.nextLink": nextLink },
        toolId,
      );
    }
  });

  it("returns the next-page link from searches and accepts it as $skiptoken", async () => {
    for (
      const [toolId, args] of [
        ["search_emails", { query: "invoice" }],
        ["search_shared_mailbox_emails", { mailbox, query: "invoice" }],
      ] as const
    ) {
      const requests: LocalIntegrationEndpointTransportRequest[] = [];
      const nextLink =
        `${graph}/v1.0/me/messages?%24search=%22invoice%22&%24top=2&%24skiptoken=page-2`;
      const result = await executeLocalIntegrationEndpoint({
        connectorName: "outlook",
        toolId: `outlook__${toolId}`,
        endpoint: outlookEndpoint(toolId),
        args: { ...args, $top: 2, $skiptoken: "page-2" },
        authHeaders: { Authorization: `Bearer ${SECRET}` },
        allowedOrigin: graph,
        transport: (request) => {
          requests.push(request);
          return Promise.resolve(Response.json({
            value: [{ id: "item-1" }, { id: "item-2" }],
            "@odata.nextLink": nextLink,
          }));
        },
      });

      assertEquals(requests[0]?.url.searchParams.get("$skiptoken"), "page-2", toolId);
      assertEquals(requests[0]?.url.searchParams.get("$search"), '"invoice"', toolId);
      assertEquals(
        result,
        { value: [{ id: "item-1" }, { id: "item-2" }], "@odata.nextLink": nextLink },
        toolId,
      );

      // A still-encoded token would be encoded twice and silently miss the next page.
      await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            connectorName: "outlook",
            toolId: `outlook__${toolId}`,
            endpoint: outlookEndpoint(toolId),
            args: { ...args, $skiptoken: "page%3D2" },
            authHeaders: { Authorization: `Bearer ${SECRET}` },
            allowedOrigin: graph,
            transport: () => Promise.reject(new Error("must not send")),
          }),
        VeryfrontError,
        "does not match its allowed pattern",
      );
    }
  });

  it("sends a failed shared-mailbox move exactly once", async () => {
    for (
      const respond of [
        () => Promise.resolve(new Response("unavailable", { status: 503 })),
        () => Promise.reject(new TypeError("connection reset")),
      ]
    ) {
      let attempts = 0;
      const error = await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            connectorName: "outlook",
            toolId: "outlook__move_shared_mailbox_email",
            endpoint: outlookEndpoint("move_shared_mailbox_email"),
            args: { mailbox, messageId, destinationId: "archive" },
            authHeaders: { Authorization: `Bearer ${SECRET}` },
            allowedOrigin: graph,
            transport: () => {
              attempts += 1;
              return respond();
            },
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-request-failed");
      assertEquals(attempts, 1);
    }
  });
});
