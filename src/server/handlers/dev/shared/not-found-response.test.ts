import { assertEquals } from "#veryfront/testing/assert.ts";
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
      assertEquals(contentType?.includes("application/problem+json") || contentType?.includes("application/json"), true);
    });

    it("should contain error details in body", async () => {
      const response = createDevNotFoundResponse();
      const body = await response.json();
      assertEquals(typeof body, "object");
      assertEquals(body.status, 404);
    });
  });
});
