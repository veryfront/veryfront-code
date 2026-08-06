import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dynamicImport } from "./dynamic-import.ts";

describe("platform/compat/dynamic-import", () => {
  it("should be a function", () => {
    assertEquals(typeof dynamicImport, "function");
  });

  it("should import a built-in module", async () => {
    const mod = await dynamicImport<{ join: (...args: unknown[]) => unknown }>("node:path");
    assertExists(mod);
    assertEquals(typeof mod.join, "function");
  });

  it("should reject for a non-existent module", async () => {
    await assertRejects(
      () => dynamicImport("__nonexistent_module_12345__"),
    );
  });

  // This module is reachable from client bundles (veryfront/chat, /mdx,
  // /workflow pull it in transitively). Project pages are served with
  // `script-src 'self' 'nonce-...' https://esm.sh` — no 'unsafe-eval' — so a
  // `new Function` here throws EvalError in the browser and blanks the page
  // before hydration starts.
  it("should not use new Function, which the page CSP blocks", () => {
    const source = Deno.readTextFileSync(new URL("./dynamic-import.ts", import.meta.url));
    assertEquals(
      /\bnew Function\s*\(/.test(source),
      false,
      "dynamic-import.ts must not use new Function — project CSP forbids 'unsafe-eval'",
    );
  });
});
