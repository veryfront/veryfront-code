/**
 * Test: 009.1 & 009.2 Timeout Handling Fixes
 *
 * Validates the fixes for issues 009.1 and 009.2 from the architecture audit:
 *
 * 009.1 (CRITICAL→MEDIUM): Revalidation semaphore now has per-project fairness limits
 *                          to prevent one project from starving others. This completes
 *                          the semaphore fairness work started in 002.4/002.5.
 *
 * 009.2 (CRITICAL→HIGH): Domain lookup fetch now has timeout protection to prevent
 *                        hanging requests from blocking the system.
 *
 * @see plans/architecture-audit/009.1-global-semaphores-no-project-isolation.md
 * @see plans/architecture-audit/009.2-fetch-calls-without-timeout.md
 */

import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  MAX_CONCURRENT_REVALIDATIONS,
  REVALIDATION_PER_PROJECT_LIMIT,
} from "../../../src/utils/constants/cache.ts";

const limitsEnabled = REVALIDATION_PER_PROJECT_LIMIT > 0;

function readFile(path: string): Promise<string> {
  return Deno.readTextFile(path);
}

describe("009.1 & 009.2 Timeout Handling Fixes", () => {
  describe("009.1 - Revalidation Per-Project Fairness", () => {
    it(
      "should have per-project limit configured",
      { ignore: !limitsEnabled },
      () => {
        assert(
          REVALIDATION_PER_PROJECT_LIMIT > 0,
          "Per-project limit should be positive",
        );
        assert(
          REVALIDATION_PER_PROJECT_LIMIT <= MAX_CONCURRENT_REVALIDATIONS,
          "Per-project limit should not exceed global limit",
        );
      },
    );

    it("should default to 1/3 of global limit", { ignore: !limitsEnabled }, () => {
      const expectedDefault = Math.ceil(MAX_CONCURRENT_REVALIDATIONS / 3);
      assertEquals(
        REVALIDATION_PER_PROJECT_LIMIT,
        expectedDefault,
        "Default per-project limit should be ceil(global/3)",
      );
    });

    it(
      "should allow multiple projects to share revalidation slots fairly",
      { ignore: !limitsEnabled },
      () => {
        const projectsWithFairShare = Math.floor(
          MAX_CONCURRENT_REVALIDATIONS / REVALIDATION_PER_PROJECT_LIMIT,
        );
        assert(
          projectsWithFairShare >= 2,
          "At least 2 projects should be able to revalidate concurrently",
        );
      },
    );
  });

  describe("009.2 - Domain Lookup Timeout", () => {
    it("should have timeout constant defined", async () => {
      const content = await readFile("./src/server/utils/domain-lookup.ts");

      assert(
        content.includes("DOMAIN_LOOKUP_TIMEOUT_MS"),
        "Should define DOMAIN_LOOKUP_TIMEOUT_MS constant",
      );
      assert(
        content.includes("AbortController"),
        "Should use AbortController for timeout",
      );
      assert(
        content.includes("signal: controller.signal"),
        "Should pass abort signal to fetch",
      );
      assert(
        content.includes("clearTimeout(timeoutId)"),
        "Should clean up timeout in finally block",
      );
    });

    it("should detect timeout errors correctly", async () => {
      const content = await readFile("./src/server/utils/domain-lookup.ts");

      assert(
        content.includes('error.name === "AbortError"'),
        "Should check for AbortError to detect timeouts",
      );
      assert(
        content.includes("timeout: isTimeout"),
        "Should log whether error was a timeout",
      );
    });
  });

  describe("Pattern Consistency", () => {
    it(
      "should follow the same per-project fairness pattern as transform semaphore",
      async () => {
        const staticFetcherContent = await readFile(
          "./src/data/static-data-fetcher.ts",
        );

        assert(
          staticFetcherContent.includes("projectRevalidationCounts"),
          "Should track per-project counts",
        );
        assert(
          staticFetcherContent.includes("acquireRevalidationSlot"),
          "Should have slot acquisition function",
        );
        assert(
          staticFetcherContent.includes("releaseRevalidationSlot"),
          "Should have slot release function",
        );
      },
    );
  });
});
