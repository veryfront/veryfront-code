import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertInstanceOf, assertStringIncludes } from "#veryfront/testing/assert";
import { REQUEST_ERROR } from "#veryfront/errors";
import { createSandboxHttpError } from "./http-error.ts";

const problem = {
  type: "https://api.veryfront.com/errors/validation-failed",
  title: "Validation Failed",
  status: 400,
  slug: "validation-failed",
  category: "VALIDATION",
};
const response = (body: unknown, status = 400) => new Response(JSON.stringify(body), { status });

describe("Sandbox response problem projection", () => {
  it("preserves canonical fields and only bounded validation details", async () => {
    const fields = { field: "sandbox_id", message: "Invalid uuid", code: "invalid_string" };
    const expected = {
      ...problem,
      detail: "Invalid uuid",
      suggestion: "Check input",
      errors: [fields],
    };
    const error = await createSandboxHttpError(
      response({
        ...expected,
        credentials: "unexpected metadata",
        errors: [{ ...fields, debug: "ignored" }],
      }),
      "Get failed",
    );
    assertEquals(error.status, 400);
    assertEquals(error.slug, "request-error");
    assertEquals(error.category, "SERVER");
    assertEquals(error.context, { responseProblem: expected });
  });
  it("keeps concurrent HTTP failures isolated without changing the shared SDK error definition", async () => {
    const statuses = [400, 403, 503];
    const errors = await Promise.all(
      statuses.map((status) =>
        createSandboxHttpError(response({ ...problem, status }, status), "Request failed")
      ),
    );
    assertEquals(errors.map((error) => error.status), statuses);
    assertEquals(REQUEST_ERROR.status, 500);
  });
  it("does not invent canonical metadata for malformed or unbounded required fields", async () => {
    for (
      const body of [null, [], { ...problem, title: "" }, { ...problem, category: true }, {
        ...problem,
        type: "x".repeat(2049),
      }]
    ) {
      const error = await createSandboxHttpError(response(body), "Request failed");
      assertEquals(error.status, 400);
      assertEquals(error.context, undefined);
    }
  });
  it("uses HTTP status when a problem body claims a conflicting status", async () => {
    const error = await createSandboxHttpError(
      response({ ...problem, status: 200 }, 403),
      "Request failed",
    );
    assertEquals(error.status, 403);
    assertEquals(error.context, undefined);
  });
  it("omits unstructured server bodies while preserving HTTP failure status", async () => {
    const error = await createSandboxHttpError(
      new Response("gateway unavailable", { status: 503 }),
      "Request failed",
    );
    assertEquals(error.status, 503);
    assertEquals(error.context, undefined);
    assertEquals(error.detail, "Request failed: 503");
  });
  it("keeps unreadable response bodies visible as a cause", async () => {
    const error = await createSandboxHttpError(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("fixture body failure"));
          },
        }),
        { status: 502 },
      ),
      "Request failed",
    );
    assertEquals(error.status, 502);
    assertInstanceOf(error.cause, Error);
    assertStringIncludes(error.cause.message, "fixture body failure");
  });
  it("bounds oversized diagnostics and does not trust a truncated canonical problem", async () => {
    const error = await createSandboxHttpError(
      new Response(JSON.stringify(problem) + " ".repeat(16384), { status: 400 }),
      "Request failed",
    );
    assertEquals(error.status, 400);
    assertEquals(error.context, { responseTruncated: true });
    assertStringIncludes(error.detail ?? "", "[truncated]");
    assertEquals((error.detail ?? "").length < 8 * 1024 + 100, true);
  });
  it("honors an already-aborted body-read boundary", async () => {
    const error = await createSandboxHttpError(
      new Response(new ReadableStream(), { status: 403 }),
      "Request failed",
      AbortSignal.abort(new Error("caller canceled")),
    );
    assertEquals(error.status, 403);
    assertInstanceOf(error.cause, Error);
    assertStringIncludes(error.cause.message, "caller canceled");
  });
  it("never exposes unknown response fields in public diagnostics", async () => {
    const error = await createSandboxHttpError(
      response({
        ...problem,
        credentials: "opaque-credential",
        customerData: "private-customer-data",
        debug: "internal-debug-data",
      }),
      "Request failed",
    );
    const publicError = JSON.stringify({
      message: error.message,
      detail: error.detail,
      context: error.context,
    });
    for (const value of ["opaque-credential", "private-customer-data", "internal-debug-data"]) {
      assertEquals(publicError.includes(value), false, value);
    }
  });
  it("redacts credentials inside allowlisted canonical diagnostic fields", async () => {
    const error = await createSandboxHttpError(
      response({ ...problem, detail: "Authorization: Bearer private-fixture-token" }),
      "Request failed",
    );
    assertEquals(
      JSON.stringify({ message: error.message, detail: error.detail, context: error.context })
        .includes("private-fixture-token"),
      false,
    );
  });
});
