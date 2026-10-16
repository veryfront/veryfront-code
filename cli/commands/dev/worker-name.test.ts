import { assertEquals, assertThrows } from "@std/assert";
import { resolveLocalWorkerName } from "./worker-name.ts";

Deno.test("local worker name prefers a trimmed explicit name over the hostname", () => {
  assertEquals(resolveLocalWorkerName("  Kentaro laptop  ", () => "host"), "Kentaro laptop");
});
Deno.test("local worker name uses hostname or safe fallback", () => {
  assertEquals(resolveLocalWorkerName("  ", () => "  developer-mac  "), "developer-mac");
  assertEquals(resolveLocalWorkerName(undefined, () => ""), "Local development");
  assertEquals(
    resolveLocalWorkerName(undefined, () => {
      throw new Error("unavailable");
    }),
    "Local development",
  );
});
Deno.test("local worker names respect the API 128 character limit", () => {
  assertEquals(resolveLocalWorkerName(undefined, () => "h".repeat(140)), "h".repeat(128));
  assertThrows(() => resolveLocalWorkerName("n".repeat(129), () => "host"), Error, "128");
});
