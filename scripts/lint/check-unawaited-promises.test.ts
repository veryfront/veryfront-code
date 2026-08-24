import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { findUnawaitedCleanupCalls } from "./check-unawaited-promises.ts";

const linesOf = (source: string) =>
  findUnawaitedCleanupCalls(source, "a.ts").map((finding) => finding.line);

// Spelled from parts so the ratchet, which scans scripts/, does not match this
// file's own fixtures.
const call = (name: string) => `${name}();`;
const destroy = call("renderer.destroy");
const cleanupRenderer = call("cleanupRenderer");
const cleanupBundler = call("cleanupBundler");

describe("findUnawaitedCleanupCalls", () => {
  it("flags statement-level calls to the known-async cleanups without await", () => {
    const source = [destroy, cleanupRenderer, cleanupBundler].join("\n");
    assertEquals(linesOf(source), [1, 2, 3]);
  });

  it("allows awaited, returned, and assigned calls", () => {
    const source = [
      `await ${destroy}`,
      `return ${cleanupRenderer}`,
      `const done = ${cleanupBundler}`,
    ].join("\n");
    assertEquals(linesOf(source), []);
  });

  it("skips comments and function declarations", () => {
    const source = [
      `// ${destroy}`,
      ` * ${cleanupRenderer}`,
      "async function cleanupBundler() {}",
    ].join("\n");
    assertEquals(linesOf(source), []);
  });

  it("names the pattern and the offending code", () => {
    const [finding] = findUnawaitedCleanupCalls(`  ${destroy}`, "a.ts");
    assertEquals(
      finding?.message,
      `renderer.destroy() called without await (async method): ${destroy}`,
    );
  });
});
