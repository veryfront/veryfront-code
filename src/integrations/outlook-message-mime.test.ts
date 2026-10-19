import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  JSON_VALUE_MAX_SERIALIZED_BYTES,
  snapshotBoundedJsonValue,
} from "#veryfront/schemas/json-value.ts";
import { connectors } from "./_data.ts";
import { MAX_BINARY_CONTENT_TYPE_LENGTH, MAX_INTEGRATION_BINARY_RESPONSE_BYTES } from "./limits.ts";
import type { IntegrationToolMeta } from "./schema.ts";
import {
  executeLocalIntegrationEndpoint as executeEndpoint,
  type ExecuteLocalIntegrationEndpointOptions,
  type LocalIntegrationEndpointTransportRequest,
} from "./local-endpoint-executor.ts";

type IntegrationEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;

const SECRET = "LOCAL_ENDPOINT_SECRET_MUST_NOT_LEAK";

function endpoint(value: IntegrationEndpoint): IntegrationEndpoint {
  return value;
}

function outlookEndpoint(toolId: string): IntegrationEndpoint {
  const tool = connectors.find((connector) => connector.name === "outlook")?.tools.find(
    (item) => item.id === `outlook__${toolId}`,
  );
  assert(tool?.endpoint, `Expected outlook__${toolId} to have an endpoint`);
  return tool.endpoint;
}

function executeLocalIntegrationEndpoint(
  options:
    & Omit<ExecuteLocalIntegrationEndpointOptions, "connectorName" | "toolId">
    & Partial<Pick<ExecuteLocalIntegrationEndpointOptions, "connectorName" | "toolId">>,
): Promise<unknown> {
  return executeEndpoint({
    ...options,
    connectorName: options.connectorName ?? "example",
    toolId: options.toolId ?? "example__test",
  });
}

