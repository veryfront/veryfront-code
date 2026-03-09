import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { TokenStorageApiClient } from "./api-client.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type { VeryfrontTokenConfig } from "./types.ts";

function createConfig(overrides: Partial<VeryfrontTokenConfig> = {}): VeryfrontTokenConfig {
  return {
    apiBaseUrl: "http://127.0.0.1:19999",
    apiToken: "test-token",
    projectSlug: "test-project",
    retry: { maxRetries: 0, initialDelay: 10, maxDelay: 50 },
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("platform/adapters/token/veryfront/api-client", () => {
  describe("constructor", () => {
    it("should create client with valid config", () => {
      const client = new TokenStorageApiClient(createConfig());
      assertExists(client);
    });
  });

  describe("get", () => {
    it("should throw VeryfrontError when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createConfig());
      await assertRejects(
        () => client.get("test-key"),
        VeryfrontError,
      );
    });
  });

  describe("set", () => {
    it("should throw VeryfrontError when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createConfig());
      await assertRejects(
        () => client.set("test-key", "test-value"),
        VeryfrontError,
      );
    });
  });

  describe("delete", () => {
    it("should throw VeryfrontError when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createConfig());
      await assertRejects(
        () => client.delete("test-key"),
        VeryfrontError,
      );
    });
  });

  describe("list", () => {
    it("should throw VeryfrontError when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createConfig());
      await assertRejects(
        () => client.list(),
        VeryfrontError,
      );
    });

    it("should throw VeryfrontError with prefix when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createConfig());
      await assertRejects(
        () => client.list("user:"),
        VeryfrontError,
      );
    });
  });

  describe("ping", () => {
    it("should return false when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createConfig());
      const result = await client.ping();
      assertEquals(result, false);
    });
  });
});
