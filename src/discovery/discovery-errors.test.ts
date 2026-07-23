import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { recordDiscoveryError } from "./discovery-errors.ts";
import type { DiscoveryError } from "./types.ts";

Deno.test("discovery error collection is generation-bounded", () => {
  const errors: DiscoveryError[] = [];
  const entry = { file: "tools/broken.ts", error: new Error("invalid definition") };
  for (let index = 0; index < 10_000; index++) recordDiscoveryError(errors, entry);

  assertThrows(
    () => recordDiscoveryError(errors, entry),
    RangeError,
    "error limit exceeded",
  );
  assertEquals(errors.length, 10_000);
});
