import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { afterEach, describe, it } from "jsr:@std/testing@1/bdd";
import { getLocalAdapter, resetLocalAdapter, runtime } from "./registry.ts";
import { createMockAdapter } from "./mock.ts";

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

    it("should detect deno runtime", async () => {
      const adapter = await runtime.get();
      assertEquals(adapter.id, "deno");
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
      assertEquals(adapter.id, "deno");
    });
  });

  describe("runtime.set", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should allow setting custom adapter", async () => {
      const mockAdapter = createMockAdapter();

      await runtime.set(mockAdapter);

      const adapter = await runtime.get();
      assertEquals(adapter.id, "memory");
    });

    it("should throw on invalid adapter", async () => {
      const invalidAdapter = {} as any;

      await assertRejects(
        () => runtime.set(invalidAdapter),
        Error,
        "Invalid adapter",
      );
    });

    it("should replace existing adapter", async () => {
      await runtime.get(); // Initialize with auto-detected
      assertEquals((await runtime.get()).id, "deno");

      const mockAdapter = createMockAdapter();
      await runtime.set(mockAdapter);

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
      assertEquals(adapter.id, "deno");
    });

    it("should return same instance on multiple calls", async () => {
      const adapter1 = await getLocalAdapter();
      const adapter2 = await getLocalAdapter();

      assertEquals(adapter1, adapter2);
    });

    it("should be independent from main runtime registry", async () => {
      const mockAdapter = createMockAdapter();
      await runtime.set(mockAdapter);

      const localAdapter = await getLocalAdapter();

      // Main registry has mock, local has real
      assertEquals((await runtime.get()).id, "memory");
      assertEquals(localAdapter.id, "deno");
    });
  });

  describe("resetLocalAdapter", () => {
    it("should reset local adapter registry", async () => {
      const adapter1 = await getLocalAdapter();
      await resetLocalAdapter();
      const adapter2 = await getLocalAdapter();

      // They should be from different registry instances
      // but still be the same singleton adapter
      assertExists(adapter1);
      assertExists(adapter2);
    });
  });

  describe("concurrent access", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should handle concurrent get calls", async () => {
      const results = await Promise.all([
        runtime.get(),
        runtime.get(),
        runtime.get(),
      ]);

      // All should return the same instance
      assertEquals(results[0], results[1]);
      assertEquals(results[1], results[2]);
    });
  });
});
