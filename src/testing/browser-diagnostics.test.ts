import { assertEquals } from "@std/assert";
import { findHydrationOrCspFailures } from "./browser-diagnostics.mjs";

Deno.test("browser diagnostics retain hydration/CSP evidence and message order", () => {
  const messages = [
    "Server ready",
    "Page hydration failed: unavailable component",
    "Refused to load the script because of Content Security Policy",
    "Failed to fetch dynamically imported module: /chunk.js",
    "WebAssembly.compile() refused unsafe-eval",
    "Hydration boundary failed",
    "Page hydration failed: unavailable component",
  ];
  const original = [...messages];
  assertEquals(findHydrationOrCspFailures(messages), messages.slice(1));
  assertEquals(messages, original);
});

Deno.test("browser diagnostics leave ordinary console messages alone", () => {
  assertEquals(findHydrationOrCspFailures([]), []);
  assertEquals(findHydrationOrCspFailures(["Server ready", "Client mounted"]), []);
});
