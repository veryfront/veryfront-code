import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { handleAPIError } from "./error-handler.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

describe("handleAPIError", () => {
  const createMockAdapter = (envVars: Record<string, string> = {}): RuntimeAdapter => {
    return {
      env: {
        get: (key: string) => envVars[key],
        set: () => {},
      },
    } as unknown as RuntimeAdapter;
  };

  describe("development environment", () => {
    it("should return detailed error with stack trace in development", async () => {
      const error = new Error("Test error");
      const adapter = createMockAdapter({ MODE: "development" });

      const response = handleAPIError(error, "/api/test", adapter);

      assertEquals(response.status, 500);
      const data = await response.json();
      assertEquals(data.error, "Test error");
      assertExists(data.stack);
    });

    it("should handle development env from NODE_ENV", async () => {
      const error = new Error("Node env error");
      const adapter = createMockAdapter({ NODE_ENV: "development" });

      const response = handleAPIError(error, "/api/test", adapter);

      assertEquals(response.status, 500);
      const data = await response.json();
      assertEquals(data.error, "Node env error");
      assertExists(data.stack);
    });

    it("should handle development env from DENO_ENV", async () => {
      const error = new Error("Deno env error");
      const adapter = createMockAdapter({ DENO_ENV: "dev" });

      const response = handleAPIError(error, "/api/test", adapter);

      assertEquals(response.status, 500);
      const data = await response.json();
      assertEquals(data.error, "Deno env error");
      assertExists(data.stack);
    });

    it("should handle non-Error objects in development", async () => {
      const adapter = createMockAdapter({ MODE: "development" });

      const response = handleAPIError("string error", "/api/test", adapter);

      assertEquals(response.status, 500);
      const data = await response.json();
      assertEquals(data.error, "Internal server error");
      assertEquals(data.stack, undefined);
    });
  });

  describe("production environment", () => {
    it("should return generic error in production", async () => {
      const error = new Error("Secret error");
      const adapter = createMockAdapter({ MODE: "production" });

      const response = handleAPIError(error, "/api/test", adapter);

      assertEquals(response.status, 500);
      const text = await response.text();
      assertEquals(text, "Internal server error");
    });

    it("should not leak error details in production", async () => {
      const error = new Error("Database password is 12345");
      const adapter = createMockAdapter({ NODE_ENV: "production" });

      const response = handleAPIError(error, "/api/test", adapter);

      assertEquals(response.status, 500);
      const text = await response.text();
      assertEquals(text, "Internal server error");
    });
  });

  describe("environment detection", () => {
    it("should default to development when no env vars set", async () => {
      const error = new Error("No env");
      const adapter = createMockAdapter({});

      const response = handleAPIError(error, "/api/test", adapter);

      assertEquals(response.status, 500);
      const data = await response.json();
      assertExists(data.error);
    });

    it("should handle case-insensitive environment values", async () => {
      const error = new Error("Case test");
      const adapter = createMockAdapter({ MODE: "PRODUCTION" });

      const response = handleAPIError(error, "/api/test", adapter);

      assertEquals(response.status, 500);
      const text = await response.text();
      assertEquals(text, "Internal server error");
    });
  });

  describe("edge cases", () => {
    it("should handle null error", async () => {
      const adapter = createMockAdapter({ MODE: "development" });

      const response = handleAPIError(null, "/api/test", adapter);

      assertEquals(response.status, 500);
      assertExists(response);
    });

    it("should handle undefined error", async () => {
      const adapter = createMockAdapter({ MODE: "production" });

      const response = handleAPIError(undefined, "/api/test", adapter);

      assertEquals(response.status, 500);
      const text = await response.text();
      assertEquals(text, "Internal server error");
    });

    it("should handle custom error objects", async () => {
      const customError = { message: "Custom error", code: 123 };
      const adapter = createMockAdapter({ MODE: "development" });

      const response = handleAPIError(customError, "/api/test", adapter);

      assertEquals(response.status, 500);
      const data = await response.json();
      assertEquals(data.error, "Internal server error");
    });
  });
});
