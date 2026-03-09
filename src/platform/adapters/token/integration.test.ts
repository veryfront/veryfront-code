import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  getTokenStorageType,
  isTokenStorageConfigured,
  resetTokenStorageAdapter,
} from "./integration.ts";

describe("platform/adapters/token/integration", () => {
  afterEach(() => {
    // Clean up any env vars we set
    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
    } catch { /* ok */ }
    try {
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    } catch { /* ok */ }
    resetTokenStorageAdapter();
  });

  describe("isTokenStorageConfigured", () => {
    it("should return false when env vars are not set", () => {
      try {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      try {
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      assertEquals(isTokenStorageConfigured(), false);
    });

    it("should return false when only API token is set", () => {
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      try {
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      assertEquals(isTokenStorageConfigured(), false);
    });

    it("should return false when only project slug is set", () => {
      try {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "test-project");
      assertEquals(isTokenStorageConfigured(), false);
    });

    it("should return true when both env vars are set", () => {
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "test-project");
      assertEquals(isTokenStorageConfigured(), true);
    });
  });

  describe("getTokenStorageType", () => {
    it("should return 'memory' when not configured", () => {
      try {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      try {
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      assertEquals(getTokenStorageType(), "memory");
    });

    it("should return 'veryfront-api' when configured", () => {
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "test-project");
      assertEquals(getTokenStorageType(), "veryfront-api");
    });
  });

  describe("resetTokenStorageAdapter", () => {
    it("should not throw when called with no adapter set", () => {
      resetTokenStorageAdapter();
    });

    it("should be callable multiple times", () => {
      resetTokenStorageAdapter();
      resetTokenStorageAdapter();
    });
  });
});
