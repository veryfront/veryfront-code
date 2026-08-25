import "#veryfront/schemas/_test-setup.ts";
import { assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  MemoryTokenAdapter,
  TOKEN_STORAGE_ERROR,
  TokenStorageApiClient,
  VeryfrontTokenAdapter,
} from "./veryfront/index.ts";
import { createTokenStorageAdapter } from "./factory.ts";
import {
  getTokenStorageAdapter,
  getTokenStorageType,
  isTokenStorageConfigured,
  resetTokenStorageAdapter,
} from "./integration.ts";

describe("token/index.ts exports", () => {
  async function getModule(): Promise<typeof import("./index.ts")> {
    return await import("./index.ts");
  }

  it("should export MemoryTokenAdapter", async () => {
    const mod = await getModule();
    assertStrictEquals(
      mod.MemoryTokenAdapter,
      MemoryTokenAdapter,
      "the barrel must re-export the same MemoryTokenAdapter binding",
    );
  });

  it("should export VeryfrontTokenAdapter", async () => {
    const mod = await getModule();
    assertStrictEquals(
      mod.VeryfrontTokenAdapter,
      VeryfrontTokenAdapter,
      "the barrel must re-export the same VeryfrontTokenAdapter binding",
    );
  });

  it("should export TokenStorageApiClient", async () => {
    const mod = await getModule();
    assertStrictEquals(
      mod.TokenStorageApiClient,
      TokenStorageApiClient,
      "the barrel must re-export the same TokenStorageApiClient binding",
    );
  });

  it("should export TOKEN_STORAGE_ERROR", async () => {
    const mod = await getModule();
    assertStrictEquals(
      mod.TOKEN_STORAGE_ERROR,
      TOKEN_STORAGE_ERROR,
      "the barrel must re-export the same TOKEN_STORAGE_ERROR registry entry",
    );
  });

  it("should export createTokenStorageAdapter", async () => {
    const mod = await getModule();
    assertStrictEquals(
      mod.createTokenStorageAdapter,
      createTokenStorageAdapter,
      "the barrel must re-export the same createTokenStorageAdapter binding",
    );
  });

  it("should export integration functions", async () => {
    const mod = await getModule();
    assertStrictEquals(
      mod.getTokenStorageAdapter,
      getTokenStorageAdapter,
      "the barrel must re-export the same getTokenStorageAdapter binding",
    );
    assertStrictEquals(
      mod.getTokenStorageType,
      getTokenStorageType,
      "the barrel must re-export the same getTokenStorageType binding",
    );
    assertStrictEquals(
      mod.isTokenStorageConfigured,
      isTokenStorageConfigured,
      "the barrel must re-export the same isTokenStorageConfigured binding",
    );
    assertStrictEquals(
      mod.resetTokenStorageAdapter,
      resetTokenStorageAdapter,
      "the barrel must re-export the same resetTokenStorageAdapter binding",
    );
  });
});
