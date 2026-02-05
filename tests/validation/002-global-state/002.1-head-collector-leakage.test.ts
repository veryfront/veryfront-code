/**
 * Test: 002.1 Head Collector - AsyncLocalStorage Isolation
 *
 * Validates the fix for issue 002.1 from the architecture audit:
 * - AsyncLocalStorage provides proper isolation between concurrent SSR requests
 * - No more cross-request metadata leakage
 *
 * @see plans/architecture-audit/002.1-head-collector-leakage.md
 */

import { assertEquals, assertNotEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { collectHead, runWithHeadCollector } from "../../../src/react/head-collector.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("002.1 Head Collector Isolation", () => {
  /**
   * Two concurrent SSR renders should have completely isolated head data.
   */
  it("concurrent requests are isolated with runWithHeadCollector", async () => {
    const renderA = runWithHeadCollector(async () => {
      collectHead({ title: "Project Alpha", description: "Alpha description" });
      await sleep(10);
      collectHead({ metas: [{ name: "og:title", content: "Alpha OG" }] });
      return "html-a";
    });

    const renderB = runWithHeadCollector(async () => {
      await sleep(5);
      collectHead({ title: "Project Beta", description: "Beta description" });
      await sleep(5);
      collectHead({ metas: [{ name: "og:title", content: "Beta OG" }] });
      return "html-b";
    });

    const [resultA, resultB] = await Promise.all([renderA, renderB]);

    assertEquals(resultA.head.title, "Project Alpha");
    assertEquals(resultA.head.description, "Alpha description");
    assertEquals(resultA.result, "html-a");

    assertEquals(resultB.head.title, "Project Beta");
    assertEquals(resultB.head.description, "Beta description");
    assertEquals(resultB.result, "html-b");

    assertNotEquals(resultA.head.title, resultB.head.title);
  });

  /**
   * Sequential requests work correctly.
   */
  it("sequential requests work correctly", async () => {
    const first = await runWithHeadCollector(async () => {
      collectHead({ title: "First Page", description: "First desc" });
      return "first-html";
    });

    assertEquals(first.head.title, "First Page");
    assertEquals(first.head.description, "First desc");

    const second = await runWithHeadCollector(async () => {
      collectHead({ title: "Second Page", description: "Second desc" });
      return "second-html";
    });

    assertEquals(second.head.title, "Second Page");
    assertEquals(second.head.description, "Second desc");

    assertNotEquals(first.head.title, second.head.title);
  });

  /**
   * Stress test with many concurrent requests.
   * All should get their own isolated metadata.
   */
  it("stress test: 10 concurrent requests all isolated", async () => {
    const NUM_REQUESTS = 10;
    const results = new Map<number, string>();

    async function renderRequest(id: number): Promise<void> {
      const { head } = await runWithHeadCollector(async () => {
        await sleep(Math.random() * 20);
        collectHead({ title: `Request-${id}` });
        await sleep(Math.random() * 10);
        return `html-${id}`;
      });

      results.set(id, head.title ?? "MISSING");
    }

    await Promise.all(
      Array.from({ length: NUM_REQUESTS }, (_, i) => renderRequest(i)),
    );

    let correctCount = 0;
    for (let i = 0; i < NUM_REQUESTS; i++) {
      if (results.get(i) === `Request-${i}`) correctCount++;
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
    collectHead({ title: "Orphan Title" });

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
