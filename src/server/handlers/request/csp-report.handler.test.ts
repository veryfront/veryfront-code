import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createLogWindow, CspReportHandler, normalizeReports } from "./csp-report.handler.ts";
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

  it("reads the Reporting API spellings, not only the legacy ones", () => {
    // Browsers post camel-case fields under `application/reports+json`. Reading
    // only the hyphenated names loses the directive and status — the two fields
    // the enforcement decision is made from — while still answering 204, so a
    // status-only assertion cannot see the loss.
    const [violation] = normalizeReports([{
      type: "csp-violation",
      body: {
        documentURL: "https://acme.veryfront.com/pricing",
        effectiveDirective: "connect-src",
        blockedURL: "https://api.example.com/track",
        statusCode: 200,
      },
    }]);

    assertEquals(violation?.effectiveDirective, "connect-src");
    assertEquals(violation?.statusCode, 200);
    assertEquals(violation?.documentUri, "https://acme.veryfront.com/pricing");
    assertEquals(violation?.blockedUri, "https://api.example.com/track");
  });

  it("prefers effective-directive over the deprecated violated-directive", () => {
    const [violation] = normalizeReports({
      "csp-report": {
        "effective-directive": "img-src",
        "violated-directive": "default-src",
      },
    });
    assertEquals(violation?.effectiveDirective, "img-src");
  });

  it("strips control characters and query strings from fields", () => {
    // Fields come from an unauthenticated body. CR/LF would let a poster forge
    // extra log records (CWE-117), and a query string can carry session
    // identifiers that have no business in the log.
    const [violation] = normalizeReports({
      "csp-report": {
        "document-uri": "https://acme.veryfront.com/account?session=secret-token",
        "violated-directive": "img-src\r\nWARN forged log line",
        "blocked-uri": "https://cdn.example.com/a.png?sig=abc#frag",
      },
    });

    assertEquals(violation?.documentUri, "https://acme.veryfront.com/account");
    assertEquals(violation?.blockedUri, "https://cdn.example.com/a.png");
    assertEquals(violation?.effectiveDirective, "img-srcWARN forged log line");
  });

  it("caps every logged field at the documented maximum length", () => {
    // The endpoint is unauthenticated; without the cap a poster could write
    // the whole body budget into the log stream one field at a time.
    const [violation] = normalizeReports({
      "csp-report": { "violated-directive": "a".repeat(2000) },
    });

    assertEquals(
      violation?.effectiveDirective?.length,
      513,
      "a logged field must be capped at MAX_FIELD_LENGTH plus the ellipsis",
    );
    assertEquals(
      violation?.effectiveDirective?.endsWith("\u2026"),
      true,
      "a truncated field must be marked with the ellipsis",
    );
  });

  it("takes the first violations in a mixed batch rather than the first entries", () => {
    // Slicing before filtering would discard real violations queued behind
    // other report types a browser batches into the same request.
    const batch = [
      ...Array.from({ length: 20 }, () => ({ type: "deprecation", body: {} })),
      { type: "csp-violation", body: { effectiveDirective: "font-src" } },
    ];
    const violations = normalizeReports(batch);
    assertEquals(violations.length, 1);
    assertEquals(violations[0]?.effectiveDirective, "font-src");
  });

  it("charges the log window per record, not per reservation", () => {
    // A batch is up to 16 violations. Charging per request would let a sender
    // write 16x the ceiling; the endpoint is unauthenticated, so this bound is
    // the only thing protecting the log stream.
    const window = createLogWindow(100, 60_000);

    let granted = 0;
    for (let i = 0; i < 20; i += 1) granted += window.reserve(1000, 16).allowed;
    assertEquals(granted, 100, "20 requests x 16 violations must still yield 100 records");

    // A new window reopens the budget and reports what the last one swallowed.
    const next = window.reserve(1000 + 60_000, 1);
    assertEquals(next.allowed, 1);
    assertEquals(next.dropped, 220, "320 attempted, 100 written, 220 dropped");
  });

  it("counts the first record of a fresh window", () => {
    // An early return on the rollover path skipped the increment, making one
    // record per window free.
    const window = createLogWindow(1, 60_000);
    assertEquals(window.reserve(0, 1).allowed, 1);
    assertEquals(window.reserve(0, 1).allowed, 0, "ceiling of 1 must admit exactly one");
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
