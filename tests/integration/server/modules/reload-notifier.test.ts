// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

/**
 * ReloadNotifier Tests
 *
 * Tests for the reload notification system:
 * - Subscription management
 * - Event triggering
 * - Debouncing behavior
 * - ChangedPaths support for smart HMR
 */

import { assert, assertEquals } from "@veryfront/testing/assert";
import { afterAll, afterEach, beforeEach, describe, it } from "@veryfront/testing/bdd";
import { delay } from "#veryfront/testing/deno-compat.ts";
import { ReloadNotifier } from "../../../../src/server/reload-notifier.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("ReloadNotifier Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  beforeEach(() => {
    ReloadNotifier.reset();
  });

  afterEach(() => {
    ReloadNotifier.reset();
  });

  afterAll(async () => {
    await cleanupBundler();
  });

  describe("ReloadNotifier - Subscription Management", () => {
    it("starts with zero listeners", () => {
      assertEquals(ReloadNotifier.getListenerCount(), 0);
      assertEquals(ReloadNotifier.getInvalidateListenerCount(), 0);
    });

    it("can subscribe and unsubscribe reload listeners", () => {
      const listener = () => {};

      assertEquals(ReloadNotifier.getListenerCount(), 0);

      const unsubscribe = ReloadNotifier.subscribe(listener);
      assertEquals(ReloadNotifier.getListenerCount(), 1);

      unsubscribe();
      assertEquals(ReloadNotifier.getListenerCount(), 0);
    });

    it("can subscribe and unsubscribe invalidate listeners", () => {
      const listener = () => {};

      assertEquals(ReloadNotifier.getInvalidateListenerCount(), 0);

      const unsubscribe = ReloadNotifier.subscribeInvalidate(listener);
      assertEquals(ReloadNotifier.getInvalidateListenerCount(), 1);

      unsubscribe();
      assertEquals(ReloadNotifier.getInvalidateListenerCount(), 0);
    });

    it("supports multiple listeners", () => {
      const listeners = [() => {}, () => {}, () => {}];
      const unsubscribers: (() => void)[] = [];

      for (const listener of listeners) {
        unsubscribers.push(ReloadNotifier.subscribe(listener));
      }

      assertEquals(ReloadNotifier.getListenerCount(), 3);

      // Unsubscribe in reverse order
      for (const unsub of unsubscribers.reverse()) {
        unsub();
      }

      assertEquals(ReloadNotifier.getListenerCount(), 0);
    });
  });

  describe("ReloadNotifier - Invalidate Events", () => {
    it("triggers invalidate listeners immediately", async () => {
      let invalidateCalled = false;

      const unsubscribe = ReloadNotifier.subscribeInvalidate(() => {
        invalidateCalled = true;
      });

      ReloadNotifier.triggerReload();

      // Invalidate should be called immediately (not debounced)
      assertEquals(invalidateCalled, true);

      unsubscribe();
    });
  });

  describe("ReloadNotifier - ChangedPaths Support", () => {
    it("passes changedPaths to reload listeners after debounce", async () => {
      let receivedPaths: string[] | undefined;

      const unsubscribe = ReloadNotifier.subscribe((paths) => {
        receivedPaths = paths;
      });

      ReloadNotifier.triggerReload(["pages/index.mdx", "components/Button.tsx"]);

      // Wait for debounce (300ms + buffer)
      await delay(400);

      assertEquals(receivedPaths?.length, 2);
      assert(receivedPaths?.includes("pages/index.mdx"));
      assert(receivedPaths?.includes("components/Button.tsx"));

      unsubscribe();
    });

    it("accumulates changedPaths during debounce window", async () => {
      let receivedPaths: string[] | undefined;

      const unsubscribe = ReloadNotifier.subscribe((paths) => {
        receivedPaths = paths;
      });

      // Trigger multiple times within debounce window
      ReloadNotifier.triggerReload(["pages/index.mdx"]);
      await delay(100);
      ReloadNotifier.triggerReload(["components/Button.tsx"]);
      await delay(100);
      ReloadNotifier.triggerReload(["lib/utils.ts"]);

      // Wait for debounce to complete
      await delay(500);

      // Should have all accumulated paths
      assertEquals(receivedPaths?.length, 3);
      assert(receivedPaths?.includes("pages/index.mdx"));
      assert(receivedPaths?.includes("components/Button.tsx"));
      assert(receivedPaths?.includes("lib/utils.ts"));

      unsubscribe();
    });

    it("deduplicates changedPaths", async () => {
      let receivedPaths: string[] | undefined;

      const unsubscribe = ReloadNotifier.subscribe((paths) => {
        receivedPaths = paths;
      });

      // Trigger same path multiple times
      ReloadNotifier.triggerReload(["pages/index.mdx"]);
      await delay(50);
      ReloadNotifier.triggerReload(["pages/index.mdx"]);
      await delay(50);
      ReloadNotifier.triggerReload(["pages/index.mdx"]);

      // Wait for debounce
      await delay(400);

      // Should only have one entry (deduplicated via Set)
      assertEquals(receivedPaths?.length, 1);
      assertEquals(receivedPaths?.[0], "pages/index.mdx");

      unsubscribe();
    });

    it("handles empty changedPaths array", async () => {
      let receivedPaths: string[] | undefined;

      const unsubscribe = ReloadNotifier.subscribe((paths) => {
        receivedPaths = paths;
      });

      ReloadNotifier.triggerReload([]);

      // Wait for debounce
      await delay(400);

      // Should be undefined when no paths provided
      assertEquals(receivedPaths, undefined);

      unsubscribe();
    });

    it("handles undefined changedPaths", async () => {
      let receivedPaths: string[] | undefined;

      const unsubscribe = ReloadNotifier.subscribe((paths) => {
        receivedPaths = paths;
      });

      ReloadNotifier.triggerReload();

      // Wait for debounce
      await delay(400);

      // Should be undefined when no paths provided
      assertEquals(receivedPaths, undefined);

      unsubscribe();
    });
  });

  describe("ReloadNotifier - Error Handling", () => {
    it("continues notifying other listeners if one throws", async () => {
      let secondListenerCalled = false;

      const unsubscribe1 = ReloadNotifier.subscribe(() => {
        throw new Error("Listener error");
      });

      const unsubscribe2 = ReloadNotifier.subscribe(() => {
        secondListenerCalled = true;
      });

      ReloadNotifier.triggerReload();

      // Wait for debounce
      await delay(400);

      // Second listener should still be called
      assertEquals(secondListenerCalled, true);

      unsubscribe1();
      unsubscribe2();
    });
  });
});