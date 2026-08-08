import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "@std/testing/bdd";
import { CspReportHandler } from "./csp-report.handler.ts";
import { CSP_REPORT_PATH } from "#veryfront/security/http/csp-report-endpoint.ts";
import type { HandlerContext } from "../types.ts";

const ctx = { projectSlug: "acme" } as HandlerContext;

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request(`https://acme.veryfront.com${CSP_REPORT_PATH}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

async function statusOf(req: Request): Promise<number | undefined> {
  const result = await new CspReportHandler().handle(req, ctx);
  return result.response?.status;
}

describe("server/handlers/request/csp-report", () => {
  it("accepts the legacy application/csp-report body", async () => {
    assertEquals(
      await statusOf(post({
        "csp-report": {
          "document-uri": "https://acme.veryfront.com/",
          "violated-directive": "img-src",
          "blocked-uri": "https://images.example.com/logo.png",
        },
      })),
      204,
    );
  });

  it("accepts the Reporting API array body", async () => {
    assertEquals(
      await statusOf(post([{
        type: "csp-violation",
        body: {
          documentURL: "https://acme.veryfront.com/",
          effectiveDirective: "img-src",
          blockedURL: "https://images.example.com/logo.png",
        },
      }])),
      204,
    );
  });

  it("answers 204 for a body it cannot use", async () => {
    // A browser can do nothing with an error and a hostile poster should learn
    // nothing from one, so malformed input is accepted and dropped, not refused.
    for (const body of ["not json at all", "", "[]", '{"unrelated":true}', "null"]) {
      assertEquals(await statusOf(post(body)), 204, `body ${JSON.stringify(body)}`);
    }
  });

  it("stops reading an oversized body instead of buffering it whole", async () => {
    // The cap has to hold without a truthful content-length, or it is advisory:
    // a streamed body with no declared length would already be in memory by the
    // time a length check could reject it. Count what the handler actually
    // pulled off the stream.
    let bytesPulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(8 * 1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        bytesPulled += chunk.byteLength;
        // Far past the 64 KiB cap; a handler that drains this reads all of it.
        if (bytesPulled > 4 * 1024 * 1024) return controller.close();
        controller.enqueue(chunk);
      },
    });

    const req = new Request(`https://acme.veryfront.com${CSP_REPORT_PATH}`, {
      method: "POST",
      body,
      // @ts-expect-error duplex is required for a streaming body and is not in the DOM types
      duplex: "half",
    });

    assertEquals((await new CspReportHandler().handle(req, ctx)).response?.status, 204);
    assert(
      bytesPulled <= 128 * 1024,
      `handler pulled ${bytesPulled} bytes; the cap should have stopped it near 64 KiB`,
    );
  });

  it("rejects an oversized body declared up front", async () => {
    const huge = JSON.stringify({ "csp-report": { "document-uri": "x".repeat(200_000) } });
    assertEquals(await statusOf(post(huge)), 204);
  });

  it("does not claim requests that are not a POST to its path", async () => {
    const handler = new CspReportHandler();

    const wrongMethod = await handler.handle(
      new Request(`https://acme.veryfront.com${CSP_REPORT_PATH}`, { method: "GET" }),
      ctx,
    );
    assertEquals(wrongMethod.response, undefined);

    const wrongPath = await handler.handle(
      new Request("https://acme.veryfront.com/", { method: "POST", body: "{}" }),
      ctx,
    );
    assertEquals(wrongPath.response, undefined);
  });

  it("keeps answering 204 past the log ceiling", async () => {
    // The ceiling bounds how much a single misconfigured project can write to
    // the log. It must not turn into backpressure on the browser.
    const handler = new CspReportHandler();
    const report = { "csp-report": { "document-uri": "https://acme.veryfront.com/" } };

    for (let i = 0; i < 250; i += 1) {
      const result = await handler.handle(post(report), ctx);
      assertEquals(result.response?.status, 204);
    }
  });
});