describe("binary endpoint responses", () => {
  const graph = "https://graph.microsoft.com";
  const mailbox = "shared@example.test";
  const messageId = "AAMk/a+b=";
  // A synthetic signed message that nests a forwarded message/rfc822 part and
  // carries bytes that are not valid UTF-8, so any text decoding changes it.
  const mime = new Uint8Array([
    ...new TextEncoder().encode(
      [
        "From: sender@example.test",
        "To: shared@example.test",
        "Subject: request",
        "MIME-Version: 1.0",
        'Content-Type: multipart/signed; protocol="application/pkcs7-signature"; boundary="s1"',
        "",
        "--s1",
        "Content-Type: message/rfc822",
        "",
        "Subject: nested",
        'Content-Type: application/pdf; name="request.pdf"',
        "Content-Transfer-Encoding: binary",
        "",
        "",
      ].join("\r\n"),
    ),
    0x25,
    0x50,
    0x44,
    0x46,
    0xff,
    0xfe,
    0x80,
    0x00,
    0xc3,
    0x28,
    ...new TextEncoder().encode(
      [
        "",
        "--s1",
        "Content-Type: application/pkcs7-signature",
        "",
        "",
      ].join("\r\n"),
    ),
    0x30,
    0x82,
    0xff,
    0x0d,
    ...new TextEncoder().encode("\r\n--s1--\r\n"),
  ]);

  function mimeEndpoint(): IntegrationEndpoint {
    return outlookEndpoint("get_shared_mailbox_email_mime");
  }

  function decodeBase64(value: string): Uint8Array {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  }

  it("returns original MIME bytes unchanged from the selected mailbox", async () => {
    const requests: LocalIntegrationEndpointTransportRequest[] = [];
    const result = await executeLocalIntegrationEndpoint({
      connectorName: "outlook",
      toolId: "outlook__get_shared_mailbox_email_mime",
      endpoint: mimeEndpoint(),
      args: { mailbox, messageId },
      authHeaders: { Authorization: `Bearer ${SECRET}` },
      allowedOrigin: graph,
      transport: (request) => {
        requests.push(request);
        return Promise.resolve(
          new Response(mime, { headers: { "content-type": "message/rfc822; charset=binary" } }),
        );
      },
    });

    assertEquals(requests.length, 1);
    assertEquals(requests[0]?.init.method, "GET");
    assertEquals(
      requests[0]?.url.href,
      "https://graph.microsoft.com/v1.0/users/shared%40example.test/messages/AAMk%2Fa%2Bb%3D/$value",
    );
    assert(result !== null && typeof result === "object");
    const binary = result as Record<string, unknown>;
    assertEquals(binary.encoding, "base64");
    assertEquals(binary.size, mime.byteLength);
    assertEquals(binary.content_type, "message/rfc822");
    assertEquals(decodeBase64(String(binary.content_base64)), mime);
  });

  function executeMime(response: () => Response): Promise<unknown> {
    return executeLocalIntegrationEndpoint({
      connectorName: "outlook",
      toolId: "outlook__get_shared_mailbox_email_mime",
      endpoint: mimeEndpoint(),
      args: { mailbox, messageId },
      authHeaders: {},
      allowedOrigin: graph,
      transport: () => Promise.resolve(response()),
    });
  }

  it("accepts a decoded body whose Content-Length counts the compressed bytes", async () => {
    // fetch decompresses a gzip body but keeps the compressed Content-Length.
    const result = await executeMime(() =>
      new Response(mime, {
        headers: { "content-encoding": "gzip", "content-length": String(mime.byteLength - 50) },
      })
    ) as Record<string, unknown>;

    assertEquals(result.size, mime.byteLength);
    assertEquals(decodeBase64(String(result.content_base64)), mime);
  });

  it("ignores the compressed Content-Length of a decoded body even above the byte limit", async () => {
    // Incompressible content grows under gzip, so its encoded length can
    // exceed the limit while the decoded body still fits.
    const body = new Uint8Array(MAX_INTEGRATION_BINARY_RESPONSE_BYTES);
    body.set(mime);
    for (const coding of ["gzip", "BR", "x-gzip", "deflate"]) {
      const result = await executeMime(() =>
        new Response(body, {
          headers: {
            "content-encoding": coding,
            "content-length": String(MAX_INTEGRATION_BINARY_RESPONSE_BYTES + 20),
          },
        })
      ) as Record<string, unknown>;
      assertEquals(result.size, body.byteLength, coding);
    }
  });

  it("returns a body over 1 MiB, up to the 4 MiB tool result bound", async () => {
    assert(MAX_INTEGRATION_BINARY_RESPONSE_BYTES >= 3 * 1024 * 1024 - 4096);
    const body = new Uint8Array(MAX_INTEGRATION_BINARY_RESPONSE_BYTES);
    body.set(mime);
    // The longest media type admitted, so the wrapper is as large as it gets.
    const contentType = `application/${"x".repeat(MAX_BINARY_CONTENT_TYPE_LENGTH - 12)}`;
    const result = await executeMime(() =>
      new Response(body, { headers: { "content-type": contentType } })
    );

    // Tool results are bounded by their whole 4 MiB size, so one string may use all of it.
    const bound = JSON_VALUE_MAX_SERIALIZED_BYTES;
    assertEquals(snapshotBoundedJsonValue(result, bound, bound).success, true);
    assertEquals((result as Record<string, unknown>).size, body.byteLength);
    assertEquals((result as Record<string, unknown>).content_type, contentType);
  });

  it("rejects a media type too long to keep the result within its bound", async () => {
    const contentType = `application/${"x".repeat(MAX_BINARY_CONTENT_TYPE_LENGTH)}`;
    const error = await assertRejects(() =>
      executeMime(() => new Response(mime, { headers: { "content-type": contentType } }))
    );
    assertInstanceOf(error, VeryfrontError);
  });

  const paddingCases: ReadonlyArray<readonly [readonly number[], string]> = [
    [[0xff], "/w=="],
    [[0xff, 0x00], "/wA="],
    [[0xfb, 0xff, 0xbf], "+/+/"],
    [[1, 2, 3, 4], "AQIDBA=="],
    [[1, 2, 3, 4, 5], "AQIDBAU="],
  ];

  it("encodes every trailing byte count with standard padding", async () => {
    for (const [body, expected] of paddingCases) {
      const bytes = new Uint8Array(body);
      const result = await executeMime(() => new Response(bytes)) as Record<string, unknown>;
      assertEquals(result.content_base64, expected, String(body));
    }
  });

  it("rejects oversized, truncated, partial, and empty bodies without exposing content", async () => {
    const maxBytes = MAX_INTEGRATION_BINARY_RESPONSE_BYTES;
    const marker = new TextEncoder().encode(`Subject: ${SECRET}\r\n\r\n`);
    const fixtures: Array<{ name: string; response: () => Response; status: number }> = [
      {
        name: "declared oversize",
        response: () =>
          new Response(marker, { headers: { "content-length": String(maxBytes + 1) } }),
        status: 200,
      },
      {
        name: "streamed oversize",
        response: () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(marker);
                controller.enqueue(new Uint8Array(maxBytes));
                controller.close();
              },
            }),
          ),
        status: 200,
      },
      {
        name: "truncated",
        response: () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(marker);
                controller.close();
              },
            }),
            { headers: { "content-length": String(marker.byteLength + 10) } },
          ),
        status: 200,
      },
      {
        name: "stream error",
        response: () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(marker);
                controller.error(new Error(SECRET));
              },
            }),
          ),
        status: 200,
      },
      {
        name: "partial content",
        response: () => new Response(marker, { status: 206 }),
        status: 206,
      },
      { name: "no content", response: () => new Response(null, { status: 204 }), status: 204 },
      { name: "empty", response: () => new Response(null, { status: 200 }), status: 200 },
      {
        name: "declared empty",
        response: () => new Response("", { headers: { "content-length": "0" } }),
        status: 200,
      },
      {
        name: "truncated with mixed-case identity coding",
        response: () =>
          new Response(marker, {
            headers: {
              "content-encoding": "Identity",
              "content-length": String(marker.byteLength + 10),
            },
          }),
        status: 200,
      },
      {
        // fetch passes a coding it does not decode through unchanged, so the
        // bytes are not the original MIME.
        name: "undecoded content coding",
        response: () =>
          new Response(marker, {
            headers: {
              "content-encoding": "x-custom",
              "content-length": String(marker.byteLength),
            },
          }),
        status: 200,
      },
    ];

    for (const fixture of fixtures) {
      const error = await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            connectorName: "outlook",
            toolId: "outlook__get_shared_mailbox_email_mime",
            endpoint: mimeEndpoint(),
            args: { mailbox, messageId },
            authHeaders: { Authorization: `Bearer ${SECRET}` },
            allowedOrigin: graph,
            transport: () => Promise.resolve(fixture.response()),
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-response-invalid", fixture.name);
      assert(error.message.includes(`HTTP status ${fixture.status}`), fixture.name);
      assertEquals(error.message.includes(SECRET), false, fixture.name);
      assertEquals(error.message.includes("example.test"), false, fixture.name);
      assertEquals(error.cause, undefined, fixture.name);
    }
  });

  it("bounds provider failures without exposing the error body", async () => {
    const response = new Response(`missing ${SECRET}`, { status: 404 });
    const error = await assertRejects(
      () =>
        executeLocalIntegrationEndpoint({
          connectorName: "outlook",
          toolId: "outlook__get_shared_mailbox_email_mime",
          endpoint: mimeEndpoint(),
          args: { mailbox, messageId },
          authHeaders: {},
          allowedOrigin: graph,
          transport: () => Promise.resolve(response),
        }),
      VeryfrontError,
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-request-failed");
    assert(error.message.includes("HTTP status 404"), error.message);
    assertEquals(error.message.includes(SECRET), false);
    assertEquals(response.bodyUsed, true);
  });

  it("allows binary responses only on GET endpoints without a transform", async () => {
    let transportCalls = 0;
    for (
      const declared of [
        endpoint({
          method: "POST",
          url: "https://api.example.test/files/export",
          response: { encoding: "base64" },
        }),
        endpoint({
          method: "GET",
          url: "https://api.example.test/files/raw",
          response: { encoding: "base64", transform: "content_base64" },
        }),
      ]
    ) {
      const error = await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            endpoint: declared,
            args: {},
            authHeaders: {},
            allowedOrigin: "https://api.example.test",
            transport: () => {
              transportCalls += 1;
              return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
            },
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-request-invalid");
    }
    assertEquals(transportCalls, 0);
  });
});
