import "#veryfront/schemas/_test-setup.ts";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BINARY_TAILWIND_PLUGIN_PACKAGES } from "#veryfront/build/binary-plugin-includes.ts";
import { bareName, TAILWIND_PLUGIN_ALLOWLIST } from "./tailwind-plugin-allowlist.ts";

describe("styles-builder/tailwind-plugin-allowlist drift", () => {
  it("every bundled binary plugin is on the allowlist", () => {
    const missing: string[] = [];
    for (const spec of BINARY_TAILWIND_PLUGIN_PACKAGES) {
      const name = bareName(spec);
      if (!TAILWIND_PLUGIN_ALLOWLIST.has(name)) missing.push(name);
    }
    assert(
      missing.length === 0,
      `BINARY_TAILWIND_PLUGIN_PACKAGES includes package(s) not on the ` +
        `Tailwind plugin allowlist: ${missing.join(", ")}. Bundling a plugin ` +
        `without allowlisting it makes it unloadable at runtime. Add the ` +
        `missing name(s) to TAILWIND_PLUGIN_ALLOWLIST after review.`,
    );
  });
});
