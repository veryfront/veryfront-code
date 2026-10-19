import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { planFileParts } from "#veryfront/llm/file.ts";
import { MAX_INTEGRATION_FILE_DOWNLOAD_BYTES } from "./limits.ts";
import type { LocalIntegrationEndpointTransport } from "./local-endpoint-executor.ts";
import {
  _createOutlookServiceAccountToolSourceForTesting,
  type OutlookServiceAccountToolSourceOptions,
} from "./outlook-service-account.ts";

const MAILBOX_PATH = "https://graph.microsoft.com/v1.0/users/intake%40example.test";
const credentials: Record<string, string> = {
  OUTLOOK_SERVICE_ACCOUNT_CLIENT_ID: "client-id-test",
  OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET: "outlook-client-secret-must-not-leak",
  OUTLOOK_SERVICE_ACCOUNT_TENANT_ID: "tenant-test.example.test",
  OUTLOOK_SERVICE_ACCOUNT_MAILBOX: "intake@example.test",
};

/** Synthetic bytes that are not valid UTF-8, so any text decoding would change them. */
function syntheticPdf(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index++) bytes[index] = (index * 131 + 7) & 0xff;
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0xfe, 0x80]);
  return bytes;
}

function graphTransport(
  body: () => Response,
): { urls: string[]; headers: Headers[]; transport: LocalIntegrationEndpointTransport } {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const transport: LocalIntegrationEndpointTransport = (request) => {
    if (request.url.origin === "https://login.microsoftonline.com") {
      return Promise.resolve(Response.json({
        token_type: "Bearer",
        access_token: "graph-access-token",
        expires_in: 3599,
      }));
    }
    urls.push(request.url.href);
    headers.push(new Headers(request.init.headers));
    return Promise.resolve(body());
  };
  return { urls, headers, transport };
}

function createSource(
  transport: LocalIntegrationEndpointTransport,
  options: Partial<OutlookServiceAccountToolSourceOptions> = {},
) {
  return _createOutlookServiceAccountToolSourceForTesting(
    {
      allowedTools: ["outlook__get_shared_mailbox_attachment"],
      credentialProvider: (name) => credentials[name],
      ...options,
    },
    transport,
  );
}

async function rejectsAsLocalIntegrationError(
  promise: Promise<unknown>,
  slug: string,
): Promise<VeryfrontError> {
  const error = await assertRejects(() => promise);
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.slug, slug);
  return error;
}

describe("Outlook service-account attachment content", () => {
  it("reads a 5 MiB attachment byte-exact from /$value for planFileParts", async () => {
    const pdf = syntheticPdf(5 * 1024 * 1024);
    const graph = graphTransport(() =>
      new Response(pdf, { headers: { "content-type": "application/pdf" } })
    );
    const source = createSource(graph.transport);

    const content = await source.readAttachment({
      messageId: "AAMk/a+b=",
      attachmentId: "AAMk/att=",
    });

    assertEquals(graph.urls, [
      `${MAILBOX_PATH}/messages/AAMk%2Fa%2Bb%3D/attachments/AAMk%2Fatt%3D/$value`,
    ]);
    assertEquals(graph.headers[0]?.get("authorization"), "Bearer graph-access-token");
    assertEquals(content.size, pdf.byteLength);
    assertEquals(content.contentType, "application/pdf");
    assertEquals(content.bytes, pdf);

    const plan = planFileParts({
      files: [{ bytes: content.bytes, filename: "report.pdf", mediaType: content.contentType }],
    });
    assertEquals(plan.complete, true);
    assertEquals(plan.parts[0]?.mediaType, "application/pdf");
  });

  it("accepts the immutable-ID preference and the /me attachment grant", async () => {
    const graph = graphTransport(() => new Response(new Uint8Array([1, 2, 3])));
    const source = createSource(graph.transport, { allowedTools: ["outlook__get_attachment"] });

    const content = await source.readAttachment({
      messageId: "m1",
      attachmentId: "a1",
      prefer: 'IdType="ImmutableId"',
    });

    assertEquals(graph.urls, [`${MAILBOX_PATH}/messages/m1/attachments/a1/$value`]);
    assertEquals(graph.headers[0]?.get("prefer"), 'IdType="ImmutableId"');
    assertEquals(content.bytes, new Uint8Array([1, 2, 3]));
    assertEquals(content.contentType, "application/octet-stream");
  });

  it("fails explicitly, never truncated, when an attachment is over the download limit", async () => {
    const tooLarge = MAX_INTEGRATION_FILE_DOWNLOAD_BYTES + 1;
    for (const declared of [true, false]) {
      const graph = graphTransport(() =>
        new Response(
          new Uint8Array(tooLarge),
          declared ? { headers: { "content-length": String(tooLarge) } } : undefined,
        )
      );
      const error = await rejectsAsLocalIntegrationError(
        createSource(graph.transport).readAttachment({ messageId: "m1", attachmentId: "a1" }),
        "local-integration-response-invalid",
      );
      assertStringIncludes(error.message, `larger than ${MAX_INTEGRATION_FILE_DOWNLOAD_BYTES}`);
    }
  });

  it("requires an attachment tool grant before any request", async () => {
    const graph = graphTransport(() => new Response(new Uint8Array([1])));
    const source = createSource(graph.transport, { allowedTools: ["outlook__list_emails"] });

    await rejectsAsLocalIntegrationError(
      source.readAttachment({ messageId: "m1", attachmentId: "a1" }),
      "local-integration-config-invalid",
    );
    assertEquals(graph.urls, []);
  });

  it("rejects undeclared or missing arguments before any request", async () => {
    const graph = graphTransport(() => new Response(new Uint8Array([1])));
    const source = createSource(graph.transport);

    for (
      const args of [
        { messageId: "m1", attachmentId: "a1", mailbox: "other@example.test" },
        { messageId: "m1", attachmentId: "a1", $expand: "microsoft.graph.itemattachment/item" },
        { messageId: "m1" },
      ]
    ) {
      await rejectsAsLocalIntegrationError(
        source.readAttachment(args as never),
        "local-integration-request-invalid",
      );
    }
    assertEquals(graph.urls, []);
  });
});
