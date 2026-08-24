import "#veryfront/schemas/_test-setup.ts";
/**
 * Test that all polyfill paths referenced by the import rewriter
 * have corresponding entries in EMBEDDED_POLYFILLS.
 *
 * This prevents the scenario where a polyfill works in dev mode
 * (files exist on disk) but fails in production (compiled binary
 * doesn't have the file in VFS).
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { getRequiredPolyfillPaths } from "#veryfront/transforms/import-rewriter/strategies/node-builtin-strategy.ts";
import { EMBEDDED_POLYFILLS } from "#veryfront/modules/server/module-server.ts";
import { VERSION } from "#veryfront/utils";

describe("Embedded Polyfills", () => {
  it("all import-rewritten polyfill paths have embedded content", () => {
    const requiredPaths = getRequiredPolyfillPaths();
    const embeddedPaths = new Set(Object.keys(EMBEDDED_POLYFILLS));

    const missing = requiredPaths.filter((path) => !embeddedPaths.has(path));

    if (missing.length > 0) {
      throw new Error(
        `Polyfill paths rewritten but not embedded (will fail in compiled binary):\n` +
          missing.map((p) => `  - ${p}`).join("\n") +
          `\n\nAdd these to EMBEDDED_POLYFILLS in src/modules/server/module-server.ts`,
      );
    }

    assertEquals(missing, []);
  });

  it("embedded polyfills have non-empty content", () => {
    for (const [path, content] of Object.entries(EMBEDDED_POLYFILLS)) {
      if (!content || content.trim().length === 0) {
        throw new Error(`Embedded polyfill has empty content: ${path}`);
      }
    }
  });

  it("embedded polyfills export something", () => {
    for (const [path, content] of Object.entries(EMBEDDED_POLYFILLS)) {
      if (!content.includes("export")) {
        throw new Error(
          `Embedded polyfill has no exports: ${path}\n` +
            `Content must include 'export' statement`,
        );
      }
    }
  });

  it("dnt shim polyfills exist with _veryfront/ prefix", () => {
    const keys = Object.keys(EMBEDDED_POLYFILLS);
    assertEquals(keys.includes("_veryfront/_dnt.shims"), true);
    assertEquals(keys.includes("_veryfront/_dnt.polyfills"), true);
  });

  it("dnt shim polyfills exist without prefix (for relative imports)", () => {
    const keys = Object.keys(EMBEDDED_POLYFILLS);
    assertEquals(keys.includes("_dnt.shims"), true);
    assertEquals(keys.includes("_dnt.polyfills"), true);
  });

  it("dnt shims polyfill exports dntGlobalThis", () => {
    const content = EMBEDDED_POLYFILLS["_veryfront/_dnt.shims"] ?? "";
    assertEquals(content.includes("dntGlobalThis"), true);
  });

  it("dnt shims polyfill exports fetch with bind to avoid illegal invocation", () => {
    for (const key of ["_veryfront/_dnt.shims", "_dnt.shims"]) {
      const content = EMBEDDED_POLYFILLS[key] ?? "";
      assertStringIncludes(
        content,
        "export const fetch = globalThis.fetch.bind(globalThis);",
        `${key}: fetch must be exported bound to globalThis`,
      );
      assertStringIncludes(
        content,
        "export const setTimeout = globalThis.setTimeout.bind(globalThis);",
        `${key}: setTimeout must be exported bound to globalThis`,
      );
      assertStringIncludes(
        content,
        "export const setInterval = globalThis.setInterval.bind(globalThis);",
        `${key}: setInterval must be exported bound to globalThis`,
      );
    }
  });

  it("prefixed and unprefixed dnt shim entries have identical content", () => {
    assertEquals(
      EMBEDDED_POLYFILLS["_veryfront/_dnt.shims"],
      EMBEDDED_POLYFILLS["_dnt.shims"],
    );
    assertEquals(
      EMBEDDED_POLYFILLS["_veryfront/_dnt.polyfills"],
      EMBEDDED_POLYFILLS["_dnt.polyfills"],
    );
  });

  it("dnt-relative deno.js uses the #deno-config browser module", () => {
    const keys = Object.keys(EMBEDDED_POLYFILLS);
    assertEquals(
      keys.includes("deno"),
      true,
      "compiled binaries must embed the dnt-relative deno.js stub",
    );
    assertEquals(
      keys.includes("_veryfront/_deno-config"),
      true,
      "compiled binaries must embed the #deno-config stub",
    );
    assertEquals(
      EMBEDDED_POLYFILLS["deno"],
      EMBEDDED_POLYFILLS["_veryfront/_deno-config"],
      "the dnt-relative stub must match the #deno-config stub",
    );
    assertEquals(
      EMBEDDED_POLYFILLS["deno"],
      `export default ${JSON.stringify({ version: VERSION })};\n`,
      "the deno-config stub must be a JS module exporting { version }",
    );
  });
});
