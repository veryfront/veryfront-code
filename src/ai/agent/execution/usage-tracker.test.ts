/**
 * Unit tests for UsageTracker
 *
 * Tests the token usage tracking functionality across multiple LLM provider calls.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { createUsageTracker, type ProviderUsage, UsageTracker } from "./usage-tracker.ts";

Deno.test("UsageTracker - initial state has all counters at zero", () => {
  const tracker = new UsageTracker();
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 0);
  assertEquals(total.completionTokens, 0);
  assertEquals(total.totalTokens, 0);
  assertEquals(total.callCount, 0);
});

Deno.test("UsageTracker - initial state hasUsage returns false", () => {
  const tracker = new UsageTracker();

  assertEquals(tracker.hasUsage(), false);
});

Deno.test("UsageTracker - add() with complete usage object updates all counters", () => {
  const tracker = new UsageTracker();
  const usage: ProviderUsage = {
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
  };

  tracker.add(usage);
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 100);
  assertEquals(total.completionTokens, 50);
  assertEquals(total.totalTokens, 150);
  assertEquals(total.callCount, 1);
});

Deno.test("UsageTracker - add() with partial usage handles undefined promptTokens", () => {
  const tracker = new UsageTracker();
  const usage: ProviderUsage = {
    promptTokens: undefined,
    completionTokens: 30,
    totalTokens: 30,
  };

  tracker.add(usage);
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 0);
  assertEquals(total.completionTokens, 30);
  assertEquals(total.totalTokens, 30);
  assertEquals(total.callCount, 1);
});

Deno.test("UsageTracker - add() with partial usage handles undefined completionTokens", () => {
  const tracker = new UsageTracker();
  const usage: ProviderUsage = {
    promptTokens: 80,
    completionTokens: undefined,
    totalTokens: 80,
  };

  tracker.add(usage);
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 80);
  assertEquals(total.completionTokens, 0);
  assertEquals(total.totalTokens, 80);
  assertEquals(total.callCount, 1);
});

Deno.test("UsageTracker - add() with partial usage handles undefined totalTokens", () => {
  const tracker = new UsageTracker();
  const usage: ProviderUsage = {
    promptTokens: 60,
    completionTokens: 40,
    totalTokens: undefined,
  };

  tracker.add(usage);
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 60);
  assertEquals(total.completionTokens, 40);
  assertEquals(total.totalTokens, 0);
  assertEquals(total.callCount, 1);
});

Deno.test("UsageTracker - add() with all fields undefined increments callCount only", () => {
  const tracker = new UsageTracker();
  const usage: ProviderUsage = {
    promptTokens: undefined,
    completionTokens: undefined,
    totalTokens: undefined,
  };

  tracker.add(usage);
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 0);
  assertEquals(total.completionTokens, 0);
  assertEquals(total.totalTokens, 0);
  assertEquals(total.callCount, 1);
});

Deno.test("UsageTracker - add() with undefined usage does not update counters", () => {
  const tracker = new UsageTracker();

  tracker.add(undefined);
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 0);
  assertEquals(total.completionTokens, 0);
  assertEquals(total.totalTokens, 0);
  assertEquals(total.callCount, 0);
});

Deno.test("UsageTracker - add() with empty object increments callCount only", () => {
  const tracker = new UsageTracker();
  const usage: ProviderUsage = {};

  tracker.add(usage);
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 0);
  assertEquals(total.completionTokens, 0);
  assertEquals(total.totalTokens, 0);
  assertEquals(total.callCount, 1);
});

Deno.test("UsageTracker - multiple add() calls aggregate correctly", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });
  tracker.add({ promptTokens: 150, completionTokens: 100, totalTokens: 250 });

  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 450);
  assertEquals(total.completionTokens, 225);
  assertEquals(total.totalTokens, 675);
  assertEquals(total.callCount, 3);
});

Deno.test("UsageTracker - multiple add() calls with mixed partial usage", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker.add({ promptTokens: undefined, completionTokens: 30, totalTokens: 30 });
  tracker.add({ promptTokens: 80, completionTokens: undefined, totalTokens: 80 });
  tracker.add({ promptTokens: 60, completionTokens: 40, totalTokens: undefined });

  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 240);
  assertEquals(total.completionTokens, 120);
  assertEquals(total.totalTokens, 260);
  assertEquals(total.callCount, 4);
});

Deno.test("UsageTracker - multiple add() calls with some undefined usage", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker.add(undefined);
  tracker.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });
  tracker.add(undefined);
  tracker.add({ promptTokens: 150, completionTokens: 100, totalTokens: 250 });

  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 450);
  assertEquals(total.completionTokens, 225);
  assertEquals(total.totalTokens, 675);
  assertEquals(total.callCount, 3);
});

Deno.test("UsageTracker - getTotal() returns correct aggregated values", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });

  const total = tracker.getTotal();

  assertEquals(typeof total, "object");
  assertEquals(Object.keys(total).length, 4);
  assertEquals(total.promptTokens, 300);
  assertEquals(total.completionTokens, 125);
  assertEquals(total.totalTokens, 425);
  assertEquals(total.callCount, 2);
});

Deno.test("UsageTracker - getTotal() can be called multiple times", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });

  const total1 = tracker.getTotal();
  const total2 = tracker.getTotal();

  assertEquals(total1, total2);
  assertEquals(total1.promptTokens, 100);
  assertEquals(total2.promptTokens, 100);
});

Deno.test("UsageTracker - reset() clears all counters", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });

  tracker.reset();
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 0);
  assertEquals(total.completionTokens, 0);
  assertEquals(total.totalTokens, 0);
  assertEquals(total.callCount, 0);
});

Deno.test("UsageTracker - reset() allows tracker to be reused", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker.reset();
  tracker.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });

  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 200);
  assertEquals(total.completionTokens, 75);
  assertEquals(total.totalTokens, 275);
  assertEquals(total.callCount, 1);
});

Deno.test("UsageTracker - reset() on empty tracker maintains zero state", () => {
  const tracker = new UsageTracker();

  tracker.reset();
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 0);
  assertEquals(total.completionTokens, 0);
  assertEquals(total.totalTokens, 0);
  assertEquals(total.callCount, 0);
});

Deno.test("UsageTracker - hasUsage() returns true after add with usage", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });

  assertEquals(tracker.hasUsage(), true);
});

Deno.test("UsageTracker - hasUsage() returns true after add with empty object", () => {
  const tracker = new UsageTracker();

  tracker.add({});

  assertEquals(tracker.hasUsage(), true);
});

Deno.test("UsageTracker - hasUsage() returns false after add with undefined", () => {
  const tracker = new UsageTracker();

  tracker.add(undefined);

  assertEquals(tracker.hasUsage(), false);
});

Deno.test("UsageTracker - hasUsage() returns false after reset", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker.reset();

  assertEquals(tracker.hasUsage(), false);
});

Deno.test("UsageTracker - hasUsage() returns true after multiple adds", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });

  assertEquals(tracker.hasUsage(), true);
});

Deno.test("UsageTracker - callCount increments correctly with each valid add", () => {
  const tracker = new UsageTracker();

  assertEquals(tracker.getTotal().callCount, 0);

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  assertEquals(tracker.getTotal().callCount, 1);

  tracker.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });
  assertEquals(tracker.getTotal().callCount, 2);

  tracker.add({ promptTokens: 150, completionTokens: 100, totalTokens: 250 });
  assertEquals(tracker.getTotal().callCount, 3);
});

Deno.test("UsageTracker - callCount does not increment for undefined usage", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  assertEquals(tracker.getTotal().callCount, 1);

  tracker.add(undefined);
  assertEquals(tracker.getTotal().callCount, 1);

  tracker.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });
  assertEquals(tracker.getTotal().callCount, 2);
});

Deno.test("UsageTracker - callCount increments even with all zero values", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

  assertEquals(tracker.getTotal().callCount, 1);
});

Deno.test("createUsageTracker - factory function creates new instance", () => {
  const tracker = createUsageTracker();

  assertEquals(tracker instanceof UsageTracker, true);
});

Deno.test("createUsageTracker - factory creates instance with initial state", () => {
  const tracker = createUsageTracker();
  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 0);
  assertEquals(total.completionTokens, 0);
  assertEquals(total.totalTokens, 0);
  assertEquals(total.callCount, 0);
  assertEquals(tracker.hasUsage(), false);
});

Deno.test("createUsageTracker - factory creates independent instances", () => {
  const tracker1 = createUsageTracker();
  const tracker2 = createUsageTracker();

  tracker1.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker2.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });

  assertEquals(tracker1.getTotal().promptTokens, 100);
  assertEquals(tracker2.getTotal().promptTokens, 200);
  assertEquals(tracker1.getTotal().callCount, 1);
  assertEquals(tracker2.getTotal().callCount, 1);
});

Deno.test("UsageTracker - handles large token counts", () => {
  const tracker = new UsageTracker();

  tracker.add({
    promptTokens: 1000000,
    completionTokens: 500000,
    totalTokens: 1500000,
  });
  tracker.add({
    promptTokens: 2000000,
    completionTokens: 750000,
    totalTokens: 2750000,
  });

  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 3000000);
  assertEquals(total.completionTokens, 1250000);
  assertEquals(total.totalTokens, 4250000);
  assertEquals(total.callCount, 2);
});

Deno.test("UsageTracker - handles zero values explicitly", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });

  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 100);
  assertEquals(total.completionTokens, 50);
  assertEquals(total.totalTokens, 150);
  assertEquals(total.callCount, 2);
});

Deno.test("UsageTracker - multiple resets work correctly", () => {
  const tracker = new UsageTracker();

  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  tracker.reset();
  tracker.add({ promptTokens: 200, completionTokens: 75, totalTokens: 275 });
  tracker.reset();
  tracker.add({ promptTokens: 300, completionTokens: 100, totalTokens: 400 });

  const total = tracker.getTotal();

  assertEquals(total.promptTokens, 300);
  assertEquals(total.completionTokens, 100);
  assertEquals(total.totalTokens, 400);
  assertEquals(total.callCount, 1);
});

Deno.test("UsageTracker - complex workflow simulation", () => {
  const tracker = new UsageTracker();

  // Initial state
  assertEquals(tracker.hasUsage(), false);

  // First call with complete usage
  tracker.add({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  assertEquals(tracker.hasUsage(), true);
  assertEquals(tracker.getTotal().callCount, 1);

  // Second call with partial usage
  tracker.add({ promptTokens: 80, completionTokens: undefined, totalTokens: 80 });
  assertEquals(tracker.getTotal().callCount, 2);

  // Undefined usage (no effect)
  tracker.add(undefined);
  assertEquals(tracker.getTotal().callCount, 2);

  // Third call with complete usage
  tracker.add({ promptTokens: 120, completionTokens: 60, totalTokens: 180 });

  // Verify totals
  const total = tracker.getTotal();
  assertEquals(total.promptTokens, 300);
  assertEquals(total.completionTokens, 110);
  assertEquals(total.totalTokens, 410);
  assertEquals(total.callCount, 3);

  // Reset and verify
  tracker.reset();
  assertEquals(tracker.hasUsage(), false);
  assertEquals(tracker.getTotal().promptTokens, 0);
  assertEquals(tracker.getTotal().callCount, 0);
});
