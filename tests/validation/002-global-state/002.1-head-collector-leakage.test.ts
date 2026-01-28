/**
 * Test: 002.1 Head Collector - AsyncLocalStorage Isolation
 *
 * Validates the fix for issue 002.1 from the architecture audit:
 * - AsyncLocalStorage provides proper isolation between concurrent SSR requests
 * - No more cross-request metadata leakage
 *
 * @see plans/architecture-audit/002.1-head-collector-leakage.md
 */

import { assertEquals, assertNotEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import {
  collectHead,
  runWithHeadCollector,
} from "../../../src/react/head-collector.ts";

describe("002.1 Head Collector Isolation", () => {
  /**
   * Two concurrent SSR renders should have completely isolated head data.
   */
  it("concurrent requests are isolated with runWithHeadCollector", async () => {
    // Create two concurrent SSR renders
    const renderA = runWithHeadCollector(async () => {
      collectHead({ title: "Project Alpha", description: "Alpha description" });
      // Simulate async rendering work
      await new Promise((resolve) => setTimeout(resolve, 10));
      collectHead({ metas: [{ name: "og:title", content: "Alpha OG" }] });
      return "html-a";
    });

    const renderB = runWithHeadCollector(async () => {
      // Small delay to interleave with A
      await new Promise((resolve) => setTimeout(resolve, 5));
      collectHead({ title: "Project Beta", description: "Beta description" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      collectHead({ metas: [{ name: "og:title", content: "Beta OG" }] });
      return "html-b";
    });

    // Run both concurrently
    const [resultA, resultB] = await Promise.all([renderA, renderB]);

    // Each should have its own isolated head data
    assertEquals(resultA.head.title, "Project Alpha");
    assertEquals(resultA.head.description, "Alpha description");
    assertEquals(resultA.result, "html-a");

    assertEquals(resultB.head.title, "Project Beta");
    assertEquals(resultB.head.description, "Beta description");
    assertEquals(resultB.result, "html-b");

    // Verify no cross-contamination
    assertNotEquals(resultA.head.title, resultB.head.title);
  });

  /**
   * Sequential requests work correctly.
   */
  it("sequential requests work correctly", async () => {
    // First request
    const first = await runWithHeadCollector(async () => {
      collectHead({ title: "First Page", description: "First desc" });
      return "first-html";
    });

    assertEquals(first.head.title, "First Page");
    assertEquals(first.head.description, "First desc");

    // Second request (after first completes)
    const second = await runWithHeadCollector(async () => {
      collectHead({ title: "Second Page", description: "Second desc" });
      return "second-html";
    });

    assertEquals(second.head.title, "Second Page");
    assertEquals(second.head.description, "Second desc");

    // Verify they're different
    assertNotEquals(first.head.title, second.head.title);
  });

  /**
   * Stress test with many concurrent requests.
   * All should get their own isolated metadata.
   */
  it("stress test: 10 concurrent requests all isolated", async () => {
    const NUM_REQUESTS = 10;
    const results: Map<number, string> = new Map();

    const renderRequest = async (id: number) => {
      const { head } = await runWithHeadCollector(async () => {
        // Random delay to increase interleaving
        await new Promise((r) => setTimeout(r, Math.random() * 20));
        collectHead({ title: `Request-${id}` });
        // Simulate async render
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        return `html-${id}`;
      });
      results.set(id, head.title ?? "MISSING");
    };

    // Launch all requests concurrently
    const requests = Array.from({ length: NUM_REQUESTS }, (_, i) =>
      renderRequest(i)
    );
    await Promise.all(requests);

    // Each request should have gotten its own title back
    let correctCount = 0;
    for (let i = 0; i < NUM_REQUESTS; i++) {
      if (results.get(i) === `Request-${i}`) {
        correctCount++;
      }
    }

    assertEquals(
      correctCount,
      NUM_REQUESTS,
      `All ${NUM_REQUESTS} requests should get correct title with AsyncLocalStorage`,
    );
  });

  /**
   * collectHead outside of context is a safe no-op.
   */
  it("collectHead outside context is silently ignored", async () => {
    // This should not throw, just silently ignore
    collectHead({ title: "Orphan Title" });

    // Within context, data is collected
    const { head } = await runWithHeadCollector(async () => {
      collectHead({ title: "Proper Title" });
      return "html";
    });

    assertEquals(head.title, "Proper Title");
  });

  /**
   * Metas accumulate correctly within a single context.
   */
  it("metas accumulate within context", async () => {
    const { head } = await runWithHeadCollector(async () => {
      collectHead({ metas: [{ name: "author", content: "Alice" }] });
      collectHead({ metas: [{ name: "keywords", content: "test,example" }] });
      return "html";
    });

    assertEquals(head.metas.length, 2);
    assertEquals(head.metas[0]?.name, "author");
    assertEquals(head.metas[1]?.name, "keywords");
  });
});
