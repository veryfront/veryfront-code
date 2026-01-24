import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getLocalAdapter, resetLocalAdapter, runtime } from "./registry.ts";
import { createMockAdapter } from "./mock.ts";
import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import type { RuntimeId } from "./base.ts";

const expectedRuntime: RuntimeId = isDeno ? "deno" : isNode ? "node" : isBun ? "bun" : "deno";

describe("registry.ts", () => {
  describe("runtime registry", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should auto-detect and return adapter", async () => {
      const adapter = await runtime.get();

      assertExists(adapter);
      assertExists(adapter.id);
      assertExists(adapter.name);
      assertExists(adapter.fs);
      assertExists(adapter.env);
    });

    it("should return same instance on multiple calls", async () => {
      const adapter1 = await runtime.get();
      const adapter2 = await runtime.get();

      assertEquals(adapter1, adapter2);
    });

    it("should detect current runtime", async () => {
      const adapter = await runtime.get();
      assertEquals(adapter.id, expectedRuntime);
    });

    it("should report initialized status", async () => {
      assertEquals(runtime.isInitialized(), false);

      await runtime.get();

      assertEquals(runtime.isInitialized(), true);
    });

    it("should throw on getSync before initialization", () => {
      assertThrows(
        () => runtime.getSync(),
        Error,
        "RuntimeAdapter not initialized",
      );
    });

    it("should return adapter on getSync after initialization", async () => {
      await runtime.get();

      const adapter = runtime.getSync();
      assertExists(adapter);
      assertEquals(adapter.id, expectedRuntime);
    });
  });

  describe("runtime.set", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should allow setting custom adapter", async () => {
      await runtime.set(createMockAdapter());

      const adapter = await runtime.get();
      assertEquals(adapter.id, "memory");
    });

    it("should throw on invalid adapter", async () => {
      await assertRejects(
        () => runtime.set({} as any),
        Error,
        "Invalid adapter",
      );
    });

    it("should replace existing adapter", async () => {
      await runtime.get();
      assertEquals((await runtime.get()).id, expectedRuntime);

      await runtime.set(createMockAdapter());

      assertEquals((await runtime.get()).id, "memory");
    });
  });

  describe("runtime.reset", () => {
    it("should clear initialized state", async () => {
      await runtime.get();
      assertEquals(runtime.isInitialized(), true);

      await runtime.reset();

      assertEquals(runtime.isInitialized(), false);
    });

    it("should allow re-initialization after reset", async () => {
      await runtime.get();
      await runtime.reset();

      const adapter = await runtime.get();
      assertExists(adapter);
    });
  });

  describe("getLocalAdapter", () => {
    afterEach(async () => {
      await resetLocalAdapter();
    });

    it("should return local runtime adapter", async () => {
      const adapter = await getLocalAdapter();

      assertExists(adapter);
      assertEquals(adapter.id, expectedRuntime);
    });

    it("should return same instance on multiple calls", async () => {
      const adapter1 = await getLocalAdapter();
      const adapter2 = await getLocalAdapter();

      assertEquals(adapter1, adapter2);
    });

    it("should be independent from main runtime registry", async () => {
      await runtime.set(createMockAdapter());

      const localAdapter = await getLocalAdapter();

      assertEquals((await runtime.get()).id, "memory");
      assertEquals(localAdapter.id, expectedRuntime);
    });
  });

  describe("resetLocalAdapter", () => {
    it("should reset local adapter registry", async () => {
      const adapter1 = await getLocalAdapter();
      await resetLocalAdapter();
      const adapter2 = await getLocalAdapter();

      assertExists(adapter1);
      assertExists(adapter2);
    });
  });

  describe("concurrent access", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should handle concurrent get calls", async () => {
      const [a, b, c] = await Promise.all([runtime.get(), runtime.get(), runtime.get()]);

      assertEquals(a, b);
      assertEquals(b, c);
    });
  });
});
