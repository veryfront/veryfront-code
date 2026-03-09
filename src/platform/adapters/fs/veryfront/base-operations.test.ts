import { assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontOperationsBase } from "./base-operations.ts";

describe("platform/adapters/fs/veryfront/base-operations", () => {
  function createStubDeps() {
    return {
      client: {} as any,
      cache: {} as any,
      normalizer: {} as any,
    };
  }

  it("should construct with required dependencies", () => {
    const deps = createStubDeps();
    const base = new VeryfrontOperationsBase(deps.client, deps.cache, deps.normalizer);
    assertExists(base);
  });

  it("should construct with optional contextProvider", () => {
    const deps = createStubDeps();
    const contextProvider = { getContext: () => ({}) } as any;
    const base = new VeryfrontOperationsBase(
      deps.client,
      deps.cache,
      deps.normalizer,
      contextProvider,
    );
    assertExists(base);
  });

  it("should accept null-ish contextProvider", () => {
    const deps = createStubDeps();
    const base = new VeryfrontOperationsBase(
      deps.client,
      deps.cache,
      deps.normalizer,
      undefined,
    );
    assertExists(base);
  });
});
