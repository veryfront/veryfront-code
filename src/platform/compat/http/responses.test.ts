import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  badGateway,
  badRequest,
  created,
  errorResponse,
  forbidden,
  HttpStatus,
  internalServerError,
  jsonErrorResponse,
  jsonResponse,
  methodNotAllowed,
  noContent,
  notFound,
  ok,
  redirectResponse,
  serviceUnavailable,
  unauthorized,
} from "./responses.ts";

describe("HttpStatus", () => {
  it("should define standard HTTP status codes", () => {
    const cases: Array<[number, number]> = [
      [HttpStatus.OK, 200],
      [HttpStatus.CREATED, 201],
      [HttpStatus.NO_CONTENT, 204],
      [HttpStatus.MOVED_PERMANENTLY, 301],
      [HttpStatus.FOUND, 302],
      [HttpStatus.NOT_MODIFIED, 304],
      [HttpStatus.BAD_REQUEST, 400],
      [HttpStatus.UNAUTHORIZED, 401],
      [HttpStatus.FORBIDDEN, 403],
      [HttpStatus.NOT_FOUND, 404],
      [HttpStatus.METHOD_NOT_ALLOWED, 405],
      [HttpStatus.CONFLICT, 409],
      [HttpStatus.UNPROCESSABLE_ENTITY, 422],
      [HttpStatus.TOO_MANY_REQUESTS, 429],
      [HttpStatus.INTERNAL_SERVER_ERROR, 500],
      [HttpStatus.NOT_IMPLEMENTED, 501],
      [HttpStatus.BAD_GATEWAY, 502],
      [HttpStatus.SERVICE_UNAVAILABLE, 503],
      [HttpStatus.GATEWAY_TIMEOUT, 504],
    ];

    for (const [actual, expected] of cases) {
      assertEquals(actual, expected);
    }
  });
});

describe("errorResponse", () => {
  it("should create a response with the given status", async () => {
    const res = errorResponse(HttpStatus.NOT_FOUND);
    assertEquals(res.status, 404);
    assertEquals(res.statusText, "Not Found");
    assertEquals(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assertEquals(await res.text(), "Not Found");
  });

  it("should use custom message when provided", async () => {
    const res = errorResponse(HttpStatus.BAD_REQUEST, "Invalid input");
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Invalid input");
  });

  it("should add correlation id header when provided", () => {
    const res = errorResponse(HttpStatus.NOT_FOUND, undefined, { correlationId: "abc-123" });
    assertEquals(res.headers.get("X-Correlation-Id"), "abc-123");
  });

  it("should merge custom headers", () => {
    const res = errorResponse(HttpStatus.BAD_REQUEST, "err", {
      headers: { "X-Custom": "value" },
    });
    assertEquals(res.headers.get("X-Custom"), "value");
    assertEquals(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
  });
});

describe("jsonResponse", () => {
  it("should serialize data as JSON", async () => {
    const res = jsonResponse({ name: "test" });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
    assertEquals(await res.json(), { name: "test" });
  });

  it("should use custom status code", () => {
    const res = jsonResponse({ ok: true }, HttpStatus.CREATED);
    assertEquals(res.status, 201);
  });

  it("should handle arrays", async () => {
    const res = jsonResponse([1, 2, 3]);
    assertEquals(await res.json(), [1, 2, 3]);
  });

  it("should return 500 for non-serializable data", async () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    const res = jsonResponse(circular);
    assertEquals(res.status, 500);
    assertEquals(await res.text(), "Failed to serialize response data");
  });

  it("should add correlation id header", () => {
    const res = jsonResponse({}, HttpStatus.OK, { correlationId: "xyz" });
    assertEquals(res.headers.get("X-Correlation-Id"), "xyz");
  });
});

describe("redirectResponse", () => {
  it("should create a temporary redirect by default", () => {
    const res = redirectResponse("/new-path");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), "/new-path");
  });

  it("should create a permanent redirect when specified", () => {
    const res = redirectResponse("/new-path", true);
    assertEquals(res.status, 301);
    assertEquals(res.headers.get("Location"), "/new-path");
  });

  it("should accept absolute URLs", () => {
    const res = redirectResponse("https://example.com/path");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), "https://example.com/path");
  });

  it("should accept relative paths starting with ./", () => {
    const res = redirectResponse("./other");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), "./other");
  });

  it("should accept relative paths starting with ../", () => {
    const res = redirectResponse("../parent");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), "../parent");
  });

  it("should return 400 for javascript: URLs", () => {
    const res = redirectResponse("javascript:alert(1)");
    assertEquals(res.status, 400);
  });
});

describe("convenience response helpers", () => {
  it("notFound should return 404", async () => {
    const res = notFound();
    assertEquals(res.status, 404);
    assertEquals(await res.text(), "Not Found");
  });

  it("notFound should accept custom message", async () => {
    const res = notFound("Page missing");
    assertEquals(res.status, 404);
    assertEquals(await res.text(), "Page missing");
  });

  it("badRequest should return 400", () => {
    assertEquals(badRequest().status, 400);
  });

  it("unauthorized should return 401", () => {
    assertEquals(unauthorized().status, 401);
  });

  it("forbidden should return 403", () => {
    assertEquals(forbidden().status, 403);
  });

  it("internalServerError should return 500", () => {
    assertEquals(internalServerError().status, 500);
  });

  it("badGateway should return 502", () => {
    assertEquals(badGateway().status, 502);
  });

  it("serviceUnavailable should return 503", () => {
    assertEquals(serviceUnavailable().status, 503);
  });
});

describe("methodNotAllowed", () => {
  it("should return 405 with Allow header", async () => {
    const res = methodNotAllowed(["GET", "POST"]);
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "GET, POST");
    assertEquals(await res.text(), "Method not allowed. Allowed methods: GET, POST");
  });
});

describe("ok", () => {
  it("should return 200 with no body when data is undefined", () => {
    const res = ok();
    assertEquals(res.status, 200);
  });

  it("should return JSON when data is provided", async () => {
    const res = ok({ result: true });
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { result: true });
  });
});

describe("created", () => {
  it("should return 201 with no body when data is undefined", () => {
    const res = created();
    assertEquals(res.status, 201);
  });

  it("should return 201 with JSON body", async () => {
    const res = created({ id: "123" });
    assertEquals(res.status, 201);
    assertEquals(await res.json(), { id: "123" });
  });

  it("should set Location header when provided", () => {
    const res = created(undefined, "/items/123");
    assertEquals(res.status, 201);
    assertEquals(res.headers.get("Location"), "/items/123");
  });
});

describe("noContent", () => {
  it("should return 204 with null body", () => {
    const res = noContent();
    assertEquals(res.status, 204);
  });
});

describe("jsonErrorResponse", () => {
  it("should return JSON error with ok: false", async () => {
    const res = jsonErrorResponse(HttpStatus.BAD_REQUEST, "Invalid field");
    assertEquals(res.status, 400);
    assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
    assertEquals(await res.json(), { ok: false, error: "Invalid field" });
  });

  it("should add correlation id header", () => {
    const res = jsonErrorResponse(HttpStatus.BAD_REQUEST, "err", { correlationId: "c-1" });
    assertEquals(res.headers.get("X-Correlation-Id"), "c-1");
  });
});
