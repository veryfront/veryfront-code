import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDevNotFoundResponse } from "./not-found-response.ts";

describe("server/handlers/dev/shared/not-found-response", () => {
  describe("createDevNotFoundResponse", () => {
    it("should return a Response object", () => {
      const response = createDevNotFoundResponse();
      assertEquals(response instanceof Response, true);
    });

    it("should return a 404 status", () => {
      const response = createDevNotFoundResponse();
      assertEquals(response.status, 404);
    });

    it("should have JSON content type", async () => {
      const response = createDevNotFoundResponse();
      const contentType = response.headers.get("content-type");
      assertStringIncludes(
        contentType ?? "",
        "application/problem+json",
        "dev 404s must be served as an RFC 7807 problem document",
      );
    });

    it("should contain error details in body", async () => {
      const response = createDevNotFoundResponse();
      const body = await response.json();
      assertEquals(typeof body, "object");
      assertEquals(body.status, 404);
      assertEquals(
        body.type,
        "https://veryfront.com/docs/code/guides/errors#page-not-found",
        "dev 404s must keep the page-not-found problem identity",
      );
      assertEquals(
        body.title,
        "Page component not found",
        "problem title must match the PAGE_NOT_FOUND definition",
      );
      assertEquals(
        body.detail,
        "The requested resource was not found",
        "the detail string is part of the dev 404 contract",
      );
    });
  });
});
