import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const BROWSER_SAFE_ENTRY_OUTPUTS = [
  "./npm/esm/src/chat/index.js",
  "./npm/esm/src/chat/index.d.ts",
  "./npm/esm/src/react/components/chat/chat.js",
  "./npm/esm/src/react/components/chat/chat.d.ts",
  "./npm/esm/src/chat/ag-ui.js",
  "./npm/esm/src/chat/ag-ui.d.ts",
  "./npm/esm/src/chat/protocol.js",
  "./npm/esm/src/chat/protocol.d.ts",
] as const;

const SHIM_FREE_BROWSER_MODULES = [
  "./npm/esm/src/agent/react/use-voice-input.js",
  "./npm/esm/src/react/components/chat/chat/hooks/use-threads.js",
  "./npm/esm/src/react/components/chat/chat/components/reasoning.js",
  "./npm/esm/src/react/components/chat/chat/components/code-block.js",
  "./npm/esm/src/react/components/chat/chat/components/message-actions.js",
  "./npm/esm/src/react/components/chat/chat/components/inline-citation.js",
  "./npm/esm/src/react/components/chat/markdown.js",
  "./npm/esm/src/security/client/html-sanitizer.js",
] as const;

describe("build-npm-dnt browser-safe chat outputs", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("keeps browser-safe chat entrypoints free of dnt shim baggage", async () => {
    const build = new Deno.Command("deno", {
      args: ["run", "-A", "scripts/build/build-npm-dnt.ts"],
      stdout: "inherit",
      stderr: "inherit",
    });
    const { code } = await build.output();
    assertEquals(code, 0);

    for (const path of BROWSER_SAFE_ENTRY_OUTPUTS) {
      const content = await Deno.readTextFile(path);
      assert(
        !content.includes("_dnt.polyfills.js"),
        `${path} should not import _dnt.polyfills.js`,
      );
    }

    for (const path of SHIM_FREE_BROWSER_MODULES) {
      const content = await Deno.readTextFile(path);
      assert(
        !content.includes("_dnt.shims.js"),
        `${path} should not import _dnt.shims.js`,
      );
      assert(
        !content.includes("dntGlobalThis"),
        `${path} should not reference dntGlobalThis`,
      );
      assert(
        !content.includes("@deno/shim-deno"),
        `${path} should not depend on @deno/shim-deno`,
      );
    }
  });
});
