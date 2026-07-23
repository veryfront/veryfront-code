import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createErrorHandler,
  createErrorResponse,
  createProblemResponse,
  errorToResponse,
} from "./http-error.ts";
import { VeryfrontError } from "./types.ts";

describe("errorToResponse", () => {
  it("should project the request instance without mutating the error", async () => {
    const error = new VeryfrontError("Request failed", {
      slug: "request-failed",
      category: "SERVER",
      status: 500,
      title: "Request failed",
    });

    const response = errorToResponse(error, "/api/projects/example");
    const body = await response.json();

    assertEquals(body.instance, "/api/projects/example");
    assertEquals(error.instance, undefined);
  });

  it("does not expose unknown exception messages in a server response", async () => {
    const response = errorToResponse(
      new Error("database failed with password=<TOKEN> at /private/project/server.ts"),
      "/api/projects/example",
    );
    const body = await response.json();

    assertEquals(body.title, "Unknown/unclassified error");
    assertEquals(body.detail, undefined);
    assertEquals(JSON.stringify(body).includes("<TOKEN>"), false);
    assertEquals(JSON.stringify(body).includes("/private/project"), false);
  });

  it("omits internal detail and causes from 5xx responses by default", async () => {
    const error = new VeryfrontError("Internal failure", {
      slug: "internal-failure",
      category: "GENERAL",
      status: 500,
      title: "Internal failure",
      detail: "private payload",
      cause: "private-cause",
    });
    const registeredBody = await createErrorResponse(error).json();
    const problemBody = await createProblemResponse({
      slug: "internal-failure",
      category: "GENERAL",
      status: 503,
      title: "Internal failure",
      detail: "private payload",
      cause: "private-cause",
    }).json();

    assertEquals(registeredBody.detail, undefined);
    assertEquals(registeredBody.cause, undefined);
    assertEquals(problemBody.detail, undefined);
    assertEquals(problemBody.cause, undefined);
  });

  it("never projects an internal cause into a client response", async () => {
    const problemResponse = createProblemResponse({
      slug: "invalid-input",
      category: "GENERAL",
      status: 400,
      title: "Invalid input",
      cause: "password=<TOKEN> at /private/project/server.ts",
    });
    const registeredResponse = createErrorResponse(
      new VeryfrontError("Invalid input", {
        slug: "invalid-input",
        category: "GENERAL",
        status: 400,
        title: "Invalid input",
        cause: "password=<TOKEN> at /private/project/server.ts",
      }),
    );

    assertEquals((await problemResponse.json()).cause, undefined);
    assertEquals((await registeredResponse.json()).cause, undefined);
  });

  it("uses non-cacheable, sniff-resistant response headers", () => {
    const response = createProblemResponse({
      slug: "invalid-input",
      category: "GENERAL",
      status: 400,
      title: "Invalid input",
    });

    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  });

  it("removes credentials and fragments from explicit instance URIs", async () => {
    const response = createProblemResponse({
      slug: "invalid-input",
      category: "GENERAL",
      status: 400,
      title: "Invalid input",
      instance: "https://user:<TOKEN>@example.com/api/items?token=<TOKEN>#private",
    });

    const body = await response.json();
    assertEquals(body.instance, "https://example.com/api/items");
    assertEquals(JSON.stringify(body).includes("<TOKEN>"), false);
    assertEquals(JSON.stringify(body).includes("#private"), false);
  });

  it("sanitizes a request instance supplied by the response caller", async () => {
    const error = new VeryfrontError("Invalid input", {
      slug: "invalid-input",
      category: "GENERAL",
      status: 400,
      title: "Invalid input",
    });

    const response = createErrorResponse(
      error,
      "https://user:<TOKEN>@example.com/api/items?token=<TOKEN>#private",
    );
    const body = await response.json();

    assertEquals(body.instance, "https://example.com/api/items");
    assertEquals(JSON.stringify(body).includes("<TOKEN>"), false);
    assertEquals(JSON.stringify(body).includes("#private"), false);
  });

  it("does not invoke mutable serializer methods on an error instance", async () => {
    const error = new VeryfrontError("Invalid input", {
      slug: "invalid-input",
      category: "GENERAL",
      status: 400,
      title: "Invalid input",
      detail: "Use a supported value",
    });
    error.toRFC9457 = () => {
      throw new Error("serializer leaked password=<TOKEN>");
    };

    const body = await createErrorResponse(error).json();

    assertEquals(body.type, "https://veryfront.com/docs/errors/invalid-input");
    assertEquals(body.detail, "Use a supported value");
  });

  it("fails closed when an error identity is mutated after construction", async () => {
    const error = new VeryfrontError("Invalid input", {
      slug: "invalid-input",
      category: "GENERAL",
      status: 400,
      title: "Invalid input",
    });
    Object.defineProperty(error, "slug", {
      get() {
        throw new Error("getter leaked password=<TOKEN>");
      },
    });

    const response = createErrorResponse(error);
    const body = await response.json();

    assertEquals(response.status, 500);
    assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
    assertEquals(JSON.stringify(body).includes("<TOKEN>"), false);
  });

  it("fails closed when a mutable error is changed to a non-error status", async () => {
    const error = new VeryfrontError("Invalid input", {
      slug: "invalid-input",
      category: "GENERAL",
      status: 400,
      title: "Invalid input",
    });
    error.status = 204;

    const response = createErrorResponse(error);
    const body = await response.json();

    assertEquals(response.status, 500);
    assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
  });

  it("validates raw problem response parameters", () => {
    assertThrows(
      () =>
        createProblemResponse({
          slug: "invalid input",
          category: "GENERAL",
          status: 400,
          title: "Invalid input",
        }),
      TypeError,
      "Invalid problem response parameters",
    );
    assertThrows(
      () =>
        createProblemResponse({
          slug: "invalid-input",
          category: "GENERAL",
          status: Number.NaN,
          title: "Invalid input",
        }),
      TypeError,
      "Invalid problem response parameters",
    );
    assertThrows(
      () =>
        createProblemResponse({
          slug: "invalid-input",
          category: "GENERAL",
          status: 399,
          title: "Invalid input",
        }),
      TypeError,
      "Invalid problem response parameters",
    );
  });

  it("does not replace an error when request context contains a malformed URL", async () => {
    const handler = createErrorHandler();
    const response = handler(new Error("private failure"), { req: { url: "not a URL" } });
    const body = await response.json();

    assertEquals(response.status, 500);
    assertEquals(body.instance, undefined);
    assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
  });
});
