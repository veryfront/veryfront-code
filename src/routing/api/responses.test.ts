import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd.ts";
import {
  badRequest,
  forbidden,
  json,
  notFound,
  redirect,
  serverError,
  unauthorized,
} from "./responses.ts";

describe("API Response Helpers", () => {
  describe("json()", () => {
    it("should create JSON response with default status", () => {
      const data = { message: "Hello" };
      const response = json(data);

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-type"), "application/json; charset=utf-8");
    });

    it("should create JSON response with custom status", () => {
      const data = { error: "Not found" };
      const response = json(data, 404);

      assertEquals(response.status, 404);
    });

    it("should create JSON response with custom headers", () => {
      const data = { token: "abc123" };
      const response = json(data, 200, {
        headers: { "X-Custom-Header": "value" },
      });

      assertEquals(response.headers.get("X-Custom-Header"), "value");
    });

    it("should serialize complex data structures", () => {
      const data = {
        user: { id: 1, name: "Test" },
        items: [1, 2, 3],
        metadata: { count: 3 },
      };
      const response = json(data);

      assertEquals(response.status, 200);
    });
  });

  describe("redirect()", () => {
    it("should create redirect with 302 status by default", () => {
      const response = redirect("/login");

      assertEquals(response.status, 302);
      assertEquals(response.headers.get("Location"), "/login");
    });

    it("should create redirect with custom status (permanent)", () => {
      const response = redirect("/home", true);

      assertEquals(response.status, 301);
      assertEquals(response.headers.get("Location"), "/home");
    });

    it("should handle absolute URLs", () => {
      const response = redirect("https://example.com/page");

      assertEquals(response.status, 302);
      assertEquals(response.headers.get("Location"), "https://example.com/page");
    });
  });

  describe("notFound()", () => {
    it("should create 404 response with default message", () => {
      const response = notFound();

      assertEquals(response.status, 404);
    });

    it("should create 404 response with custom message", async () => {
      const response = notFound("Page not found");

      assertEquals(response.status, 404);
      assertEquals(await response.text(), "Page not found");
    });
  });

  describe("badRequest()", () => {
    it("should create 400 response with default message", () => {
      const response = badRequest();

      assertEquals(response.status, 400);
    });

    it("should create 400 response with custom message", async () => {
      const response = badRequest("Invalid input");

      assertEquals(response.status, 400);
      assertEquals(await response.text(), "Invalid input");
    });
  });

  describe("unauthorized()", () => {
    it("should create 401 response with default message", () => {
      const response = unauthorized();

      assertEquals(response.status, 401);
    });

    it("should create 401 response with custom message", async () => {
      const response = unauthorized("Token expired");

      assertEquals(response.status, 401);
      assertEquals(await response.text(), "Token expired");
    });
  });

  describe("forbidden()", () => {
    it("should create 403 response with default message", () => {
      const response = forbidden();

      assertEquals(response.status, 403);
    });

    it("should create 403 response with custom message", async () => {
      const response = forbidden("Access denied");

      assertEquals(response.status, 403);
      assertEquals(await response.text(), "Access denied");
    });
  });

  describe("serverError()", () => {
    it("should create 500 response with default message", () => {
      const response = serverError();

      assertEquals(response.status, 500);
    });

    it("should create 500 response with custom message", async () => {
      const response = serverError("Database error");

      assertEquals(response.status, 500);
      assertEquals(await response.text(), "Database error");
    });
  });
});
