import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CONFIG_NOT_FOUND, UNKNOWN_ERROR } from "./error-registry.ts";
import {
  createErrorHandler,
  createErrorResponse,
  createProblemResponse,
  errorToResponse,
  formatErrorLog,
  PROBLEM_JSON_CONTENT_TYPE,
} from "./http-error.ts";
import {
  ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
  ERROR_OUTPUT_MAX_LENGTH_CHARS,
} from "./safe-diagnostics.ts";
import { VeryfrontError } from "./types.ts";

describe("http-error", () => {
  it("should not expose unknown error details in a 500 response", async () => {
    const response = errorToResponse(
      new Error("postgres://admin:super-secret@db.internal/app"),
      "/api/build",
    );
    const body = await response.json();

    assertEquals(response.status, 500);
    assertEquals(response.headers.get("Content-Type"), PROBLEM_JSON_CONTENT_TYPE);
    assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
    assertEquals(body.instance, "/api/build");
    assertEquals(body.detail, undefined);
    assertEquals(JSON.stringify(body).includes("super-secret"), false);
  });

  it("should omit detail and cause from registered 5xx errors", async () => {
    const response = errorToResponse(
      UNKNOWN_ERROR.create({
        detail: "private implementation detail",
        cause: "database-password",
      }),
    );
    const body = await response.json();

    assertEquals(body.detail, undefined);
    assertEquals(body.cause, undefined);
  });

  it("should preserve safe client-error details", async () => {
    const response = errorToResponse(
      CONFIG_NOT_FOUND.create({
        detail: "veryfront.config.ts was not found",
        cause: "private lookup provenance",
      }),
    );
    const body = await response.json();

    assertEquals(body.detail, "veryfront.config.ts was not found");
    assertEquals(body.cause, undefined);
  });

  it("should add an instance without mutating the source error", async () => {
    const error = CONFIG_NOT_FOUND.create();
    const response = errorToResponse(error, "/projects/example");
    const body = await response.json();

    assertEquals(body.instance, "/projects/example");
    assertEquals(error.instance, undefined);
  });

  it("should extract absolute and relative request paths best-effort", async () => {
    const handler = createErrorHandler();

    const absolute = await handler(CONFIG_NOT_FOUND.create(), {
      req: { url: "https://example.com/api/build?mode=fast" },
    }).json();
    const relative = await handler(CONFIG_NOT_FOUND.create(), {
      req: { url: "projects/example?mode=fast" },
    }).json();

    assertEquals(absolute.instance, "/api/build");
    assertEquals(relative.instance, "/projects/example");
  });

  it("should preserve the original error response when request URL access fails", async () => {
    const handler = createErrorHandler();
    const req = Object.defineProperty({}, "url", {
      get(): never {
        throw new Error("unreadable URL");
      },
    }) as { url: string };

    const response = handler(CONFIG_NOT_FOUND.create(), { req });
    const body = await response.json();

    assertEquals(response.status, 404);
    assertEquals(body.type, "https://veryfront.com/docs/errors/config-not-found");
    assertEquals(body.instance, undefined);
  });

  it("should preserve the original error response when request access fails", async () => {
    const handler = createErrorHandler();
    const context = Object.defineProperty({}, "req", {
      get(): never {
        throw new Error("unreadable request");
      },
    }) as { req: { url: string } };

    const response = handler(CONFIG_NOT_FOUND.create(), context);
    const body = await response.json();

    assertEquals(response.status, 404);
    assertEquals(body.type, "https://veryfront.com/docs/errors/config-not-found");
    assertEquals(body.instance, undefined);
  });

  it("should omit the instance for malformed request URLs", async () => {
    const handler = createErrorHandler();
    for (const url of ["http://[", "   "]) {
      const response = handler(CONFIG_NOT_FOUND.create(), { req: { url } });
      const body = await response.json();

      assertEquals(response.status, 404);
      assertEquals(body.instance, undefined);
    }
  });

  it("should preserve custom statuses for generic problem responses", async () => {
    const response = createProblemResponse({
      slug: "vendor/custom-problem",
      title: "Custom problem",
      status: 299,
      category: "GENERAL",
    });

    assertEquals(response.status, 299);
  });

  it("should fall back for statuses that cannot carry a problem-details body", async () => {
    for (const status of [204, 205, 304]) {
      const response = createProblemResponse({
        slug: "vendor/custom-problem",
        title: "Custom problem",
        status,
        category: "GENERAL",
      });
      const body = await response.json();

      assertEquals(response.status, 500);
      assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
    }
  });

  it("should fall back safely for a proxy around a real VeryfrontError", async () => {
    const hostile = new Proxy(CONFIG_NOT_FOUND.create(), {
      get(target, property, receiver) {
        if (property === "title") throw new Error("blocked");
        return Reflect.get(target, property, receiver);
      },
    });

    const response = errorToResponse(hostile, "/safe");
    const body = await response.json();

    assertEquals(response.status, 500);
    assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
    assertEquals(body.instance, "/safe");
  });

  it("should neutralize terminal and line injection in plain-text error logs", () => {
    const injection = "\x1b]2;owned\x07\x1b[2J\nFAKE SUCCESS";
    const error = new VeryfrontError(`message ${injection}`, {
      slug: `custom-${injection}`,
      category: "GENERAL",
      status: 500,
      title: `title ${injection}`,
      detail: `detail ${injection}`,
      suggestion: `suggestion ${injection}`,
    });

    const output = formatErrorLog(error);

    for (const forbidden of ["\x1b]2;owned", "\x1b[2J", "\x07", "\nFAKE SUCCESS"]) {
      assertEquals(output.includes(forbidden), false);
    }
  });

  it("should bound and redact the actual HTTP response body", async () => {
    const error = new VeryfrontError("Vendor error", {
      slug: "vendor/path?token=slug-secret#fragment",
      category: "GENERAL",
      status: 499,
      title: "t".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
      detail: `${"d".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS)} Authorization: Bearer detail-secret`,
      suggestion: "s".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS),
      cause: `apiKey=cause-secret ${"c".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS)}`,
      instance: `/projects/${"i".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS)}`,
    });

    const response = createErrorResponse(error);
    const text = await response.text();
    const body = JSON.parse(text);

    assert(text.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS);
    assert(body.title.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assert(body.detail.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assert(body.suggestion.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assert(body.instance.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assertEquals(body.type.includes("slug-secret"), false);
    assertEquals(text.includes("detail-secret"), false);
    assertEquals(text.includes("cause-secret"), false);
  });

  it("should bound the actual plain-text error log", () => {
    const error = new VeryfrontError("Vendor error", {
      slug: "vendor-log",
      category: "GENERAL",
      status: 500,
      title: "t".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
      detail: "d".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
      suggestion: "s".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
    });

    const output = formatErrorLog(error);

    assert(output.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS);
    assert(output.includes("...[truncated]"));
  });
});
